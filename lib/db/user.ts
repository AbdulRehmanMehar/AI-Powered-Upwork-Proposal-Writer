import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcryptjs';

// ============================================
// User Schema
// ============================================
export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  password: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  
  // Profile/Background info for proposals
  profile: {
    title?: string; // e.g., "Senior React Developer"
    summary?: string; // Brief professional summary
    yearsExperience?: number;
    hourlyRate?: string;
    skills?: string[];
    specializations?: string[];
    portfolioLinks?: string[];
    pastClients?: string[]; // Notable past clients
    achievements?: string[]; // Key achievements
    certifications?: string[];
    availability?: string; // e.g., "20 hours/week"
    timezone?: string;
    preferredTone?: 'professional' | 'friendly' | 'casual' | 'formal';
    customSignature?: string;
    // New fields for additional context
    additionalDetails?: string; // Free-form text for any extra context
    resumeText?: string; // Parsed text content from uploaded resume
    resumeFileName?: string; // Original filename of uploaded resume
    resumeUploadedAt?: Date; // When the resume was uploaded
    // GitHub integration for real project examples
    githubUsername?: string; // GitHub username
    githubPat?: string; // Personal Access Token (for private repos + higher rate limit)
    githubProjectsCache?: string; // Cached JSON of fetched projects
    githubLastFetched?: Date; // When projects were last fetched
    // GitHub sync tracking for incremental sync
    githubSyncedRepos?: string[]; // List of repo full names that are synced
    githubTotalRepos?: number; // Total number of repos found
    githubSyncStartedAt?: Date; // When current sync batch started
  };
  
  // Methods
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Don't include password in queries by default
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
    },
    profile: {
      title: { type: String, trim: true },
      summary: { type: String, trim: true, maxlength: 1000 },
      yearsExperience: { type: Number, min: 0, max: 50 },
      hourlyRate: { type: String, trim: true },
      skills: [{ type: String, trim: true }],
      specializations: [{ type: String, trim: true }],
      portfolioLinks: [{ type: String, trim: true }],
      pastClients: [{ type: String, trim: true }],
      achievements: [{ type: String, trim: true }],
      certifications: [{ type: String, trim: true }],
      availability: { type: String, trim: true },
      timezone: { type: String, trim: true },
      preferredTone: {
        type: String,
        enum: ['professional', 'friendly', 'casual', 'formal'],
        default: 'professional',
      },
      customSignature: { type: String, trim: true, maxlength: 200 },
      // New fields for additional context
      additionalDetails: { type: String, trim: true, maxlength: 50000 },
      resumeText: { type: String, trim: true, maxlength: 50000 },
      resumeFileName: { type: String, trim: true },
      resumeUploadedAt: { type: Date },
      // GitHub integration
      githubUsername: { type: String, trim: true },
      githubPat: { type: String, trim: true, select: false }, // Don't expose PAT by default
      githubProjectsCache: { type: String, trim: true, maxlength: 100000 },
      githubLastFetched: { type: Date },
      // GitHub sync tracking
      githubSyncedRepos: [{ type: String }],
      githubTotalRepos: { type: Number, default: 0 },
      githubSyncStartedAt: { type: Date },
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
UserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error) {
    throw error as Error;
  }
});

// Compare password method
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// ============================================
// Export
// ============================================
export const User: Model<IUser> = 
  mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export default User;
