import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import { User } from '@/lib/db/user';
import { fetchGitHubProjects, GitHubProject } from '@/lib/github-projects';

export async function POST(req: Request) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { username, pat } = body;

    if (!username) {
      return NextResponse.json(
        { error: 'GitHub username is required' },
        { status: 400 }
      );
    }

    // Fetch projects from GitHub
    const result = await fetchGitHubProjects(username, pat, 20);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to fetch GitHub projects' },
        { status: 400 }
      );
    }

    // Connect to database and update user
    await connectToDatabase();

    // Prepare update data
    const updateData: Record<string, unknown> = {
      'profile.githubUsername': username,
      'profile.githubProjectsCache': JSON.stringify(result.projects),
      'profile.githubLastFetched': new Date(),
    };

    // Only store PAT if provided (encrypted would be better in production)
    if (pat) {
      updateData['profile.githubPat'] = pat;
      console.log(`Saving GitHub PAT for user ${session.user.id} (${pat.substring(0, 10)}...)`);
    }

    // Use native MongoDB driver for reliable updates
    const mongoose = await import('mongoose');
    const db = mongoose.connection.db;
    
    if (!db) {
      console.error('MongoDB connection not available!');
      return NextResponse.json(
        { error: 'Database connection error' },
        { status: 500 }
      );
    }
    
    const updateResult = await db.collection('users').updateOne(
      { _id: new mongoose.Types.ObjectId(session.user.id) },
      { $set: updateData }
    );
    
    console.log(`MongoDB updateOne result: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`);
    
    // Verify PAT was saved
    if (pat) {
      const verifyDoc = await db.collection('users').findOne(
        { _id: new mongoose.Types.ObjectId(session.user.id) },
        { projection: { 'profile.githubPat': 1 } }
      );
      console.log(`GitHub PAT verified in DB: ${!!verifyDoc?.profile?.githubPat}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        projects: result.projects,
        count: result.projects.length,
      },
    });
  } catch (error) {
    console.error('GitHub fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch GitHub projects' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectToDatabase();

    // Clear GitHub data
    await User.findByIdAndUpdate(
      session.user.id,
      {
        $unset: {
          'profile.githubUsername': '',
          'profile.githubPat': '',
          'profile.githubProjectsCache': '',
          'profile.githubLastFetched': '',
        },
      }
    );

    return NextResponse.json({
      success: true,
      message: 'GitHub integration disconnected',
    });
  } catch (error) {
    console.error('GitHub disconnect error:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect GitHub' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectToDatabase();

    const user = await User.findById(session.user.id).select(
      'profile.githubUsername profile.githubProjectsCache profile.githubLastFetched'
    );

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    let projects: GitHubProject[] = [];
    if (user.profile?.githubProjectsCache) {
      try {
        projects = JSON.parse(user.profile.githubProjectsCache);
      } catch {
        projects = [];
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        username: user.profile?.githubUsername || null,
        projects,
        lastFetched: user.profile?.githubLastFetched || null,
      },
    });
  } catch (error) {
    console.error('GitHub get error:', error);
    return NextResponse.json(
      { error: 'Failed to get GitHub data' },
      { status: 500 }
    );
  }
}
