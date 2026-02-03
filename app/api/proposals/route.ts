import { NextRequest, NextResponse } from 'next/server';
import { getProposalGenerator, JobDetails, ProposalLength } from '@/lib/proposal-generator';
import { auth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import User from '@/lib/db/user';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.title || !body.description) {
      return NextResponse.json(
        { error: 'Job title and description are required' },
        { status: 400 }
      );
    }

    // Get user profile if authenticated
    let userProfile = body.userProfile || undefined;
    let userId: string | undefined;
    
    // If no profile provided in body, try to fetch from session
    const session = await auth();
    if (session?.user?.id) {
      userId = session.user.id;
      if (!userProfile) {
        try {
          await connectToDatabase();
          // Include 'name' so we can sign proposals with the user's actual name
          // Include GitHub fields for real project examples
          const user = await User.findById(session.user.id)
            .select('name profile')
            .lean();
          if (user?.profile) {
            // Parse GitHub projects from cache if available
            let githubProjects = undefined;
            if (user.profile.githubProjectsCache) {
              try {
                githubProjects = JSON.parse(user.profile.githubProjectsCache as string);
              } catch {
                console.error('Failed to parse GitHub projects cache');
              }
            }
            
            userProfile = {
              ...user.profile,
              name: user.name, // Add the user's name to the profile for signing
              githubProjects, // Add parsed GitHub projects
            };
          }
        } catch (error) {
          console.error('Failed to fetch user profile:', error);
        }
      }
    }

    // Validate proposalLength
    const proposalLength: ProposalLength = body.proposalLength === 'short' ? 'short' : 'full';

    const jobDetails: JobDetails = {
      title: body.title,
      description: body.description,
      clientName: body.clientName,
      budget: body.budget,
      skills: body.skills,
      additionalContext: body.additionalContext,
      userProfile,
      proposalLength,
      userId,
    };

    const generator = getProposalGenerator();
    const result = await generator.generate(jobDetails);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to generate proposal' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        proposal: result.proposal,
        proposalLength: result.proposalLength,
        modelUsed: result.modelUsed,
        tokensUsed: result.tokensUsed,
        generationTime: result.generationTime,
        proposalId: result.savedProposalId,
      },
    });
  } catch (error) {
    console.error('Proposal generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

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
    const { Proposal } = await import('@/lib/db/models');

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const outcome = searchParams.get('outcome');
    const sort = searchParams.get('sort') || 'createdAt';
    const order = searchParams.get('order') === 'asc' ? 1 : -1;

    // Build query
    const query: Record<string, unknown> = { userId: session.user.id };
    if (outcome && outcome !== 'all') {
      query.outcome = outcome;
    }

    // Get total count
    const total = await Proposal.countDocuments(query);

    // Get proposals with pagination
    const proposals = await Proposal.find(query)
      .sort({ [sort]: order })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Calculate stats
    const stats = await Proposal.aggregate([
      { $match: { userId: session.user.id } },
      {
        $group: {
          _id: '$outcome',
          count: { $sum: 1 },
        },
      },
    ]);

    const outcomeStats = stats.reduce((acc: Record<string, number>, { _id, count }: { _id: string; count: number }) => {
      acc[_id] = count;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      success: true,
      data: {
        proposals,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        stats: outcomeStats,
      },
    });
  } catch (error) {
    console.error('Get proposals error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
