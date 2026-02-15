/**
 * Knowledge Base Module
 * Handles chunking, storing, and retrieving practitioner knowledge
 */

import { getQdrantClient, COLLECTIONS, initializeCollections } from './qdrant';
import { generateEmbedding, generateEmbeddings } from './gemini-embeddings';
import { v4 as uuidv4 } from 'uuid';
import { connectToDatabase } from './db/connection';
import { WinningProposal } from './db/models';

// ============================================
// Types
// ============================================

export type KnowledgeCategory = 
  | 'hook'           // Opening hooks and twists
  | 'proof'          // Social proof, case studies
  | 'cta'            // Call to action examples
  | 'ps'             // P.S. section examples
  | 'tone'           // Voice and tone guidance
  | 'banned'         // What NOT to do
  | 'strategy'       // General strategies
  | 'mindset';       // Mindset and approach

export type Practitioner = 'josh_burns' | 'evan_fisher' | 'general';

export interface KnowledgeChunk {
  id?: string;
  text: string;
  category: KnowledgeCategory;
  practitioner: Practitioner;
  source?: string;          // e.g., "VIDEO 3" or "COMPARATIVE_ANALYSIS.md"
  jobType?: string;         // e.g., "web_development", "design", "general"
  isExample?: boolean;      // Is this an actual example vs. explanation?
  quality?: 'good' | 'bad'; // For examples - is this good or bad practice?
}

export interface RetrievedKnowledge {
  chunk: KnowledgeChunk;
  score: number;
}

export interface WinningProposalKnowledge {
  id: string;
  text: string;
  jobTitle: string;
  jobDescription?: string;  // Original job posting for context
  outcome: 'interview' | 'hired' | 'ongoing';
  intensity: 'ultra-short' | 'full';
  tags?: string[];
  earnings?: number;
  notes?: string;
}

// ============================================
// Text Chunking
// ============================================

const CHUNK_SIZE = 500;      // Target characters per chunk
const MAX_CHUNK_SIZE = 2000; // Hard limit to avoid token issues (Jina max ~8192 tokens)
const CHUNK_OVERLAP = 50;    // Overlap between chunks

/**
 * Smart text chunking that respects sentence boundaries
 */
export function chunkText(text: string, metadata: Omit<KnowledgeChunk, 'text' | 'id'>): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  
  // Split by double newlines first (paragraphs)
  const paragraphs = text.split(/\n\n+/);
  
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    if (!trimmedParagraph) continue;
    
    // If adding this paragraph would exceed chunk size
    if (currentChunk.length + trimmedParagraph.length > CHUNK_SIZE && currentChunk.length > 0) {
      // Save current chunk
      chunks.push({
        id: uuidv4(),
        text: currentChunk.trim(),
        ...metadata,
      });
      
      // Start new chunk with overlap (last sentence of previous chunk)
      const sentences = currentChunk.split(/[.!?]+/);
      const lastSentence = sentences[sentences.length - 2]?.trim() || '';
      currentChunk = lastSentence ? lastSentence + '. ' + trimmedParagraph : trimmedParagraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph;
    }
  }
  
  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push({
      id: uuidv4(),
      text: currentChunk.trim(),
      ...metadata,
    });
  }
  
  // Ensure no chunk exceeds max size (split if needed)
  return chunks.flatMap(chunk => {
    if (chunk.text.length <= MAX_CHUNK_SIZE) return [chunk];
    
    // Split oversized chunks by sentences
    const sentences = chunk.text.match(/[^.!?]+[.!?]+/g) || [chunk.text];
    const splitChunks: KnowledgeChunk[] = [];
    let current = '';
    
    for (const sentence of sentences) {
      if (current.length + sentence.length > MAX_CHUNK_SIZE && current) {
        splitChunks.push({ ...chunk, id: uuidv4(), text: current.trim() });
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) {
      splitChunks.push({ ...chunk, id: uuidv4(), text: current.trim() });
    }
    return splitChunks;
  });
}

/**
 * Extract specific examples from practitioner transcripts
 * These are high-value chunks that should be retrieved as-is
 */
