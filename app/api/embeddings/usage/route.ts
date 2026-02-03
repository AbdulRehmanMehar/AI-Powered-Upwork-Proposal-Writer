import { NextRequest, NextResponse } from 'next/server';
import { getGeminiUsageStats, getRateLimitStatus, syncKeyUsageFromDB } from '@/lib/gemini-embeddings';
import connectDB from '@/lib/db/connection';

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    
    // Sync usage from DB on first call
    await syncKeyUsageFromDB();
    
    // Get usage stats
    const usageStats = await getGeminiUsageStats();
    
    // Get current rate limit status
    const rateLimitStatus = getRateLimitStatus();
    
    return NextResponse.json({
      success: true,
      provider: 'Gemini',
      model: 'gemini-embedding-001',
      usage: {
        totalRequestsToday: usageStats.totalRequests,
        totalTokensToday: usageStats.totalTokens,
      },
      loadBalancing: {
        totalKeys: rateLimitStatus.totalKeys,
        availableKeys: rateLimitStatus.availableKeys,
        keysAtMinuteLimit: rateLimitStatus.keysAtMinuteLimit,
        keysAtDailyLimit: rateLimitStatus.keysAtDailyLimit,
      },
      keyDetails: usageStats.byKey.map(k => ({
        keyIndex: k.keyIndex + 1,
        requestsToday: k.requestsToday,
        remainingToday: k.remainingToday,
        requestsThisMinute: k.requestsThisMinute,
        isExhausted: k.isExhausted,
      })),
      limits: {
        perKey: {
          requestsPerMinute: 40,
          tokensPerMinute: 10_000,
          requestsPerDay: 200,
        },
        total: {
          requestsPerMinute: 40 * rateLimitStatus.totalKeys,
          requestsPerDay: 200 * rateLimitStatus.totalKeys,
        },
      },
    });
  } catch (error) {
    console.error('Failed to get Gemini usage stats:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
