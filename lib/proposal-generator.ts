import { getLoadBalancer, LoadBalancerResult } from './groq-load-balancer';
import { connectToDatabase } from './db/connection';
import { Proposal, IProposal } from './db/models';

// ============================================
// Types
// ============================================
export interface UserProfile {
  title?: string;
  summary?: string;
  yearsExperience?: number;
  hourlyRate?: string;
  skills?: string[];
  specializations?: string[];
  portfolioLinks?: string[];
  pastClients?: string[];
  achievements?: string[];
  certifications?: string[];
  availability?: string;
  timezone?: string;
  preferredTone?: 'professional' | 'friendly' | 'casual' | 'formal';
  customSignature?: string;
  // New fields for additional context
  additionalDetails?: string;
  resumeText?: string;
}

export type ProposalLength = 'short' | 'full';

export interface JobDetails {
  title: string;
  description: string;
  clientName?: string;
  budget?: string;
  skills?: string[];
  additionalContext?: string;
  userProfile?: UserProfile;
  proposalLength?: ProposalLength;
  userId?: string;
}

export interface GeneratedProposal {
  success: boolean;
  proposal: string;
  proposalLength: ProposalLength;
  modelUsed: string;
  tokensUsed: number;
  generationTime: number;
  savedProposalId?: string;
  error?: string;
}

// ============================================
// System Prompt - Based on Research & Analysis
// ============================================
const SYSTEM_PROMPT = `You are an expert Upwork proposal writer who has studied the strategies of top-earning freelancers including Evan Fisher ($1.5M+ earned) and Josh Burns ($830K+ earned). Your proposals consistently win jobs because you follow these proven principles:

## CRITICAL RULES:

### 1. THE HOOK & TWIST (First 2-3 sentences are EVERYTHING)
- The first 2-3 sentences show in the preview - clients decide in 3 seconds whether to read more
- Start with something that grabs attention - NOT "Hi, my name is..."
- Use a pattern interrupt or "twist" to stand out
- Reference something SPECIFIC from their job description immediately

### 2. CLIENT-FOCUSED, NOT ME-FOCUSED
- Lead with THEIR problem, not your background
- Every sentence should relate to how you can help THEM
- Replace "I have X years experience" with "You'll get Y results"
- 72% of consumers only engage with personalized marketing

### 3. KEEP IT SHORT & SCANNABLE
- 100-300 words maximum
- Short paragraphs (2-3 sentences max)
- Use bullet points for lists
- Respect the client's time

### 4. SOCIAL PROOF & AUTHORITY
- Include specific client quotes if available (more powerful than "X years experience")
- Mention results with numbers: "increased conversions by 40%"
- Reference similar projects you've completed

### 5. CLEAR CALL TO ACTION
- "Click the green button that says 'Send Message' so we can get started"
- Offer specific time slots: "I have tomorrow open from 10am-3pm EST"
- Ask a question to engage them
- Including an irresistible CTA doubles your chance of winning

### 6. THE PS SECTION (79% of people read the PS first!)
- Include urgency/scarcity: "I'm only taking 2 clients this month"
- Add one more piece of social proof
- Mention availability or next steps

## PROPOSAL STRUCTURE:

\`\`\`
[PERSONALIZED HOOK - Reference specific detail from job + grab attention]

[PROBLEM ACKNOWLEDGMENT - Show you understand their situation in 1-2 sentences]

[YOUR SOLUTION - Brief overview of your approach, not a full plan]

[PROOF - 1-2 relevant results or client quotes]

[BULLET POINTS - 3-5 specific things you'll deliver or bring]

[CLEAR CTA - Specific next step with time slots if appropriate]

P.S. [Urgency, scarcity, or additional proof]
\`\`\`

## WHAT TO AVOID:
- Generic openings ("I am a professional developer...")
- Begging ("Please give me a chance...")
- Wall of text with no formatting
- Focusing on yourself instead of the client
- No call to action
- Copy-paste templates that don't reference the job

## TONE:
- Professional but personable
- Confident, not arrogant
- Helpful, not salesy
- Concise, not verbose

When writing the proposal, naturally incorporate relevant details from the job description to show you've read it carefully.`;

