import { NextRequest, NextResponse } from 'next/server';
import { getMultiAgentGenerator, JobDetails, ProposalLength, ProposalIntensity } from '@/lib/multi-agent-proposal';
import { auth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import User from '@/lib/db/user';
import { Proposal } from '@/lib/db/models';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.title && !body.rawJobData) {
      return NextResponse.json(
        { error: 'Job title or raw job data is required' },
        { status: 400 }
      );
    }

    // Get user profile if authenticated
    let userProfile = body.userProfile || undefined;
    let userId: string | undefined;
    
    const session = await auth();
    if (session?.user?.id) {
      userId = session.user.id;
      if (!userProfile) {
        try {
          await connectToDatabase();
          // Include 'name' so we can sign proposals with the user's actual name
          const user = await User.findById(session.user.id).select('name profile').lean();
          if (user?.profile) {
            userProfile = {
              ...user.profile,
              name: user.name, // Add the user's name to the profile for signing
            };
            // Debug: Log what we have in profile
            console.log('Profile data loaded:', {
              name: userProfile.name,
              hasAdditionalDetails: !!userProfile.additionalDetails,
              additionalDetailsLength: userProfile.additionalDetails?.length || 0,
              hasResumeText: !!userProfile.resumeText,
              resumeTextLength: userProfile.resumeText?.length || 0,
            });
          }
        } catch (error) {
          console.error('Failed to fetch user profile:', error);
        }
      }
    }

    // Validate proposalLength and intensity
    const proposalLength: ProposalLength = body.proposalLength === 'short' ? 'short' : 'full';
    
    // Extract intensity (priority: explicit intensity > derive from length > default)
    const intensity: ProposalIntensity | undefined = 
      body.intensity === 'ultra-short' ? 'ultra-short' :
      body.intensity === 'full' ? 'full' :
      undefined; // Let determineIntensity() handle fallback from proposalLength

    // If raw job data is provided, use it as description
    const description = body.rawJobData || body.description || '';
    const title = body.title || 'Untitled Job';

    // Client name extraction is handled dynamically by the AI parser
    // Don't use hardcoded regex patterns - let the AI figure it out
    const clientName = body.clientName || undefined;

    const jobDetails: JobDetails = {
      title,
      description,
      clientName,
      budget: body.budget,
      skills: body.skills,
      additionalContext: body.additionalContext,
      userProfile,
      proposalLength,
      intensity, // Add explicit intensity parameter
      userId,
      screeningQuestions: body.screeningQuestions,
    };

    // Use multi-agent generator
    const generator = getMultiAgentGenerator();
    const result = await generator.generate(jobDetails);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to generate proposal' },
        { status: 500 }
      );
    }

    // Save to database
    let savedProposalId: string | undefined;
    try {
      await connectToDatabase();
      const savedProposal = await Proposal.create({
        userId: userId || undefined,
        jobTitle: title,
        jobDescription: description,
        clientName,
        budget: body.budget,
        skills: body.skills || [],
        generatedProposal: result.proposal,
        proposalLength,
        modelUsed: result.modelUsed,
        tokensUsed: result.tokensUsed,
        generationTime: result.generationTime,
        screeningAnswers: result.screeningAnswers || [],
        outcome: 'pending',
      });
      savedProposalId = (savedProposal as unknown as { _id: { toString: () => string } })._id.toString();
    } catch (error) {
      console.error('Failed to save proposal:', error);
    }

    return NextResponse.json({
      success: true,
      data: {
        proposal: result.proposal,
        proposalLength: result.proposalLength,
        intensity: result.intensity, // Return actual intensity used
        analysis: result.analysis, // Return quality metrics
        screeningAnswers: result.screeningAnswers,
        reviewFeedback: result.reviewFeedback,
        modelUsed: result.modelUsed,
        tokensUsed: result.tokensUsed,
        generationTime: result.generationTime,
        agentIterations: result.agentIterations,
        proposalId: savedProposalId,
      },
    });
  } catch (error) {
    console.error('Multi-agent proposal generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
