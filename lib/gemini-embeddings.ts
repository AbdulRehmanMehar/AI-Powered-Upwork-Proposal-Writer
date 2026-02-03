/**
 * Google Gemini Embeddings with Load Balancing
 * 
 * Rate limits per API key:
 * - 40 requests per minute
 * - 10,000 tokens per minute
 * - 200 requests per day
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ============================================
// Configuration
// ============================================

const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 768; // Using 768 to match our existing Qdrant collections

// Rate limits per API key (from Google AI Studio dashboard)
// NOTE: If all keys are from the same project, they SHARE the same quota!
const RATE_LIMITS = {
  requestsPerMinute: 100,   // Actual: 100 RPM
  tokensPerMinute: 30_000,  // Actual: 30K TPM
  requestsPerDay: 1_000,    // Actual: 1K per day
};

// Batch settings
// IMPORTANT: Each item in batch counts as 1 request towards quota!
const BATCH_SIZE = 10; // Small batches to avoid hitting limits
const MIN_DELAY_MS = 700; // ~85 requests/minute max (stay under 100 RPM)

// ============================================
// MongoDB Schema for API Key Usage Tracking
// ============================================

export interface IGeminiKeyUsage extends Document {
  apiKeyIndex: number; // Index in the keys array (not the actual key for security)
  timestamp: Date;
  requests: number;
  tokens: number;
  operation: 'embed_single' | 'embed_batch' | 'ingest';
  batchSize?: number;
  success: boolean;
  errorMessage?: string;
}

const GeminiKeyUsageSchema = new Schema<IGeminiKeyUsage>({
  apiKeyIndex: { type: Number, required: true, index: true },
  timestamp: { type: Date, default: Date.now, index: true },
  requests: { type: Number, required: true },
  tokens: { type: Number, required: true },
  operation: { type: String, required: true, enum: ['embed_single', 'embed_batch', 'ingest'] },
  batchSize: { type: Number },
  success: { type: Boolean, required: true },
  errorMessage: { type: String },
});

// Compound indexes for efficient queries
GeminiKeyUsageSchema.index({ apiKeyIndex: 1, timestamp: -1 });
GeminiKeyUsageSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }); // 7 day TTL

export const GeminiKeyUsage: Model<IGeminiKeyUsage> = mongoose.models.GeminiKeyUsage || 
  mongoose.model<IGeminiKeyUsage>('GeminiKeyUsage', GeminiKeyUsageSchema);

// ============================================
// API Key Management
// ============================================

interface ApiKeyState {
  index: number;
  key: string;
  requestsThisMinute: number;
  tokensThisMinute: number;
  requestsToday: number;
  minuteStart: number;
  dayStart: number;
  lastRequestTime: number;
  isExhausted: boolean; // Daily limit reached
}

let apiKeys: ApiKeyState[] = [];
let currentKeyIndex = 0;
let initialized = false;

/**
 * Initialize API keys from environment
 */
function initializeKeys(): void {
  if (initialized) return;
  
  const keysString = process.env.GEM_API_KEYS;
  if (!keysString) {
    throw new Error('GEM_API_KEYS environment variable is not set');
  }
  
  const keys = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
  if (keys.length === 0) {
    throw new Error('No valid API keys found in GEM_API_KEYS');
  }
  
  const now = Date.now();
  const dayStart = new Date().setHours(0, 0, 0, 0);
  
  apiKeys = keys.map((key, index) => ({
    index,
    key,
    requestsThisMinute: 0,
    tokensThisMinute: 0,
    requestsToday: 0,
    minuteStart: now,
    dayStart,
    lastRequestTime: 0,
    isExhausted: false,
  }));
  
  console.log(`🔑 Initialized ${apiKeys.length} Gemini API keys for load balancing`);
  initialized = true;
}

/**
 * Reset minute counters if a minute has passed
 */
