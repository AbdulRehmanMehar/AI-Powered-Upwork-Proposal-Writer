import { getLoadBalancer, LoadBalancerResult } from './ollama-client';
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
const SYSTEM_PROMPT = `You write Upwork proposals that win jobs. You follow an evidence-based formula backed by Upwork's own official guidance and proven patterns from high-earning freelancers.

## HOW CLIENTS ACTUALLY READ PROPOSALS:
- They receive 20-50+ proposals per job
- They spend 5-10 seconds scanning each one
- They only read the first 2-3 lines initially
- Long proposals get skipped. Short, relevant proposals win.

## THE WINNING FORMULA:

Line 1: Restate their CORE PAIN POINT — NOT the job title. What's hard about this project? (e.g., "Getting Casbin and Clerk to work across tenant boundaries is the hard part" NOT "You need a full-stack engineer")
Line 2: One relevant proof or result with a number
Line 3: One smart question that shows deep understanding of the domain
Line 4: A concrete next step or offer (e.g., "Happy to sketch the architecture" or "I can outline the approach this week")

That's it. 4-6 lines. No more.

## PROPOSAL FORMAT:

Hi [Name],

[Restate their problem in your words.]
[One proof point with a result, e.g. "reduced failed payments by 25%."]
[One smart question about their project.]
[Brief next step.]

— [YourName]

## WINNING EXAMPLES:

"Hi Sarah, I saw you're looking to integrate Stripe into your SaaS. I recently built a similar billing system for a subscription platform that reduced failed payments by 25%. Would you like me to outline the approach?"

"Hello John, I noticed your React app needs performance optimization. I've improved load time by 40% for similar apps. Could you share your current Lighthouse scores?"

"Hi Mike, it looks like you need a dashboard built with real-time updates. I've built admin tools like this using React + Node. Do you already have an API in place?"

Notice: All under 5-6 lines. No resume talk. No long paragraphs. Question included.

## RULES:
1. 6-8 lines MAXIMUM. No exceptions.
2. First line MUST identify their CORE PAIN POINT. Do NOT just restate the job title.
3. NEVER start with "I have X years experience" or "I am a senior developer."
4. Include exactly 1 smart question that builds trust.
5. Sound like a human writing a quick, confident message to a colleague.
6. Use "I" and "my" only. Never "we", "our", or "our team."
7. No bullet points in the proposal body.
8. No P.S. sections. No fluff. No padding.
9. One proof point only. Pick the most relevant one.
10. Greeting: "Hi [Name]," with the ACTUAL client name — never leave "[Name]" as literal text.
11. Signature: "— [Name]" on its own line. Never "Best," / "Cheers," / "Regards," / "Thanks,".
12. MUST include a concrete next step or offer after the question.

## TONE:
- Professional but personable
- Confident, not arrogant
- Helpful, not salesy
- Concise, not verbose

## NEVER DO:
- Wall of text or long paragraphs
- Generic openings ("I am a professional developer...")
- Begging ("Please give me a chance...")
- Focusing on yourself instead of the client
- Copy-paste templates that don't reference the job
- Listing multiple projects (pick ONE proof point)
- AI buzzwords: "excited", "passionate", "leverage", "robust", "seamless"

## OUTPUT:
Just the proposal text. Nothing else.`;

const SHORT_PROPOSAL_ADDENDUM = `

## LENGTH: SHORT (3-4 lines, 40-60 words)
Write the tightest version of the formula:
1. Restate their problem (1 line)
2. One proof point (1 line)
3. One question or next step (1 line)
Every word must earn its place. This is a quick, confident message — not an essay.`;

const FULL_PROPOSAL_ADDENDUM = `

## LENGTH: FULL (6-8 lines, 60-100 words)
Write the complete version of the formula with slightly more context:
1. Restate their problem (1-2 lines)
2. One proof point with a specific result (1-2 lines)
3. One smart question showing project understanding (1 line)
4. Brief next step (1 line)
Still concise. No padding. No bullet points. No P.S. section.`;

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
        maxTokens: proposalLength === 'short' ? 300 : 500,
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

    prompt += `\nWrite the proposal using the 4-line formula: restate their problem, one proof point, one smart question, next step. Keep it under 8 lines total. Be specific to THIS job.`;

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
