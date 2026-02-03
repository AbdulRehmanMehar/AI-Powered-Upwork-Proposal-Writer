import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import { User } from '@/lib/db/user';
import { updateUserProfileEmbeddings } from '@/lib/profile-embeddings';

export async function GET() {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    
    const user = await User.findById(session.user.id).select('-password');
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: user._id,
        email: user.email,
        name: user.name,
        profile: user.profile || {},
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, profile } = body;

    await connectToDatabase();

    const updateData: Record<string, unknown> = {};
    
    if (name) {
      updateData.name = name;
    }
    
    if (profile) {
      // Validate and sanitize profile data
      const allowedFields = [
        'title', 'summary', 'yearsExperience', 'hourlyRate',
        'skills', 'specializations', 'portfolioLinks', 'pastClients',
        'achievements', 'certifications', 'availability', 'timezone',
        'preferredTone', 'customSignature', 'additionalDetails',
        // GitHub integration (username only - PAT handled separately for security)
        'githubUsername'
      ];
      
      const sanitizedProfile: Record<string, unknown> = {};
      
      for (const field of allowedFields) {
        if (profile[field] !== undefined) {
          sanitizedProfile[`profile.${field}`] = profile[field];
        }
      }
      
      Object.assign(updateData, sanitizedProfile);
    }

    const user = await User.findByIdAndUpdate(
      session.user.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Update profile embeddings in the background (non-blocking)
    // This enables semantic matching between job descriptions and profile data
    if (user.profile && Object.keys(user.profile).length > 0) {
      updateUserProfileEmbeddings(session.user.id, user.profile)
        .then(result => {
          console.log(`Profile embeddings updated: ${result.chunksStored} chunks stored for user ${session.user.id}`);
        })
        .catch(error => {
          console.error('Failed to update profile embeddings:', error);
          // Don't fail the request - embeddings are an enhancement
        });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: user._id,
        email: user.email,
        name: user.name,
        profile: user.profile || {},
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
