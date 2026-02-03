import { NextResponse } from 'next/server';
import { getLoadBalancer } from '@/lib/groq-load-balancer';

export async function GET() {
  try {
    const loadBalancer = getLoadBalancer();
    const stats = await loadBalancer.getUsageStats();

    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get usage stats error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
