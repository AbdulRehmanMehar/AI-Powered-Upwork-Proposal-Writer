/**
 * RAG-Enhanced Proposal Generator
 * Retrieves relevant examples from practitioner knowledge base
 * to provide dynamic, contextual few-shot examples for the writer
 */

import { retrieveProposalExamples, RetrievedKnowledge, getKnowledgeStats, retrieveWinningProposals, WinningProposalKnowledge } from './knowledge-base';

export interface RAGExamples {
  hookExamples: string[];
  proofExamples: string[];
  ctaExamples: string[];
  psExamples: string[];
  bannedExamples: string[];
  strategies: string[];
  winningProposals: WinningProposalKnowledge[];
}

/**
 * Retrieve contextually relevant examples for proposal generation
 */
export async function getRAGExamples(
  jobDescription: string,
  userId?: string,
  intensity?: 'ultra-short' | 'full',
  precomputedEmbedding?: number[]
): Promise<RAGExamples> {
  try {
    // Check if knowledge base has content
    const stats = await getKnowledgeStats();
    if (stats.totalChunks === 0) {
      console.log('⚠️ Knowledge base is empty - using fallback examples');
      const winningProposals = userId ? await retrieveWinningProposals(userId, intensity, 3) : [];
      return { ...getFallbackExamples(), winningProposals };
    }

    // Retrieve examples for each section and user's winning proposals in parallel
    const [{ hooks, proofs, ctas, pss, banned }, winningProposals] = await Promise.all([
      retrieveProposalExamples(jobDescription, precomputedEmbedding),
      userId ? retrieveWinningProposals(userId, intensity, 3) : Promise.resolve([]),
    ]);

    return {
      hookExamples: formatRetrievedExamples(hooks, 'good'),
      proofExamples: formatRetrievedExamples(proofs, 'good'),
      ctaExamples: formatRetrievedExamples(ctas, 'good'),
      psExamples: formatRetrievedExamples(pss, 'good'),
      bannedExamples: formatRetrievedExamples(banned, 'bad'),
      strategies: [],
      winningProposals,
    };
  } catch (error) {
    console.error('RAG retrieval failed, using fallbacks:', error);
    const winningProposals = userId ? await retrieveWinningProposals(userId, intensity, 3) : [];
    return { ...getFallbackExamples(), winningProposals };
  }
}

/**
 * Format retrieved examples for prompt injection
 */
function formatRetrievedExamples(
  retrieved: RetrievedKnowledge[],
  expectedQuality: 'good' | 'bad'
): string[] {
  return retrieved
    .filter(r => !r.chunk.quality || r.chunk.quality === expectedQuality)
    .map(r => {
      const source = r.chunk.practitioner === 'evan_fisher' 
        ? '(Evan Fisher - $1.5M+ earned)' 
        : r.chunk.practitioner === 'josh_burns'
          ? '(Josh Burns - $830K+ earned)'
          : '';
      return `"${r.chunk.text}" ${source}`;
    });
}

/**
 * Build dynamic examples section for the writer prompt
 */
export function buildRAGExamplesSection(examples: RAGExamples): string {
  let section = `REAL EXAMPLES FROM TOP FREELANCERS:\n\n`;
  
  // YOUR WINNING PROPOSALS (for style reference only!)
  if (examples.winningProposals.length > 0) {
    section += `YOUR OWN WINNING PROPOSALS (for STYLE reference only):\n\n`;
    section += `CRITICAL: These examples are from DIFFERENT jobs. DO NOT write about these jobs.\n`;
    section += `Only study the WRITING STYLE: how hooks are phrased, how proof is structured, how questions are asked.\n\n`;
    
    examples.winningProposals.forEach((wp, i) => {
      const outcomeLabel = wp.outcome === 'hired' ? 'GOT HIRED' : 
                          wp.outcome === 'ongoing' ? 'ONGOING WORK' : 
                          'GOT INTERVIEW';
      const earningsLabel = wp.earnings ? ` ($${wp.earnings.toLocaleString()} earned)` : '';
      const intensityLabel = wp.intensity === 'ultra-short' ? 'Ultra-short' : 'Full';
      
      section += `Style Example ${i + 1} [${intensityLabel}] - ${outcomeLabel}${earningsLabel}\n`;
      section += `Proposal (STYLE ONLY, different job than yours):\n${wp.text}\n\n`;
    });
    
    section += `Study the STYLE above (hook phrasing, proof structure, question format). DO NOT copy the topics/jobs.\n\n`;
  }
  
  // Hook examples
  if (examples.hookExamples.length > 0) {
    section += `OPENING HOOKS THAT WORK:\n`;
    examples.hookExamples.forEach((ex, i) => {
      section += `${i + 1}. ${ex}\n`;
    });
    section += `\n`;
  }
  
  // Proof examples
  if (examples.proofExamples.length > 0) {
    section += `PROOF STATEMENTS THAT CONVERT:\n`;
    examples.proofExamples.forEach((ex, i) => {
      section += `${i + 1}. ${ex}\n`;
    });
    section += `\n`;
  }
  
  // CTA examples
  if (examples.ctaExamples.length > 0) {
    section += `CALL-TO-ACTION EXAMPLES:\n`;
    examples.ctaExamples.forEach((ex, i) => {
      section += `${i + 1}. ${ex}\n`;
    });
    section += `\n`;
  }
  
  // Banned patterns (what NOT to do)
  if (examples.bannedExamples.length > 0) {
    section += `OVERUSED PATTERNS TO AVOID:\n`;
    examples.bannedExamples.forEach((ex, i) => {
      section += `${i + 1}. ${ex}\n`;
    });
    section += `\n`;
  }
  
  section += `Adapt these to sound like you talking to this specific client.\n`;
  
  return section;
}

