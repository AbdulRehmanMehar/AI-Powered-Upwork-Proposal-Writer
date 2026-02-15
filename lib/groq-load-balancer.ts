import Groq from 'groq-sdk';
import { connectToDatabase } from './db/connection';
import { ModelUsage, RequestLog, GROQ_MODELS, ModelConfig, IRequestLog } from './db/models';

// ============================================
// Types
// ============================================
export interface ModelAvailability {
  modelId: string;
  config: ModelConfig;
  canUseNow: boolean;
  requestsRemainingMinute: number;
  requestsRemainingDay: number;
  tokensRemainingMinute: number;
  tokensRemainingDay: number | null;
  score: number; // Calculated availability score
  cooldownUntil?: Date; // When the model can be used again
}

export interface LoadBalancerResult {
  success: boolean;
  modelUsed: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  duration: number;
  error?: string;
}

// ============================================
// Rate Limit Cooldown Tracking (in-memory for speed)
// ============================================
const modelCooldowns: Map<string, Date> = new Map();

// Cooldown durations based on error type
const COOLDOWN_DURATION_429 = 60 * 1000; // 60 seconds for rate limit
const COOLDOWN_DURATION_413 = 5 * 60 * 1000; // 5 minutes for request too large
const COOLDOWN_DURATION_500 = 30 * 1000; // 30 seconds for server errors

function setModelCooldown(modelId: string, durationMs: number): void {
  const cooldownUntil = new Date(Date.now() + durationMs);
  modelCooldowns.set(modelId, cooldownUntil);
  console.log(`⏸️ Model ${modelId} on cooldown until ${cooldownUntil.toISOString()}`);
}

function isModelOnCooldown(modelId: string): { onCooldown: boolean; until?: Date } {
  const cooldownUntil = modelCooldowns.get(modelId);
  if (!cooldownUntil) return { onCooldown: false };
  
  if (new Date() >= cooldownUntil) {
    // Cooldown expired, remove it
    modelCooldowns.delete(modelId);
    return { onCooldown: false };
  }
  
  return { onCooldown: true, until: cooldownUntil };
}

function clearModelCooldown(modelId: string): void {
  modelCooldowns.delete(modelId);
}