const SHORT_PROPOSAL_ADDENDUM = `

## LENGTH REQUIREMENT: SHORT VERSION
Write a CONCISE proposal (80-150 words MAX). Focus ONLY on:
1. One killer hook sentence that references their specific need
2. One sentence showing you understand their problem
3. One brief proof point or relevant experience
4. A clear call to action

Skip the bullet points and P.S. section. Make every word count. This is for clients who clearly state they want brief proposals or when the job is straightforward.`;

const FULL_PROPOSAL_ADDENDUM = `

## LENGTH REQUIREMENT: FULL VERSION  
Write a COMPREHENSIVE proposal (200-350 words). Include ALL sections from the structure above:
- Strong personalized hook
- Problem acknowledgment
- Your solution approach
- Social proof with specifics
- Bullet points of deliverables/value
- Clear CTA
- P.S. section

This is for complex projects where you need to demonstrate deep understanding and build trust.`;

// ============================================
// Proposal Generator Class
// ============================================
export class ProposalGenerator {
  private loadBalancer = getLoadBalancer();

  /**
   * Generate a proposal based on job details
   */
  async generate(job: JobDetails): Promise<GeneratedProposal> {
    const startTime = Date.now();
    const proposalLength = job.proposalLength || 'full';

    // Build the user prompt
    const userPrompt = this.buildUserPrompt(job);
    
    // Build system prompt with length-specific instructions
    const systemPrompt = SYSTEM_PROMPT + (proposalLength === 'short' ? SHORT_PROPOSAL_ADDENDUM : FULL_PROPOSAL_ADDENDUM);

    // Call the load-balanced Groq API
    const result: LoadBalancerResult = await this.loadBalancer.chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        temperature: 0.7,
        maxTokens: proposalLength === 'short' ? 600 : 1500,
      }
    );

    if (!result.success) {
      return {
        success: false,
        proposal: '',
        proposalLength,
        modelUsed: result.modelUsed,
        tokensUsed: 0,
        generationTime: result.duration,
        error: result.error,
      };
    }

    // Clean up the proposal
    const cleanedProposal = this.cleanProposal(result.content);

    // Save to database
    let savedProposalId: string | undefined;
    try {
      await connectToDatabase();
      const savedProposal = await Proposal.create({
        userId: job.userId || undefined,
        jobTitle: job.title,
        jobDescription: job.description,
        clientName: job.clientName,
        budget: job.budget,
        skills: job.skills || [],
        generatedProposal: cleanedProposal,
        proposalLength,
        modelUsed: result.modelUsed,
        tokensUsed: result.totalTokens,
        generationTime: result.duration,
      });
      savedProposalId = savedProposal._id.toString();
    } catch (error) {
      console.error('Failed to save proposal:', error);
    }

    return {
      success: true,
      proposal: cleanedProposal,
      proposalLength,
      modelUsed: result.modelUsed,
      tokensUsed: result.totalTokens,
      generationTime: result.duration,
      savedProposalId,
    };
  }

  /**
   * Build the user prompt from job details
   */
  private buildUserPrompt(job: JobDetails): string {
    let prompt = `Write a winning Upwork proposal for the following job:\n\n`;
    
    prompt += `**Job Title:** ${job.title}\n\n`;
    prompt += `**Job Description:**\n${job.description}\n\n`;
    
    if (job.clientName) {
      prompt += `**Client Name:** ${job.clientName}\n`;
    }
    
    if (job.budget) {
      prompt += `**Budget:** ${job.budget}\n`;
    }
    
    if (job.skills && job.skills.length > 0) {
      prompt += `**Required Skills:** ${job.skills.join(', ')}\n`;
    }
    
    if (job.additionalContext) {
      prompt += `\n**Additional Context:**\n${job.additionalContext}\n`;
    }

    // Add user profile information if available
    if (job.userProfile) {
      const profile = job.userProfile;
      prompt += `\n---\n**FREELANCER PROFILE (Use this to personalize the proposal):**\n`;
      
      if (profile.title) {
        prompt += `- **Professional Title:** ${profile.title}\n`;
      }
      
      if (profile.summary) {
        prompt += `- **Summary:** ${profile.summary}\n`;
      }
      
      if (profile.yearsExperience) {
        prompt += `- **Years of Experience:** ${profile.yearsExperience}\n`;
      }
      
      if (profile.hourlyRate) {
        prompt += `- **Hourly Rate:** ${profile.hourlyRate}\n`;
      }
      
      if (profile.skills && profile.skills.length > 0) {
        prompt += `- **Technical Skills:** ${profile.skills.join(', ')}\n`;
      }
      
      if (profile.specializations && profile.specializations.length > 0) {
        prompt += `- **Specializations:** ${profile.specializations.join(', ')}\n`;
      }
      
      if (profile.certifications && profile.certifications.length > 0) {
        prompt += `- **Certifications:** ${profile.certifications.join(', ')}\n`;
      }
      
      if (profile.pastClients && profile.pastClients.length > 0) {
        prompt += `- **Notable Clients:** ${profile.pastClients.join(', ')}\n`;
      }
      
      if (profile.achievements && profile.achievements.length > 0) {
        prompt += `- **Key Achievements:**\n`;
        profile.achievements.forEach(a => {
          prompt += `  • ${a}\n`;
        });
      }
      
      if (profile.availability) {
        prompt += `- **Availability:** ${profile.availability}\n`;
      }
      
      if (profile.timezone) {
        prompt += `- **Timezone:** ${profile.timezone}\n`;
      }
      
      if (profile.preferredTone) {
        prompt += `\n**TONE PREFERENCE:** Write in a ${profile.preferredTone} tone.\n`;
      }
      
      if (profile.customSignature) {
        prompt += `\n**SIGNATURE:** End the proposal with: "${profile.customSignature}"\n`;
      }
      
      // Add resume content if available
      if (profile.resumeText && profile.resumeText.length > 100) {
        prompt += `\n---\n**RESUME/CV CONTENT (Extract relevant experience and achievements):**\n`;
        // Truncate if too long (keep most relevant parts)
        const resumeContent = profile.resumeText.length > 3000 
          ? profile.resumeText.substring(0, 3000) + '...[truncated]'
          : profile.resumeText;
        prompt += resumeContent + '\n';
      }
      
      // Add additional details if provided
      if (profile.additionalDetails && profile.additionalDetails.trim()) {
        prompt += `\n---\n**ADDITIONAL CONTEXT FROM FREELANCER:**\n`;
        prompt += profile.additionalDetails + '\n';
      }
    }

    prompt += `\nWrite a compelling proposal following the structure and principles outlined. Make it personal, specific, and action-oriented.`;

    return prompt;
  }

  /**
   * Clean up the generated proposal
   */
  private cleanProposal(raw: string): string {
    let cleaned = raw.trim();
    
    // Remove <think> blocks (from DeepSeek and other reasoning models)
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    
    // Remove any markdown code blocks if present
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    
    // Remove excessive newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    // Trim again
    cleaned = cleaned.trim();
    
    return cleaned;
  }

  /**
   * Get recent proposals
   */
  async getRecentProposals(limit: number = 10): Promise<IProposal[]> {
    await connectToDatabase();
    return Proposal.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Rate a proposal
   */
  async rateProposal(proposalId: string, rating: number, notes?: string): Promise<IProposal | null> {
    await connectToDatabase();
    return Proposal.findByIdAndUpdate(
      proposalId,
      { rating, notes },
      { new: true }
    );
  }

  /**
   * Get proposal by ID
   */
  async getProposal(proposalId: string): Promise<IProposal | null> {
    await connectToDatabase();
    return Proposal.findById(proposalId);
  }

  /**
   * Delete a proposal
   */
  async deleteProposal(proposalId: string): Promise<boolean> {
    await connectToDatabase();
    const result = await Proposal.findByIdAndDelete(proposalId);
    return !!result;
  }
}

// Singleton instance
let generatorInstance: ProposalGenerator | null = null;

export function getProposalGenerator(): ProposalGenerator {
  if (!generatorInstance) {
    generatorInstance = new ProposalGenerator();
  }
  return generatorInstance;
}

export default ProposalGenerator;
