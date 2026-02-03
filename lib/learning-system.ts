/**
 * Learning System for Proposal Generator
 * 
 * Tracks validation failures and uses them to improve future generation.
 * The AI learns from mistakes instead of repeating them.
 */

import { connectToDatabase } from './db/connection';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';

// ============================================
// Types
// ============================================

export interface ValidationFailure {
  _id?: ObjectId;
  userId?: ObjectId;
  errorType: string;
  errorMessage: string;
  validatorName: string;
  intensity: 'ultra-short' | 'full';
  badSnippet?: string;
  fixedSnippet?: string;
  count: number;
  lastOccurred: Date;
  createdAt: Date;
}

export interface LearnedWarning {
  errorType: string;
  message: string;
  frequency: number;
  example?: string;
}

// ============================================
// In-Memory Cache for Frequent Mistakes
// ============================================

// Cache common mistakes to avoid DB hits on every request
let cachedWarnings: LearnedWarning[] = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================
// Helper to get DB
// ============================================

async function getDb() {
  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection failed');
  }
  return db;
}

// ============================================
// Core Functions
// ============================================

/**
 * Record a validation failure for learning
 */
export async function recordValidationFailure(
  validatorName: string,
  errorMessage: string,
  intensity: 'ultra-short' | 'full',
  options?: {
    userId?: string;
    badSnippet?: string;
    fixedSnippet?: string;
  }
): Promise<void> {
  try {
    const db = await getDb();
    const collection = db.collection('validationfailures');
    
    // Normalize error type from validator name
    const errorType = normalizeErrorType(validatorName, errorMessage);
    
    // Try to find existing failure with same error type
    const existing = await collection.findOne({
      errorType,
      intensity,
      ...(options?.userId ? { userId: new ObjectId(options.userId) } : {}),
    });
    
    if (existing) {
      // Increment count and update last occurred
      await collection.updateOne(
        { _id: existing._id },
        {
          $inc: { count: 1 },
          $set: {
            lastOccurred: new Date(),
            // Update snippets if provided (newer examples are better)
            ...(options?.badSnippet && { badSnippet: options.badSnippet }),
            ...(options?.fixedSnippet && { fixedSnippet: options.fixedSnippet }),
          },
        }
      );
      console.log(`📚 Learning: Updated failure count for "${errorType}" (count: ${existing.count + 1})`);
    } else {
      // Create new failure record
      const failure: Omit<ValidationFailure, '_id'> = {
        userId: options?.userId ? new ObjectId(options.userId) : undefined,
        errorType,
        errorMessage,
        validatorName,
        intensity,
        badSnippet: options?.badSnippet,
        fixedSnippet: options?.fixedSnippet,
        count: 1,
        lastOccurred: new Date(),
        createdAt: new Date(),
      };
      
      await collection.insertOne(failure);
      console.log(`📚 Learning: Recorded new failure type "${errorType}"`);
    }
    
    // Invalidate cache so next generation picks up new data
    cacheTimestamp = 0;
  } catch (error) {
    console.error('Failed to record validation failure:', error);
    // Don't throw - learning is non-critical
  }
}

/**
 * Record when a validation failure was successfully fixed
 */
export async function recordSuccessfulFix(
  validatorName: string,
  errorMessage: string,
  intensity: 'ultra-short' | 'full',
  badSnippet: string,
  fixedSnippet: string
): Promise<void> {
  try {
    const db = await getDb();
    const collection = db.collection('validationfailures');
    
    const errorType = normalizeErrorType(validatorName, errorMessage);
    
    // Update the record with the fix example
    await collection.updateOne(
      { errorType, intensity },
      {
        $set: {
          badSnippet,
          fixedSnippet,
          lastOccurred: new Date(),
        },
      }
    );
    
    console.log(`📚 Learning: Recorded fix for "${errorType}": "${badSnippet.substring(0, 50)}..." → "${fixedSnippet.substring(0, 50)}..."`);
  } catch (error) {
    console.error('Failed to record successful fix:', error);
  }
}

