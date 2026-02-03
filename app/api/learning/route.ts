import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getLearningStats, clearLearningData, getLearnedWarnings } from '@/lib/learning-system';

/**
 * GET /api/learning - Get learning system stats
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stats = await getLearningStats();
    const warnings = await getLearnedWarnings(undefined, 10);

    return NextResponse.json({
      success: true,
      stats,
      warnings,
    });
  } catch (error) {
    console.error('Error getting learning stats:', error);
    return NextResponse.json(
      { error: 'Failed to get learning stats' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/learning - Clear learning data (admin only)
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    await clearLearningData(userId || undefined);

    return NextResponse.json({
      success: true,
      message: userId ? `Cleared learning data for user ${userId}` : 'Cleared all learning data',
    });
  } catch (error) {
    console.error('Error clearing learning data:', error);
    return NextResponse.json(
      { error: 'Failed to clear learning data' },
      { status: 500 }
    );
  }
}
