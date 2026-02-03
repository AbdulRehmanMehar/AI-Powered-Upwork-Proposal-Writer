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

// POST /api/profile/embeddings - Update profile embeddings
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, profile } = body;
    
    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }
    
    if (!profile || typeof profile !== 'object') {
      return NextResponse.json(
        { error: 'profile object is required' },
        { status: 400 }
      );
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
