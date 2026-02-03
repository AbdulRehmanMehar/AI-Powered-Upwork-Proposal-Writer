import { NextRequest, NextResponse } from 'next/server';
import { getKnowledgeStats, clearKnowledge } from '@/lib/knowledge-base';
import { checkQdrantHealth, initializeCollections } from '@/lib/qdrant';

export async function GET() {
  try {
    // Check Qdrant health
    const isHealthy = await checkQdrantHealth();
    
    if (!isHealthy) {
      return NextResponse.json({
        success: false,
        error: 'Qdrant is not reachable',
        qdrantUrl: process.env.QDRANT_CONTAINER_URL,
      }, { status: 503 });
    }
    
    // Get stats
    const stats = await getKnowledgeStats();
    
    return NextResponse.json({
      success: true,
      qdrantHealthy: true,
      stats: {
        totalChunks: stats.totalChunks,
        isEmpty: stats.totalChunks === 0,
        needsIngestion: stats.totalChunks === 0,
      },
      message: stats.totalChunks === 0 
        ? 'Knowledge base is empty. Run: npx tsx scripts/ingest-knowledge.ts'
        : `Knowledge base has ${stats.totalChunks} chunks ready for RAG`,
    });
  } catch (error) {
    console.error('Knowledge base status check failed:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;
    
    if (action === 'initialize') {
      await initializeCollections();
      return NextResponse.json({
        success: true,
        message: 'Collections initialized',
      });
    }
    
    if (action === 'clear') {
      await clearKnowledge();
      return NextResponse.json({
        success: true,
        message: 'Knowledge base cleared. Run ingestion script to repopulate.',
      });
    }
    
    return NextResponse.json({
      success: false,
      error: 'Invalid action. Use "initialize" or "clear"',
    }, { status: 400 });
  } catch (error) {
    console.error('Knowledge base action failed:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