export function extractExamples(text: string, practitioner: Practitioner): KnowledgeChunk[] {
  const examples: KnowledgeChunk[] = [];
  
  // Pattern for quoted examples (things they said to say)
  const quotePatterns = [
    // Direct quotes with quotes
    /"([^"]{20,300})"/g,
    // "Here's what you should say:" patterns
    /(?:here's what|you could say|something like|for example)[:\s]+["']?([^"'\n]{20,300})["']?/gi,
  ];
  
  for (const pattern of quotePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const quote = match[1]?.trim();
      if (quote && quote.length > 20) {
        // Determine if this is a good or bad example
        const contextBefore = text.slice(Math.max(0, match.index - 100), match.index).toLowerCase();
        const isBad = contextBefore.includes("don't") || contextBefore.includes('bad') || 
                      contextBefore.includes('wrong') || contextBefore.includes('avoid');
        
        // Categorize the example
        let category: KnowledgeCategory = 'strategy';
        const lowerQuote = quote.toLowerCase();
        
        if (lowerQuote.includes('hey') || lowerQuote.includes('hi ') || match.index < 500) {
          category = 'hook';
        } else if (lowerQuote.includes('p.s.') || lowerQuote.includes('ps ')) {
          category = 'ps';
        } else if (lowerQuote.includes('click') || lowerQuote.includes('call') || 
                   lowerQuote.includes('message') || lowerQuote.includes('schedule')) {
          category = 'cta';
        } else if (lowerQuote.includes('client') || lowerQuote.includes('helped') ||
                   lowerQuote.includes('worked with')) {
          category = 'proof';
        }
        
        examples.push({
          id: uuidv4(),
          text: quote,
          category,
          practitioner,
          isExample: true,
          quality: isBad ? 'bad' : 'good',
        });
      }
    }
  }
  
  return examples;
}

// ============================================
// Storage
// ============================================

/**
 * Store knowledge chunks in Qdrant
 */
export async function storeKnowledge(chunks: KnowledgeChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  
  const client = getQdrantClient();
  await initializeCollections();
  
  console.log(`📥 Storing ${chunks.length} knowledge chunks...`);
  
  // Generate embeddings for all chunks (using 'ingest' operation for tracking)
  const texts = chunks.map(c => c.text);
  const embeddings = await generateEmbeddings(texts, 'ingest');
  
  // Prepare points for Qdrant
  const points = chunks.map((chunk, index) => ({
    id: chunk.id || uuidv4(),
    vector: embeddings[index],
    payload: {
      text: chunk.text,
      category: chunk.category,
      practitioner: chunk.practitioner,
      source: chunk.source || null,
      jobType: chunk.jobType || 'general',
      isExample: chunk.isExample || false,
      quality: chunk.quality || null,
    },
  }));
  
  // Upsert in batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    const batch = points.slice(i, i + BATCH_SIZE);
    await client.upsert(COLLECTIONS.PRACTITIONER_KNOWLEDGE, {
      wait: true,
      points: batch,
    });
    console.log(`  ✓ Stored batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(points.length / BATCH_SIZE)}`);
  }
  
  console.log(`✅ Stored ${chunks.length} chunks in Qdrant`);
}

// ============================================
// Retrieval
// ============================================

export interface RetrievalOptions {
  category?: KnowledgeCategory;
  practitioner?: Practitioner;
  jobType?: string;
  onlyExamples?: boolean;
  onlyGoodExamples?: boolean;
  limit?: number;
}

/**
 * Retrieve relevant knowledge for a given query
 */
export async function retrieveKnowledge(
  query: string,
  options: RetrievalOptions = {},
  precomputedEmbedding?: number[]
): Promise<RetrievedKnowledge[]> {
  const client = getQdrantClient();
  const { 
    category, 
    practitioner, 
    jobType,
    onlyExamples,
    onlyGoodExamples,
    limit = 5 
  } = options;
  
  // Use precomputed embedding or generate one
  const queryEmbedding = precomputedEmbedding || await generateEmbedding(query);
  
  // Build filter
  const mustConditions: any[] = [];
  
  if (category) {
    mustConditions.push({
      key: 'category',
      match: { value: category },
    });
  }
  
  if (practitioner) {
    mustConditions.push({
      key: 'practitioner',
      match: { value: practitioner },
    });
  }
  
  if (jobType) {
    mustConditions.push({
      key: 'jobType',
      match: { value: jobType },
    });
  }
  
  if (onlyExamples) {
    mustConditions.push({
      key: 'isExample',
      match: { value: true },
    });
  }
  
  if (onlyGoodExamples) {
    mustConditions.push({
      key: 'quality',
      match: { value: 'good' },
    });
  }
  
  // Search
  const results = await client.search(COLLECTIONS.PRACTITIONER_KNOWLEDGE, {
    vector: queryEmbedding,
    limit,
    filter: mustConditions.length > 0 ? { must: mustConditions } : undefined,
    with_payload: true,
  });
  
  return results.map(result => ({
    chunk: {
      id: result.id as string,
      text: result.payload?.text as string,
      category: result.payload?.category as KnowledgeCategory,
      practitioner: result.payload?.practitioner as Practitioner,
      source: result.payload?.source as string | undefined,
      jobType: result.payload?.jobType as string | undefined,
      isExample: result.payload?.isExample as boolean | undefined,
      quality: result.payload?.quality as 'good' | 'bad' | undefined,
    },
    score: result.score,
  }));
}

