import { getLoadBalancer, LoadBalancerResult } from './ollama-client';
import { retrieveProfileForProposal, getUserProfileStats, RetrievedProfileChunk } from './profile-embeddings';
import { buildLearnedWarningsPrompt, getLearningStats, buildUserFeedbackPrompt } from './learning-system';
import { generateEmbedding } from './gemini-embeddings';

// ============================================
// Types
// ============================================
export interface GitHubProject {
  name: string;
  description: string;
  url: string;
  language: string;
  stars: number;
  topics: string[];
  readme?: string; // First 500 chars of README
  lastUpdated: string;
}

export interface UserProfile {
  name?: string; // The freelancer's name (for signing proposals)
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
  additionalDetails?: string;
  resumeText?: string;
  // GitHub integration for real project examples
  githubUsername?: string;
  githubPat?: string; // Personal Access Token (encrypted in DB)
  githubProjects?: GitHubProject[]; // Cached projects from GitHub
}

export type ProposalLength = 'short' | 'full';
export type ProposalIntensity = 'ultra-short' | 'full'; // 40-60 words vs 60-100 words

export interface JobDetails {
  title: string;
  description: string;
  clientName?: string;
  budget?: string;
  skills?: string[];
  additionalContext?: string;
  userProfile?: UserProfile;
  proposalLength?: ProposalLength;
  intensity?: ProposalIntensity; // New: replaces dual-mode approach
  userId?: string;
  screeningQuestions?: string[];
}

export interface ScreeningAnswer {
  question: string;
  answer: string;
}

export interface QualityMetrics {
  soundsHuman: number; // 0-100: Does it sound like a real person typed it?
  personalizationScore: number; // 0-100: Did we use client name, reference job specifics?
  proofQuality: number; // 0-100: One project, specific, with link?
  ctaClarity: number; // 0-100: Clear next step with specific time?
  lengthAppropriate: boolean; // Under 200 words ideal
  // Legacy fields for backward compatibility
  speedOptimized?: boolean;
  hookStrength?: number;
  clientFocusRatio?: number;
  portfolioRelevance?: number;
  conciseness?: number;
  socialProof?: boolean;
  jobUnderstanding?: number;
  errorFree?: boolean;
}

export interface ProposalAnalysis {
  overallScore: number; // 0-100
  passesStandards: boolean; // Meets quality standards
  qualityMetrics: QualityMetrics;
  strengths: string[];
  improvements: string[];
  humanVoiceIssues?: string[]; // Specific issues with human voice
  reasoning: string;
  wouldYouSayThisOutLoud?: boolean; // The ultimate human test
  instantFailReasons?: string[]; // From AI reviewer
  hallucinationDetected?: boolean;
  hallucinationDetails?: string[];
  bannedPhrasesFound?: string[];
  typos?: string[];
  upworkGuideAlignment?: string; // Legacy field
}

export interface MultiAgentResult {
  success: boolean;
  proposal: string; // Final recommended proposal
  intensity: ProposalIntensity; // 'ultra-short' or 'full'
  analysis: ProposalAnalysis; // Quality evaluation
  proposalLength: ProposalLength;
  screeningAnswers: ScreeningAnswer[];
  reviewFeedback?: string;
  modelUsed: string;
  tokensUsed: number;
  generationTime: number;
  agentIterations: number;
  error?: string;
}

// ============================================
// Agent Prompts
// ============================================

// Writer system prompt — pure format enforcer.
// Content decisions (what pain point, what proof, what question) are made in the user prompt.
// Format aligned with evidence-based playbook: each ingredient on its own line, proper spacing.
const WRITER_SYSTEM_PROMPT = `You turn pre-assembled ingredients into an Upwork proposal. Each ingredient becomes its own short line (1-2 sentences max). Separate sections with line breaks.

EXAMPLE INPUT:
GREETING: Hi Sarah,
PAIN POINT: migrating a legacy Rails monolith to microservices
PROOF: I split a 200K-line Rails app into 12 services at Finco — cut deploy time from 45 min to 4 min
QUESTION: Are you planning to start with the auth service first, or decompose the data layer and API gateway in parallel?
NEXT STEP: I have a few ideas on the migration sequence — when would be a good time to connect this week?
SIGNATURE: — Mike

EXAMPLE OUTPUT:
Hi Sarah,

Migrating a legacy Rails monolith to microservices is tricky to get right.
I split a 200K-line Rails app into 12 services at Finco — cut deploy time from 45 min to 4 min.
Are you planning to start with the auth service first, or decompose the data layer and API gateway in parallel?

I have a few ideas on the migration sequence — when would be a good time to connect this week?

— Mike

RULES:
1. Output ONLY the proposal — no explanations, no markdown, no extra text.
2. FORMAT: Greeting on line 1, then blank line, then body lines (each ingredient = its own line), then blank line, then CTA line, then blank line, then signature. NEVER lump everything into one wall of text.
3. Keep each line to 1-2 sentences MAX. Short lines that are easy to scan.
4. The signature is EXACTLY the SIGNATURE ingredient. Do NOT add "Best", "Regards", "Cheers", "Thanks", or ANY other word before or after.
5. Copy each ingredient almost word-for-word. Only smooth grammar — never swap in synonyms, drop metrics, or generalize.
6. NEVER invent claims, metrics, project names, or skills not in the ingredients.
7. Use "I"/"my". Never "we"/"our". Say "you"/"your" when talking about the client's problem.
8. Contractions (I've, I'd, can't). Sound like a real person texting a colleague.
9. BANNED WORDS: "seamless", "leverage", "robust", "comprehensive", "streamline", "passionate", "cutting-edge", "I'm excited", "I'd love to", "built something similar", "I am a", "I have X years".`;