/**
 * Get learned warnings to inject into prompts
 * Returns the most common mistakes sorted by frequency
 */
export async function getLearnedWarnings(
  intensity?: 'ultra-short' | 'full',
  limit: number = 10
): Promise<LearnedWarning[]> {
  // Check cache first
  if (Date.now() - cacheTimestamp < CACHE_TTL_MS && cachedWarnings.length > 0) {
    const filtered = intensity 
      ? cachedWarnings.filter(w => w.errorType.includes(intensity) || !w.errorType.includes('ultra-short') && !w.errorType.includes('full'))
      : cachedWarnings;
    return filtered.slice(0, limit);
  }
  
  try {
    const db = await getDb();
    const collection = db.collection('validationfailures');
    
    // Get most frequent failures from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const query: Record<string, unknown> = {
      lastOccurred: { $gte: thirtyDaysAgo },
    };
    
    if (intensity) {
      query.intensity = intensity;
    }
    
    const failures = await collection
      .find(query)
      .sort({ count: -1 })
      .limit(limit * 2) // Get more to filter later
      .toArray();
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warnings: LearnedWarning[] = failures.map((f: any) => ({
      errorType: f.errorType as string,
      message: buildWarningMessage(f as ValidationFailure),
      frequency: f.count as number,
      example: f.badSnippet ? `Bad: "${f.badSnippet}"${f.fixedSnippet ? ` → Good: "${f.fixedSnippet}"` : ''}` : undefined,
    }));
    
    // Update cache
    cachedWarnings = warnings;
    cacheTimestamp = Date.now();
    
    return warnings.slice(0, limit);
  } catch (error) {
    console.error('Failed to get learned warnings:', error);
    return [];
  }
}

/**
 * Build a prompt section with learned warnings
 */
export async function buildLearnedWarningsPrompt(intensity: 'ultra-short' | 'full'): Promise<string> {
  const warnings = await getLearnedWarnings(intensity, 8);
  
  if (warnings.length === 0) {
    return '';
  }
  
  const warningLines = warnings.map((w, i) => {
    let line = `${i + 1}. 🚫 **${w.message}** (failed ${w.frequency}x)`;
    if (w.example) {
      line += `\n   Example: ${w.example}`;
    }
    return line;
  });
  
  const totalFailures = warnings.reduce((sum, w) => sum + w.frequency, 0);
  
  return `
## 🔴 CRITICAL: LEARNED FROM ${totalFailures} PAST FAILURES

**READ EVERY WARNING BELOW. These are REAL mistakes that got proposals REJECTED.**

${warningLines.join('\n\n')}

⚠️ The validator will IMMEDIATELY REJECT your proposal if you make ANY of these mistakes.
✅ Double-check your output against EACH warning above before submitting.
`;
}

/**
 * Get stats about the learning system
 */
export async function getLearningStats(): Promise<{
  totalFailures: number;
  uniqueErrorTypes: number;
  topMistakes: { errorType: string; count: number }[];
  lastUpdated: Date | null;
}> {
  try {
    const db = await getDb();
    const collection = db.collection('validationfailures');
    
    const totalFailures = await collection.countDocuments();
    const uniqueErrorTypes = (await collection.distinct('errorType')).length;
    
    const topMistakes = await collection
      .find()
      .sort({ count: -1 })
      .limit(5)
      .project({ errorType: 1, count: 1, _id: 0 })
      .toArray();
    
    const lastRecord = await collection
      .findOne({}, { sort: { lastOccurred: -1 } });
    
    return {
      totalFailures,
      uniqueErrorTypes,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      topMistakes: topMistakes.map((m: any) => ({ errorType: m.errorType as string, count: m.count as number })),
      lastUpdated: lastRecord?.lastOccurred || null,
    };
  } catch (error) {
    console.error('Failed to get learning stats:', error);
    return {
      totalFailures: 0,
      uniqueErrorTypes: 0,
      topMistakes: [],
      lastUpdated: null,
    };
  }
}

/**
 * Clear learning data (useful for testing or resetting)
 */
