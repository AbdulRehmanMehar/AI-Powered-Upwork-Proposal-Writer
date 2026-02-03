/**
 * GitHub Sync API
 * Deep analyzes and embeds GitHub repositories into knowledge base
 * Supports incremental sync - tracks what's already synced
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import { User } from '@/lib/db/user';
import { embedUserGitHubProjects, getGitHubKnowledgeStats, getTotalRepoCount } from '@/lib/github-knowledge';
import { fetchAllUserRepos } from '@/lib/github-deep-analyzer';

/**
 * POST /api/profile/github/sync
 * Trigger a deep sync of GitHub repositories (incremental by default)
 * Query params:
 *   - fullResync=true: Clear all and start fresh
 *   - batchSize=10: Number of repos to sync per batch (default 10)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const fullResync = searchParams.get('fullResync') === 'true';
    const batchSize = parseInt(searchParams.get('batchSize') || '10', 10);

    await connectToDatabase();

    // Use native MongoDB driver to read user data reliably
    const mongoose = await import('mongoose');
    const db = mongoose.connection.db;
    
    if (!db) {
      return NextResponse.json(
        { error: 'Database connection error' },
        { status: 500 }
      );
    }
    
    const userDoc = await db.collection('users').findOne(
      { _id: new mongoose.Types.ObjectId(session.user.id) }
    );

    if (!userDoc?.profile?.githubUsername) {
      return NextResponse.json(
        { error: 'GitHub username not configured. Please add your GitHub username first.' },
        { status: 400 }
      );
    }

    const pat = userDoc.profile.githubPat;
    console.log(`PAT from DB (native): ${pat ? `${pat.substring(0, 10)}...` : 'NOT FOUND'}`);
    
    if (!pat) {
      return NextResponse.json(
        { error: 'GitHub Personal Access Token not configured. A PAT is required for deep analysis.' },
        { status: 400 }
      );
    }

    const username = userDoc.profile.githubUsername;
    const currentlySynced = (userDoc.profile.githubSyncedRepos as string[]) || [];

    console.log(`DB sync state - currentlySynced: ${currentlySynced.length} repos`);

    // First, get total repo count for progress tracking
    const totalRepos = await fetchAllUserRepos(username, pat);
    
    console.log(`Starting GitHub sync for user ${session.user.id} (${username})`);
    console.log(`Total repos: ${totalRepos.total}, Already synced: ${currentlySynced.length}, Full resync: ${fullResync}`);

    // Run the deep analysis and embedding (incremental)
    const result = await embedUserGitHubProjects(
      session.user.id,
      username,
      pat,
      batchSize,
      fullResync
    );

    if (!result.success) {
      return NextResponse.json(
        { 
          error: 'Sync failed', 
          details: result.errors,
          progress: {
            synced: result.alreadySynced,
            total: totalRepos.total,
          }
        },
        { status: 500 }
      );
    }

    // Get updated stats
    const stats = await getGitHubKnowledgeStats(session.user.id);

    const remainingToSync = totalRepos.total - result.syncedRepos.length;

    return NextResponse.json({
      success: true,
      data: {
        embeddedChunks: result.embeddedCount,
        repos: stats.repos,
        repoCount: stats.repos.length,
        errors: result.errors,
        lastSynced: new Date().toISOString(),
        // Progress tracking
        progress: {
          newlySynced: result.newlySynced,
          alreadySynced: result.alreadySynced,
          totalSynced: result.syncedRepos.length,
          totalRepos: totalRepos.total,
          remainingToSync,
          percentComplete: Math.round((result.syncedRepos.length / totalRepos.total) * 100),
          isComplete: remainingToSync === 0,
        }
      },
    });
  } catch (error) {
    console.error('GitHub sync error:', error);
    return NextResponse.json(
      { error: 'Sync failed. Please try again.' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/profile/github/sync
 * Get sync status and progress
 */
export async function GET() {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const stats = await getGitHubKnowledgeStats(session.user.id);

    await connectToDatabase();
    const user = await User.findById(session.user.id)
      .select('profile.githubUsername profile.githubLastFetched profile.githubSyncedRepos')
      .lean();
    
    // Separate query for PAT since it has select: false
    const userWithPat = await User.findById(session.user.id)
      .select('+profile.githubPat')
      .lean();

    // Get total repo count if we have credentials
    let totalRepos = 0;
    if (user?.profile?.githubUsername && userWithPat?.profile?.githubPat) {
      const countResult = await getTotalRepoCount(
        user.profile.githubUsername,
        userWithPat.profile.githubPat
      );
      totalRepos = countResult.total;
    }

    const syncedCount = stats.syncedRepos?.length || stats.repos.length;
    const remainingToSync = totalRepos - syncedCount;

    return NextResponse.json({
      success: true,
      data: {
        username: user?.profile?.githubUsername || null,
        hasCredentials: !!(user?.profile?.githubUsername && userWithPat?.profile?.githubPat),
        totalChunks: stats.totalChunks,
        repos: stats.repos,
        repoCount: stats.repos.length,
        lastSynced: stats.lastSynced?.toISOString() || null,
        isConfigured: stats.isConfigured,
        // Progress tracking
        progress: {
          totalSynced: syncedCount,
          totalRepos,
          remainingToSync,
          percentComplete: totalRepos > 0 ? Math.round((syncedCount / totalRepos) * 100) : 0,
          isComplete: totalRepos > 0 && remainingToSync === 0,
        }
      },
    });
  } catch (error) {
    console.error('GitHub sync status error:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status' },
      { status: 500 }
    );
  }
}