/**
 * Retrieve user's winning proposals from database
 */
export async function retrieveWinningProposals(
  userId: string,
  intensity?: 'ultra-short' | 'full',
  limit: number = 5
): Promise<WinningProposalKnowledge[]> {
  try {
    await connectToDatabase();
    
    const query: any = { userId };
    if (intensity) {
      query.intensity = intensity;
    }
    
    const proposals = await WinningProposal.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    return proposals.map(p => ({
      id: p._id.toString(),
      text: p.proposalText,
      jobTitle: p.jobTitle,
      jobDescription: p.jobDescription,  // Include original job posting
      outcome: p.outcome,
      intensity: p.intensity,
      tags: p.tags,
      earnings: p.earnings,
      notes: p.notes,
    }));
  } catch (error) {
    console.error('Error retrieving winning proposals:', error);
    return [];
  }
}

/**
 * Retrieve examples for each section of a proposal
 */
export async function retrieveProposalExamples(
  jobDescription: string,
  precomputedEmbedding?: number[]
): Promise<{
  hooks: RetrievedKnowledge[];
  proofs: RetrievedKnowledge[];
  ctas: RetrievedKnowledge[];
  pss: RetrievedKnowledge[];
  banned: RetrievedKnowledge[];
}> {
  // Embed once and reuse across all 5 searches
  const embedding = precomputedEmbedding || await generateEmbedding(jobDescription);

  // Run all retrievals in parallel (all reuse the same embedding)
  const [hooks, proofs, ctas, pss, banned] = await Promise.all([
    retrieveKnowledge(jobDescription, { 
      category: 'hook', 
      onlyGoodExamples: true, 
      limit: 3 
    }, embedding),
    retrieveKnowledge(jobDescription, { 
      category: 'proof', 
      onlyGoodExamples: true, 
      limit: 3 
    }, embedding),
    retrieveKnowledge(jobDescription, { 
      category: 'cta', 
      onlyGoodExamples: true, 
      limit: 3 
    }, embedding),
    retrieveKnowledge(jobDescription, { 
      category: 'ps', 
      onlyGoodExamples: true, 
      limit: 2 
    }, embedding),
    retrieveKnowledge(jobDescription, { 
      category: 'banned', 
      limit: 3 
    }, embedding),
  ]);
  
  return { hooks, proofs, ctas, pss, banned };
}

/**
 * Get collection stats
 */
export async function getKnowledgeStats(): Promise<{
  totalChunks: number;
  byCategory: Record<string, number>;
  byPractitioner: Record<string, number>;
}> {
  const client = getQdrantClient();
  
  try {
    const collectionInfo = await client.getCollection(COLLECTIONS.PRACTITIONER_KNOWLEDGE);
    const totalChunks = collectionInfo.points_count || 0;
    
    // We'd need to scroll through to get category/practitioner counts
    // For now, return basic info
    return {
      totalChunks,
      byCategory: {},
      byPractitioner: {},
    };
  } catch (error) {
    return {
      totalChunks: 0,
      byCategory: {},
      byPractitioner: {},
    };
  }
}

/**
 * Clear all knowledge (for re-ingestion)
 */
export async function clearKnowledge(): Promise<void> {
  const client = getQdrantClient();
  
  try {
    await client.deleteCollection(COLLECTIONS.PRACTITIONER_KNOWLEDGE);
    console.log('🗑️ Cleared practitioner knowledge collection');
  } catch (error) {
    // Collection might not exist
  }
  
  await initializeCollections();
}
