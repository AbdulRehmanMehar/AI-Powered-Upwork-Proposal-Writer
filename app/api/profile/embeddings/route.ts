/**
 * API Route: User Profile Embeddings
 * Manages user profile embeddings in Qdrant for semantic job matching
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  updateUserProfileEmbeddings, 
  getUserProfileStats,
  clearUserProfileChunks 
} from '@/lib/profile-embeddings';
import { auth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import User from '@/lib/db/user';

// POST /api/profile/embeddings - Update profile embeddings
// Accepts either { userId, profile } in body, or uses session auth + DB lookup
export async function POST(request: NextRequest) {
  try {
    let userId: string | undefined;
    let profile: Record<string, unknown> | undefined;

    // Try parsing body (may be empty if called from settings page auto-sync)
    try {
      const body = await request.json();
      userId = body.userId;
      profile = body.profile;
    } catch {
      // Empty body — will fall back to session auth below
    }

    // If no userId in body, get from session
    if (!userId) {
      const session = await auth();
      if (!session?.user?.id) {
        return NextResponse.json(
          { error: 'userId is required (provide in body or be authenticated)' },
          { status: 401 }
        );
      }
      userId = session.user.id;
    }

    // If no profile in body, fetch from DB
    if (!profile || typeof profile !== 'object') {
      await connectToDatabase();
      const user = await User.findById(userId).select('profile').lean();
      if (!user?.profile) {
        return NextResponse.json(
          { error: 'No profile found for user' },
          { status: 404 }
        );
      }
      profile = user.profile as Record<string, unknown>;
    }
    
    console.log(`Updating profile embeddings for user: ${userId}`);
    
    const result = await updateUserProfileEmbeddings(userId, profile);
    
    return NextResponse.json({
      success: true,
      message: `Profile embeddings updated`,
      chunksStored: result.chunksStored,
      userId,
    });
    
  } catch (error) {
    console.error('Error updating profile embeddings:', error);
    return NextResponse.json(
      { 
        error: 'Failed to update profile embeddings',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET /api/profile/embeddings?userId=xxx - Get profile embedding stats
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    
    if (!userId) {
      return NextResponse.json(
        { error: 'userId query parameter is required' },
        { status: 400 }
      );
    }
    
    const stats = await getUserProfileStats(userId);
    
    return NextResponse.json({
      success: true,
      userId,
      ...stats,
    });
    
  } catch (error) {
    console.error('Error getting profile stats:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get profile stats',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// DELETE /api/profile/embeddings - Clear profile embeddings
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    
    if (!userId) {
      return NextResponse.json(
        { error: 'userId query parameter is required' },
        { status: 400 }
      );
    }
    
    await clearUserProfileChunks(userId);
    
    return NextResponse.json({
      success: true,
      message: 'Profile embeddings cleared',
      userId,
    });
    
  } catch (error) {
    console.error('Error clearing profile embeddings:', error);
    return NextResponse.json(
      { 
        error: 'Failed to clear profile embeddings',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