const QUESTION_ANSWERER_PROMPT = `Answer Upwork screening questions. 2-4 sentences. Be specific to the job. Include a concrete example or number. Sound confident. Output just the answer.`;

// ============================================
// JOB PARSER AGENT - Extracts structured data from raw job posts
// ============================================
const JOB_PARSER_PROMPT = `You are an expert at analyzing Upwork job postings. Extract structured information that will help write a winning proposal.

## YOUR TASK:
Parse the job posting and extract ALL of the following:

### 1. CLIENT NAME (CRITICAL - READ CAREFULLY!)
- Look ONLY in the "Client's recent history" or reviews section
- Freelancers say things like "It was great working with [NAME]" or "Thanks [NAME]" or "Great client [NAME]"
- Return the FIRST NAME only (e.g., "Matt", "Sarah", "John")

⚠️ DO NOT EXTRACT THESE AS NAMES:
- Numbers like "33 minutes ago", "5 reviews", "4 hours ago" → NOT names!
- Time references like "33", "2 weeks" → NOT names!
- Company names → NOT client first names!
- "client" or "Client" → NOT a name!
- Any number by itself → NEVER a valid name!
- Job metadata (proposal count, hours, applicants) → NOT names!

⚠️ VALIDATION — before returning a name, verify ALL of these:
- It is a real human first name (at least 2 alphabetic characters)
- It is NOT a number or timestamp
- It is NOT a company or brand name
- It appeared in a review or feedback context, NOT in the job description itself
- If ANY doubt, return null — it's better to use "Hi there," than the wrong name

✅ VALID NAME EXAMPLES:
- "It was great working with Matt" → "Matt"
- "Thanks Sarah!" → "Sarah"  
- "Working with John was excellent" → "John"
- "Malcolm is very responsive" → "Malcolm"
- Client's name mentioned in review text → extract it

❌ INVALID (return null instead):
- "33 minutes ago" → NOT a name, return null
- "Rating is 5.0" → NOT a name, return null
- No review mentions a name → return null

SEARCH ORDER (check ALL of these):
1. Review text: "working with [NAME]", "Thanks [NAME]", "[NAME] is great", "[NAME] was very"
2. Review signatures that mention the client
3. Any first name that appears in the reviews/feedback section

If you cannot find a clear human first name in the reviews, return null.

### 2. UNIQUE HOOK LINE
- Find the ONE sentence that shows what the client REALLY cares about
- Often in "Why This Project Is Different" or similar sections
- Look for emotional language, values, or differentiators
- This is what makes THEIR project special to THEM

### 3. KEY PAIN POINTS (PRIORITIZE TECHNICAL REQUIREMENTS!)
- **FIRST**: Look at the must-have skills and technical requirements - what's TECHNICALLY challenging?
- What specific technical problems are they trying to solve?
- What's frustrating them about current solutions?
- What are they worried about?

⚠️ CRITICAL PRIORITY ORDER:
1. **TECHNICAL CHALLENGES** mentioned in requirements (e.g., "multi-tenant permissions", "RBAC/ABAC integration")
2. **MUST-HAVE SKILLS** that indicate the core problem (e.g., "Casbin", "Clerk", "row-level security")
3. Industry/domain context (music, healthcare, etc.) - ONLY if no technical pain point is clear

**EXAMPLES:**
Job: "Full stack engineer for music SaaS. Must have: Casbin, CASL, multi-tenant RBAC experience"
❌ BAD: "music publishing royalties" (industry keyword, NOT the technical requirement)
✅ GOOD: "Multi-tenant permission systems with RBAC/ABAC" (actual technical requirement)

Job: "React developer. Must have: performance optimization, bundle size reduction"
❌ BAD: "building dashboards" (generic)
✅ GOOD: "React performance optimization and bundle size management" (specific technical challenge)

### 4. MUST-HAVE REQUIREMENTS (HIGHEST PRIORITY - EXTRACT CAREFULLY!)
- Technical skills explicitly marked as "required", "must have", "must-have"
- Specific tools/technologies mentioned multiple times
- Experience levels mentioned as mandatory
- **These are MORE IMPORTANT than industry keywords** - a "music SaaS" job that requires "Casbin + Clerk" is really about permissions, not music!

### 5. NICE-TO-HAVE REQUIREMENTS  
- Skills marked as "preferred" or "bonus"
- Industry experience they'd like

### 6. BUDGET INFO
- Stated budget amount
- Fixed-price or hourly
- Any budget flexibility hints ("willing to pay higher rates")

### 7. TIMELINE
- Project duration
- Any deadlines mentioned
- Urgency indicators

### 8. SCREENING QUESTIONS
- Questions they'll ask when submitting proposal
- Usually in "You will be asked to answer the following questions"
- Also look for "Please include in your proposal"

### 9. RED FLAGS / WARNINGS
- Anything tricky about this job
- Unrealistic expectations
- Budget vs scope mismatch

### 10. CLIENT QUALITY SIGNALS
- Payment verified?
- Hire rate?
- Previous reviews quality?
- Total spent?

## OUTPUT FORMAT (JSON):
\`\`\`json
{
  "clientName": "Matt" or null,
  "uniqueHookLine": "The exact sentence that shows what they care about",
  "painPoints": ["pain point 1", "pain point 2"],
  "mustHaveSkills": ["React", "Node.js", "PostgreSQL"],
  "niceToHaveSkills": ["Healthcare experience", "PDF generation"],
  "budget": {
    "amount": "$10,000",
    "type": "fixed" or "hourly",
    "flexibility": "willing to pay more for experience"
  },
  "timeline": "12-16 weeks" or null,
  "screeningQuestions": [
    "do you understand the ndis?",
    "why would you make a good long term partner?"
  ],
  "redFlags": ["Budget may be low for scope"],
  "clientQuality": {
    "rating": "excellent" | "good" | "average" | "poor" | "unknown",
    "positives": ["5-star reviews", "quick responses"],
    "negatives": ["low hire rate"],
    "paymentVerified": true,
    "totalSpent": "$13K"
  }
}
\`\`\`

IMPORTANT: Output ONLY valid JSON. No explanations before or after.`;