function resetMinuteCountersIfNeeded(keyState: ApiKeyState): void {
  const now = Date.now();
  if (now - keyState.minuteStart >= 60_000) {
    keyState.requestsThisMinute = 0;
    keyState.tokensThisMinute = 0;
    keyState.minuteStart = now;
  }
}

/**
 * Reset daily counters if a new day
 */
function resetDailyCountersIfNeeded(keyState: ApiKeyState): void {
  const todayStart = new Date().setHours(0, 0, 0, 0);
  if (todayStart > keyState.dayStart) {
    keyState.requestsToday = 0;
    keyState.dayStart = todayStart;
    keyState.isExhausted = false;
  }
}

/**
 * Get the next available API key using simple round-robin
 * Returns null only if ALL keys are exhausted for the day
 */
function getNextKey(): ApiKeyState | null {
  initializeKeys();
  
  // Try each key once
  for (let i = 0; i < apiKeys.length; i++) {
    const keyState = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    
    // Reset counters if needed
    resetMinuteCountersIfNeeded(keyState);
    resetDailyCountersIfNeeded(keyState);
    
    // Skip if daily limit reached
    if (keyState.isExhausted || keyState.requestsToday >= RATE_LIMITS.requestsPerDay) {
      keyState.isExhausted = true;
      continue;
    }
    
    // Check minute capacity
    if (keyState.requestsThisMinute < RATE_LIMITS.requestsPerMinute) {
      return keyState;
    }
  }
  
  // All keys at minute limit - find the one that resets soonest
  let bestKey: ApiKeyState | null = null;
  let shortestWait = Infinity;
  
  for (const keyState of apiKeys) {
    if (keyState.isExhausted) continue;
    
    const waitTime = 60_000 - (Date.now() - keyState.minuteStart);
    if (waitTime < shortestWait) {
      shortestWait = waitTime;
      bestKey = keyState;
    }
  }
  
  return bestKey;
}

/**
 * Get an available key, waiting if necessary
 */
async function waitForAvailableKey(): Promise<ApiKeyState> {
  let key = getNextKey();
  
  if (!key) {
    throw new Error('All Gemini API keys have reached their daily limit');
  }
  
  // Reset counters if needed
  resetMinuteCountersIfNeeded(key);
  
  // If this key is at minute limit, wait for reset
  if (key.requestsThisMinute >= RATE_LIMITS.requestsPerMinute) {
    const waitTime = Math.max(0, 60_000 - (Date.now() - key.minuteStart)) + 100;
    console.log(`⏳ Key ${key.index + 1} at minute limit, waiting ${Math.ceil(waitTime / 1000)}s...`);
    await delay(waitTime);
    
    // Reset after waiting
    key.requestsThisMinute = 0;
    key.tokensThisMinute = 0;
    key.minuteStart = Date.now();
  }
  
  return key;
}

/**
 * Update counters after a successful request
 */
function updateKeyCounters(keyState: ApiKeyState, tokens: number): void {
  keyState.requestsThisMinute++;
  keyState.tokensThisMinute += tokens;
  keyState.requestsToday++;
  keyState.lastRequestTime = Date.now();
  
  // Mark as exhausted if daily limit reached
  if (keyState.requestsToday >= RATE_LIMITS.requestsPerDay) {
    keyState.isExhausted = true;
    console.log(`⚠️ API key ${keyState.index + 1} has reached daily limit`);
  }
}

// ============================================
// Usage Logging
// ============================================

/**
 * Log usage to MongoDB
 */
async function logUsage(
  keyIndex: number,
  tokens: number,
  operation: 'embed_single' | 'embed_batch' | 'ingest',
  success: boolean,
  batchSize?: number,
  errorMessage?: string
): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 1) {
      return; // Skip if not connected
    }
    
    await GeminiKeyUsage.create({
      apiKeyIndex: keyIndex,
      timestamp: new Date(),
      requests: 1,
      tokens,
      operation,
      batchSize,
      success,
      errorMessage,
    });
  } catch (error) {
    console.error('Failed to log Gemini usage:', error);
  }
}

