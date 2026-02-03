import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getLoadBalancer } from '@/lib/groq-load-balancer';
import { UserProfile } from '@/lib/proposal-generator';

// System prompt for answering job questions
const QUESTION_ANSWERING_SYSTEM_PROMPT = `You are an expert Upwork freelancer who answers job posting questions strategically to win contracts.

## YOUR APPROACH:

### 1. UNDERSTAND THE QUESTION'S PURPOSE
- What is the client really trying to assess?
- Is this a skills question, availability question, or culture fit question?
- What would make them confident in hiring you?

### 2. ANSWER STRUCTURE
- Be direct and confident - start with a clear answer
- Provide brief supporting evidence or examples
- Keep it concise (2-4 sentences usually)
- End with something that moves the conversation forward

### 3. TONE GUIDELINES
- Professional but personable
- Confident without being arrogant
- Specific rather than generic
- Show genuine interest in their project

### 4. COMMON QUESTION TYPES:
- **Experience questions**: Give specific, relevant examples with outcomes
- **Availability questions**: Be clear about your schedule and communication
- **Process questions**: Show you have a systematic approach
- **Rate/Budget questions**: Be professional, focus on value
- **Technical questions**: Demonstrate knowledge concisely

### 5. AVOID:
- Generic responses that could apply to anyone
- Overly long answers
- Desperation or over-promising
- Ignoring specific details they asked about

IMPORTANT: Your answer should be ready to paste directly into Upwork. No preamble, no "Here's my answer:" - just the answer itself.`;

interface AnswerQuestionRequest {
  question: string;
  jobContext: string;
  proposalContext?: string;
  userProfile?: UserProfile;
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body: AnswerQuestionRequest = await request.json();
    const { question, jobContext, proposalContext, userProfile } = body;

    if (!question || !question.trim()) {
      return NextResponse.json(
        { error: 'Question is required' },
        { status: 400 }
      );
    }

    if (!jobContext || !jobContext.trim()) {
      return NextResponse.json(
        { error: 'Job context is required' },
        { status: 400 }
      );
    }

    // Build the user prompt
    let userPrompt = `**JOB POSTING:**\n${jobContext}\n\n`;
    
    if (proposalContext) {
      userPrompt += `**MY PROPOSAL (for context and consistency):**\n${proposalContext}\n\n`;
    }

    // Add user profile context
    if (userProfile) {
      userPrompt += `**MY BACKGROUND:**\n`;
      
      if (userProfile.title) {
        userPrompt += `- Professional Title: ${userProfile.title}\n`;
      }
      if (userProfile.summary) {
        userPrompt += `- Summary: ${userProfile.summary}\n`;
      }
      if (userProfile.yearsExperience) {
        userPrompt += `- Years of Experience: ${userProfile.yearsExperience}\n`;
      }
      if (userProfile.skills && userProfile.skills.length > 0) {
        userPrompt += `- Skills: ${userProfile.skills.join(', ')}\n`;
      }
      if (userProfile.specializations && userProfile.specializations.length > 0) {
        userPrompt += `- Specializations: ${userProfile.specializations.join(', ')}\n`;
      }
      if (userProfile.achievements && userProfile.achievements.length > 0) {
        userPrompt += `- Key Achievements:\n`;
        userProfile.achievements.forEach(a => {
          userPrompt += `  • ${a}\n`;
        });
      }
      if (userProfile.certifications && userProfile.certifications.length > 0) {
        userPrompt += `- Certifications: ${userProfile.certifications.join(', ')}\n`;
      }
      if (userProfile.availability) {
        userPrompt += `- Availability: ${userProfile.availability}\n`;
      }
      if (userProfile.timezone) {
        userPrompt += `- Timezone: ${userProfile.timezone}\n`;
      }
      if (userProfile.hourlyRate) {
        userPrompt += `- Hourly Rate: ${userProfile.hourlyRate}\n`;
      }
      
      // Add resume content if available
      if (userProfile.resumeText && userProfile.resumeText.length > 100) {
        const resumeContent = userProfile.resumeText.length > 2000 
          ? userProfile.resumeText.substring(0, 2000) + '...[truncated]'
          : userProfile.resumeText;
        userPrompt += `\n- Resume/CV Content:\n${resumeContent}\n`;
      }
      
      // Add additional details if provided
      if (userProfile.additionalDetails) {
        userPrompt += `\n- Additional Context: ${userProfile.additionalDetails}\n`;
      }
      
      userPrompt += '\n';
    }

    userPrompt += `**QUESTION TO ANSWER:**\n${question}\n\n`;
    userPrompt += `Write a compelling, specific answer to this question. The answer should be ready to paste directly into Upwork.`;

    // Get load balancer and generate answer
    const loadBalancer = await getLoadBalancer();
    
    const result = await loadBalancer.chatCompletion(
      [
        { role: 'system', content: QUESTION_ANSWERING_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      {
        temperature: 0.7,
        maxTokens: 500, // Keep answers concise
      }
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to generate answer' },
        { status: 500 }
      );
    }

    // Clean up the answer
    let answer = result.content.trim();
    
    // Remove any "Here's my answer:" type prefixes
    const prefixPatterns = [
      /^(here'?s?\s+(my\s+)?answer:?\s*)/i,
      /^(my\s+answer:?\s*)/i,
      /^(answer:?\s*)/i,
    ];
    
    for (const pattern of prefixPatterns) {
      answer = answer.replace(pattern, '');
    }
    
    answer = answer.trim();

    return NextResponse.json({
      success: true,
      data: {
        answer,
        modelUsed: result.modelUsed,
        tokensUsed: result.totalTokens,
      },
    });
  } catch (error) {
    console.error('Answer question error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate answer' },
      { status: 500 }
    );
  }
}
