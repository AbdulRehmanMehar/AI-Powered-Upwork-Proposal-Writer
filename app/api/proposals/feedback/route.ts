import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import { Proposal, UserFeedbackLearning } from '@/lib/db/models';
import { getLoadBalancer } from '@/lib/ollama-client';

// ============================================
// Feedback Reviewer System Prompt
// ============================================

const FEEDBACK_REVIEWER_PROMPT = `You are a proposal quality analyst. Your job is to extract actionable learning rules from user feedback.

The user just reviewed a generated proposal and said what was wrong with it. Extract the KEY LEARNING that should be applied to ALL future proposals.

## RULES FOR EXTRACTION:

1. **Be specific** - "Don't use 'we'" is good, "write better" is not
2. **Make it actionable** - The writer should know exactly what to do/avoid
3. **Categorize correctly** - Pick the most relevant category
4. **Assess severity** - Is this critical (proposal-breaking), important (affects quality), or minor (stylistic)?

## OUTPUT FORMAT (JSON only, no markdown):

{
  "learningCategory": "hook" | "proof" | "tone" | "formatting" | "length" | "relevance" | "signature" | "banned_phrase" | "other",
  "learningRule": "The specific actionable rule (e.g., 'Never start with \"I am a\"', 'Keep proof to ONE project only')",
  "severity": "critical" | "important" | "minor",
  "reasoning": "Brief explanation of why this matters"
}

## CATEGORY DEFINITIONS:

- **hook**: First sentence issues (boring, generic, doesn't grab attention)
- **proof**: Portfolio/project examples (too many, irrelevant, hallucinated)
- **tone**: Voice issues (too formal, robotic, corporate-speak)
- **formatting**: Structure issues (too long paragraphs, wrong signature format)
- **length**: Word count issues (too long, too short)
- **relevance**: Not matching job requirements
- **signature**: Name/closing format issues
- **banned_phrase**: Using phrases like "we", "excited to", etc.
- **other**: Anything else

IMPORTANT: Respond with ONLY the JSON object, no explanation before or after.`;

// ============================================
// API Handler
// ============================================

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { proposalId, feedback, originalProposal, jobType, clientType } = body;

    // Validate required fields
    if (!proposalId || !feedback) {
      return NextResponse.json(
        { error: 'proposalId and feedback are required' },
        { status: 400 }
      );
    }

    if (!feedback.trim() || feedback.length < 10) {
      return NextResponse.json(
        { error: 'Please provide more detailed feedback (at least 10 characters)' },
        { status: 400 }
      );
    }

    await connectToDatabase();

    // Get the original proposal if not provided
    let proposalText = originalProposal;
    if (!proposalText) {
      const proposal = await Proposal.findById(proposalId);
      if (!proposal) {
        return NextResponse.json(
          { error: 'Proposal not found' },
          { status: 404 }
        );
      }
      proposalText = proposal.generatedProposal;
    }

    // Call AI to extract learning from feedback
    const loadBalancer = getLoadBalancer();
    
    const userPrompt = `## PROPOSAL THAT WAS REVIEWED:
${proposalText}

## USER'S FEEDBACK:
${feedback}

Extract the key learning rule from this feedback.`;

    const result = await loadBalancer.chatCompletion(
      [
        { role: 'system', content: FEEDBACK_REVIEWER_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      {
        temperature: 0.3, // Low temp for consistent extraction
        maxTokens: 500,
      }
    );

    if (!result.success) {
      console.error('Failed to extract learning:', result.error);
      return NextResponse.json(
        { error: 'Failed to process feedback. Please try again.' },
        { status: 500 }
      );
    }

    // Parse the AI response
    let learningData;
    try {
      // Clean up response - remove markdown code blocks if present
      let cleanContent = result.content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.slice(7);
      }
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith('```')) {
        cleanContent = cleanContent.slice(0, -3);
      }
      learningData = JSON.parse(cleanContent.trim());
    } catch (parseError) {
      console.error('Failed to parse AI response:', result.content);
      return NextResponse.json(
        { error: 'Failed to extract learning from feedback' },
        { status: 500 }
      );
    }

    // Validate the extracted learning
    const validCategories = ['hook', 'proof', 'tone', 'formatting', 'length', 'relevance', 'signature', 'banned_phrase', 'other'];
    const validSeverities = ['critical', 'important', 'minor'];

    if (!validCategories.includes(learningData.learningCategory)) {
      learningData.learningCategory = 'other';
    }
    if (!validSeverities.includes(learningData.severity)) {
      learningData.severity = 'important';
    }

    // Save the learning to database
    const learning = await UserFeedbackLearning.create({
      userId: session.user.id,
      proposalId,
      originalProposal: proposalText,
      userFeedback: feedback,
      learningCategory: learningData.learningCategory,
      learningRule: learningData.learningRule,
      severity: learningData.severity,
      jobType: jobType || undefined,
      clientType: clientType || undefined,
      timesApplied: 0,
    });

    return NextResponse.json({
      success: true,
      data: {
        learningId: learning._id.toString(),
        extractedLearning: {
          category: learningData.learningCategory,
          rule: learningData.learningRule,
          severity: learningData.severity,
          reasoning: learningData.reasoning,
        },
        tokensUsed: result.totalTokens,
        modelUsed: result.modelUsed,
      },
    });
  } catch (error) {
    console.error('Feedback processing error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================
// GET - Retrieve user's learnings
// ============================================

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    await connectToDatabase();

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const severity = searchParams.get('severity');
    const limit = parseInt(searchParams.get('limit') || '20');

    // Build query
    const query: Record<string, unknown> = { userId: session.user.id };
    if (category) query.learningCategory = category;
    if (severity) query.severity = severity;

    // Get learnings, sorted by severity (critical first) then recency
    const learnings = await UserFeedbackLearning.find(query)
      .sort({ 
        severity: 1, // critical < important < minor alphabetically, so this puts critical first
        createdAt: -1 
      })
      .limit(limit)
      .lean();

    // Get stats
    const stats = await UserFeedbackLearning.aggregate([
      { $match: { userId: session.user.id } },
      {
        $group: {
          _id: '$learningCategory',
          count: { $sum: 1 },
          criticalCount: {
            $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] },
          },
        },
      },
    ]);

    return NextResponse.json({
      success: true,
      data: {
        learnings,
        stats: stats.reduce((acc, s) => {
          acc[s._id] = { total: s.count, critical: s.criticalCount };
          return acc;
        }, {} as Record<string, { total: number; critical: number }>),
        total: learnings.length,
      },
    });
  } catch (error) {
    console.error('Failed to get learnings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