// ============================================
// Utility Functions
// ============================================
function getStartOfDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfMinute(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

// ============================================
// Groq Load Balancer Class
// ============================================
export class GroqLoadBalancer {
  private groq: Groq;
  private models: ModelConfig[];

  constructor() {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
    this.models = GROQ_MODELS.filter(m => m.enabled);
  }

  /**
   * Get current usage stats for a model
   */
  async getModelUsage(modelId: string): Promise<{
    requestsThisMinute: number;
    requestsToday: number;
    tokensThisMinute: number;
    tokensToday: number;
  }> {
    await connectToDatabase();
    
    const now = new Date();
    const startOfDay = getStartOfDay(now);
    const startOfMinute = getStartOfMinute(now);

    // Get today's usage
    const dailyUsage = await ModelUsage.findOne({
      modelId,
      date: startOfDay,
    });

    // Get this minute's usage
    const minuteUsage = await ModelUsage.findOne({
      modelId,
      minute: startOfMinute,
    });

    return {
      requestsThisMinute: minuteUsage?.requestsThisMinute || 0,
      requestsToday: dailyUsage?.requestsToday || 0,
      tokensThisMinute: minuteUsage?.tokensThisMinute || 0,
      tokensToday: dailyUsage?.tokensToday || 0,
    };
  }

  /**
   * Check availability of all models and return sorted by best option
   */
  async checkAllModelsAvailability(): Promise<ModelAvailability[]> {
    await connectToDatabase();

    const availabilities: ModelAvailability[] = [];

    for (const config of this.models) {
      const usage = await this.getModelUsage(config.modelId);

      const requestsRemainingMinute = config.requestsPerMinute - usage.requestsThisMinute;
      const requestsRemainingDay = config.requestsPerDay - usage.requestsToday;
      const tokensRemainingMinute = config.tokensPerMinute - usage.tokensThisMinute;
      const tokensRemainingDay = config.tokensPerDay !== null 
        ? config.tokensPerDay - usage.tokensToday 
        : null;

      // Check if model is on cooldown from recent rate limit error
      const cooldownStatus = isModelOnCooldown(config.modelId);

      // Can use if we have room in both minute and day limits AND not on cooldown
      const canUseNow = 
        !cooldownStatus.onCooldown &&
        requestsRemainingMinute > 0 && 
        requestsRemainingDay > 0 &&
        tokensRemainingMinute > 1000 && // Need at least 1000 tokens
        (tokensRemainingDay === null || tokensRemainingDay > 1000);

      // Calculate availability score
      // Higher score = better choice
      let score = config.priority;
      
      // Bonus for more remaining capacity
      const dayCapacityPercent = requestsRemainingDay / config.requestsPerDay;
      const minuteCapacityPercent = requestsRemainingMinute / config.requestsPerMinute;
      
      score += dayCapacityPercent * 20;
      score += minuteCapacityPercent * 10;

      // Penalty if running low on daily tokens
      if (tokensRemainingDay !== null && tokensRemainingDay < 10000) {
        score -= 30;
      }

      // Model on cooldown = unavailable
      if (cooldownStatus.onCooldown) {
        score = -100; // Very negative score
      }

      if (!canUseNow) {
        score = -1;
      }

      availabilities.push({
        modelId: config.modelId,
        config,
        canUseNow,
        requestsRemainingMinute,
        requestsRemainingDay,
        tokensRemainingMinute,
        tokensRemainingDay,
        cooldownUntil: cooldownStatus.until,
        score,
      });
    }

    // Sort by score descending
    return availabilities.sort((a, b) => b.score - a.score);
  }

  /**
   * Select the best available model
   */
  async selectBestModel(): Promise<ModelAvailability | null> {
    const availabilities = await this.checkAllModelsAvailability();
    const available = availabilities.find(m => m.canUseNow);
    return available || null;
  }

  /**
   * Record usage after a successful request
   */
  async recordUsage(
    modelId: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    duration: number,
    success: boolean,
    error?: string,
    proposalId?: string
  ): Promise<void> {
    await connectToDatabase();

    const now = new Date();
    const startOfDay = getStartOfDay(now);
    const startOfMinute = getStartOfMinute(now);

    // Update or create daily usage
    await ModelUsage.findOneAndUpdate(
      { modelId, date: startOfDay },
      {
        $inc: {
          requestsToday: 1,
          tokensToday: totalTokens,
        },
        $set: { lastRequestAt: now },
      },
      { upsert: true, new: true }
    );

    // Update or create minute usage
    await ModelUsage.findOneAndUpdate(
      { modelId, minute: startOfMinute },
      {
        $inc: {
          requestsThisMinute: 1,
          tokensThisMinute: totalTokens,
        },
        $set: { 
          lastRequestAt: now,
          date: startOfDay, // Keep date reference
        },
      },
      { upsert: true, new: true }
    );

    // Log the request
    const logData: Partial<IRequestLog> = {
      modelId,
      promptTokens,
      completionTokens,
      totalTokens,
      requestDuration: duration,
      success,
      error,
    };

    if (proposalId) {
      logData.proposalId = proposalId as unknown as IRequestLog['proposalId'];
    }

    await RequestLog.create(logData);
  }

  /**
   * Make a chat completion request with automatic load balancing
   */
  async chatCompletion(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options: {
      temperature?: number;
      maxTokens?: number;
      preferredModel?: string;
      triedModels?: string[]; // Track models we've already tried to avoid loops
      responseFormat?: 'json' | 'text';
      jsonSchema?: Record<string, unknown>; // Note: Groq doesn't enforce schemas, only JSON mode
    } = {}
  ): Promise<LoadBalancerResult> {
    const startTime = Date.now();
    
    // Track which models we've tried
    const triedModels = options.triedModels || [];
    
    // If a preferred model is specified and available, try it first
    let selectedModel: ModelAvailability | null = null;
    
    if (options.preferredModel && !triedModels.includes(options.preferredModel)) {
      const availabilities = await this.checkAllModelsAvailability();
      selectedModel = availabilities.find(
        m => m.modelId === options.preferredModel && m.canUseNow
      ) || null;
    }

    // If no preferred model or it's not available, select the best one we haven't tried
    if (!selectedModel) {
      const availabilities = await this.checkAllModelsAvailability();
      selectedModel = availabilities.find(m => m.canUseNow && !triedModels.includes(m.modelId)) || null;
    }

    if (!selectedModel) {
      return {
        success: false,
        modelUsed: 'none',
        content: '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        duration: Date.now() - startTime,
        error: 'No models available. All rate limits exceeded.',
      };
    }

    try {
      const requestBody: any = {
        model: selectedModel.modelId,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
      };

      // Groq supports response_format for JSON mode (but not enforced schemas)
      if (options.responseFormat === 'json' || options.jsonSchema) {
        requestBody.response_format = { type: 'json_object' };
      }

      const response = await this.groq.chat.completions.create(requestBody);

      const duration = Date.now() - startTime;
      const usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const content = response.choices[0]?.message?.content || '';

      // Successful request - clear any cooldown on this model
      clearModelCooldown(selectedModel.modelId);

      // Record successful usage
      await this.recordUsage(
        selectedModel.modelId,
        usage.prompt_tokens,
        usage.completion_tokens,
        usage.total_tokens,
        duration,
        true
      );

      return {
        success: true,
        modelUsed: selectedModel.modelId,
        content,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Determine cooldown duration based on error type
      let cooldownDuration = 0;
      let shouldRetry = false;
      
      if (errorMessage.includes('429') || errorMessage.includes('rate_limit')) {
        cooldownDuration = COOLDOWN_DURATION_429;
        shouldRetry = true;
        console.log(`🚫 429 Rate limit on ${selectedModel.modelId} - cooling down for 60s`);
      } else if (errorMessage.includes('413') || errorMessage.includes('too large') || errorMessage.includes('exceeded')) {
        cooldownDuration = COOLDOWN_DURATION_413;
        shouldRetry = true;
        console.log(`🚫 413 Request too large on ${selectedModel.modelId} - cooling down for 5min`);
      } else if (errorMessage.includes('500') || errorMessage.includes('502') || errorMessage.includes('503') || errorMessage.includes('server')) {
        cooldownDuration = COOLDOWN_DURATION_500;
        shouldRetry = true; // Also retry on server errors!
        console.log(`🚫 Server error on ${selectedModel.modelId} - cooling down for 30s`);
      }

      // Set cooldown if applicable
      if (cooldownDuration > 0) {
        setModelCooldown(selectedModel.modelId, cooldownDuration);
      }

      // Retry with another model for rate limits AND server errors
      if (shouldRetry) {
        // Record the failed attempt
        await this.recordUsage(
          selectedModel.modelId,
          0, 0, 0,
          duration,
          false,
          errorMessage
        );

        // Add current model to the list of tried models
        triedModels.push(selectedModel.modelId);

        // Try with a different model that we haven't tried yet
        const availabilities = await this.checkAllModelsAvailability();
        const alternativeModel = availabilities.find(
          m => m.canUseNow && !triedModels.includes(m.modelId)
        );

        if (alternativeModel) {
          console.log(`⚡ Switching from ${selectedModel.modelId} to ${alternativeModel.modelId}`);
          return this.chatCompletion(messages, {
            ...options,
            preferredModel: alternativeModel.modelId,
            triedModels,
          });
        } else {
          // All models tried, wait a moment and try the best available
          console.log(`All models exhausted. Tried: ${triedModels.join(', ')}`);
          
          // Return error instead of infinite loop
          return {
            success: false,
            modelUsed: selectedModel.modelId,
            content: '',
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            duration,
            error: `All models exhausted. Tried: ${triedModels.join(', ')}`,
          };
        }
      }

      // For non-retryable errors, just return the error
      await this.recordUsage(
        selectedModel.modelId,
        0, 0, 0,
        duration,
        false,
        errorMessage
      );

      return {
        success: false,
        modelUsed: selectedModel.modelId,
        content: '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * Get usage statistics for all models
   */
  async getUsageStats(): Promise<{
    models: Array<{
      modelId: string;
      config: ModelConfig;
      usage: {
        requestsThisMinute: number;
        requestsToday: number;
        tokensThisMinute: number;
        tokensToday: number;
      };
      availability: ModelAvailability;
    }>;
    totalRequestsToday: number;
    totalTokensToday: number;
  }> {
    const availabilities = await this.checkAllModelsAvailability();
    const models = [];
    let totalRequestsToday = 0;
    let totalTokensToday = 0;

    for (const availability of availabilities) {
      const usage = await this.getModelUsage(availability.modelId);
      totalRequestsToday += usage.requestsToday;
      totalTokensToday += usage.tokensToday;

      models.push({
        modelId: availability.modelId,
        config: availability.config,
        usage,
        availability,
      });
    }

    return {
      models,
      totalRequestsToday,
      totalTokensToday,
    };
  }
}

// Singleton instance
let loadBalancerInstance: GroqLoadBalancer | null = null;

export function getLoadBalancer(): GroqLoadBalancer {
  if (!loadBalancerInstance) {
    loadBalancerInstance = new GroqLoadBalancer();
  }
  return loadBalancerInstance;
}

export default GroqLoadBalancer;
