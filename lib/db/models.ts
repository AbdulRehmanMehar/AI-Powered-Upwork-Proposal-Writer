import mongoose, { Schema, Document, Model } from 'mongoose';

// ============================================
// Model Rate Limits Configuration
// ============================================
export interface ModelConfig {
  modelId: string;
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerDay: number | null; // null means no limit
  priority: number; // Higher = preferred
  enabled: boolean;
}

export const GROQ_MODELS: ModelConfig[] = [
  {
    modelId: 'llama-3.3-70b-versatile',
    requestsPerMinute: 30,
    requestsPerDay: 1000,
    tokensPerMinute: 12000,
    tokensPerDay: 100000,
    priority: 100, // Best model - highest priority
    enabled: true,
  },
  {
    modelId: 'moonshotai/kimi-k2-instruct',
    requestsPerMinute: 60,
    requestsPerDay: 1000,
    tokensPerMinute: 10000,
    tokensPerDay: 300000,
    priority: 90,
    enabled: true,
  },
  {
    modelId: 'moonshotai/kimi-k2-instruct-0905',
    requestsPerMinute: 60,
    requestsPerDay: 1000,
    tokensPerMinute: 10000,
    tokensPerDay: 300000,
    priority: 88,
    enabled: true,
  },
  {
    modelId: 'qwen/qwen3-32b',
    requestsPerMinute: 60,
    requestsPerDay: 1000,
    tokensPerMinute: 6000,
    tokensPerDay: 500000,
    priority: 85,
    enabled: true,
  },
  {
    modelId: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    requestsPerMinute: 30,
    requestsPerDay: 1000,
    tokensPerMinute: 6000,
    tokensPerDay: 500000,
    priority: 80,
    enabled: true,
  },
  {
    modelId: 'meta-llama/llama-4-scout-17b-16e-instruct',
    requestsPerMinute: 30,
    requestsPerDay: 1000,
    tokensPerMinute: 30000,
    tokensPerDay: 500000,
    priority: 75,
    enabled: true,
  },
  {
    modelId: 'openai/gpt-oss-120b',
    requestsPerMinute: 30,
    requestsPerDay: 1000,
    tokensPerMinute: 8000,
    tokensPerDay: 200000,
    priority: 70,
    enabled: true,
  },
  {
    modelId: 'openai/gpt-oss-20b',
    requestsPerMinute: 30,
    requestsPerDay: 1000,
    tokensPerMinute: 8000,
    tokensPerDay: 200000,
    priority: 65,
    enabled: true,
  },
  {
    modelId: 'llama-3.1-8b-instant',
    requestsPerMinute: 30,
    requestsPerDay: 14400,
    tokensPerMinute: 6000,
    tokensPerDay: 500000,
    priority: 60,
    enabled: true,
  },
  {
    modelId: 'allam-2-7b',
    requestsPerMinute: 30,
    requestsPerDay: 7000,
    tokensPerMinute: 6000,
    tokensPerDay: 500000,
    priority: 50,
    enabled: true,
  },
  {
    modelId: 'groq/compound',
    requestsPerMinute: 30,
    requestsPerDay: 250,
    tokensPerMinute: 70000,
    tokensPerDay: null, // No limit
    priority: 40, // Lower daily requests
    enabled: true,
  },
  {
    modelId: 'groq/compound-mini',
    requestsPerMinute: 30,
    requestsPerDay: 250,
    tokensPerMinute: 70000,
    tokensPerDay: null,
    priority: 35,
    enabled: true,
  },
];