/**
 * Fallback examples if RAG fails or knowledge base is empty
 */
function getFallbackExamples(): RAGExamples {
  return {
    hookExamples: [
      '"Hi Sarah, I saw you\'re looking to integrate Stripe into your SaaS." (problem restatement)',
      '"I noticed your React app needs performance optimization." (direct and specific)',
      '"It looks like you need a dashboard built with real-time updates." (references the task)',
    ],
    proofExamples: [
      '"I recently built a similar billing system for a subscription platform that reduced failed payments by 25%." (one proof with number)',
      '"I\'ve improved load time by 40% for similar apps." (result-focused)',
      '"I\'ve built admin tools like this using React + Node." (technical credibility)',
    ],
    ctaExamples: [
      '"Would you like me to outline the approach?" (offers next step)',
      '"Could you share your current Lighthouse scores?" (smart question)',
      '"Do you already have an API in place?" (shows understanding)',
    ],
    psExamples: [],
    bannedExamples: [
      '"Dear Sir / Madam. I am very interested in your project." (Generic, impersonal)',
      '"I have 5 years experience in..." (Resume talk - client doesn\'t care)',
      '"I am a senior developer..." (Me-focused, not client-focused)',
      '"Please consider my proposal for this position." (Begging)',
    ],
    strategies: [
      'Clients spend 5-10 seconds per proposal. First 2-3 lines are everything.',
      'You\'re not trying to get hired from this message - you\'re trying to get them to REPLY.',
      '6-8 lines max. Short + relevant + confident always beats long + desperate.',
      'Include 1 smart question - it builds trust and shows understanding.',
    ],
    winningProposals: [],
  };
}

/**
 * Build the complete RAG-enhanced writer system prompt
 * Optimized for qwen2.5:7b — short, positive instructions, no negative examples
 */
export function buildRAGWriterSystemPrompt(examples: RAGExamples): string {
  return `You write short Upwork proposals that get replies.

FORMAT (follow exactly):

Hi {clientName},

{ONE paragraph, 4-6 lines: pain point, proof with number, question, next step}

— {freelancerName}

RULES:
1. Greeting on its own line. Use the client name from the user prompt, or "there" if unknown.
2. Body is ONE paragraph. All content flows together — pain point, proof, question, next step.
3. Signature "— Name" is the last line. Use the freelancer's real name from the user prompt. Always include it.
4. Always use "I" and "my". For questions, use "you" and "your" (example: "Are you using X?" or "What's your current setup?").
5. Line 1 names a SPECIFIC technical challenge about THIS job. It should only apply to THIS job, not 100 others.
6. Include ONE proof with a real project metric (%, ms, users, revenue). Use data from the profile/GitHub info provided.
7. Ask ONE smart domain question that shows you understand the problem.
8. End with a concrete next step (sketch, call, outline).
9. Use contractions (I've, I'd, can't) to sound natural.
10. Output only the proposal text. No markdown, no headers, no explanation.

AVOID these phrases: "seamless", "leverage", "robust", "comprehensive", "streamline", "passionate", "cutting-edge", "I'm excited", "I'd love to", "I resonate", "As a seasoned", "I am confident", "built something similar", "built similar systems", "is complex", "is challenging", "can be tedious", "X jobs completed", "100% success".

AVOID using Upwork platform stats as proof (jobs completed, success rate, hours worked). Only use project outcome metrics.

GOOD EXAMPLE:
Hi Sarah, getting Casbin and Clerk to play nicely across tenant boundaries with granular role splits is the hard part. I built a multi-tenant RBAC layer on Postgres that handles 12K permission checks/sec without noticeable latency. Are you planning per-org roles or a global permission model? Happy to sketch the schema.

— Abdul

${buildRAGExamplesSection(examples)}

REMINDER: The examples above are from DIFFERENT jobs. Only copy the WRITING STYLE (hook structure, proof format, question phrasing). Write about the CURRENT job from the user prompt below, not the example jobs.`;
}