/**
 * Get usage statistics for all keys
 */
export async function getGeminiUsageStats(): Promise<{
  totalRequests: number;
  totalTokens: number;
  byKey: Array<{
    keyIndex: number;
    requestsToday: number;
    requestsThisMinute: number;
    tokensThisMinute: number;
    isExhausted: boolean;
    remainingToday: number;
  }>;
}> {
  initializeKeys();
  
  // Get today's stats from DB
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  
  const dbStats = await GeminiKeyUsage.aggregate([
    { $match: { timestamp: { $gte: todayStart }, success: true } },
    {
      $group: {
        _id: '$apiKeyIndex',
        requests: { $sum: '$requests' },
        tokens: { $sum: '$tokens' },
      },
    },
  ]);
  
  const dbStatsByKey = new Map(dbStats.map(s => [s._id, s]));
  
  // Combine with in-memory state
  const byKey = apiKeys.map(keyState => {
    resetMinuteCountersIfNeeded(keyState);
    resetDailyCountersIfNeeded(keyState);
    
    const dbStat = dbStatsByKey.get(keyState.index);
    const requestsToday = Math.max(keyState.requestsToday, dbStat?.requests || 0);
    
    return {
      keyIndex: keyState.index,
      requestsToday,
      requestsThisMinute: keyState.requestsThisMinute,
      tokensThisMinute: keyState.tokensThisMinute,
      isExhausted: keyState.isExhausted,
      remainingToday: Math.max(0, RATE_LIMITS.requestsPerDay - requestsToday),
    };
  });
  
  return {
    totalRequests: byKey.reduce((sum, k) => sum + k.requestsToday, 0),
    totalTokens: dbStats.reduce((sum, s) => sum + s.tokens, 0),
    byKey,
  };
}

/**
 * Sync in-memory counters with database (call on startup)
 */
export async function syncKeyUsageFromDB(): Promise<void> {
  initializeKeys();
  
  if (mongoose.connection.readyState !== 1) {
    console.log('MongoDB not connected, skipping usage sync');
    return;
  }
  
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  
  const dbStats = await GeminiKeyUsage.aggregate([
    { $match: { timestamp: { $gte: todayStart }, success: true } },
    {
      $group: {
        _id: '$apiKeyIndex',
        requests: { $sum: '$requests' },
        tokens: { $sum: '$tokens' },
      },
    },
  ]);
  
  for (const stat of dbStats) {
    const keyState = apiKeys[stat._id];
    if (keyState) {
      keyState.requestsToday = stat.requests;
      if (stat.requests >= RATE_LIMITS.requestsPerDay) {
        keyState.isExhausted = true;
      }
    }
  }
  
  console.log('✅ Synced Gemini API key usage from database');
}

// ============================================
// Gemini API Types
// ============================================

interface GeminiEmbeddingRequest {
  model: string;
  content: {
    parts: Array<{ text: string }>;
  };
  outputDimensionality?: number;
}

interface GeminiBatchEmbeddingRequest {
  requests: GeminiEmbeddingRequest[];
}

interface GeminiEmbeddingResponse {
  embedding: {
    values: number[];
  };
}

interface GeminiBatchEmbeddingResponse {
  embeddings: Array<{
    values: number[];
  }>;
}

// ============================================
// Main Functions
// ============================================

/**
 * Estimate tokens for texts (rough: ~4 chars per token)
 */
function estimateTokens(texts: string[]): number {
  return texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const embeddings = await generateEmbeddings([text], 'embed_single');
  return embeddings[0];
}

/**
 * Generate embeddings for multiple texts with load balancing
 */
