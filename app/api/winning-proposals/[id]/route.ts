import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import mongoose from 'mongoose';

/**
 * GET /api/winning-proposals/[id] - Get a specific winning proposal
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Next.js 15+ requires awaiting params
    const { id } = await params;

    await connectToDatabase();
    const db = mongoose.connection.db;
    
    if (!db) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    const proposal = await db.collection('winningproposals').findOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(session.user.id),
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: proposal,
    });
  } catch (error) {
    console.error('Error fetching winning proposal:', error);
    return NextResponse.json(
      { error: 'Failed to fetch winning proposal' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/winning-proposals/[id] - Update a winning proposal
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Next.js 15+ requires awaiting params
    const { id } = await params;

    const body = await request.json();
    const {
      proposalText,
      jobTitle,
      jobDescription,
      clientName,
      budget,
      outcome,
      hireDate,
      earnings,
      category,
      tags,
      intensity,
      responseTime,
      competitorCount,
      notes,
    } = body;

    await connectToDatabase();
    const db = mongoose.connection.db;
    
    if (!db) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (proposalText !== undefined) updateData.proposalText = proposalText;
    if (jobTitle !== undefined) updateData.jobTitle = jobTitle;
    if (jobDescription !== undefined) updateData.jobDescription = jobDescription;
    if (clientName !== undefined) updateData.clientName = clientName;
    if (budget !== undefined) updateData.budget = budget;
    if (outcome !== undefined) updateData.outcome = outcome;
    if (hireDate !== undefined) updateData.hireDate = hireDate ? new Date(hireDate) : null;
    if (earnings !== undefined) updateData.earnings = earnings;
    if (category !== undefined) updateData.category = category;
    if (tags !== undefined) updateData.tags = tags;
    if (intensity !== undefined) updateData.intensity = intensity;
    if (responseTime !== undefined) updateData.responseTime = responseTime;
    if (competitorCount !== undefined) updateData.competitorCount = competitorCount;
    if (notes !== undefined) updateData.notes = notes;

    const result = await db.collection('winningproposals').findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(id),
        userId: new mongoose.Types.ObjectId(session.user.id),
      },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error updating winning proposal:', error);
    return NextResponse.json(
      { error: 'Failed to update winning proposal' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/winning-proposals/[id] - Delete a winning proposal
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Next.js 15+ requires awaiting params
    const { id } = await params;

    await connectToDatabase();
    const db = mongoose.connection.db;
    
    if (!db) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    const result = await db.collection('winningproposals').deleteOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(session.user.id),
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Proposal deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting winning proposal:', error);
    return NextResponse.json(
      { error: 'Failed to delete winning proposal' },
      { status: 500 }
    );
  }
}