export async function clearLearningData(userId?: string): Promise<void> {
  try {
    const db = await getDb();
    const collection = db.collection('validationfailures');
    
    if (userId) {
      await collection.deleteMany({ userId: new ObjectId(userId) });
    } else {
      await collection.deleteMany({});
    }
    
    // Invalidate cache
    cacheTimestamp = 0;
    cachedWarnings = [];
    
    console.log('📚 Learning data cleared');
  } catch (error) {
    console.error('Failed to clear learning data:', error);
  }
}

// ============================================
// USER FEEDBACK LEARNING SYSTEM
// (Human-in-the-loop feedback, not auto-validation)
// ============================================

export interface UserFeedbackRule {
  category: string;
  rule: string;
  severity: 'critical' | 'important' | 'minor';
  timesApplied: number;
}

// Cache for user feedback learnings
let cachedUserLearnings: Map<string, UserFeedbackRule[]> = new Map();
let userLearningsCacheTimestamp: Map<string, number> = new Map();
const USER_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes (shorter because human feedback is more important)

/**
 * Get user-specific feedback learnings
 * These come from the "Regenerate with feedback" feature
 */
export async function getUserFeedbackLearnings(
  userId: string,
  limit: number = 10
): Promise<UserFeedbackRule[]> {
  // Check cache
  const cacheKey = userId;
  const cacheTime = userLearningsCacheTimestamp.get(cacheKey) || 0;
  
  if (Date.now() - cacheTime < USER_CACHE_TTL_MS) {
    const cached = cachedUserLearnings.get(cacheKey);
    if (cached) {
      return cached.slice(0, limit);
    }
  }

  try {
    const db = await getDb();
    const collection = db.collection('userfeedbacklearnings');
    
    // Get learnings sorted by severity (critical first) then recency
    const learnings = await collection
      .find({ userId: new ObjectId(userId) })
      .sort({ 
        severity: 1, // "critical" < "important" < "minor" alphabetically 
        createdAt: -1 
      })
      .limit(limit * 2) // Get more for filtering
      .toArray();
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rules: UserFeedbackRule[] = learnings.map((l: any) => ({
      category: l.learningCategory,
      rule: l.learningRule,
      severity: l.severity,
      timesApplied: l.timesApplied || 0,
    }));

    // Update cache
    cachedUserLearnings.set(cacheKey, rules);
    userLearningsCacheTimestamp.set(cacheKey, Date.now());

    return rules.slice(0, limit);
  } catch (error) {
    console.error('Failed to get user feedback learnings:', error);
    return [];
  }
}

/**
 * Build a prompt section with user-specific feedback learnings
 * This is DIFFERENT from buildLearnedWarningsPrompt - this is HUMAN feedback
 */
export async function buildUserFeedbackPrompt(userId: string): Promise<string> {
  const learnings = await getUserFeedbackLearnings(userId, 8);
  
  if (learnings.length === 0) {
    return '';
  }

  // Group by severity
  const critical = learnings.filter(l => l.severity === 'critical');
  const important = learnings.filter(l => l.severity === 'important');
  const minor = learnings.filter(l => l.severity === 'minor');

  let prompt = '\n## 🎯 YOUR PERSONAL WRITING RULES (from your feedback)\n\n';
  prompt += 'These rules come from YOUR past feedback. Follow them carefully.\n\n';

  if (critical.length > 0) {
    prompt += '### 🔴 CRITICAL (must follow):\n';
    critical.forEach((l, i) => {
      prompt += `${i + 1}. **${l.rule}**\n`;
    });
    prompt += '\n';
  }

  if (important.length > 0) {
    prompt += '### 🟡 IMPORTANT:\n';
    important.forEach((l, i) => {
      prompt += `${i + 1}. ${l.rule}\n`;
    });
    prompt += '\n';
  }

  if (minor.length > 0) {
    prompt += '### 🟢 Style preferences:\n';
    minor.forEach((l, i) => {
      prompt += `${i + 1}. ${l.rule}\n`;
    });
    prompt += '\n';
  }

  return prompt;
}