// ============================================
// Types for matched profile data
// ============================================
export interface MatchedProfileData {
  bestMatchingProject: {
    description: string;
    relevance: string;
    metrics: string | null;
  } | null;
  relevantSkills: string[];
  strongestAchievement: string | null;
  relevantCertifications: string[];
  socialProof: {
    notableClients: string[];
    yearsInDomain: number | null;
  } | null;
  uniqueValueProposition: string | null;
  suggestedProofStatement: string | null;
}

// RAG-retrieved profile data from vector search
export interface RAGProfileData {
  bestProject: RetrievedProfileChunk | null;
  achievements: RetrievedProfileChunk[];
  skills: RetrievedProfileChunk | null;
  testimonials: RetrievedProfileChunk[];
  summary: RetrievedProfileChunk | null;
  source: 'vector_search' | 'llm_fallback';
}

// ============================================
// Types for parsed job data
// ============================================
export interface ParsedJobData {
  clientName: string | null;
  uniqueHookLine: string | null;
  painPoints: string[];
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  budget: {
    amount: string | null;
    type: 'fixed' | 'hourly' | null;
    flexibility: string | null;
  } | null;
  timeline: string | null;
  screeningQuestions: string[];
  redFlags: string[];
  clientQuality: {
    rating: 'excellent' | 'good' | 'average' | 'poor' | 'unknown';
    positives: string[];
    negatives: string[];
    paymentVerified: boolean;
    totalSpent: string | null;
  } | null;
}

// ============================================
// Multi-Agent Proposal Generator
// ============================================
export class MultiAgentProposalGenerator {
  private loadBalancer = getLoadBalancer();

  /**
   * Main generation function — simplified pipeline:
   *   Phase 1: Parse job (1 LLM call) + embed + fetch profile/github (vector search, no LLM)
   *   Phase 2: Write proposal (1 LLM call) with focused prompt
   *   Phase 3: Answer screening questions (1 LLM call each)
   *
   * Total: 2 LLM calls for the proposal + N for screening questions.
   * Old pipeline used 7-11 calls with reviewer/refiner that degraded quality.
   */
  async generate(job: JobDetails): Promise<MultiAgentResult> {
    const startTime = Date.now();
    const proposalLength = job.proposalLength || 'full';
    let totalTokens = 0;
    let modelUsed = '';
    let agentIterations = 0;

    try {
      const intensity = this.determineIntensity(job);
      
      // ═══════════════════════════════════════════════════════════
      // PHASE 1: Parse job + fetch context (parallel)
      // One LLM call (parser) + vector searches + DB queries
      // ═══════════════════════════════════════════════════════════
      console.log('Phase 1: Parse job + fetch context (parallel)...');
      
      const [jobEmbedding, parsedJob, learnedWarningsPrompt, userFeedbackPrompt] = await Promise.all([
        generateEmbedding(job.description),
        this.parseJobWithAI(job.description),
        buildLearnedWarningsPrompt(intensity),
        job.userId ? buildUserFeedbackPrompt(job.userId) : Promise.resolve(''),
      ]);

      agentIterations++;
      if (parsedJob.tokensUsed) totalTokens += parsedJob.tokensUsed;
      
      console.log('Parsed job data:', JSON.stringify(parsedJob.data, null, 2));
      if (learnedWarningsPrompt) console.log('📚 Loaded learned warnings');
      if (userFeedbackPrompt) console.log('📝 Loaded user feedback rules');

      // Build enhanced job with parsed data
      const enhancedJob: JobDetails = {
        ...job,
        clientName: job.clientName || parsedJob.data?.clientName || undefined,
        budget: job.budget || parsedJob.data?.budget?.amount || undefined,
      };

      // Collect screening questions
      const allQuestions = [
        ...(job.screeningQuestions || []),
        ...(parsedJob.data?.screeningQuestions || []),
      ].filter((q, i, arr) => arr.findIndex(x => x.toLowerCase() === q.toLowerCase()) === i);

      // ═══════════════════════════════════════════════════════════
      // PHASE 1b: Profile vector search (no LLM)
      // ═══════════════════════════════════════════════════════════
      let matchedProfile: MatchedProfileData | null = null;
      
      if (job.userId) {
        console.log('Fetching profile (vector search)...');
        try {
          const profileStats = await getUserProfileStats(job.userId);
          if (profileStats.totalChunks > 0) {
            const retrievedProfile = await retrieveProfileForProposal(job.userId, job.description, jobEmbedding);
            console.log(`Retrieved profile: ${retrievedProfile.bestProject ? '1 project' : '0 projects'}, ${retrievedProfile.achievements.length} achievements`);
            const ragProfileData: RAGProfileData = { ...retrievedProfile, source: 'vector_search' as const };
            if (ragProfileData.bestProject || ragProfileData.achievements.length > 0) {
              matchedProfile = this.convertRAGToMatchedProfile(ragProfileData, job.userProfile);
            }
          }
        } catch (err) {
          console.error('Profile vector search failed:', err);
        }
      }

      console.log(`Using intensity level: ${intensity} (proposalLength: ${proposalLength})`);

      // ═══════════════════════════════════════════════════════════
      // PHASE 2: Write proposal (1 LLM call)
      // Short focused system prompt + all job data in user prompt
      // ═══════════════════════════════════════════════════════════
      console.log('Phase 2: Writing proposal...');
      const combinedLearnings = (learnedWarningsPrompt || '') + (userFeedbackPrompt || '');
      const writerPrompt = parsedJob.data 
        ? this.buildWriterPromptWithParsedData(enhancedJob, parsedJob.data, proposalLength, matchedProfile, intensity)
        : this.buildWriterPrompt(enhancedJob, proposalLength, intensity);
      
      console.log('=== WRITER PROMPT INGREDIENTS ===');
      console.log(writerPrompt);
      console.log('=== END INGREDIENTS ===');
      const writerResult = await this.callAgent(WRITER_SYSTEM_PROMPT, writerPrompt);
      
      if (!writerResult.success) {
        return this.errorResult(writerResult.error || 'Writer agent failed', proposalLength, startTime);
      }
      
      totalTokens += writerResult.totalTokens;
      modelUsed = writerResult.modelUsed;
      agentIterations++;

      const cleanedProposal = this.cleanProposal(writerResult.content);
      
      // Enforce greeting + signature in code (LLM can't be trusted)
      const expectedGreeting = parsedJob.data 
        ? (() => {
            const cn = parsedJob.data.clientName || enhancedJob.clientName;
            return cn && cn.toLowerCase() !== 'unknown' && cn.length > 1 && !/^\d+$/.test(cn) ? cn : 'there';
          })()
        : (enhancedJob.clientName && enhancedJob.clientName.toLowerCase() !== 'unknown' ? enhancedJob.clientName : 'there');
      const expectedSignature = this.extractCleanName(enhancedJob.userProfile);
      const currentProposal = this.enforceTemplate(cleanedProposal, expectedGreeting, expectedSignature);

      // ═══════════════════════════════════════════════════════════
      // PHASE 3: Answer screening questions
      // ═══════════════════════════════════════════════════════════
      const screeningAnswers: ScreeningAnswer[] = [];
      for (const question of allQuestions) {
        const answer = await this.answerQuestion(question, enhancedJob, currentProposal);
        if (answer.success) {
          screeningAnswers.push({ question, answer: answer.content });
          totalTokens += answer.totalTokens;
          agentIterations++;
        }
      }

      // Build simple analysis (no reviewer needed)
      const finalAnalysis = this.buildSimpleAnalysis(currentProposal, enhancedJob);

      return {
        success: true,
        proposal: currentProposal,
        intensity,
        analysis: finalAnalysis,
        proposalLength,
        screeningAnswers,
        reviewFeedback: '',
        modelUsed,
        tokensUsed: totalTokens,
        generationTime: Date.now() - startTime,
        agentIterations,
      };

    } catch (error) {
      console.error('Proposal generation error:', error);
      return this.errorResult(
        error instanceof Error ? error.message : 'Unknown error',
        proposalLength,
        startTime
      );
    }
  }

