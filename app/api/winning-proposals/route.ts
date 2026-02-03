import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import mongoose from 'mongoose';

/**
 * GET /api/winning-proposals - Get all winning proposals for the user
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const db = mongoose.connection.db;
    
    if (!db) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    const proposals = await db
      .collection('winningproposals')
      .find({ userId: new mongoose.Types.ObjectId(session.user.id) })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({
      success: true,
      data: proposals,
    });
  } catch (error) {
    console.error('Error fetching winning proposals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch winning proposals' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/winning-proposals - Create a new winning proposal
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    // Validation
    if (!proposalText || !jobTitle || !intensity) {
      return NextResponse.json(
        { error: 'proposalText, jobTitle, and intensity are required' },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const db = mongoose.connection.db;
    
    if (!db) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    const winningProposal = {
      userId: new mongoose.Types.ObjectId(session.user.id),
      proposalText,
      jobTitle,
      jobDescription: jobDescription || null,
      clientName: clientName || null,
      budget: budget || null,
      outcome: outcome || 'interview',
      hireDate: hireDate ? new Date(hireDate) : null,
      earnings: earnings || null,
      category: category || null,
      tags: tags || [],
      intensity,
      responseTime: responseTime || null,
      competitorCount: competitorCount || null,
      notes: notes || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('winningproposals').insertOne(winningProposal);

    return NextResponse.json({
      success: true,
      data: { _id: result.insertedId, ...winningProposal },
    });
  } catch (error) {
    console.error('Error creating winning proposal:', error);
    return NextResponse.json(
      { error: 'Failed to create winning proposal' },
      { status: 500 }
    );
  }
}