export async function generateEmbeddings(
  texts: string[],
  operation: 'embed_single' | 'embed_batch' | 'ingest' = 'embed_batch'
): Promise<number[][]> {
  initializeKeys();
  
  if (texts.length === 0) {
    return [];
  }
  
  const allEmbeddings: number[][] = [];
  let totalTokensUsed = 0;
  let totalRequestsMade = 0;

  console.log(`📥 Processing ${texts.length} texts in batches of ${BATCH_SIZE}...`);

  // Process in batches
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const estimatedTokens = estimateTokens(batch);
    
    // Get an available key (with waiting if needed)
    const keyState = await waitForAvailableKey();
    
    // Delay between requests to stay under rate limit
    await delay(MIN_DELAY_MS);
    
    try {
      // Use batch embedding endpoint
      const embeddings = await callGeminiBatchEmbed(keyState, batch);
      
      // Update counters - each item in batch counts as 1 request!
      const requestsUsed = batch.length;
      const tokensUsed = estimatedTokens;
      totalTokensUsed += tokensUsed;
      totalRequestsMade += requestsUsed;
      
      // Update key counters with actual request count
      keyState.requestsThisMinute += requestsUsed;
      keyState.tokensThisMinute += tokensUsed;
      keyState.requestsToday += requestsUsed;
      keyState.lastRequestTime = Date.now();
      
      // Log usage
      await logUsage(keyState.index, tokensUsed, operation, true, batch.length);
      
      allEmbeddings.push(...embeddings);
      
      // Progress logging
      const progress = Math.min(100, Math.round(((i + batch.length) / texts.length) * 100));
      console.log(`  📊 ${progress}% (${i + batch.length}/${texts.length}) - key ${keyState.index + 1} - ${totalRequestsMade} reqs, ${totalTokensUsed} tokens`);
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      
      await logUsage(keyState.index, 0, operation, false, batch.length, errorMsg);
      
      // If rate limited, wait and retry
      if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
        console.log(`⚠️ Rate limited on key ${keyState.index + 1}. Waiting 60s before retry...`);
        keyState.requestsThisMinute = RATE_LIMITS.requestsPerMinute; // Mark as at minute limit
        
        // Wait a full minute before retrying
        await delay(60_000);
        
        // Reset this key's minute counter
        keyState.requestsThisMinute = 0;
        keyState.tokensThisMinute = 0;
        keyState.minuteStart = Date.now();
        
        i -= BATCH_SIZE; // Retry this batch
        continue;
      }
      
      throw error;
    }
  }

  return allEmbeddings;
}

/**
 * Call Gemini batch embedding API
 */
async function callGeminiBatchEmbed(keyState: ApiKeyState, texts: string[]): Promise<number[][]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=${keyState.key}`;
  
  const requests: GeminiEmbeddingRequest[] = texts.map(text => ({
    model: `models/${GEMINI_EMBEDDING_MODEL}`,
    content: {
      parts: [{ text }],
    },
    outputDimensionality: EMBEDDING_DIMENSIONS,
  }));
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data: GeminiBatchEmbeddingResponse = await response.json();
  
  return data.embeddings.map(e => e.values);
}

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Get embedding dimension
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIMENSIONS;
}

/**
 * Get rate limit status for all keys
 */
export function getRateLimitStatus(): {
  availableKeys: number;
  totalKeys: number;
  keysAtMinuteLimit: number;
  keysAtDailyLimit: number;
} {
  initializeKeys();
  
  let availableKeys = 0;
  let keysAtMinuteLimit = 0;
  let keysAtDailyLimit = 0;
  
  for (const keyState of apiKeys) {
    resetMinuteCountersIfNeeded(keyState);
    resetDailyCountersIfNeeded(keyState);
    
    if (keyState.isExhausted) {
      keysAtDailyLimit++;
    } else if (keyState.requestsThisMinute >= RATE_LIMITS.requestsPerMinute) {
      keysAtMinuteLimit++;
    } else {
      availableKeys++;
    }
  }
  
  return {
    availableKeys,
    totalKeys: apiKeys.length,
    keysAtMinuteLimit,
    keysAtDailyLimit,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