  /**
   * Determine intensity level for proposal
   * Priority: explicit intensity > proposalLength mapping > default 'full'
   */
  private determineIntensity(job: JobDetails): ProposalIntensity {
    // If explicitly set, use it
    if (job.intensity) {
      return job.intensity;
    }
    
    // Map from legacy proposalLength
    if (job.proposalLength === 'short') {
      return 'ultra-short'; // 3-5 sentences
    }
    
    // Default to full
    return 'full'; // 60-100 words
  }

  /**
   * Build simple analysis based on basic checks (no LLM call needed)
   */
  private buildSimpleAnalysis(proposal: string, job: JobDetails): ProposalAnalysis {
    const words = proposal.split(/\s+/).length;
    const hasGreeting = /^Hi\s+\w+/i.test(proposal.trim());
    const hasSignature = /—\s*\w+/.test(proposal);
    const hasQuestion = /\?/.test(proposal);
    const clientName = job.clientName;
    const hasClientName = clientName ? proposal.includes(clientName) : false;
    const hasWe = /\b(we|our|us)\b/i.test(proposal);
    const hasMetric = /\d+[%kKmM]|\d{2,}/.test(proposal);

    const score = [
      hasGreeting ? 15 : 0,
      hasSignature ? 10 : 0,
      hasQuestion ? 15 : 0,
      hasClientName ? 15 : 0,
      !hasWe ? 10 : 0,
      hasMetric ? 15 : 0,
      words >= 40 && words <= 120 ? 20 : (words < 40 ? 10 : 5),
    ].reduce((a, b) => a + b, 0);

    return {
      overallScore: score,
      passesStandards: score >= 70,
      qualityMetrics: {
        soundsHuman: hasWe ? 40 : 70,
        personalizationScore: hasClientName ? 80 : 40,
        proofQuality: hasMetric ? 70 : 30,
        ctaClarity: hasQuestion ? 70 : 30,
        lengthAppropriate: words >= 40 && words <= 120,
      },
      strengths: [
        hasGreeting ? 'Has greeting' : '',
        hasSignature ? 'Has signature' : '',
        hasClientName ? 'Uses client name' : '',
        hasMetric ? 'Includes metric' : '',
        hasQuestion ? 'Asks a question' : '',
      ].filter(Boolean),
      improvements: [
        !hasGreeting ? 'Missing greeting' : '',
        !hasSignature ? 'Missing signature' : '',
        !hasClientName ? 'Missing client name' : '',
        !hasMetric ? 'No metric/proof' : '',
        !hasQuestion ? 'No question asked' : '',
        hasWe ? 'Uses "we/our" instead of "I/my"' : '',
      ].filter(Boolean),
      reasoning: `Word count: ${words}. Basic checks score: ${score}/100.`,
      wouldYouSayThisOutLoud: !hasWe && hasQuestion,
    };
  }