/**
 * Mark a learning as applied (for tracking effectiveness)
 */
export async function markLearningApplied(learningIds: string[]): Promise<void> {
  if (learningIds.length === 0) return;
  
  try {
    const db = await getDb();
    const collection = db.collection('userfeedbacklearnings');
    
    await collection.updateMany(
      { _id: { $in: learningIds.map(id => new ObjectId(id)) } },
      {
        $inc: { timesApplied: 1 },
        $set: { lastApplied: new Date() },
      }
    );
  } catch (error) {
    console.error('Failed to mark learnings as applied:', error);
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Normalize error type from validator name and message
 */
function normalizeErrorType(validatorName: string, errorMessage: string): string {
  // Extract key phrases from error message
  const lowerMessage = errorMessage.toLowerCase();
  
  if (lowerMessage.includes('best regards') || lowerMessage.includes('best,')) {
    return 'signature_best_regards_ultra_short';
  }
  if (lowerMessage.includes('greeting') || lowerMessage.includes('hi ')) {
    return 'missing_greeting';
  }
  if (lowerMessage.includes('we ') || lowerMessage.includes('our team')) {
    return 'solo_pronoun_we';
  }
  if (lowerMessage.includes('check my profile') || lowerMessage.includes('feel free')) {
    return 'weak_cta';
  }
  if (lowerMessage.includes('grammar')) {
    return 'grammar_error';
  }
  if (lowerMessage.includes('hallucination') || lowerMessage.includes('invented')) {
    return 'hallucination';
  }
  if (lowerMessage.includes('banned phrase') || lowerMessage.includes('excited')) {
    return 'banned_ai_phrase';
  }
  if (lowerMessage.includes('portfolio') || lowerMessage.includes('link')) {
    return 'missing_portfolio_link';
  }
  if (lowerMessage.includes('client name') || lowerMessage.includes('greeting uses')) {
    return 'wrong_client_name';
  }
  if (lowerMessage.includes('acronym') || lowerMessage.includes('corporate')) {
    return 'robotic_tone';
  }
  if (lowerMessage.includes('availability') || lowerMessage.includes('timezone')) {
    return 'filler_availability';
  }
  if (lowerMessage.includes('inline signature') || lowerMessage.includes(', name')) {
    return 'inline_signature';
  }
  
  // Default: use validator name + first few words of message
  const sanitizedValidator = validatorName.replace('validate', '').toLowerCase();
  return `${sanitizedValidator}_other`;
}

/**
 * Build a human-readable warning message
 */
function buildWarningMessage(failure: ValidationFailure): string {
  switch (failure.errorType) {
    case 'signature_best_regards_ultra_short':
      return 'Ultra-short proposals must NOT use "Best," or "Best regards," - just "— Name"';
    case 'missing_greeting':
      return 'Always start with a greeting: "Hi [ClientName]," or "Hi there,"';
    case 'solo_pronoun_we':
      return 'You are SOLO - never use "We" or "Our team"';
    case 'weak_cta':
      return 'Never say "check my profile" or "feel free" - give specific next step';
    case 'grammar_error':
      return 'Watch for grammar: "I\'ve experience" → "I have experience"';
    case 'hallucination':
      return 'Don\'t invent projects - use "built something similar" if no exact match';
    case 'banned_ai_phrase':
      return 'Avoid AI phrases: "I\'m excited", "I would love to", "I\'m passionate"';
    case 'missing_portfolio_link':
      return 'If you mention work, include a link (9x hire rate impact!)';
    case 'wrong_client_name':
      return 'Double-check client name in greeting - never use your own name!';
    case 'robotic_tone':
      return 'Limit acronyms and avoid corporate words like "Furthermore"';
    case 'filler_availability':
      return 'Don\'t include availability/timezone info - it\'s filler';
    case 'inline_signature':
      return 'Signature must be on its own line, not inline like ", Abdul"';
    default:
      return failure.errorMessage.substring(0, 100);
  }
}
