/**
 * LLM Client — Unified interface for Ollama (local) and Groq (cloud with load balancing).
 * 
 * Configure via environment variables:
 *   LLM_PROVIDER — 'ollama' or 'groq' (default: ollama)
 *   
 *   For Ollama (simple, single model):
 *     OLLAMA_URL   — base URL (default: http://192.168.1.9:11434)
 *     OLLAMA_MODEL — model name (default: qwen2.5:7b)
 *   
 *   For Groq (load-balanced, 5 models with rate limit tracking):
 *     GROQ_API_KEY — Groq API key (required)
 *     Uses GroqLoadBalancer for automatic model rotation, rate limit management, MongoDB tracking.
 */

import { GroqLoadBalancer } from './groq-load-balancer';

// ============================================
// Types
// ============================================
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
// Ollama Client (local)
// ============================================
class OllamaClient {
  private baseUrl: string;
  private model: string;

  // Simple in-memory stats (reset on restart)
  private stats = {
    totalRequests: 0,
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    errors: 0,
    lastRequestAt: null as Date | null,
  };

  constructor() {
    this.baseUrl = process.env.OLLAMA_URL || 'http://192.168.1.9:11434';
    this.model = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
    console.log(`🦙 Ollama client initialized: ${this.baseUrl} / model: ${this.model}`);
  }

  /**
   * Make a chat completion request via Ollama's OpenAI-compatible API.
   * Use responseFormat: 'json' to force structured JSON output (uses Ollama's native JSON mode).
   */
  async chatCompletion(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options: {
      temperature?: number;
      maxTokens?: number;
      preferredModel?: string;
      triedModels?: string[];
      responseFormat?: 'json' | 'text';
      jsonSchema?: Record<string, unknown>; // Ollama structured output schema
    } = {}
  ): Promise<LoadBalancerResult> {
    const startTime = Date.now();
    const model = options.preferredModel || this.model;

    try {
      // Use Ollama native API for JSON mode or structured output; OpenAI-compat otherwise
      const useNativeApi = options.responseFormat === 'json' || options.jsonSchema;

      const url = useNativeApi
        ? `${this.baseUrl}/api/chat`
        : `${this.baseUrl}/v1/chat/completions`;

      // Determine format: full schema > plain "json" > omit
      const format = options.jsonSchema ? options.jsonSchema : (options.responseFormat === 'json' ? 'json' : undefined);

      const body = useNativeApi
        ? {
            model,
            messages,
            ...(format ? { format } : {}),
            stream: false,
            options: {
              temperature: options.temperature ?? 0.7,
              num_predict: options.maxTokens ?? 2048,
            },
          }
        : {
            model,
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 2048,
            stream: false,
          };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${errorText}`);
      }

      const data = await response.json();

      // Handle both Ollama native (/api/chat) and OpenAI-compat (/v1/chat/completions) responses
      const content = useNativeApi
        ? (data.message?.content || '')
        : (data.choices?.[0]?.message?.content || '');

      const usage = useNativeApi
        ? {
            prompt_tokens: data.prompt_eval_count || 0,
            completion_tokens: data.eval_count || 0,
            total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
          }
        : (data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
      const duration = Date.now() - startTime;

      // Update stats
      this.stats.totalRequests++;
      this.stats.totalTokens += usage.total_tokens;
      this.stats.totalPromptTokens += usage.prompt_tokens;
      this.stats.totalCompletionTokens += usage.completion_tokens;
      this.stats.lastRequestAt = new Date();

      return {
        success: true,
        modelUsed: model,
        content,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.stats.errors++;

      const errorMessage = error instanceof Error ? error.message : 'Unknown Ollama error';
      console.error(`🦙 Ollama request failed (${duration}ms): ${errorMessage}`);

      return {
        success: false,
        modelUsed: model,
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
   * Return usage statistics (compatible shape with old load balancer).
   */
  async getUsageStats(): Promise<{
    models: Array<{
      modelId: string;
      totalRequests: number;
      totalTokens: number;
      totalPromptTokens: number;
      totalCompletionTokens: number;
      errors: number;
      lastRequestAt: Date | null;
    }>;
    totalRequestsToday: number;
    totalTokensToday: number;
  }> {
    return {
      models: [
        {
          modelId: this.model,
          totalRequests: this.stats.totalRequests,
          totalTokens: this.stats.totalTokens,
          totalPromptTokens: this.stats.totalPromptTokens,
          totalCompletionTokens: this.stats.totalCompletionTokens,
          errors: this.stats.errors,
          lastRequestAt: this.stats.lastRequestAt,
        },
      ],
      totalRequestsToday: this.stats.totalRequests,
      totalTokensToday: this.stats.totalTokens,
    };
  }
}

// ============================================
// Singleton
// ============================================
let instance: OllamaClient | GroqLoadBalancer | null = null;

export function getLoadBalancer(): OllamaClient | GroqLoadBalancer {
  if (!instance) {
    const provider = process.env.LLM_PROVIDER || 'ollama';
    
    if (provider === 'groq') {
      instance = new GroqLoadBalancer();
    } else {
      instance = new OllamaClient();
    }
  }
  return instance;
}

export default OllamaClient;