  /**
   * Parse job posting with AI to extract structured data
   */
  private async parseJobWithAI(description: string): Promise<{ data: ParsedJobData | null; tokensUsed: number }> {
    try {
      const result = await this.callAgent(
        JOB_PARSER_PROMPT,
        `Parse this Upwork job posting:\n\n${description}`,
        { responseFormat: 'json' }
      );
      
      if (!result.success) {
        console.error('Job parser failed:', result.error);
        return { data: null, tokensUsed: 0 };
      }
      
      // Parse JSON response
      const cleaned = result.content.trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as ParsedJobData;
          return { data: parsed, tokensUsed: result.totalTokens };
        } catch (parseError) {
          console.error('Failed to parse job data JSON:', parseError);
          return { data: null, tokensUsed: result.totalTokens };
        }
      }
      return { data: null, tokensUsed: result.totalTokens };
    } catch (error) {
      console.error('Job parsing failed:', error);
      return { data: null, tokensUsed: 0 };
    }
  }

  /**
   * Call an agent (LLM)
   */
  private async callAgent(
    systemPrompt: string,
    userPrompt: string,
    options?: { responseFormat?: 'json' | 'text'; temperature?: number; maxTokens?: number; jsonSchema?: Record<string, unknown> }
  ): Promise<LoadBalancerResult> {
    return this.loadBalancer.chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens ?? 2000,
        responseFormat: options?.responseFormat,
        jsonSchema: options?.jsonSchema,
      }
    );
  }

  /**
   * Convert RAG profile data to MatchedProfileData format
   * This bridges the vector search results with the existing prompt builder
   */
  /**
   * Check if a chunk of text is usable as proof (not JSON, not metadata, not a keyword list)
   */
  private isValidProof(text: string): boolean {
    if (!text || text.length < 20) return false;
    // Reject raw JSON
    if (/^\s*[{\[]/.test(text)) return false;
    if (/"\w+"\s*:/.test(text)) return false;
    // Reject keyword lists (comma-separated titles/roles)
    const commaCount = (text.match(/,/g) || []).length;
    if (commaCount > 3 && text.length < 300) return false;
    // Reject SEO keyword blocks
    if (/seo_focus_keywords|focus_keywords|meta_description/i.test(text)) return false;
    // Reject lines that are just skill lists
    if (/^(Senior |Junior |Lead )?[\w.]+\s+developer/i.test(text.trim()) && commaCount > 2) return false;
    return true;
  }

  private convertRAGToMatchedProfile(
    ragProfile: RAGProfileData,
    userProfile?: UserProfile
  ): MatchedProfileData {
    const result: MatchedProfileData = {
      bestMatchingProject: null,
      relevantSkills: [],
      strongestAchievement: null,
      relevantCertifications: [],
      socialProof: null,
      uniqueValueProposition: null,
      suggestedProofStatement: null,
    };

    // Best matching project from vector search — validate it's real content, not metadata
    if (ragProfile.bestProject) {
      const chunk = ragProfile.bestProject.chunk;
      if (this.isValidProof(chunk.text)) {
        result.bestMatchingProject = {
          description: chunk.text,
          relevance: `Semantic similarity: ${(ragProfile.bestProject.score * 100).toFixed(1)}%`,
          metrics: chunk.metadata?.metrics?.join(', ') || null,
        };
        result.suggestedProofStatement = chunk.text;
      } else {
        console.warn('⚠️ Best project chunk rejected (looks like metadata/JSON):', chunk.text.substring(0, 100));
      }
    }

    // Achievements (take the best valid one)
    if (ragProfile.achievements.length > 0) {
      for (const a of ragProfile.achievements) {
        const valid = this.isValidProof(a.chunk.text);
        if (!valid) {
          console.warn(`⚠️ Achievement chunk rejected: "${a.chunk.text.substring(0, 100)}..."`);
        }
      }
      const validAchievement = ragProfile.achievements.find(a => this.isValidProof(a.chunk.text));
      result.strongestAchievement = validAchievement?.chunk.text || null;
      if (!result.strongestAchievement) {
        console.warn('⚠️ All achievement chunks rejected — no valid proof from vector search');
      }
    }

    // Extract skills from the skills chunk
    if (ragProfile.skills) {
      const skillsText = ragProfile.skills.chunk.text;
      // Parse skills from text like "Skills: React, Node.js, PostgreSQL..."
      const skillsMatch = skillsText.match(/Skills?:\s*([^.]+)/i);
      if (skillsMatch) {
        result.relevantSkills = skillsMatch[1].split(',').map(s => s.trim());
      } else if (ragProfile.skills.chunk.metadata?.technologies) {
        result.relevantSkills = ragProfile.skills.chunk.metadata.technologies;
      }
    }

    // Testimonials as social proof
    if (ragProfile.testimonials.length > 0) {
      const testimonialText = ragProfile.testimonials.map(t => t.chunk.text).join(' | ');
      result.uniqueValueProposition = testimonialText;
    }

    // Add static profile data
    if (userProfile) {
      if (userProfile.pastClients?.length) {
        result.socialProof = {
          notableClients: userProfile.pastClients,
          yearsInDomain: userProfile.yearsExperience || null,
        };
      }
      if (userProfile.certifications?.length) {
        result.relevantCertifications = userProfile.certifications;
      }
    }

    return result;
  }

  /**
   * Answer a single screening question
   */
  private async answerQuestion(
    question: string, 
    job: JobDetails, 
    proposal: string
  ): Promise<LoadBalancerResult> {
    const prompt = this.buildQuestionPrompt(question, job, proposal);
    return this.callAgent(QUESTION_ANSWERER_PROMPT, prompt);
  }

  /**
   * Build writer prompt — pre-assembles all 4 ingredients so the LLM just composes them.
   */
  private buildWriterPromptWithParsedData(
    job: JobDetails, 
    parsedData: ParsedJobData, 
    length: ProposalLength,
    matchedProfile?: MatchedProfileData | null,
    intensity?: ProposalIntensity,
  ): string {
    const actualIntensity = intensity || (length === 'short' ? 'ultra-short' : 'full');
    
    // ── Pre-assemble the 4 ingredients ──
    const clientName = parsedData.clientName || job.clientName;
    const greeting = clientName && clientName.toLowerCase() !== 'unknown' && clientName.length > 1 && !/^\d+$/.test(clientName)
      ? clientName : 'there';
    const freelancerName = this.extractCleanName(job.userProfile);

    // INGREDIENT 1: Pain point (from parsed job data)
    const painPoint = parsedData.painPoints?.[0] || `what ${job.title} requires`;
    
    // INGREDIENT 2: Proof (from profile/vector search, with fallback)
    // Each candidate is validated to reject JSON/metadata junk from vector search
    let proof = '';
    let proofSource = 'none';
    if (matchedProfile?.suggestedProofStatement && this.isValidProof(matchedProfile.suggestedProofStatement)) {
      proof = matchedProfile.suggestedProofStatement;
      proofSource = 'vector_proof_statement';
    } else if (matchedProfile?.bestMatchingProject && this.isValidProof(matchedProfile.bestMatchingProject.description)) {
      proof = matchedProfile.bestMatchingProject.description;
      if (matchedProfile.bestMatchingProject.metrics) {
        proof += ` (${matchedProfile.bestMatchingProject.metrics})`;
      }
      proofSource = 'vector_project';
    } else if (matchedProfile?.strongestAchievement && this.isValidProof(matchedProfile.strongestAchievement)) {
      proof = matchedProfile.strongestAchievement;
      proofSource = 'vector_achievement';
    } else if (job.userProfile?.achievements?.length) {
      // Static profile achievements — try each one
      const validAchievement = job.userProfile.achievements.find(a => this.isValidProof(a));
      if (validAchievement) {
        proof = validAchievement;
        proofSource = 'static_achievement';
      }
    }
    
    // If still no proof, build one from static profile title + relevant skills
    if (!proof && job.userProfile) {
      const title = this.cleanProfileTitle(job.userProfile.title);
      const skills = matchedProfile?.relevantSkills?.slice(0, 3) || job.userProfile.skills?.slice(0, 3);
      const yearsExp = job.userProfile.yearsExperience;
      if (title && yearsExp) {
        proof = `I've spent ${yearsExp}+ years building ${title.toLowerCase()} solutions`;
        if (skills?.length) proof += ` with ${skills.join(', ')}`;
        proofSource = 'static_profile';
      } else if (title) {
        proof = `I've built production ${title.toLowerCase()} systems with the stack your project needs`;
        if (skills?.length) proof += ` (${skills.join(', ')})`;
        proofSource = 'static_title';
      }
    }
    
    // Last resort generic fallback
    if (!proof) {
      proof = `I've built production systems with ${parsedData.mustHaveSkills?.slice(0, 3).join(', ') || 'the stack you described'}`;
      proofSource = 'generic_fallback';
    }
    
    console.log(`📋 Proof selected [${proofSource}]: ${proof.substring(0, 120)}...`);
    
    // INGREDIENT 3: Smart question (derived from job specifics)
    // Skip generic skills (React, Python, JS, etc.) and prefer domain-specific ones
    const GENERIC_SKILLS = new Set(['react', 'python', 'javascript', 'typescript', 'node', 'node.js', 'html', 'css', 'sql', 'postgresql', 'mongodb', 'api', 'git', 'docker', 'aws', 'next.js', 'vue', 'angular']);
    const specificSkills = (parsedData.mustHaveSkills || []).filter(s => !GENERIC_SKILLS.has(s.toLowerCase()));
    
    let question = '';
    if (specificSkills.length >= 2) {
      question = `Are you planning to start with ${specificSkills[0]} first, or build both ${specificSkills[0]} and ${specificSkills[1]} in parallel?`;
    } else if (parsedData.painPoints && parsedData.painPoints.length >= 2) {
      question = `Which is higher priority right now — ${parsedData.painPoints[0].toLowerCase()} or ${parsedData.painPoints[1].toLowerCase()}?`;
    } else if (specificSkills.length === 1) {
      question = `What's your current setup for ${specificSkills[0]} — starting fresh or migrating from something existing?`;
    } else {
      question = `What's your current progress on this — greenfield or do you have existing code?`;
    }
    
    // INGREDIENT 4: Next step — sell the CALL, not the service
    const timezone = job.userProfile?.timezone || '';
    const tzSuffix = timezone ? ` (I'm in ${timezone})` : '';
    const nextStep = `I have a couple of ideas on how to approach this${tzSuffix} — when would be a good time to connect this week?`;

    // ── Build the prompt ──
    let prompt = `Compose a proposal using these pre-assembled ingredients. Each ingredient becomes its own short line. Use line breaks between sections.\n\n`;
    prompt += `GREETING: Hi ${greeting},\n`;
    prompt += `PAIN POINT: ${painPoint}\n`;
    prompt += `PROOF: ${proof}\n`;
    prompt += `QUESTION: ${question}\n`;
    prompt += `NEXT STEP: ${nextStep}\n`;
    prompt += `SIGNATURE: — ${freelancerName}\n\n`;
    
    prompt += `Word limit: ${actualIntensity === 'ultra-short' ? '40-60' : '60-100'} words for the body (excluding greeting and signature).\n\n`;
    
    prompt += `FORMAT: Each ingredient on its own line. Blank line after greeting, blank line before CTA, blank line before signature. DO NOT lump into one paragraph.\n`;
    prompt += `Copy each ingredient nearly verbatim. Only smooth grammar. Keep ALL technical terms, metrics, and specifics exactly as written above. The signature is EXACTLY "— ${freelancerName}" — do NOT add Best/Regards/Cheers.\n`;

    return prompt;
  }

  /**
   * Legacy writer prompt builder (fallback if parsing fails)
   * Now simplified - AI will extract client name, unique lines, budget dynamically
   */
  private buildWriterPrompt(job: JobDetails, length: ProposalLength, intensity?: ProposalIntensity, learnedWarningsPrompt?: string): string {
    const actualIntensity = intensity || (length === 'short' ? 'ultra-short' : 'full');
    
    // Best-effort ingredient assembly without parsed data
    const greeting = job.clientName && job.clientName.toLowerCase() !== 'unknown' ? job.clientName : 'there';
    const freelancerName = this.extractCleanName(job.userProfile);
    const painPoint = job.title;
    const proof = job.userProfile?.achievements?.[0] || 'I have hands-on experience with the exact stack you described';
    const question = `What's your current progress on this — greenfield or do you have existing code?`;
    const timezone = job.userProfile?.timezone || '';
    const tzSuffix = timezone ? ` (I'm in ${timezone})` : '';
    const nextStep = `I have a couple of ideas on how to approach this${tzSuffix} — when would be a good time to connect this week?`;

    let prompt = `Compose a proposal using these pre-assembled ingredients. Each ingredient becomes its own short line. Use line breaks between sections.\n\n`;
    prompt += `GREETING: Hi ${greeting},\n`;
    prompt += `PAIN POINT: ${painPoint}\n`;
    prompt += `PROOF: ${proof}\n`;
    prompt += `QUESTION: ${question}\n`;
    prompt += `NEXT STEP: ${nextStep}\n`;
    prompt += `SIGNATURE: — ${freelancerName}\n\n`;
    prompt += `Word limit: ${actualIntensity === 'ultra-short' ? '40-60' : '60-100'} words for the body (excluding greeting and signature).\n\n`;
    prompt += `FORMAT: Each ingredient on its own line. Blank line after greeting, blank line before CTA, blank line before signature. DO NOT lump into one paragraph.\n`;
    prompt += `Copy each ingredient nearly verbatim. Only smooth grammar. Keep ALL technical terms, metrics, and specifics exactly as written above. The signature is EXACTLY "— ${freelancerName}" — do NOT add Best/Regards/Cheers.\n`;

    return prompt;
  }

  /**
   * Build question answering prompt
   */
  private buildQuestionPrompt(question: string, job: JobDetails, proposal: string): string {
    let prompt = `## JOB CONTEXT:
**Title:** ${job.title}
**Description:** ${job.description}

## MY PROPOSAL:
${proposal}

## MY PROFILE:`;

    prompt += this.buildProfileSection(job.userProfile);

    prompt += `\n## QUESTION TO ANSWER:\n${question}\n\nWrite a compelling 2-4 sentence answer. Be specific to this job.`;

    return prompt;
  }

  /**
   * Build profile section for prompts - with clear usage instructions
   */
  private buildProfileSection(profile?: UserProfile): string {
    if (!profile) return '\n(No profile provided - use generic proof)\n';

    // Debug logging
    console.log('Building profile section with:', {
      hasAdditionalDetails: !!profile.additionalDetails,
      additionalDetailsLength: profile.additionalDetails?.length || 0,
      hasResumeText: !!profile.resumeText,
      resumeTextLength: profile.resumeText?.length || 0,
    });

    let section = '\n';
    
    if (profile.title) {
      section += `Title: ${profile.title}\n`;
    }
    
    if (profile.summary) {
      section += `Summary: ${profile.summary}\n`;
    }
    
    if (profile.yearsExperience) {
      section += `Years of Experience: ${profile.yearsExperience}\n`;
    }
    
    if (profile.skills && profile.skills.length > 0) {
      section += `Skills: ${profile.skills.join(', ')}\n`;
    }
    
    if (profile.specializations && profile.specializations.length > 0) {
      section += `Specializations: ${profile.specializations.join(', ')}\n`;
    }
    
    if (profile.achievements && profile.achievements.length > 0) {
      section += `\nAchievements (pick ONE relevant to this job for your proof):\n`;
      profile.achievements.forEach((a, i) => {
        section += `${i + 1}. ${a}\n`;
      });
    }
    
    if (profile.pastClients && profile.pastClients.length > 0) {
      section += `\nNotable Clients: ${profile.pastClients.join(', ')}\n`;
    }
    
    if (profile.certifications && profile.certifications.length > 0) {
      section += `Certifications: ${profile.certifications.join(', ')}\n`;
    }
    
    if (profile.availability) {
      section += `Availability: ${profile.availability}\n`;
    }
    
    if (profile.timezone) {
      section += `Timezone: ${profile.timezone}\n`;
    }
    
    if (profile.hourlyRate) {
      section += `Rate: ${profile.hourlyRate}\n`;
    }

    if (profile.preferredTone) {
      section += `\nTone preference: ${profile.preferredTone}\n`;
    }

    if (profile.customSignature) {
      section += `Sign off with: "${profile.customSignature}"\n`;
    }

    // Resume content
    if (profile.resumeText && profile.resumeText.length > 100) {
      section += `\nResume/CV:\n${profile.resumeText}\n`;
    }

    // Additional details
    if (profile.additionalDetails && profile.additionalDetails.trim()) {
      section += `\nAdditional context:\n${profile.additionalDetails}\n`;
    }

    return section;
  }

  /**
   * Enforce the exact greeting and signature — fixes LLM deviations like "Best," or wrong names.
   */
  /**
   * Extract a clean first name from user profile, stripping any "Best," / "Regards," etc.
   */
  private extractCleanName(userProfile?: UserProfile): string {
    const raw = userProfile?.name || userProfile?.customSignature || 'Your Name';
    // Strip common sign-off prefixes: "Best, Abdul" → "Abdul", "Best regards, Abdul" → "Abdul"
    const stripped = raw.replace(/^\s*(?:Best|Regards|Cheers|Thanks|Sincerely|Warm regards|Kind regards|Best regards)[,.]?\s*/i, '').trim();
    // Take first name only ("Abdul Rehman" → "Abdul")
    const firstName = stripped.split(/\s+/)[0] || stripped;
    return firstName || 'Your Name';
  }

  /**
   * Clean profile title for use in proof text.
   * "ai integration engineer | secure ai workflows, saas mvps & automation" → "AI Integration Engineer"
   * Takes only the primary title (before any pipe separator) and capitalizes it.
   */
  private cleanProfileTitle(title?: string): string {
    if (!title) return '';
    // Take text before first pipe separator
    let primary = title.split('|')[0].trim();
    // Remove trailing commas/whitespace
    primary = primary.replace(/[,;]+\s*$/, '').trim();
    // Title-case it: "ai integration engineer" → "AI Integration Engineer"
    primary = primary.replace(/\b\w+/g, (word) => {
      // Keep common abbreviations uppercase
      const upper = word.toUpperCase();
      if (['AI', 'ML', 'API', 'UI', 'UX', 'CRM', 'ERP', 'SaaS', 'MVP', 'RAG', 'LLM', 'NLP', 'AWS', 'GCP'].includes(upper)) {
        return upper;
      }
      // Capitalize first letter, keep rest lowercase
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
    return primary;
  }

  private enforceTemplate(proposal: string, greeting: string, signatureName: string): string {
    let lines = proposal.trim().split('\n');
    
    // ── Fix greeting (first line) ──
    // Replace whatever the LLM put as line 1 with the correct greeting
    if (lines.length > 0 && /^Hi\s/i.test(lines[0])) {
      lines[0] = `Hi ${greeting},`;
    } else {
      lines.unshift(`Hi ${greeting},`);
    }
    
    // ── Remove ALL existing signature lines ──
    // Remove any line that looks like "— Name", "- Best, Name", etc. (anywhere in the proposal)
    lines = lines.filter(line => {
      const trimmed = line.trim();
      // Match: "— Abdul", "— Best, Abdul", "- Best,\nAbdul", etc.
      if (/^[—–-]\s*/.test(trimmed) && trimmed.length < 60) return false;
      // Match standalone "Best," or "Regards," lines
      if (/^(?:Best|Regards|Cheers|Thanks|Sincerely|Warm regards|Kind regards|Best regards)[,.]?\s*$/i.test(trimmed)) return false;
      return true;
    });
    
    // ── Remove trailing empty lines ──
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    
    // ── Ensure blank line after greeting ──
    // If line[1] is not empty, insert a blank line
    if (lines.length > 1 && lines[1].trim() !== '') {
      lines.splice(1, 0, '');
    }
    
    // ── Ensure proper spacing: no triple+ blank lines, but preserve single blanks ──
    const cleaned: string[] = [];
    let prevBlank = false;
    for (const line of lines) {
      const isBlank = line.trim() === '';
      if (isBlank && prevBlank) continue; // skip consecutive blanks
      cleaned.push(line);
      prevBlank = isBlank;
    }
    
    // ── Append correct signature with blank line before it ──
    cleaned.push('', `— ${signatureName}`);
    
    console.log(`enforceTemplate: greeting="Hi ${greeting}," signature="— ${signatureName}"`);
    return cleaned.join('\n');
  }

  /**
   * Clean proposal output
   */
  private cleanProposal(raw: string): string {
    let cleaned = raw.trim();
    
    // Remove <think> blocks (from DeepSeek and other reasoning models)
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    
    // Remove markdown code blocks
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    
    // Remove "Here's the proposal:" type prefixes
    cleaned = cleaned.replace(/^(Here'?s?\s+(the\s+)?(my\s+)?proposal:?\s*\n*)/i, '');
    cleaned = cleaned.replace(/^(Here'?s?\s+(the\s+)?(my\s+)?refined\s+proposal:?\s*\n*)/i, '');
    
    // Remove excessive newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    // Clean up double spaces
    cleaned = cleaned.replace(/  +/g, ' ');
    
    return cleaned.trim();
  }

  /**
   * Create error result
   */
  private errorResult(error: string, length: ProposalLength, startTime: number): MultiAgentResult {
    return {
      success: false,
      proposal: '',
      intensity: 'full',
      analysis: {
        overallScore: 0,
        passesStandards: false,
        qualityMetrics: {
          soundsHuman: 0,
          personalizationScore: 0,
          proofQuality: 0,
          ctaClarity: 0,
          lengthAppropriate: false,
        },
        strengths: [],
        improvements: ['Generation failed: ' + error],
        humanVoiceIssues: ['Generation failed'],
        reasoning: 'Error occurred during generation',
        wouldYouSayThisOutLoud: false,
      },
      proposalLength: length,
      screeningAnswers: [],
      modelUsed: '',
      tokensUsed: 0,
      generationTime: Date.now() - startTime,
      agentIterations: 0,
      error,
    };
  }
}

// Singleton
let instance: MultiAgentProposalGenerator | null = null;

export function getMultiAgentGenerator(): MultiAgentProposalGenerator {
  if (!instance) {
    instance = new MultiAgentProposalGenerator();
  }
  return instance;
}