// ============================================
// Usage Tracking Schema
// ============================================
export interface IModelUsage extends Document {
  modelId: string;
  date: Date; // Normalized to start of day for daily tracking
  minute: Date; // Normalized to start of minute for per-minute tracking
  requestsThisMinute: number;
  requestsToday: number;
  tokensThisMinute: number;
  tokensToday: number;
  lastRequestAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ModelUsageSchema = new Schema<IModelUsage>(
  {
    modelId: {
      type: String,
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    minute: {
      type: Date,
      required: true,
      index: true,
    },
    requestsThisMinute: {
      type: Number,
      default: 0,
    },
    requestsToday: {
      type: Number,
      default: 0,
    },
    tokensThisMinute: {
      type: Number,
      default: 0,
    },
    tokensToday: {
      type: Number,
      default: 0,
    },
    lastRequestAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient lookups
ModelUsageSchema.index({ modelId: 1, date: 1 });
ModelUsageSchema.index({ modelId: 1, minute: 1 });

// ============================================
// Request Log Schema (for detailed tracking)
// ============================================
export interface IRequestLog extends Document {
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestDuration: number; // ms
  success: boolean;
  error?: string;
  proposalId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const RequestLogSchema = new Schema<IRequestLog>(
  {
    modelId: {
      type: String,
      required: true,
      index: true,
    },
    promptTokens: {
      type: Number,
      required: true,
    },
    completionTokens: {
      type: Number,
      required: true,
    },
    totalTokens: {
      type: Number,
      required: true,
    },
    requestDuration: {
      type: Number,
      required: true,
    },
    success: {
      type: Boolean,
      required: true,
    },
    error: {
      type: String,
    },
    proposalId: {
      type: Schema.Types.ObjectId,
      ref: 'Proposal',
    },
  },
  {
    timestamps: true,
  }
);

RequestLogSchema.index({ createdAt: -1 });
RequestLogSchema.index({ modelId: 1, createdAt: -1 });

// ============================================
// Proposal Schema
// ============================================
export type ProposalLength = 'short' | 'full';

// ============================================
// Proposal Outcome Types
// ============================================
export type ProposalOutcome =
  | 'pending'      // Just submitted, waiting
  | 'viewed'       // Client viewed the proposal
  | 'messaged'     // Client replied/messaged
  | 'interviewed'  // Had an interview/call
  | 'hired'        // Got the job!
  | 'rejected'     // Explicitly rejected
  | 'no_response'; // No response after X days

export interface IProposal extends Document {
  userId?: mongoose.Types.ObjectId;
  jobTitle: string;
  jobDescription: string;
  clientName?: string;
  budget?: string;
  skills: string[];
  generatedProposal: string;
  proposalLength: ProposalLength;
  modelUsed: string;
  tokensUsed: number;
  generationTime: number; // ms
  // Outcome tracking for AI learning
  outcome: ProposalOutcome;
  outcomeUpdatedAt?: Date;
  submittedAt?: Date; // When user submitted to Upwork
  clientResponseTime?: number; // Hours until first response
  // User feedback
  rating?: number; // User rating 1-5
  notes?: string;
  whatWorked?: string; // User notes on what worked
  whatDidntWork?: string; // User notes on what didn't work
  // Screening questions & answers
  screeningAnswers?: Array<{
    question: string;
    answer: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const ProposalSchema = new Schema<IProposal>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    jobTitle: {
      type: String,
      required: true,
    },
    jobDescription: {
      type: String,
      required: true,
    },
    clientName: {
      type: String,
    },
    budget: {
      type: String,
    },
    skills: [{
      type: String,
    }],
    generatedProposal: {
      type: String,
      required: true,
    },
    proposalLength: {
      type: String,
      enum: ['short', 'full'],
      default: 'full',
    },
    modelUsed: {
      type: String,
      required: true,
    },
    tokensUsed: {
      type: Number,
      required: true,
    },
    generationTime: {
      type: Number,
      required: true,
    },
    // Outcome tracking
    outcome: {
      type: String,
      enum: ['pending', 'viewed', 'messaged', 'interviewed', 'hired', 'rejected', 'no_response'],
      default: 'pending',
    },
    outcomeUpdatedAt: {
      type: Date,
    },
    submittedAt: {
      type: Date,
    },
    clientResponseTime: {
      type: Number,
    },
    // User feedback
    rating: {
      type: Number,
      min: 1,
      max: 5,
    },
    notes: {
      type: String,
    },
    whatWorked: {
      type: String,
    },
    whatDidntWork: {
      type: String,
    },
    // Screening questions & answers
    screeningAnswers: [{
      question: String,
      answer: String,
    }],
  },
  {
    timestamps: true,
  }
);

ProposalSchema.index({ createdAt: -1 });
ProposalSchema.index({ outcome: 1 });
ProposalSchema.index({ userId: 1, outcome: 1 });

// ============================================
// Validation Failure Schema (Learning System)
// ============================================

/**
 * Tracks validation failures so the AI can learn from mistakes.
 * Aggregated by error type to build a "common mistakes" list.
 */
export interface IValidationFailure extends Document {
  userId?: mongoose.Types.ObjectId;
  errorType: string;        // e.g., "signature_format", "missing_greeting", "banned_phrase"
  errorMessage: string;     // The actual error message
  validatorName: string;    // e.g., "validateSignature", "validateGreeting"
  intensity: 'ultra-short' | 'full';
  badSnippet?: string;      // The problematic part of the proposal
  fixedSnippet?: string;    // What it was corrected to (if available)
  count: number;            // How many times this exact error occurred
  lastOccurred: Date;
  createdAt: Date;
}

const ValidationFailureSchema = new Schema<IValidationFailure>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    errorType: {
      type: String,
      required: true,
      index: true,
    },
    errorMessage: {
      type: String,
      required: true,
    },
    validatorName: {
      type: String,
      required: true,
    },
    intensity: {
      type: String,
      enum: ['ultra-short', 'full'],
      required: true,
    },
    badSnippet: String,
    fixedSnippet: String,
    count: {
      type: Number,
      default: 1,
    },
    lastOccurred: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient querying of common mistakes
ValidationFailureSchema.index({ errorType: 1, count: -1 });
ValidationFailureSchema.index({ userId: 1, lastOccurred: -1 });
ValidationFailureSchema.index({ intensity: 1, count: -1 });

// ============================================
// Winning Proposal Schema (Learning from Success)
// ============================================

/**
 * Stores proposals that won jobs - used as examples for the AI to learn from.
 * These are gold - actual proposals that converted to interviews/hires.
 */
export interface IWinningProposal extends Document {
  userId: mongoose.Types.ObjectId;
  
  // The proposal content
  proposalText: string;
  
  // Job details
  jobTitle: string;
  jobDescription?: string;
  clientName?: string;
  budget?: string;
  
  // Outcome tracking
  outcome: 'interview' | 'hired' | 'ongoing'; // interview = got interview, hired = got job
  hireDate?: Date;
  earnings?: number; // Total earned from this job
  
  // Classification for RAG retrieval
  category?: string; // e.g., "web-development", "ai-automation", "fintech"
  tags?: string[]; // Keywords for matching: ["nextjs", "stripe", "authentication"]
  intensity: 'ultra-short' | 'full';
  
  // Success metrics
  responseTime?: number; // Hours from posting to client response
  competitorCount?: number; // Number of other proposals
  
  // Notes
  notes?: string; // What worked about this proposal
  
  createdAt: Date;
  updatedAt: Date;
}

const WinningProposalSchema = new Schema<IWinningProposal>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    proposalText: {
      type: String,
      required: true,
    },
    jobTitle: {
      type: String,
      required: true,
    },
    jobDescription: String,
    clientName: String,
    budget: String,
    outcome: {
      type: String,
      enum: ['interview', 'hired', 'ongoing'],
      required: true,
      default: 'interview',
      index: true,
    },
    hireDate: Date,
    earnings: Number,
    category: {
      type: String,
      index: true,
    },
    tags: [String],
    intensity: {
      type: String,
      enum: ['ultra-short', 'full'],
      required: true,
    },
    responseTime: Number,
    competitorCount: Number,
    notes: String,
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient RAG retrieval
WinningProposalSchema.index({ userId: 1, outcome: 1 });
WinningProposalSchema.index({ userId: 1, category: 1 });
WinningProposalSchema.index({ tags: 1 });
WinningProposalSchema.index({ intensity: 1, outcome: 1 });
WinningProposalSchema.index({ createdAt: -1 });

// ============================================
// User Feedback Learning Schema
// ============================================

/**
 * Human-in-the-loop feedback system.
 * When user clicks "Regenerate" and provides feedback,
 * the reviewer extracts learning points and stores them here.
 * These learnings are included in future proposal generations.
 */
export interface IUserFeedbackLearning extends Document {
  userId: mongoose.Types.ObjectId;
  
  // The feedback context
  proposalId: mongoose.Types.ObjectId;
  originalProposal: string;
  userFeedback: string; // What the user said was wrong
  
  // Extracted learning (from Reviewer agent)
  learningCategory: string; // e.g., "hook", "proof", "tone", "formatting", "length"
  learningRule: string; // The specific rule extracted, e.g., "Don't mention multiple projects"
  severity: 'critical' | 'important' | 'minor';
  
  // For matching future jobs
  jobType?: string; // e.g., "web-dev", "ai", "automation"
  clientType?: string; // e.g., "startup", "enterprise", "agency"
  
  // Usage tracking
  timesApplied: number; // How many times this learning was used in prompts
  lastApplied?: Date;
  
  // Effectiveness tracking
  wasHelpful?: boolean; // Did following this rule improve outcomes?
  
  createdAt: Date;
  updatedAt: Date;
}

const UserFeedbackLearningSchema = new Schema<IUserFeedbackLearning>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    proposalId: {
      type: Schema.Types.ObjectId,
      ref: 'Proposal',
      required: true,
    },
    originalProposal: {
      type: String,
      required: true,
    },
    userFeedback: {
      type: String,
      required: true,
    },
    learningCategory: {
      type: String,
      required: true,
      enum: ['hook', 'proof', 'tone', 'formatting', 'length', 'relevance', 'signature', 'banned_phrase', 'other'],
      index: true,
    },
    learningRule: {
      type: String,
      required: true,
    },
    severity: {
      type: String,
      enum: ['critical', 'important', 'minor'],
      default: 'important',
    },
    jobType: {
      type: String,
      index: true,
    },
    clientType: {
      type: String,
    },
    timesApplied: {
      type: Number,
      default: 0,
    },
    lastApplied: {
      type: Date,
    },
    wasHelpful: {
      type: Boolean,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient learning retrieval
UserFeedbackLearningSchema.index({ userId: 1, severity: 1, createdAt: -1 });
UserFeedbackLearningSchema.index({ userId: 1, learningCategory: 1 });
UserFeedbackLearningSchema.index({ userId: 1, jobType: 1 });

// ============================================
// Model Exports
// ============================================
export const ModelUsage: Model<IModelUsage> =
  mongoose.models.ModelUsage || mongoose.model<IModelUsage>('ModelUsage', ModelUsageSchema);

export const RequestLog: Model<IRequestLog> =
  mongoose.models.RequestLog || mongoose.model<IRequestLog>('RequestLog', RequestLogSchema);

export const Proposal: Model<IProposal> =
  mongoose.models.Proposal || mongoose.model<IProposal>('Proposal', ProposalSchema);

export const ValidationFailure: Model<IValidationFailure> =
  mongoose.models.ValidationFailure || mongoose.model<IValidationFailure>('ValidationFailure', ValidationFailureSchema);

export const WinningProposal: Model<IWinningProposal> =
  mongoose.models.WinningProposal || mongoose.model<IWinningProposal>('WinningProposal', WinningProposalSchema);

export const UserFeedbackLearning: Model<IUserFeedbackLearning> =
  mongoose.models.UserFeedbackLearning || mongoose.model<IUserFeedbackLearning>('UserFeedbackLearning', UserFeedbackLearningSchema);
