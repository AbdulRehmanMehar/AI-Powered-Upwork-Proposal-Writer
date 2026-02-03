import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import { Proposal, ProposalOutcome } from '@/lib/db/models';
import mongoose from 'mongoose';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/proposals/[id] - Get a single proposal
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: 'Invalid proposal ID' },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const proposal = await Proposal.findOne({
      _id: id,
      userId: session.user.id,
    }).lean();

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: proposal,
    });
  } catch (error) {
    console.error('Failed to fetch proposal:', error);
    return NextResponse.json(
      { error: 'Failed to fetch proposal' },
      { status: 500 }
    );
  }
}

// PATCH /api/proposals/[id] - Update proposal (outcome, rating, notes)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: 'Invalid proposal ID' },
        { status: 400 }
      );
    }

    const body = await request.json();

    await connectToDatabase();

    // Find the proposal first to ensure it belongs to the user
    const existingProposal = await Proposal.findOne({
      _id: id,
      userId: session.user.id,
    });

    if (!existingProposal) {
      return NextResponse.json(
        { error: 'Proposal not found' },
        { status: 404 }
      );
    }

    // Build update object
    const updateData: Record<string, unknown> = {};
    
    // Outcome update
    const validOutcomes: ProposalOutcome[] = ['pending', 'viewed', 'messaged', 'interviewed', 'hired', 'rejected', 'no_response'];
    if (body.outcome && validOutcomes.includes(body.outcome)) {
      updateData.outcome = body.outcome;
      updateData.outcomeUpdatedAt = new Date();
      
      // Calculate response time if transitioning from pending to messaged/interviewed
      if (
        existingProposal.outcome === 'pending' && 
        ['messaged', 'interviewed'].includes(body.outcome) &&
        existingProposal.submittedAt
      ) {
        const responseTime = (Date.now() - new Date(existingProposal.submittedAt).getTime()) / (1000 * 60 * 60);
        updateData.clientResponseTime = Math.round(responseTime * 10) / 10; // Hours with 1 decimal
      }
    }

    // Submitted at
    if (body.submittedAt) {
      updateData.submittedAt = new Date(body.submittedAt);
    }

    // Mark as submitted (sets submittedAt to now)
    if (body.markSubmitted) {
      updateData.submittedAt = new Date();
    }

    // Rating (1-5)
    if (body.rating !== undefined) {
      const rating = parseInt(body.rating);
      if (rating >= 1 && rating <= 5) {
        updateData.rating = rating;
      }
    }

    // Notes
    if (body.notes !== undefined) {
      updateData.notes = body.notes;
    }

    // What worked
    if (body.whatWorked !== undefined) {
      updateData.whatWorked = body.whatWorked;
    }

    // What didn't work
    if (body.whatDidntWork !== undefined) {
      updateData.whatDidntWork = body.whatDidntWork;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const updatedProposal = await Proposal.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).lean();

    return NextResponse.json({
      success: true,
      data: updatedProposal,
    });
  } catch (error) {
    console.error('Failed to update proposal:', error);
    return NextResponse.json(
      { error: 'Failed to update proposal' },
      { status: 500 }
    );
  }
}

// DELETE /api/proposals/[id] - Delete a proposal
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: 'Invalid proposal ID' },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const result = await Proposal.deleteOne({
      _id: id,
      userId: session.user.id,
    });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'Proposal not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Proposal deleted',
    });
  } catch (error) {
    console.error('Failed to delete proposal:', error);
    return NextResponse.json(
      { error: 'Failed to delete proposal' },
      { status: 500 }
    );
  }
}
