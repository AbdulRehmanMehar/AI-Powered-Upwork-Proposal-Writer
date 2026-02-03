import { getLoadBalancer, LoadBalancerResult } from './groq-load-balancer';
import { getRAGExamples, buildRAGWriterSystemPrompt, RAGExamples } from './rag-proposal';
import { retrieveProfileForProposal, getUserProfileStats, RetrievedProfileChunk } from './profile-embeddings';
import { retrieveRelevantProjects, formatProjectsForProposal } from './github-knowledge';
import { recordValidationFailure, recordSuccessfulFix, buildLearnedWarningsPrompt, getLearningStats, buildUserFeedbackPrompt } from './learning-system';

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
export type ProposalIntensity = 'ultra-short' | 'full'; // 3-5 sentences vs 200-300 words

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

// ============================================
// Supplementary Prompt Content (used by Refiner)
// ============================================

const BANNED_PATTERNS = `
## BANNED PHRASES (Using these = AUTOMATIC FAILURE):

### ❌ GENERIC HOOKS (KILLS CURIOSITY)
❌ "same here" / "same problem" / "me too"
❌ "I've done this before" / "I've built this"
❌ "I've built something similar" / "built something similar"
❌ "caught my attention" / "piqued my interest"
❌ "I resonate with..." / "I can relate"
❌ "I can help with this" / "I can definitely help"
❌ "[Quote] — I agree" / "[Quote] — exactly"

### ❌ FILLER PHRASES (WASTE WORDS, SAY NOTHING)
❌ "Your stack seems like a great fit" — DELETE, says nothing
❌ "seems like a great fit" / "looks like a great fit"
❌ "sounds like a great fit" / "perfect fit for"
❌ "this is right up my alley"
❌ "I'd be a great fit for this"

### ❌ AI BUZZWORDS
❌ "I'm excited to..." / "I was excited..."
❌ "I would love to..."  
❌ "I am confident that..." / "I'm confident in..."
❌ "I was impressed by..."
❌ "As a [job title]..." / "As a seasoned..."
❌ "With my expertise..."
❌ "I'm passionate about..."
❌ "I look forward to..."
❌ "I believe I am..."
❌ "aligns with your expectations" / "aligns with my experience"
❌ "Your [X] checklist aligns with..." (template language)
❌ "I'm intrigued by..." (robots say this)
❌ "I recall..." (sounds like accessing memory banks)
❌ "crucial" / "significant" / "significantly" (vague AI words)
❌ "If this is a good fit..." (template ending)
❌ "I'm here to help" (too salesy)
❌ "I'd like to explore..." (corporate speak)
❌ "that's exactly why" / "that's precisely why" (AI connector phrases)
❌ "Your pain point is..." / "The pain point is..." (template-y)
❌ "I've built similar platforms" (resume dumping language)
❌ "Clean architecture that..." (corporate buzzwords)

## BANNED PRONOUNS (You are a SOLO freelancer):
❌ "We" / "we" / "We'll" / "we'll" / "We've" / "we've" / "We can" / "we can"
❌ "Our team" / "our team" / "Our approach" / "our approach"
❌ ANY plural first-person pronoun - you work ALONE
✅ ONLY use "I" / "I've" / "I'll" / "I can" / "my"

## BANNED PUNCTUATION (AI tells on itself with these):
❌ En-dashes (–) or em-dashes (—) — use simple hyphens (-)
❌ Fancy quotes (" " ' ') — use straight quotes (" ')
❌ Colons in prose ("The key: we need...") — just use dashes or commas
❌ Semicolons (;) — break into two sentences or use a comma

## BANNED STRUCTURES:
❌ Starting ANY sentence with "I" in the first paragraph
❌ Multiple consecutive sentences starting with "I"
❌ Paragraphs longer than 3 sentences
❌ Generic proof without a client name or specific context
❌ More than 4 paragraphs total (keep it SHORT)
❌ Proposals longer than 150 words

## BANNED WEAK CTAs:
❌ "check out my profile for more info" - lazy, wastes their time
❌ "feel free to reach out" - passive, unclear
❌ "let me know if you're interested" - puts burden on them
❌ "looking forward to hearing from you" - generic
❌ "available to discuss" - no specific action
✅ INSTEAD: "Let's do a quick 10-minute call. I'm free tomorrow 2-5pm."
✅ INSTEAD: "Hit 'Send Message' and I'll walk you through my approach."

## BANNED FILLER (wastes precious words):
❌ "I'm available X hours per week from [location]" - save for interview
❌ Availability/timezone info - irrelevant at proposal stage
❌ Geographic disclaimers - sounds defensive
✅ INSTEAD: Focus on solving their problem

## ANTI-HALLUCINATION RULES (CRITICAL):
❌ NEVER invent project names, client names, or locations
❌ NEVER say "last month" or "recently" with made-up details
❌ NEVER mention specific cities/countries for past projects unless from GitHub data
❌ If no matching GitHub project provided, say "built something similar" - NO specifics
❌ ONLY reference projects that appear in the GitHub data or profile
✅ Keep proof vague if no real data: "done this before" not "did this for Singapore fintech"

## AI-SOUNDING PATTERNS TO AVOID:
❌ Cramming 3+ metrics into one paragraph (sounds like a robot)
❌ Listing multiple projects (pick ONE and go deep)
❌ Bullet points with arrows (→) — feels corporate
❌ "wk 1... wk 6... wk 13" timeline breakdowns (save for the call)
❌ Parenthetical company descriptions like "(NDIS provider, 120 staff)"
❌ Every sentence containing a number or percentage
❌ Referencing numbers from the job post metadata ("33 minutes", "50+ proposals", etc.)
❌ Perfect grammar and sentence structure (real humans make minor mistakes)
❌ Using "janky" or other forced-casual words (trying too hard)
`;

// ============================================
// Writer System Prompt (Main Proposal Generator)
// ============================================

const WRITER_SYSTEM_PROMPT = `# Upwork Proposal Writer

<CRITICAL_RULES priority="HIGHEST">
## ⛔ ABSOLUTE PROHIBITIONS - VIOLATION = INSTANT REJECTION

Before writing ANYTHING, acknowledge these rules:

### GREETING FORMAT (CRITICAL):
The greeting MUST be on its OWN LINE, followed by a BLANK LINE:
✅ CORRECT:
\`\`\`
Hey —

"Quote from job" — my insight...
\`\`\`

✅ CORRECT (with name):
\`\`\`
Hi Moshe,

"Quote from job" — my insight...
\`\`\`

❌ WRONG (all on one line):
\`\`\`
Hi Moshe, "Quote from job", my insight...
\`\`\`

### NEVER USE THESE PHRASES (they flag AI-generated content):
- "the tricky part" / "tricky part most miss" / "tricky part is"
- "the gotcha" / "the gotcha is" / "here's the gotcha"
- "Same stack" / "Same problem" / "Same challenges" / "Same here"
- "for a fintech client" / "for a healthcare client" / "for a [industry] client"
- "I dealt with this" / "been there" / "I've seen this before"
- "resonate" / "I resonate" / "this resonates"
- "I'd love to" / "I would love to" / "I'd be happy to"
- "I'm excited to" / "I'm thrilled to"
- "similar expertise" / "required similar expertise"
- "I've worked on projects that required"
- "ensuring reliable performance" / "a solid routing layer"

### NEVER INVENT CLAIMS:
- Do NOT claim you worked "for a fintech" or "for a healthcare company" unless you have REAL evidence
- Do NOT claim specific metrics like "40% reduction" or "99.9% uptime" unless from REAL profile data
- Do NOT claim "same stack" or "same challenges" as the client

### NEVER USE VAGUE PROJECT REFERENCES:
- ❌ "Had a project where..." — WHICH project? Link it.
- ❌ "Last quarter/last year I ran into..." — Be SPECIFIC. Name the tech stack.
- ❌ "for a SaaS" / "for a client" / "on a recent project" — Sounds made up.
- ✅ "On my portfolio project (github.com/abdul/X)..." — LINK IT
- ✅ "Building my-project.com, I hit this exact issue..." — NAME IT
- ✅ "My last Upwork client needed..." + LINK to portfolio item

### HOOK MUST HAVE INSIGHT, NOT AGREEMENT:
- ❌ "I've worked on projects that required similar expertise" (says NOTHING)
- ❌ "I built a system that integrated AI models" (vague - HOW MANY models? WHAT scale?)
- ✅ "[Quote] — last month I routed 3 LLMs through a single gateway, cost dropped 40%"
- ✅ "[Quote] — curious, are you seeing token costs spike when your router hits 1K+ req/s?"

### SIGNATURE MUST BE:
- On its OWN LINE
- After a BLANK LINE
- Format: "— Abdul" (with em-dash)
</CRITICAL_RULES>

---

You write proposals that win jobs on Upwork. This guide contains everything you need to write production-quality proposals on the first attempt.

---

## Your Identity

You are **Abdul**, a solo freelancer. 

- Always use "I", "my", "I've", "I'll"
- Never use "we", "our", "us", "our team"
- You work alone. Period.

---

## The Psychology (Why This Works)

**From Evan Fisher ($1.5M+ earned on Upwork):**
> "86% of people on Upwork make exactly zero dollars. The beginning of your cover letter is so incredibly important because that's what shows up in the preview."

**From Josh Burns ($830K+ earned):**
> "The first one to two sentences are extremely important. You need to make these powerful and honestly clickbaity."

**Key Facts:**
- Client sees ONLY first 2 sentences before clicking "Read More"
- You have 3 seconds to capture attention
- 72% of people only engage with personalized content
- 79% read the P.S. section FIRST

---

## Proposal Structure

### Ultra-Short Format (3-5 sentences total)

\`\`\`
Hey —

[HOOK: Quote + Insight] [PROOF: One project with scale numbers]

[CTA: Question + Availability]

— Abdul
\`\`\`

### Full Format (150-200 words)

\`\`\`
Hey [Name if known] —

[HOOK: Quote + Insight]

[SAVE THE DAY: How you solve this - 2-3 sentences]

[PROOF: One project with link and metrics]

[CTA: Question + Availability]

P.S. [Urgency/scarcity OR social proof snippet]

Best,
Abdul
\`\`\`

---

## Section 1: The Hook (MOST IMPORTANT)

The hook determines whether they read your proposal or skip to the next one.

### The "Hook and Twist" Framework

From Evan Fisher:
> "The hook is a normal opening line. The twist is something that makes you immediately stand out."

**Formula:** Quote their words → Add unexpected insight

### Hook Patterns That Work

**PATTERN A: Insider Knowledge**
Show you know something they didn't mention.
\`\`\`
"Building an AI support agent" — last month I wired up a handoff layer for a support bot. The LLM part was easy; the 30% of queries needing human escalation without losing context? That took some thought.
\`\`\`

**PATTERN B: Contrarian Take**
Challenge conventional thinking + back it up.
\`\`\`
"Obsessed with performance" — most devs chase Lighthouse scores, but I've found checkout speed under 1s matters more than a perfect 100. Ran an A/B test last month that proved it.
\`\`\`

**PATTERN C: Pattern Recognition**
Name the real problem.
\`\`\`
"Full website redesign" — these usually hit a wall when the old payment webhooks need to keep firing during the transition.
\`\`\`

**PATTERN D: Cliffhanger Proof**
Tease a result.
\`\`\`
"Checkout is slow" — took one from 4s to 800ms last month. The fix was embarrassingly simple.
\`\`\`

### Hook Requirements

1. **Quote their job post** — Use actual words from the job in quotes
2. **Add substance** — After the quote, include:
   - A specific number (50K users, 300ms, $2M/month)
   - OR a technical challenge (WebSocket state, RBAC hierarchies)
   - OR an architecture insight (monolith vs microservices)
3. **Be specific** — "checkout needs optimization" = FAIL. "checkout needs sub-200ms when 1000 users hit it at once" = PASS

### Hooks That FAIL (Never Use These)

- "Same here" / "Same problem" / "Same stack"
- "The tricky part most miss" / "The tricky part is" / "The gotcha is"
- "I've done this before"
- "I can help with this"
- "This caught my attention"
- "I resonate with this"
- "I have experience in X"
- "Sounds like a great fit"

---

## Section 2: Save the Day

This is where you position yourself as the solution to their problem.

From Evan Fisher:
> "Make it incredibly clear what you can do for them, how you can solve this problem."

**Keep it brief.** 2-3 sentences max. High-level approach, not step-by-step.

\`\`\`
Good: "I'd start by auditing your current auth flow, then migrate to JWTs without breaking existing sessions."

Bad: "Week 1: I'll review your codebase. Week 2: I'll write migration scripts. Week 3: I'll test..." (Save this for the call)
\`\`\`

---

## Section 3: Proof (Authority Building)

**One project. Go deep. Include numbers.**

From Evan Fisher:
> "'In four hours, he solved issues that my last development company couldn't solve in months' — that's infinitely better than saying 'I have 15 years of experience'"

### Proof Requirements

1. **ONE project only** — Don't list multiple projects (resume dumping = instant fail)
2. **Must match job domain** — E-commerce job = e-commerce project, not email automation
3. **Include scale numbers:**
   - Users: "12K daily active users"
   - Revenue: "$2M/month in transactions"
   - Performance: "reduced from 4s to 800ms"
   - Volume: "500K API calls/day"
4. **Include link if available** — Portfolio links work 9x better

### Proof Examples

\`\`\`
Good: "Did a similar migration for a 15K-user SaaS — checkout went from 4s to under 800ms (https://github.com/abdul/project)"

Bad: "I've built many e-commerce platforms with great results."

Bad: "I built ProjectA, also ProjectB, and recently ProjectC." (Resume dumping)
\`\`\`

---

## Section 4: Call to Action

**Tell them EXACTLY what to do next.**

From Evan Fisher:
> "Including an irresistible call to action doubles your chance of winning the job."
> "Click the green button that says send a message so we can get started"

### CTA Formula

\`\`\`
[Engaging Question]? [Specific Availability].
\`\`\`

### CTA Examples

\`\`\`
Good: "What's the gnarliest edge case in your current flow? Free tomorrow 2-5pm."

Good: "Curious — are you seeing the slowdown on mobile or desktop? I'm free Thursday afternoon."

Good: "What questions do you have for me?"

Bad: "Let me know if you're interested."

Bad: "Feel free to reach out."

Bad: "Free tomorrow 2-5pm." (No question = monologue, not conversation)
\`\`\`

---

## Section 5: P.S. Section (For Full Proposals)

From Evan Fisher:
> "79% of people read the P.S. first. This is where you include things that make them choose you."

### What to Put in P.S.

1. **Urgency/Scarcity**: "I'm wrapping up a project Tuesday and have a slot opening"
2. **Social Proof**: "Just finished a similar build for [Company] — happy to share the approach"
3. **Value Add**: "I put together a checklist for [relevant thing] — can share if helpful"

---

## Formatting Rules

### Greeting

- Ultra-short: \`Hey —\`
- If you know client name: \`Hey [Name] —\` or \`Hi [Name],\`
- Never: "Dear Sir/Madam", "Hello", "To whom it may concern"

### Signature

- Ultra-short: \`— Abdul\` (on its own line after a blank line)
- Full: \`Best,\\nAbdul\` (two lines)
- Never: Inline with text, "Best regards", "Sincerely", "Cheers"

### Writing Style

- Write like you're emailing a professional contact
- Complete sentences (no bullet points in the proposal body)
- Use "and" not "+": "Postgres and Redis" not "Postgres + Redis"
- Use "with" not "/": "Node with TypeScript" not "Node/TypeScript"
- No semicolons — break into two sentences instead
- Varied sentence lengths — mix short and longer sentences

---

## Instant Fail Conditions

If you do ANY of these, the proposal will be rejected:

1. Using "we" or "our" — You're solo
2. No greeting — Must start with "Hey —" or "Hi [Name],"
3. Generic hook — "same here", "I've done this before"
4. Resume dumping — Mentioning more than ONE project
5. Irrelevant project — Project domain doesn't match job
6. No question in CTA — Must end with an engaging question
7. Wrong signature — Must be on its own line
8. Vague proof — "I built a platform" without numbers
9. Using + or / — Write naturally, not like code
10. Too long — Ultra-short must be 3-5 sentences ONLY

---

## Banned Phrases

These phrases instantly reveal AI-generated content:

- "I'm excited to..."
- "I would love to..."
- "I'm passionate about..."
- "extensive experience"
- "built something adjacent"
- "As a seasoned..."
- "aligns with your expectations"
- "I'm intrigued by..."
- "leverage" / "utilize" (just say "use")
- "seamless" / "robust" / "cutting-edge"

---

## Pre-Output Checklist

Before outputting the proposal, verify:

- [ ] Did I use "I" not "we" throughout?
- [ ] Does it start with "Hey —" or "Hi [Name],"?
- [ ] Does my hook quote their job + add specific insight?
- [ ] Did I mention only ONE relevant project?
- [ ] Does my project have scale numbers?
- [ ] Does my CTA include a question?
- [ ] Is my signature on its OWN LINE after a blank line?
- [ ] Is it the right length? (Ultra-short = 3-5 sentences only)
- [ ] Would I say this out loud to a colleague?

---

## Perfect Examples

### Ultra-Short (Finance/AI Job)

\`\`\`
Hey —

"Building a compliance-first AI agent" — logging 50K LLM decisions per day for regulators is where most projects stall. I spent a week on an audit pipeline for my last project (Vercel AI SDK + Postgres) and it passed SOC2 first attempt.

What's your current approach to decision logging? Free Thursday afternoon.

— Abdul
\`\`\`

### Ultra-Short (E-commerce Job)

\`\`\`
Hey —

"Checkout performance issues" — most devs optimize the wrong thing. On my portfolio project (github.com/abdul/fast-checkout), the bottleneck wasn't the server — it was 47 Stripe webhook handlers running synchronously. Got it from 4s to 800ms.

Curious — where are you seeing the slowdown, mobile or desktop? Free tomorrow 2-5pm.

— Abdul
\`\`\`

### Full Format (Migration Job)

\`\`\`
Hey Sarah —

"Six-month .NET to Next.js migration" — those timelines usually stretch when the old payment webhooks need to keep firing alongside the new system.

Did a similar migration on my portfolio project (https://github.com/abdul/migration-project). Keeping Stripe events flowing to both systems during a 3-month transition took some thought — zero failed payments across 15K transactions.

I'd start by mapping your current webhook dependencies, then set up a proxy layer so we can migrate incrementally without any downtime.

What's driving the 6-month timeline — investor deadline or customer-facing launch? I'm free Thursday 2-5pm if you want to dig into the technical approach.

P.S. I put together a migration checklist from that project — happy to share if it's useful.

Best,
Abdul
\`\`\`

---

## Output

Just the proposal text. No explanations, no meta-commentary, no "Here's the proposal:".
`;

const REVIEWER_SYSTEM_PROMPT = `You're a STRICT quality checker. Score 0-100 and FAIL proposals that violate rules.

## ⛔ INSTANT FAIL CONDITIONS (Score = 0)

### 1. NO GREETING
- Proposal starts with "I" or project claim
- ❌ "Led a .NET MVC migration..."
- ✅ Must start with "Hey —" or "Hi [Name],"

### 2. NO JOB QUOTE
- First sentence doesn't quote THEIR specific words in quotes
- ❌ "I have experience with e-commerce"
- ✅ "\"Obsessed with clarity, design quality\" — same here"

### 3. GENERIC HOOK (NEW - IMPORTANT!)
- Hook uses lazy phrases that show no insight
- ❌ "same here" / "same problem" / "I resonate"
- ❌ "I've done this before" / "I've built this"
- ❌ "X caught my attention"
- ❌ "the tricky part most miss is..." / "the tricky part most teams miss"
- ❌ "Same stack, same challenges"
- ✅ Hook must show INSIGHT or knowledge beyond what they said
- ✅ Tell a QUICK STORY: "ran into this last year - the fix was..."
- ✅ Ask a CURIOUS QUESTION: "curious if you're hitting the X problem"
- ✅ Drop CASUAL KNOWLEDGE: "these usually break when..."

### 4. RESUME DUMPING
- Lists 2+ projects instead of ONE deep

### 5. NO QUESTION AT END
- CTA ends with statement not question
- ❌ "Free tomorrow 2-5pm."
- ✅ "What's the trickiest part? Free tomorrow 2-5pm."

### 6. WRONG SIGN-OFF
- Ultra-short must be "— Name" not "Best," or plain name
- Full must be "Best,\\nName" (two lines)

### 7. TYPOS
- "a.NET" instead of "a .NET" (space before .NET)
- Weird punctuation "2-5pm?,"

### 8. BANNED PHRASES
- "I'm excited to..."
- "built something adjacent"
- "bring that same X"
- "extensive experience"
- "check my profile"
- "We" / "Our team"

### 9. HALLUCINATION
- Claims project/company/metric not in profile data
- Uses job metadata (231 proposals) as requirements (231 stores)

### 10. IRRELEVANT PROJECT
- Project domain doesn't match job domain
- E-commerce job + email automation project = FAIL

## SCORING (only if no instant fails)

### STRUCTURE (30 points)
- Greeting present and correct: +10
- Quotes their job post: +10
- One project only: +5
- Ends with question: +5

### HOOK QUALITY (35 points - MOST IMPORTANT)
- Shows specific insight/knowledge: +15
- Makes reader curious: +10
- Not generic ("same here", "I can help"): +10

### TONE (15 points)
- Sounds human/conversational: +10
- No AI phrases: +5

### RELEVANCE (20 points)
- Project matches job domain: +10
- References specific job requirements: +10

## OUTPUT FORMAT (MUST be valid JSON):
\`\`\`json
{
  "overallScore": 85,
  "passesStandards": true,
  "qualityMetrics": {
    "soundsHuman": 80,
    "personalizationScore": 75,
    "proofQuality": 70,
    "ctaClarity": 85,
    "lengthAppropriate": true
  },
  "strengths": ["Good greeting", "Quotes job post"],
  "improvements": ["Add specific metric"],
  "humanVoiceIssues": [],
  "reasoning": "Passes all checks. Strong opening.",
  "wouldYouSayThisOutLoud": true,
  "instantFailReasons": [],
  "hallucinationDetected": false,
  "hallucinationDetails": [],
  "typos": []
}
\`\`\`

CRITICAL: Output ONLY the JSON object. No markdown, no explanation, no text before or after.
BE EXTREMELY STRICT. Real Upwork proposals get rejected for these mistakes.`;

const REFINER_SYSTEM_PROMPT = `Fix the proposal to score 10/10.

## 🔴 PRIORITY #1: REMOVE ALL "WE" USAGE (INSTANT FAIL)

**YOU ARE A SOLO FREELANCER. NEVER USE "WE" OR "OUR".**

Before doing ANYTHING else, scan the ENTIRE proposal and replace:
- "we" → "I"
- "We" → "I"  
- "our" → "my"
- "Our" → "My"
- "we're" → "I'm"
- "We're" → "I'm"
- "we've" → "I've"
- "We've" → "I've"
- "we can" → "I can"
- "we built" → "I built"
- "our team" → "I"

Check EVERY sentence. If you find ANY "we", fix it IMMEDIATELY.

---

## 🔴 PRIORITY #2: FIX GENERIC HOOK

The hook is the FIRST thing clients see. Generic hooks kill curiosity.

❌ GENERIC (REWRITE THESE):
- "[Quote] — same here" 
- "[Quote] — I've done this before"
- "[Quote] — I resonate with this"
- "[Quote] — exactly"

✅ COMPELLING (SHOW INSIGHT):
- "[Quote]" — ran into this last year. The fix was [specific thing].
- "[Quote]" — curious, are you hitting [known issue]?
- "[Quote]" — these usually break when [insider knowledge].
- Tell a quick personal story, NOT generic insights

Example fix:
- ❌ "Obsessed with clarity and performance" — same here.
- ❌ "Obsessed with clarity and performance" — most teams miss X. (TOO TEMPLATE-Y)
- ✅ "Obsessed with clarity and performance" — had a client last year who thought these were opposites. Turned out the bottleneck was their image pipeline, not the code.

---

## 🔴 PRIORITY #3: FIX SIGNATURE FORMAT

The signature MUST be on its OWN LINE after a BLANK LINE.

For ULTRA-SHORT:
\`\`\`
[Question]? Free tomorrow 2-5pm.

— Abdul
\`\`\`
NOT "Best regards," — just "— Name"

For FULL:
\`\`\`
P.S. [something]

Best,
Abdul
\`\`\`

WRONG (inline): "Free tomorrow 2-5pm, Abdul"
WRONG (no blank): "Free tomorrow 2-5pm.\\n— Abdul"
CORRECT: "Free tomorrow 2-5pm.\\n\\n— Abdul"

---

## OTHER FIXES:

### ADD PORTFOLIO LINK
If GitHub URL is provided in the prompt, include it:
- ❌ "I built a dashboard" (no link)
- ✅ "I built a dashboard (github.com/user/repo)" (with link)

### WRITE COMPLETE SENTENCES
No colons or semicolons as shortcuts:
- ❌ "Tech: React; Backend: Node"
- ✅ "Built with React and Node on the backend."

### ADD GREETING IF MISSING
- "Hey —" or "Hi [Name],"

### 7. ADD QUESTION AT END
- ❌ "Free tomorrow 2-5pm."
- ✅ "What made you start looking for help now? Free tomorrow 2-5pm."

### 8. QUOTE THEIR JOB POST
First sentence should quote their words:
- ✅ "\"Obsessed with clarity\" — I ran into this last month..."

${BANNED_PATTERNS}

## OUTPUT:
Just the fixed proposal. No explanations.`;

const QUESTION_EXTRACTOR_PROMPT = `Extract screening questions from Upwork job posts.

Look for:
- "You will be asked to answer the following questions"
- Numbered questions
- "Please include in your proposal:"
- Any direct questions to candidates

OUTPUT: JSON array of questions only.
Example: ["question 1", "question 2"]
If none found: []`;

const QUESTION_ANSWERER_PROMPT = `Answer Upwork screening questions strategically.

RULES:
- 2-4 sentences maximum
- Be specific to THIS job
- Include a concrete example or number when possible
- Never beg or over-promise
- Sound confident but not arrogant

BAD: "Yes, I understand the NDIS and would love the opportunity to work on this project."
GOOD: "Yes — I've built compliance workflows for Australian government-funded programs before, including audit trails that passed NDIS-adjacent audits. Happy to share specifics on a call."

OUTPUT: Just the answer, ready to paste. No "Answer:" prefix.`;

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
- Numbers like "33 minutes ago", "5 reviews", "4 hours ago" → These are NOT names!
- Company names → These are NOT client first names!
- "client" or "Client" → This is not a name!
- Any number by itself → NEVER a valid name!

✅ VALID NAME EXAMPLES:
- "It was great working with Matt" → "Matt"
- "Thanks Sarah!" → "Sarah"  
- "Working with John was excellent" → "John"

❌ INVALID (return null instead):
- "33 minutes ago" → NOT a name, return null
- "Rating is 5.0" → NOT a name, return null
- No review mentions a name → return null

If you cannot find a clear human first name in the reviews, return null.

### 2. UNIQUE HOOK LINE
- Find the ONE sentence that shows what the client REALLY cares about
- Often in "Why This Project Is Different" or similar sections
- Look for emotional language, values, or differentiators
- This is what makes THEIR project special to THEM

### 3. KEY PAIN POINTS
- What problems are they trying to solve?
- What's frustrating them about current solutions?
- What are they worried about?

### 4. MUST-HAVE REQUIREMENTS
- Technical skills explicitly marked as required
- Experience levels mentioned
- Specific tools/technologies

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
// Profile Matcher Agent Prompt
// ============================================
const PROFILE_MATCHER_PROMPT = `You are an expert at matching freelancer profiles to job requirements. Your task is to extract ONLY the most relevant parts of a freelancer's profile for a specific job.

## YOUR TASK:
Given a job's requirements and a freelancer's full profile, extract:

### 1. BEST MATCHING PROJECT/EXPERIENCE ⚠️ MUST BE RELEVANT!
- Find the ONE project that matches the CORE JOB REQUIREMENTS (not just tangentially related)
- **REJECT** if the project is from a completely different domain
- Include specific metrics, outcomes, or results if available
- This will be the main proof point in the proposal

**EXAMPLES OF GOOD MATCHES:**
- Job: "React developer for dashboard" → Project: "Built analytics dashboard with React/D3.js"
- Job: "Backend API engineer" → Project: "Designed REST API for fintech platform"

**EXAMPLES OF BAD MATCHES (REJECT THESE):**
- Job: "Front-end engineer for e-commerce" → Project: "Email automation system" ❌ WRONG DOMAIN
- Job: "Mobile app developer" → Project: "WordPress plugin" ❌ WRONG PLATFORM
- Job: "Data scientist for ML" → Project: "Built a landing page" ❌ WRONG SKILL SET

⚠️ **IF NO RELEVANT PROJECT EXISTS, SET bestMatchingProject TO null** - Don't force a match!

### 2. RELEVANT SKILLS (matched to job requirements)
- List only skills from their profile that match job's must-have/nice-to-have
- Order by relevance to job
- If job asks for "React", don't list "Vue" unless it's a bonus skill

### 3. STRONGEST ACHIEVEMENT
- Pick ONE achievement that would impress this specific client
- Prioritize achievements with numbers/metrics
- **Must be relevant to the job domain** - reject if unrelated

### 4. RELEVANT CERTIFICATIONS
- Only certifications that matter for this job
- Skip unrelated ones

### 5. SOCIAL PROOF
- Notable clients that would impress this client (same industry?)
- Years of experience in **relevant area** (not total years)

### 6. UNIQUE VALUE PROPOSITION
- What makes this freelancer uniquely qualified for THIS job?
- Combine skills + experience + achievements into one compelling statement
- Must be relevant to THIS job's domain

### 7. SUGGESTED PROOF STATEMENT
- Write a 1-2 sentence proof statement using their RELEVANT experience
- **ONLY USE IF PROJECT IS ACTUALLY RELEVANT** - otherwise set to null
- Example: "Last month, I built a similar patient management system that now handles 10K+ appointments monthly."

## OUTPUT FORMAT (JSON):
\`\`\`json
{
  "bestMatchingProject": {
    "description": "Built a healthcare SaaS platform with React/Node...",
    "relevance": "Same tech stack + healthcare domain",
    "metrics": "10K users, 99.9% uptime"
  },
  "relevantSkills": ["React", "Node.js", "PostgreSQL", "Healthcare APIs"],
  "strongestAchievement": "Reduced page load time by 40% on a dashboard serving 50K daily users",
  "relevantCertifications": ["AWS Solutions Architect"],
  "socialProof": {
    "notableClients": ["Mayo Clinic", "Blue Cross"],
    "yearsInDomain": 5
  },
  "uniqueValueProposition": "Full-stack developer with 5 years healthcare SaaS experience and proven track record of building HIPAA-compliant systems",
  "suggestedProofStatement": "Last month, I built a similar patient portal - it now handles 10K+ appointments monthly with 99.9% uptime."
}
\`\`\`

CRITICAL RULES:
- Output ONLY valid JSON
- **If no relevant match found for a field, use null or empty array** - DON'T force irrelevant matches
- Be specific - don't generalize or make things up
- Prioritize recency and relevance
- The suggestedProofStatement should sound natural, not robotic
- **DOMAIN RELEVANCE > EVERYTHING ELSE** - An email automation project is NOT relevant to a front-end e-commerce job`;

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
   * Main generation function with multi-agent workflow
   */
  async generate(job: JobDetails): Promise<MultiAgentResult> {
    const startTime = Date.now();
    const proposalLength = job.proposalLength || 'full';
    let totalTokens = 0;
    let modelUsed = '';
    let agentIterations = 0;

    try {
      // Determine intensity level early (before RAG retrieval)
      const intensity = this.determineIntensity(job);
      
      // Step 0: Retrieve RAG examples (parallel with job parsing)
      console.log('Step 0: Retrieving relevant examples from knowledge base...');
      const ragExamplesPromise = getRAGExamples(job.description, job.userId, intensity);

      // Step 1: Parse job with AI to extract structured data
      console.log('Step 1: Parsing job with AI...');
      const parsedJob = await this.parseJobWithAI(job.description);
      agentIterations++;
      if (parsedJob.tokensUsed) totalTokens += parsedJob.tokensUsed;
      
      // Wait for RAG examples
      const ragExamples = await ragExamplesPromise;
      console.log(`Retrieved ${ragExamples.hookExamples.length} hooks, ${ragExamples.ctaExamples.length} CTAs, ${ragExamples.winningProposals.length} winning proposals from knowledge base`);
      
      // Validate client name - basic sanity check for obviously invalid names
      // The AI parser should catch most issues, this is just a fail-safe
      if (parsedJob.data?.clientName) {
        const name = parsedJob.data.clientName.trim();
        // Only reject if it's clearly not a name (pure digits, very short, or null-like)
        const isInvalid = 
          !name || 
          name.length < 2 ||
          /^\d+$/.test(name) || // Pure digits like "33"
          /^\d+\s*(minutes?|hours?|days?|weeks?|ago)/i.test(name); // Time patterns
          
        if (isInvalid) {
          console.log(`Invalid client name detected: "${name}" - setting to null`);
          parsedJob.data.clientName = null;
        }
      }
      
      console.log('Parsed job data:', JSON.stringify(parsedJob.data, null, 2));

      // Use parsed data to enhance job details
      const enhancedJob: JobDetails = {
        ...job,
        clientName: job.clientName || parsedJob.data?.clientName || undefined,
        budget: job.budget || parsedJob.data?.budget?.amount || undefined,
      };

      // Get all screening questions (from parsed data + any provided)
      const allQuestions = [
        ...(job.screeningQuestions || []),
        ...(parsedJob.data?.screeningQuestions || []),
      ].filter((q, i, arr) => arr.findIndex(x => x.toLowerCase() === q.toLowerCase()) === i);

      // Step 2: Match profile to job (vector search first, LLM fallback)
      let matchedProfile: MatchedProfileData | null = null;
      let ragProfileData: RAGProfileData | null = null;
      let githubProjectsPrompt: string = '';
      let retrievedGitHubProjects: Array<{ repoName: string; repoUrl: string; text: string }> = [];
      
      if (job.userId) {
        // Try vector search first (faster, no LLM cost)
        console.log('Step 2: Retrieving relevant profile data via vector search...');
        try {
          const profileStats = await getUserProfileStats(job.userId);
          
          if (profileStats.totalChunks > 0) {
            // User has profile embeddings - use vector search
            const retrievedProfile = await retrieveProfileForProposal(job.userId, job.description);
            
            ragProfileData = {
              ...retrievedProfile,
              source: 'vector_search' as const,
            };
            
            console.log(`Retrieved profile data via vector search: ${
              retrievedProfile.bestProject ? '1 project' : '0 projects'
            }, ${retrievedProfile.achievements.length} achievements, ${
              retrievedProfile.testimonials.length} testimonials`);
              
            // Convert RAG profile data to MatchedProfileData format for compatibility
            if (ragProfileData.bestProject || ragProfileData.achievements.length > 0) {
              matchedProfile = this.convertRAGToMatchedProfile(ragProfileData, job.userProfile);
            }
          } else {
            console.log('No profile embeddings found for user, falling back to LLM matching...');
          }
        } catch (ragError) {
          console.error('Vector search failed, falling back to LLM:', ragError);
        }
        
        // Also retrieve GitHub projects from knowledge base
        console.log('Step 2b: Retrieving relevant GitHub projects...');
        try {
          const githubProjects = await retrieveRelevantProjects(job.userId, job.description, 3);
          if (githubProjects.length > 0) {
            githubProjectsPrompt = formatProjectsForProposal(githubProjects);
            // Store for auto-fix use (to inject portfolio links)
            retrievedGitHubProjects = githubProjects.map(p => ({
              repoName: p.repoName,
              repoUrl: p.repoUrl,
              text: p.text
            }));
            console.log(`Retrieved ${githubProjects.length} relevant GitHub projects from knowledge base`);
          } else {
            console.log('No relevant GitHub projects found in knowledge base');
          }
        } catch (githubError) {
          console.error('GitHub retrieval failed:', githubError);
        }
      }
      
      // LLM fallback if vector search didn't work or returned nothing
      if (!matchedProfile && job.userProfile) {
        console.log('Step 2 (fallback): Matching profile to job via LLM...');
        const profileMatch = await this.matchProfileToJob(job.userProfile, parsedJob.data, job.description);
        agentIterations++;
        if (profileMatch.tokensUsed) totalTokens += profileMatch.tokensUsed;
        matchedProfile = profileMatch.data;
        console.log('Matched profile (LLM):', JSON.stringify(matchedProfile, null, 2));
      } else if (!matchedProfile) {
        console.log('Step 2: Skipped (no user profile provided)');
      }

      // Log intensity (already determined earlier)
      console.log(`Using intensity level: ${intensity} (proposalLength: ${proposalLength})`);

      // Step 2c: Get learned warnings from past mistakes
      console.log('Step 2c: Loading learned warnings from past mistakes...');
      const learnedWarningsPrompt = await buildLearnedWarningsPrompt(intensity);
      if (learnedWarningsPrompt) {
        const stats = await getLearningStats();
        console.log(`📚 Loaded ${stats.totalFailures} past failures across ${stats.uniqueErrorTypes} error types`);
        if (stats.topMistakes.length > 0) {
          console.log(`📚 Top mistakes: ${stats.topMistakes.map(m => `${m.errorType}(${m.count}x)`).join(', ')}`);
        }
      }

      // Step 2d: Get user-specific feedback learnings (human-in-the-loop)
      let userFeedbackPrompt = '';
      if (job.userId) {
        console.log('Step 2d: Loading user feedback learnings...');
        userFeedbackPrompt = await buildUserFeedbackPrompt(job.userId);
        if (userFeedbackPrompt) {
          console.log('📝 Loaded user-specific writing rules from past feedback');
        }
      }

      // Step 3: Generate initial proposal (Writer Agent) with RAG-enhanced prompt
      console.log('Step 3: Writing initial proposal with RAG examples...');
      const ragWriterSystemPrompt = buildRAGWriterSystemPrompt(ragExamples);
      // Combine auto-learned warnings with user feedback learnings
      const combinedLearnings = (learnedWarningsPrompt || '') + (userFeedbackPrompt || '');
      const writerPrompt = parsedJob.data 
        ? this.buildWriterPromptWithParsedData(enhancedJob, parsedJob.data, proposalLength, matchedProfile, intensity, githubProjectsPrompt, combinedLearnings)
        : this.buildWriterPrompt(enhancedJob, proposalLength, intensity, combinedLearnings);
      const writerResult = await this.callAgent(ragWriterSystemPrompt, writerPrompt);
      
      if (!writerResult.success) {
        return this.errorResult(writerResult.error || 'Writer agent failed', proposalLength, startTime);
      }
      
      totalTokens += writerResult.totalTokens;
      modelUsed = writerResult.modelUsed;
      agentIterations++;

      let currentProposal = this.cleanProposal(writerResult.content);
      
      let reviewFeedback = '';
      let finalAnalysis: ProposalAnalysis | null = null;

      // Step 4 & 5: Review-Refine loop (up to 2 iterations)
      const MAX_REFINEMENT_ROUNDS = 2;
      
      for (let round = 0; round < MAX_REFINEMENT_ROUNDS; round++) {
        // STEP 1: Run PRODUCTION VALIDATORS FIRST (stricter than AI)
        const validationResult = this.runProductionValidators(currentProposal, intensity, job);
        
        if (!validationResult.valid) {
          console.log(`❌ PRODUCTION VALIDATOR FAILED (round ${round + 1}): ${validationResult.error}`);
          
          // Record the failure for learning
          const validatorName = validationResult.validatorName || 'unknown';
          await recordValidationFailure(
            validatorName,
            validationResult.error || 'Unknown error',
            intensity,
            {
              userId: job.userId,
              badSnippet: currentProposal.substring(0, 200),
            }
          );
          
          // Force refinement with specific error
          const refinerPrompt = this.buildRefinerPrompt(
            job, 
            currentProposal, 
            `CRITICAL VALIDATION ERROR: ${validationResult.error}\n\nFix this immediately.`,
            proposalLength
          );
          const badProposal = currentProposal;
          const refinerResult = await this.callAgent(REFINER_SYSTEM_PROMPT, refinerPrompt);
          
          if (refinerResult.success) {
            totalTokens += refinerResult.totalTokens;
            agentIterations++;
            currentProposal = this.cleanProposal(refinerResult.content);
            
            // Record the successful fix
            await recordSuccessfulFix(
              validatorName,
              validationResult.error || 'Unknown error',
              intensity,
              badProposal.substring(0, 200),
              currentProposal.substring(0, 200)
            );
            
            continue; // Force another validation round
          } else {
            console.error(`Refiner agent failed after validation error (round ${round + 1}):`, refinerResult.error);
            break;
          }
        }
        
        // STEP 2: If validators pass, run AI reviewer for quality score
        const reviewPrompt = this.buildReviewPrompt(job, currentProposal, proposalLength, githubProjectsPrompt);
        const reviewResult = await this.callAgent(REVIEWER_SYSTEM_PROMPT, reviewPrompt);
        
        if (!reviewResult.success) {
          console.error(`Reviewer agent failed (round ${round + 1}):`, reviewResult.error);
          break;
        }
        
        totalTokens += reviewResult.totalTokens;
        agentIterations++;
        reviewFeedback = reviewResult.content;
        
        // Try to parse JSON analysis from reviewer
        const parsedAnalysis = this.parseReviewerAnalysis(reviewFeedback);
        if (parsedAnalysis) {
          finalAnalysis = parsedAnalysis;
        }
        
        // Check if it passed based on analysis
        const passed = finalAnalysis 
          ? finalAnalysis.passesStandards && finalAnalysis.overallScore >= 70
          : reviewFeedback.toLowerCase().includes('verdict: pass');
        
        if (passed) {
          console.log(`✅ Proposal passed review on round ${round + 1} (score: ${finalAnalysis?.overallScore || 'N/A'})`);
          break;
        }
        
        // Failed review - call WRITER to regenerate with feedback
        console.log(`📝 Proposal failed review (round ${round + 1}), calling WRITER to regenerate...`);
        
        const writerRewritePrompt = parsedJob && parsedJob.data
          ? this.buildWriterPromptWithParsedData(enhancedJob, parsedJob.data, proposalLength, matchedProfile, intensity, githubProjectsPrompt, learnedWarningsPrompt, reviewFeedback)
          : this.buildWriterPrompt(enhancedJob, proposalLength, intensity, learnedWarningsPrompt, reviewFeedback);
        
        const writerRewriteResult = await this.callAgent(WRITER_SYSTEM_PROMPT, writerRewritePrompt);
        
        if (writerRewriteResult.success) {
          totalTokens += writerRewriteResult.totalTokens;
          agentIterations++;
          currentProposal = this.cleanProposal(writerRewriteResult.content);
        } else {
          console.error(`Writer rewrite failed (round ${round + 1}):`, writerRewriteResult.error);
          break;
        }
      }

      // Step 5: Answer screening questions
      const screeningAnswers: ScreeningAnswer[] = [];
      for (const question of allQuestions) {
        const answer = await this.answerQuestion(question, job, currentProposal);
        if (answer.success) {
          screeningAnswers.push({
            question,
            answer: answer.content,
          });
          totalTokens += answer.totalTokens;
          agentIterations++;
        }
      }

      // Build final analysis (use parsed or create fallback)
      if (!finalAnalysis) {
        const passed = reviewFeedback.toLowerCase().includes('pass');
        finalAnalysis = this.buildFallbackAnalysis(reviewFeedback, passed);
      }

      // FINAL PRODUCTION VALIDATION: Last line of defense before returning
      console.log('Running final production validation...');
      let finalValidation = this.runProductionValidators(currentProposal, intensity, job);
      
      if (!finalValidation.valid) {
        console.error(`⚠️ FINAL VALIDATION FAILED: ${finalValidation.error}`);
        
        // EMERGENCY AUTO-FIX: Try to fix the specific issue
        if (finalValidation.validatorName === 'validatePortfolioLinks' && retrievedGitHubProjects.length > 0) {
          console.log('🔧 Emergency fix: Injecting portfolio link...');
          const bestProject = retrievedGitHubProjects[0];
          
          // Force inject the portfolio link before signature
          const signatureMatch = currentProposal.match(/\n\n—\s*\w+\s*$/);
          if (signatureMatch) {
            const insertPoint = currentProposal.indexOf(signatureMatch[0]);
            currentProposal = currentProposal.slice(0, insertPoint) + 
              `\n\nRelevant project: ${bestProject.repoUrl}` + 
              currentProposal.slice(insertPoint);
            console.log(`✅ Emergency injected: ${bestProject.repoUrl}`);
            
            // Re-validate
            finalValidation = this.runProductionValidators(currentProposal, intensity, job);
          }
        }
        
        if (!finalValidation.valid) {
          console.error('Proposal still has critical issues despite emergency fix.');
          
          // Update analysis to reflect failure
          finalAnalysis.passesStandards = false;
          finalAnalysis.overallScore = Math.min(finalAnalysis.overallScore, 65);
          finalAnalysis.improvements.unshift(`CRITICAL: ${finalValidation.error}`);
        } else {
          console.log('✅ Emergency fix succeeded - proposal is now production-ready');
        }
      } else {
        console.log('✅ Final validation passed - proposal is production-ready');
      }

      return {
        success: true,
        proposal: currentProposal,
        intensity,
        analysis: finalAnalysis,
        proposalLength,
        screeningAnswers,
        reviewFeedback,
        modelUsed,
        tokensUsed: totalTokens,
        generationTime: Date.now() - startTime,
        agentIterations,
      };

    } catch (error) {
      console.error('Multi-agent generation error:', error);
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
    return 'full'; // 200-300 words
  }

  /**
   * Programmatically fix common issues BEFORE calling the LLM refiner
   * This handles simple regex-fixable issues that the LLM often fails at
   */


  /**
   * Parse reviewer JSON output into structured analysis
   */
  private parseReviewerAnalysis(reviewerOutput: string): ProposalAnalysis | null {
    try {
      // Try to extract JSON from the output
      const jsonMatch = reviewerOutput.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('No JSON found in reviewer output');
        return null;
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate structure
      if (typeof parsed.overallScore !== 'number' || !parsed.qualityMetrics) {
        console.warn('Invalid reviewer JSON structure');
        return null;
      }
      
      return parsed as ProposalAnalysis;
    } catch (error) {
      console.error('Failed to parse reviewer JSON:', error);
      return null;
    }
  }

  /**
   * Build fallback analysis when reviewer JSON parsing fails
   */
  private buildFallbackAnalysis(reviewFeedback: string, passed: boolean): ProposalAnalysis {
    return {
      overallScore: passed ? 75 : 50,
      passesStandards: passed,
      qualityMetrics: {
        soundsHuman: passed ? 70 : 50,
        personalizationScore: 70,
        proofQuality: 70,
        ctaClarity: 70,
        lengthAppropriate: true,
      },
      strengths: passed ? ['Proposal passed quality checks'] : [],
      improvements: passed ? [] : ['See reviewer feedback for details'],
      humanVoiceIssues: passed ? [] : ['Check reviewer feedback'],
      reasoning: reviewFeedback.substring(0, 500),
      wouldYouSayThisOutLoud: passed,
    };
  }

  /**
   * PRODUCTION VALIDATORS - Catch critical errors the AI reviewer might miss
   */

  /**
   * Validate signature format matches intensity level
   */
  private validateSignature(proposal: string, intensity: ProposalIntensity, expectedName?: string): { valid: boolean; error?: string } {
    const lines = proposal.trim().split('\n');
    const lastLine = lines[lines.length - 1].trim();
    const secondLastLine = lines.length > 1 ? lines[lines.length - 2].trim() : '';
    const thirdLastLine = lines.length > 2 ? lines[lines.length - 3].trim() : '';

    // Check for inline signature patterns (WRONG)
    // Pattern 1: ", Name" at end of sentence
    const inlineSignatureMatch1 = proposal.match(/[.!?],\s*([A-Z][a-z]+)\s*$/);
    if (inlineSignatureMatch1) {
      return {
        valid: false,
        error: `Signature "${inlineSignatureMatch1[1]}" is inline with text. Name must be on its own line after a blank line, not ", ${inlineSignatureMatch1[1]}"`
      };
    }
    
    // Pattern 2: "pm, Abdul" or "tomorrow, Abdul"
    const inlineSignatureMatch2 = proposal.match(/(pm|am|tomorrow|today|afternoon|morning),\s*([A-Z][a-z]+)\s*$/);
    if (inlineSignatureMatch2) {
      return {
        valid: false,
        error: `Signature "${inlineSignatureMatch2[2]}" is inline with text. Must be on its own line: "...${inlineSignatureMatch2[1]}.\n\n— ${inlineSignatureMatch2[2]}"`
      };
    }
    
    // Pattern 3: Signature on same line as question
    const inlineSignatureMatch3 = lastLine.match(/\?.*([A-Z][a-z]{2,})\s*$/);
    if (inlineSignatureMatch3 && lastLine.includes('?') && !lastLine.startsWith('—') && !lastLine.startsWith('-')) {
      return {
        valid: false,
        error: `Signature appears inline with question. Name must be on its own line after blank line.`
      };
    }
    
    // Check for signature NOT on its own line (should have blank line before)
    if (intensity === 'ultra-short' && lastLine.match(/^—?\s?[A-Z][a-z]+$/)) {
      // Last line looks like a signature - check if there's a blank line before it
      if (secondLastLine && secondLastLine.length > 0) {
        return {
          valid: false,
          error: `Signature must have a BLANK LINE before it. Found text immediately before: "${secondLastLine.substring(0, 50)}..."`
        };
      }
    }

    if (intensity === 'full') {
      // Full proposals must have "Best regards," on second-to-last line and full name on last line
      if (!secondLastLine.match(/^(Best regards|Kind regards|Regards|Best),?$/i)) {
        return { 
          valid: false, 
          error: `Full proposal must end with "Best regards," on separate line before name. Found: "${secondLastLine}"` 
        };
      }
      if (!lastLine || lastLine.length < 2) {
        return { 
          valid: false, 
          error: 'Missing name after "Best regards,"' 
        };
      }
      // Check if it's just first name when full name expected
      if (expectedName && expectedName.includes(' ') && !lastLine.includes(' ')) {
        return {
          valid: false,
          error: `Signature should be full name "${expectedName}", not just "${lastLine}"`
        };
      }
    } else {
      // Ultra-short: just name on last line (no "Best regards")
      if (secondLastLine.match(/^(Best regards|Kind regards|Regards|Best),?$/i)) {
        return {
          valid: false,
          error: 'Ultra-short proposals should NOT have "Best regards," - just name on last line'
        };
      }
      if (!lastLine || lastLine.length < 2) {
        return {
          valid: false,
          error: 'Missing signature on last line'
        };
      }
    }

    return { valid: true };
  }

  /**
   * Check if proposal mentions client name that doesn't match expected
   */
  private validateClientName(proposal: string, expectedClientName?: string, freelancerName?: string): { valid: boolean; error?: string } {
    // Extract greeting from first line
    const firstLine = proposal.trim().split('\n')[0];
    const greetingMatch = firstLine.match(/^(Hi|Hey|Hello)\s+([A-Z][a-z]+)/i);
    
    if (greetingMatch) {
      const greetedName = greetingMatch[2];
      
      // CRITICAL: Check if greeting uses freelancer's own name
      if (freelancerName) {
        const freelancerFirstName = freelancerName.split(' ')[0];
        if (greetedName.toLowerCase() === freelancerFirstName.toLowerCase()) {
          return {
            valid: false,
            error: `CATASTROPHIC ERROR: Proposal greets "${greetedName}" which is YOUR name, not the client's! ${expectedClientName ? `Client is "${expectedClientName}"` : 'Client name unknown'}`
          };
        }
      }
      
      // Check if greeting matches expected client name
      if (expectedClientName && expectedClientName.toLowerCase() !== 'unknown') {
        const expectedFirstName = expectedClientName.split(' ')[0];
        if (greetedName.toLowerCase() !== expectedFirstName.toLowerCase()) {
          return {
            valid: false,
            error: `Greeting uses "${greetedName}" but expected client name is "${expectedClientName}"`
          };
        }
      }
    }
    
    return { valid: true };
  }

  /**
   * Check if proposal greeting is valid (if present)
   * Greetings are OPTIONAL - a strong hook without greeting is fine
   */
  private validateGreeting(proposal: string): { valid: boolean; error?: string } {
    const lines = proposal.trim().split('\n');
    const firstLine = lines[0].trim();
    const secondLine = lines.length > 1 ? lines[1].trim() : '';
    
    // Check if first line looks like a greeting
    const greetingPatterns = [
      /^(Hi|Hey|Hello)\s+[A-Za-z]+,?/i,  // "Hi Sarah," or "Hi there"
      /^(Hi|Hey|Hello)\s+there,?/i,       // "Hi there,"
      /^(Hi|Hey|Hello),/i,                 // Just "Hi," or "Hey,"
      /^(Hi|Hey|Hello)\s*—/i,              // "Hey —" pattern
    ];
    
    const hasGreeting = greetingPatterns.some(pattern => pattern.test(firstLine));
    
    // CRITICAL CHECK: Greeting should be on its OWN LINE
    // If greeting is followed by a quote on the SAME line, that's wrong
    // Pattern: "Hi Name, "quoted text"" or "Hi Name, "quoted text"" (curly quotes)
    if (/^(Hi|Hey|Hello)\s+[A-Za-z]+,?\s*[""][^""]+[""]/.test(firstLine)) {
      return {
        valid: false,
        error: `Greeting and hook are on the SAME LINE. The greeting must be on its own line:\n\nCORRECT:\nHi Name,\n\n"Quote" — insight...\n\nWRONG:\nHi Name, "Quote", insight...`
      };
    }
    
    // Also check: If greeting line is too long (>30 chars), it probably has content after it
    if (hasGreeting && firstLine.length > 40) {
      return {
        valid: false,
        error: `Greeting line too long (${firstLine.length} chars). Greeting should be on its own short line like "Hi Name," then blank line, then hook on next paragraph.`
      };
    }
    
    // Check if second line is blank (proper structure) or has content (wrong)
    if (hasGreeting && secondLine.length > 0 && !secondLine.startsWith('"') && !secondLine.startsWith('"')) {
      // If second line has content but doesn't start with a quote, might be hook running into greeting
      // This is OK if it's a blank line scenario
    }
    
    // Only fail if greeting looks broken (e.g., "Hi ," or "Hello  ,")
    if (/^(Hi|Hey|Hello)\s*,\s*$/i.test(firstLine)) {
      return {
        valid: false,
        error: 'Broken greeting "Hi ," - either use "Hi [Name]," or skip greeting entirely and start with hook'
      };
    }
    
    return { valid: true };
  }

  /**
   * Check for portfolio links when projects are mentioned
   */
  private validatePortfolioLinks(proposal: string, userProfile?: UserProfile): { valid: boolean; error?: string } {
    // Check if proposal mentions work/projects
    const mentionsWork = /\b(built|created|developed|shipped|worked on|migrated|implemented|designed)\b/i.test(proposal);
    
    if (mentionsWork) {
      // Check for actual URLs or portfolio link placeholders
      const hasLinks = /https?:\/\/|portfolio|github\.com|gitlab\.com|\[.*?\]\(.*?\)/.test(proposal);
      
      if (!hasLinks) {
        return {
          valid: false,
          error: 'Mentions projects but includes ZERO portfolio links (9x hire rate impact!)'
        };
      }
    }
    
    return { valid: true };
  }

  /**
   * Validate CTA quality - must have button name and specific times
   */
  private validateCTA(proposal: string, intensity: ProposalIntensity): { valid: boolean; error?: string } {
    const lowerProposal = proposal.toLowerCase();
    
    // Check for weak/passive CTAs
    const weakPhrases = [
      'feel free', 
      'if relevant', 
      'if this interests you', 
      'available to help', 
      'if you\'d like',
      'check my profile',
      'check out my profile',
      'look at my profile',
      'see my profile',
      'visit my profile',
      'looking forward to hearing',
      'looking forward to',
      'let me know if you\'re interested',
      'let me know if interested'
    ];
    for (const phrase of weakPhrases) {
      if (lowerProposal.includes(phrase)) {
        return {
          valid: false,
          error: `Contains weak CTA phrase: "${phrase}" - offer a specific next step instead (e.g., "Let's do a 10-minute call. I'm free tomorrow 2-5pm.")`
        };
      }
    }
    
    // Check for filler/availability info that wastes space
    const fillerPhrases = [
      'available 30+',
      'available 40+',
      'hours a week',
      'hours per week',
      'from pakistan',
      'based in pakistan',
      'based in india',
      'working from',
      'i\'m located in',
      'i\'m available now',
      'available now and can start',
      'can start this week',
      'can start immediately',
      'ready to start',
      'available to start'
    ];
    for (const phrase of fillerPhrases) {
      if (lowerProposal.includes(phrase)) {
        return {
          valid: false,
          error: `Contains availability/location filler: "${phrase}" - this wastes precious space. Save for the interview.`
        };
      }
    }
    
    // Check for defensive geographic language
    const defensivePhrases = ['despite being', 'even though i\'m', 'although i\'m based'];
    for (const phrase of defensivePhrases) {
      if (lowerProposal.includes(phrase)) {
        return {
          valid: false,
          error: `Contains defensive language: "${phrase}" - be matter-of-fact, not apologetic`
        };
      }
    }
    
    // For full proposals, check for specific button reference
    if (intensity === 'full') {
      const hasButtonRef = /click|send a message|message button|green button/i.test(proposal);
      if (!hasButtonRef) {
        return {
          valid: false,
          error: 'Full proposals should reference the specific button to click (e.g., "Click the green \'Send a Message\' button")'
        };
      }
    }
    
    // Check for question-ending (required for ultra-short)
    if (intensity === 'ultra-short') {
      // Question should appear before the signature line
      // Format: "...question? Free tomorrow 2-5pm.\n\n— Name" or "...question?\n\n— Name"
      const hasQuestionBeforeSignature = proposal.trim().match(/\?[^?]*\n\s*\n?[\—\-]?\s*[A-Z][a-z]+\s*$/);
      if (!hasQuestionBeforeSignature) {
        return {
          valid: false,
          error: 'Ultra-short proposals must end with a question (e.g., "What questions do you have for me?")'
        };
      }
    }
    
    return { valid: true };
  }

  /**
   * Check for tech jargon cramming (too robotic)
   */
  private validateHumanTone(proposal: string): { valid: boolean; error?: string } {
    // Count technical terms/acronyms (3+ letters, all caps)
    const acronyms = proposal.match(/\b[A-Z]{2,}\b/g) || [];
    if (acronyms.length > 5) {
      return {
        valid: false,
        error: `Too many acronyms/technical terms (${acronyms.length}): ${acronyms.slice(0, 6).join(', ')}... - sounds robotic, not human`
      };
    }
    
    // Check for corporate transition words
    const corporateWords = ['furthermore', 'additionally', 'moreover', 'consequently', 'nevertheless'];
    for (const word of corporateWords) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(proposal)) {
        return {
          valid: false,
          error: `Contains corporate transition word "${word}" - sounds like LinkedIn post, not human conversation`
        };
      }
    }
    
    return { valid: true };
  }

  /**
   * Check for "We" pronouns - solo freelancer should only use "I"
   * But allow "we" in quoted examples of bad responses
   */
  private validateSoloPronouns(proposal: string): { valid: boolean; error?: string } {
    // Remove quoted text before checking (e.g., "we're looking into it" is okay as example)
    const proposalWithoutQuotes = proposal.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');
    
    // Check for plural first-person pronouns
    const wePatterns = [
      /\bWe\b/g, /\bwe\b/g, /\bWe'll\b/g, /\bwe'll\b/g,
      /\bWe've\b/g, /\bwe've\b/g, /\bWe can\b/g, /\bwe can\b/g,
      /\bOur\s+team\b/gi, /\bour\s+approach\b/gi, /\bour\s+process\b/gi
    ];
    
    for (const pattern of wePatterns) {
      const matches = proposalWithoutQuotes.match(pattern);
      if (matches && matches.length > 0) {
        return {
          valid: false,
          error: `Uses "${matches[0]}" - you're a SOLO freelancer! Use "I" not "We"`
        };
      }
    }
    
    return { valid: true };
  }

  /**
   * Check for hallucinated project claims (specific language without data)
   * This is a pattern-based check - the AI reviewer does deeper verification
   */
  private validateNoHallucination(proposal: string): { valid: boolean; error?: string } {
    const lowerProposal = proposal.toLowerCase();
    
    // INSTANT FAIL PHRASES - commonly hallucinated or robotic
    const bannedPhrases = [
      { pattern: /\bresonate\b/i, phrase: 'resonate' },
      { pattern: /your needs resonate/i, phrase: 'your needs resonate' },
      { pattern: /i dealt with a similar challenge/i, phrase: 'I dealt with a similar challenge' },
      { pattern: /i dealt with the same/i, phrase: 'I dealt with the same' },
      { pattern: /the gotcha is/i, phrase: 'the gotcha is' },
      { pattern: /the tricky part/i, phrase: 'the tricky part' },
      { pattern: /tricky part most miss/i, phrase: 'tricky part most miss' },
      { pattern: /tricky part most teams miss/i, phrase: 'tricky part most teams miss' },
      { pattern: /what most teams miss/i, phrase: 'what most teams miss' },
      { pattern: /same stack,? same/i, phrase: 'same stack, same' },
      { pattern: /same challenges/i, phrase: 'same challenges' },
      { pattern: /last quarter when i/i, phrase: 'last quarter when I' },
      { pattern: /99\.9% uptime/i, phrase: '99.9% uptime' },
      { pattern: /99\.99% uptime/i, phrase: '99.99% uptime' },
      { pattern: /been there\./i, phrase: 'Been there.' },
      // New: "I'd love to" patterns
      { pattern: /i'?d love to/i, phrase: "I'd love to" },
      { pattern: /i would love to/i, phrase: 'I would love to' },
      { pattern: /i'?d be happy to/i, phrase: "I'd be happy to" },
      // New: Generic "similar expertise" patterns
      { pattern: /similar expertise/i, phrase: 'similar expertise' },
      { pattern: /required similar/i, phrase: 'required similar' },
      { pattern: /projects that required/i, phrase: 'projects that required' },
      // New: Vague proof patterns
      { pattern: /ensuring reliable performance/i, phrase: 'ensuring reliable performance' },
      { pattern: /ensuring.*safety/i, phrase: 'ensuring...safety' },
      { pattern: /a solid routing layer/i, phrase: 'a solid routing layer' },
      { pattern: /a solid.*layer/i, phrase: 'a solid...layer' },
    ];
    
    for (const { pattern, phrase } of bannedPhrases) {
      if (pattern.test(proposal)) {
        return {
          valid: false,
          error: `Banned phrase: "${phrase}" sounds robotic/hallucinated. Rewrite with SPECIFIC details and numbers.`
        };
      }
    }
    
    // SUSPICIOUS STATISTICS - precise decimals that look invented
    const precisePercentMatches = proposal.match(/\d+\.\d+%/g) || [];
    for (const match of precisePercentMatches) {
      const num = parseFloat(match);
      const isRound = num % 10 === 0 || num % 5 === 0 || num === 99.9 || num === 99.99;
      if (!isRound) {
        return {
          valid: false,
          error: `Suspicious statistic: "${match}" looks invented. Use round numbers (40%, 50%, 3x) or be vague.`
        };
      }
    }
    
    // Patterns that indicate hallucination (too specific without real data)
    const hallucinationPatterns = [
      // "Built/created a [specific] system/platform for [specific client type]"
      { pattern: /built (a|an|the) [a-z\-]+ (system|platform|app|tool|automation|router) for (a|an|the) [a-z\-]+ (chain|company|client|salon|store|business|agency)/i, reason: 'Claims specific project for specific client type' },
      // "for a fintech client" / "for a healthcare client" - fake client claims
      { pattern: /for (a|an|the) (fintech|healthcare|finance|banking|insurance|beauty|salon|enterprise|startup|ecommerce|e-commerce) (client|company|startup|firm|business)/i, reason: 'Claims work for specific industry client without evidence' },
      // "Just wrapped/finished/completed X" - overly specific claims
      { pattern: /just (wrapped|finished|completed|built|shipped) (a|an|the) [a-z\-]+ (platform|system|app|product)/i, reason: 'Claims to have "just" completed a specific platform' },
      // "Replaced a X-person team"
      { pattern: /replaced (a|an) \d[\-\s]person team/i, reason: 'Claims to have replaced specific team size' },
      // "Running for X months/years without [problem]"
      { pattern: /running (for )?\d+ (months?|years?) (without|with no|with zero)/i, reason: 'Claims specific uptime/duration' },
      // "Same X you mentioned" - pretending to have exact match
      { pattern: /same (validation|compliance|audit|billing|payment|booking|automation|stack|challenges?) (headache|issue|problem|challenge)?( you mentioned)?/i, reason: 'Claims to have had the EXACT same experience as client' },
      // Specific industry + location claims
      { pattern: /(fintech|healthcare|finance|banking|insurance|beauty|salon) (client|project|gig) (in|from|for) [A-Z][a-z]+/i, reason: 'Claims specific industry + location' },
      // "Last month/week/year" with specifics
      { pattern: /(last|previous|recent) (month|week|year|quarter),? (i|we) (built|finished|completed|wrapped|shipped|tuned|dealt)/i, reason: 'Claims recent specific project' },
      // "Lender-grade" or job-specific jargon mirroring
      { pattern: /lender[\-\s]grade/i, reason: 'Mirrors job-specific jargon - likely hallucination' },
      // "Zero downtime" claims
      { pattern: /zero downtime (migration|deployment|upgrade|switch)/i, reason: 'Claims zero downtime - needs verification' },
      // "Cut their X way down" or "reduced X significantly"
      { pattern: /cut (their|the) [a-z\-]+ (way down|significantly|dramatically|by \d+%)/i, reason: 'Claims specific impact without data' },
      // "X% open rates/conversion/improvement" - specific invented metrics
      { pattern: /\d{2,3}% (open|conversion|click|response|improvement|increase|reduction)/i, reason: 'Claims specific percentage metric' },
      // "that trimmed/reduced their X by Y%" - specific invented metric
      { pattern: /that (trimmed|reduced|cut|slashed|lowered|improved) (their|the) [a-z\-]+ (burn|cost|usage|time|load|latency) by \d+%/i, reason: 'Claims specific percentage improvement for unnamed client' },
      // "Same stack, same X" - pretending exact match
      { pattern: /same stack,? same/i, reason: 'Claims exact technology match - sounds fabricated' },
    ];
    
    for (const { pattern, reason } of hallucinationPatterns) {
      if (pattern.test(proposal)) {
        const match = proposal.match(pattern);
        return {
          valid: false,
          error: `Likely hallucination: "${match?.[0]}" - ${reason}. Use vague language like "built something similar" or reference ACTUAL projects from your profile.`
        };
      }
    }
    
    return { valid: true };
  }

  /**
   * Check for banned AI phrases that slip through
   */
  private validateBannedPhrases(proposal: string): { valid: boolean; error?: string } {
    const bannedPhrases = [
      "i'm excited", "i am excited", "i was excited",
      "i would love to", "i'd love to",
      "i am confident", "i'm confident",
      "i was impressed", "as a seasoned",
      "with my expertise", "i'm passionate",
      "i look forward", "i believe i am",
      "aligns with", "i'm intrigued",
      "i recall", "crucial", "significantly",
      "if this is a good fit", "i'm here to help",
      "i'd like to explore", "that's exactly why",
      "that's precisely why", "pain point",
      "clean architecture", "leverage", "utilize",
      "comprehensive", "robust solution"
    ];
    
    const lowerProposal = proposal.toLowerCase();
    for (const phrase of bannedPhrases) {
      if (lowerProposal.includes(phrase)) {
        return {
          valid: false,
          error: `Contains banned AI phrase: "${phrase}" - rewrite to sound human`
        };
      }
    }
    
    return { valid: true };
  }

  /**
   * Check for common grammar mistakes
   */
  private validateGrammar(proposal: string): { valid: boolean; error?: string } {
    const grammarErrors = [
      { pattern: /\bI've experience\b/gi, fix: '"I have experience" or "I\'ve got experience"' },
      { pattern: /\bI've worked experience\b/gi, fix: '"I have experience working" or "I\'ve worked on"' },
      { pattern: /\bI've skill\b/gi, fix: '"I have skills" or "I\'m skilled at"' },
      { pattern: /\bdid built\b/gi, fix: '"built" or "did build"' },
      { pattern: /\bmore then\b/gi, fix: '"more than"' },
      { pattern: /\bless then\b/gi, fix: '"less than"' },
      { pattern: /\byour's\b/gi, fix: '"yours"' },
      { pattern: /\bit's requirements\b/gi, fix: '"its requirements" (possessive, no apostrophe)' },
      { pattern: /\btheir is\b/gi, fix: '"there is"' },
      { pattern: /\bseems a classic\b/gi, fix: '"seems like a classic"' },
      { pattern: /\bseems a common\b/gi, fix: '"seems like a common"' },
      { pattern: /\bseems a typical\b/gi, fix: '"seems like a typical"' },
      { pattern: /\bI did this before\b/gi, fix: '"I\'ve done this before" (more natural)' },
      { pattern: /\bcan able to\b/gi, fix: '"can" or "am able to"' },
      { pattern: /\bwould able to\b/gi, fix: '"would be able to"' },
    ];
    
    for (const { pattern, fix } of grammarErrors) {
      const match = proposal.match(pattern);
      if (match) {
        return {
          valid: false,
          error: `Grammar error: "${match[0]}" should be ${fix}`
        };
      }
    }
    
    return { valid: true };
  }

  /**
   * Run all production validators - returns first critical error found
   */
  private runProductionValidators(
    proposal: string, 
    intensity: ProposalIntensity,
    job: JobDetails
  ): { valid: boolean; error?: string; validatorName?: string } {
    // 1. Solo pronouns validation (CRITICAL - catches "We" usage)
    const pronounCheck = this.validateSoloPronouns(proposal);
    if (!pronounCheck.valid) return { ...pronounCheck, validatorName: 'validateSoloPronouns' };
    
    // 2. Hallucination check (CRITICAL - catches made-up projects)
    const hallucinationCheck = this.validateNoHallucination(proposal);
    if (!hallucinationCheck.valid) return { ...hallucinationCheck, validatorName: 'validateNoHallucination' };
    
    // 3. Banned AI phrases validation
    const phrasesCheck = this.validateBannedPhrases(proposal);
    if (!phrasesCheck.valid) return { ...phrasesCheck, validatorName: 'validateBannedPhrases' };
    
    // 4. Grammar validation (catches "I've experience" etc.)
    const grammarCheck = this.validateGrammar(proposal);
    if (!grammarCheck.valid) return { ...grammarCheck, validatorName: 'validateGrammar' };
    
    // 5. Signature validation
    const sigCheck = this.validateSignature(proposal, intensity, job.userProfile?.name);
    if (!sigCheck.valid) return { ...sigCheck, validatorName: 'validateSignature' };
    
    // 6. Client name validation (CRITICAL - catches "Hey Abdul" disasters)
    const nameCheck = this.validateClientName(proposal, job.clientName, job.userProfile?.name);
    if (!nameCheck.valid) return { ...nameCheck, validatorName: 'validateClientName' };
    
    // 7. Greeting validation (must have "Hi [Name]," or "Hi there,")
    const greetingCheck = this.validateGreeting(proposal);
    if (!greetingCheck.valid) return { ...greetingCheck, validatorName: 'validateGreeting' };
    
    // 8. Portfolio links validation
    const portfolioCheck = this.validatePortfolioLinks(proposal, job.userProfile);
    if (!portfolioCheck.valid) return { ...portfolioCheck, validatorName: 'validatePortfolioLinks' };
    
    // 9. CTA quality validation (catches "check my profile" and weak CTAs)
    const ctaCheck = this.validateCTA(proposal, intensity);
    if (!ctaCheck.valid) return { ...ctaCheck, validatorName: 'validateCTA' };
    
    // 10. Human tone validation
    const toneCheck = this.validateHumanTone(proposal);
    if (!toneCheck.valid) return { ...toneCheck, validatorName: 'validateHumanTone' };
    
    // 11. Ultra-short length validation (must be SHORT!)
    if (intensity === 'ultra-short') {
      const lengthCheck = this.validateUltraShortLength(proposal);
      if (!lengthCheck.valid) return { ...lengthCheck, validatorName: 'validateUltraShortLength' };
    }
    
    // 12. Check for + and / in text (should be natural language)
    const symbolCheck = this.validateNoCodeSymbols(proposal);
    if (!symbolCheck.valid) return { ...symbolCheck, validatorName: 'validateNoCodeSymbols' };
    
    // 13. Check for generic hooks (must show insight, not just "same here")
    const hookCheck = this.validateHookQuality(proposal);
    if (!hookCheck.valid) return { ...hookCheck, validatorName: 'validateHookQuality' };
    
    // 14. Check for vague proof statements (need specific numbers)
    const proofCheck = this.validateProofSpecificity(proposal);
    if (!proofCheck.valid) return { ...proofCheck, validatorName: 'validateProofSpecificity' };
    
    // 15. Check for multiple projects (resume dumping)
    const resumeDumpCheck = this.validateNoResumeDumping(proposal);
    if (!resumeDumpCheck.valid) return { ...resumeDumpCheck, validatorName: 'validateNoResumeDumping' };
    
    return { valid: true };
  }
  
  /**
   * Validate no resume dumping - only ONE project mentioned
   */
  private validateNoResumeDumping(proposal: string): { valid: boolean; error?: string } {
    const lower = proposal.toLowerCase();
    
    // Patterns that indicate multiple projects
    const multiProjectPatterns = [
      /i also built/i,
      /i've also (built|created|developed)/i,
      /another project/i,
      /i also (created|developed|made)/i,
      /additionally,? i (built|created)/i,
      /plus,? i (built|created)/i,
      /on top of that/i,
    ];
    
    for (const pattern of multiProjectPatterns) {
      if (pattern.test(lower)) {
        return {
          valid: false,
          error: `Resume dumping detected - mentions multiple projects. Pick ONE relevant project and go deep.`
        };
      }
    }
    
    return { valid: true };
  }

  /**
   * Validate ultra-short proposals are actually short
   */
  private validateUltraShortLength(proposal: string): { valid: boolean; error?: string } {
    // Count sentences (roughly)
    const sentences = proposal.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    // Count paragraphs
    const paragraphs = proposal.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    // Count words
    const words = proposal.split(/\s+/).length;
    
    if (sentences.length > 8) {
      return {
        valid: false,
        error: `Ultra-short proposal has ${sentences.length} sentences - should be 3-5 MAX. DELETE some content.`
      };
    }
    
    if (paragraphs.length > 4) {
      return {
        valid: false,
        error: `Ultra-short proposal has ${paragraphs.length} paragraphs - should be 2-3 MAX (greeting + body + signature)`
      };
    }
    
    if (words > 150) {
      return {
        valid: false,
        error: `Ultra-short proposal has ${words} words - should be under 100. CUT IT DOWN.`
      };
    }
    
    return { valid: true };
  }
  
  /**
   * Check for code-like symbols that should be natural language
   */
  private validateNoCodeSymbols(proposal: string): { valid: boolean; error?: string } {
    // Check for + used as "and"
    if (/\w\s+\+\s+\w/.test(proposal)) {
      return {
        valid: false,
        error: 'Uses "+" instead of "and" - write naturally like "Postgres and Redis" not "Postgres + Redis"'
      };
    }
    
    // Check for tech/stack written with /
    if (/\b\w+\/\w+\b/.test(proposal) && !/https?:\/\//.test(proposal)) {
      const match = proposal.match(/\b(\w+\/\w+)\b/);
      if (match && !match[1].includes('://')) {
        return {
          valid: false,
          error: `Uses "/" in "${match[1]}" - write naturally like "Node with TypeScript" not "Node/TypeScript"`
        };
      }
    }
    
    return { valid: true };
  }

  /**
   * Validate hook quality - must show insight, not be generic
   */
  private validateHookQuality(proposal: string): { valid: boolean; error?: string } {
    // Get the first paragraph (the hook)
    const paragraphs = proposal.split(/\n\n+/).filter(p => p.trim());
    if (paragraphs.length < 2) return { valid: true }; // Too short to validate
    
    // The hook is usually the second element (after "Hey —")
    const hookParagraph = paragraphs[1]?.toLowerCase() || '';
    const hookOriginal = paragraphs[1] || '';
    
    // Generic hook patterns that show NO insight
    const genericPatterns = [
      /same here\.?$/,
      /same problem\.?$/,
      /same exact/,
      /\bresonate\b/i,
      /resonate with this/,
      /your needs resonate/i,
      /caught my attention/,
      /piqued my interest/,
      /i've done this before/,
      /i've built this before/,
      /i've built something similar/,
      /built something similar/,
      /i can help with this/,
      /i can definitely help/,
      /i have experience (in|with)/,
      /i've worked on similar/,
      /i've worked on projects that required/,  // NEW: catches "projects that required similar"
      /projects that required similar/,          // NEW
      /worked on projects that required/,        // NEW
      /— same\.?$/,
      /— i agree/,
      /— absolutely/,
      /— exactly/,
      /—\s*me too/,
      // Robotic hook phrases (these sound like templates)
      /the part that trips most/i,
      /the gotcha is/i,
      /the tricky part most miss/i,
      /the tricky part most teams miss/i,
      /the real work is in/i,
      /what most devs miss/i,
      /what most teams miss/i,
      // "Same X" patterns (lazy agreement)
      /same stack,? same/i,
      /same challenges/i,
      /same problem/i,
      /same headache/i,
      /same issue/i,
      // Formal/robotic phrases
      /i dealt with a similar challenge/i,
      /i dealt with the same/i,
      /i dealt with this/i,
      // NEW: Generic "similar expertise" phrases
      /required similar expertise/i,
      /similar expertise/i,
      /expertise in this area/i,
      /experience in this area/i,
    ];
    
    // Filler phrases that waste words and say nothing
    const fillerPatterns = [
      /seems like a great fit/i,
      /looks like a great fit/i,
      /sounds like a great fit/i,
      /perfect fit for/i,
      /great match for/i,
      /this is right up my alley/i,
      /i'd be a great fit/i,
      // NEW: Phrases that sound eager but say nothing
      /i'd love to discuss/i,
      /i would love to discuss/i,
      /i'd be happy to discuss/i,
      /i'd love to help/i,
      /i'd love to work on/i,
      /i'm excited to/i,
      /i'm thrilled to/i,
    ];
    
    const fullProposal = proposal.toLowerCase();
    for (const pattern of fillerPatterns) {
      if (pattern.test(fullProposal)) {
        return {
          valid: false,
          error: `Filler phrase detected. Delete it - it says nothing and wastes words. Show don't tell.`
        };
      }
    }
    
    for (const pattern of genericPatterns) {
      if (pattern.test(hookParagraph)) {
        return {
          valid: false,
          error: `Generic hook detected. Don't just say "same here" - tell a quick story. Example: "Ran into this last month — turned out the bottleneck was X" or use a specific number.`
        };
      }
    }
    
    // Check if hook ends with just "same here" or similar (even after more text)
    const hookSentences = hookParagraph.split(/[.!?]+/).filter(s => s.trim());
    const firstSentence = hookSentences[0] || '';
    
    // If the first sentence after the quote just says "same here" with nothing else meaningful
    if (/—\s*(same here|same|me too|agreed|exactly|absolutely)\s*[.!]?$/i.test(firstSentence) && firstSentence.length < 100) {
      return {
        valid: false,
        error: `Hook too generic - just saying "same here" doesn't spark curiosity. Tell a quick story: "I hit this last month when building X" or share a specific number.`
      };
    }
    
    // Check for lazy quoting pattern: starts with quoted job text + comma + generic insight
    // Match both straight quotes "" and curly quotes ""
    if (/^[""][^"""]+[""],?\s*(the tricky|the hard|the challenge|the real|most teams miss|most devs miss)/i.test(hookOriginal)) {
      // Check if there's actual specific insight after the quote
      const afterQuote = hookOriginal.replace(/^[""][^"""]+[""],?\s*/i, '');
      // If the insight is vague (no numbers, no specific tech, no specific problem)
      const hasSpecifics = /\d+\s*(ms|seconds|%|users|calls|requests|tenants|transactions|\$)|latency|throughput|scale|concurrent|real-time|websocket|RBAC|compliance|audit/i.test(afterQuote);
      if (!hasSpecifics && afterQuote.length < 100) {
        return {
          valid: false,
          error: `Hook quotes job but lacks specific insight. Instead of template phrases, tell a quick story with specific details (numbers, scale, architecture challenges).`
        };
      }
    }
    
    // Check for Hey, "quoted text" pattern without meaningful follow-up
    if (/^hey,?\s*[""][^""]+[""]/i.test(hookOriginal)) {
      // Get everything after the quote
      const afterQuote = hookOriginal.replace(/^hey,?\s*[""][^""]+[""]\s*,?\s*/i, '');
      // If what follows is vague or too short
      if (afterQuote.length < 40) {
        return {
          valid: false,
          error: `Hook quotes job but needs more substance. After quoting, add specific insight about WHY this is hard or what most people miss.`
        };
      }
    }
    
    return { valid: true };
  }

  /**
   * Validate proof statements have specific scale/numbers, not vague descriptions
   */
  private validateProofSpecificity(proposal: string): { valid: boolean; error?: string } {
    const lowerProposal = proposal.toLowerCase();
    
    // NEW: Check for vague project references that sound made up
    const vagueProjectPatterns = [
      { pattern: /had a project where/i, fix: 'Name or link the project' },
      { pattern: /last (quarter|year|month) i (ran into|dealt with|worked on)/i, fix: 'Specify the tech stack or link the project' },
      { pattern: /for a saas/i, fix: 'Link the actual project or name it' },
      { pattern: /on a recent project/i, fix: 'Which project? Link it.' },
      { pattern: /i ran into this (recently|last)/i, fix: 'Name the specific project and tech stack' },
    ];
    
    for (const { pattern, fix } of vagueProjectPatterns) {
      const match = proposal.match(pattern);
      if (match) {
        return {
          valid: false,
          error: `Vague project reference: "${match[0]}" sounds made up. ${fix}.`
        };
      }
    }
    
    // Check if proposal mentions building/creating something
    const mentionsWork = /\b(built|created|developed|shipped|wrapped|worked on|implemented|designed)\b/i.test(proposal);
    
    if (mentionsWork) {
      // Vague patterns that lack specificity
      const vaguePatterns = [
        /\b(multi-tenant|enterprise|production|scalable|robust)\s+(app|application|system|platform|saas|software)\b/i,
        /\b(fintech|e-commerce|healthcare|real-time|AI-powered)\s+(app|application|system|platform|saas|software)\b/i,
        // NEW: Vague "a system that [verb]" patterns
        /a system that (integrated|handled|managed|processed|supported)/i,
        /a platform that (integrated|handled|managed|processed|supported)/i,
        /a tool that (integrated|handled|managed|processed|supported)/i,
        // NEW: Buzzword-heavy vague claims
        /reliable performance and safety/i,
        /ensuring reliable performance/i,
        /with a solid routing layer/i,
        /a solid.*layer/i,
        /integrated ai models/i,
        /integrating ai models/i,
      ];
      
      // Check if ANY vague pattern exists
      let hasVaguePattern = false;
      let vagueMatch = '';
      for (const pattern of vaguePatterns) {
        const match = proposal.match(pattern);
        if (match) {
          hasVaguePattern = true;
          vagueMatch = match[0];
          break;
        }
      }
      
      if (hasVaguePattern) {
        // Check if there are specific numbers nearby (within 200 chars)
        const contextWindow = 200;
        const matchIndex = proposal.toLowerCase().indexOf(vagueMatch.toLowerCase());
        const context = proposal.slice(Math.max(0, matchIndex - contextWindow), Math.min(proposal.length, matchIndex + contextWindow));
        
        // Look for specific scale numbers
        const hasNumbers = /\d+[\s-]*(tenant|user|customer|transaction|request|call|API|endpoint|ms|second|%|uptime|million|thousand|TB|GB|model|route|token)s?/i.test(context);
        const hasMoneyScale = /\$\d+[KMB]?/i.test(context);
        
        if (!hasNumbers && !hasMoneyScale) {
          return {
            valid: false,
            error: `Vague proof: "${vagueMatch}" needs specifics. HOW MANY models? HOW MANY requests? WHAT metrics improved? Add scale numbers.`
          };
        }
      }
      
      // NEW: Check if "I built" is followed by vague description without numbers
      const builtMatch = proposal.match(/i built (a|an) [^.]{10,60}\./i);
      if (builtMatch) {
        const builtStatement = builtMatch[0];
        // Check if this built statement has any numbers
        if (!/\d+/.test(builtStatement)) {
          return {
            valid: false,
            error: `"${builtStatement.slice(0, 50)}..." lacks specifics. Every "I built X" needs numbers: how many users? what scale? what metrics?`
          };
        }
      }
    }
    
    return { valid: true };
  }

  /**
   * Parse job posting with AI to extract structured data
   */
  private async parseJobWithAI(description: string): Promise<{ data: ParsedJobData | null; tokensUsed: number }> {
    try {
      const result = await this.callAgent(
        JOB_PARSER_PROMPT,
        `Parse this Upwork job posting:\n\n${description}`
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
   * Match user profile to job requirements - extract only relevant parts
   */
  private async matchProfileToJob(
    profile: UserProfile,
    parsedJob: ParsedJobData | null,
    jobDescription: string
  ): Promise<{ data: MatchedProfileData | null; tokensUsed: number }> {
    try {
      // Build a summary of what the job needs
      let jobSummary = '';
      if (parsedJob) {
        jobSummary = `## JOB REQUIREMENTS SUMMARY:
- Must-have skills: ${parsedJob.mustHaveSkills?.join(', ') || 'Not specified'}
- Nice-to-have skills: ${parsedJob.niceToHaveSkills?.join(', ') || 'Not specified'}
- Pain points: ${parsedJob.painPoints?.join('; ') || 'Not specified'}
- Client cares about: "${parsedJob.uniqueHookLine || 'Not specified'}"
`;
      } else {
        jobSummary = `## JOB DESCRIPTION:\n${jobDescription.substring(0, 2000)}`;
      }

      // Build full profile content
      let profileContent = '## FREELANCER PROFILE:\n\n';
      
      if (profile.title) profileContent += `**Title:** ${profile.title}\n`;
      if (profile.summary) profileContent += `**Summary:** ${profile.summary}\n`;
      if (profile.yearsExperience) profileContent += `**Years Experience:** ${profile.yearsExperience}\n`;
      if (profile.skills?.length) profileContent += `**Skills:** ${profile.skills.join(', ')}\n`;
      if (profile.specializations?.length) profileContent += `**Specializations:** ${profile.specializations.join(', ')}\n`;
      if (profile.achievements?.length) {
        profileContent += `**Achievements:**\n${profile.achievements.map(a => `- ${a}`).join('\n')}\n`;
      }
      if (profile.pastClients?.length) profileContent += `**Past Clients:** ${profile.pastClients.join(', ')}\n`;
      if (profile.certifications?.length) profileContent += `**Certifications:** ${profile.certifications.join(', ')}\n`;
      
      // Include resume and additional details - this is where the gold is
      if (profile.resumeText) {
        profileContent += `\n**RESUME/CV:**\n${profile.resumeText}\n`;
      }
      if (profile.additionalDetails) {
        profileContent += `\n**ADDITIONAL DETAILS/CASE STUDIES:**\n${profile.additionalDetails}\n`;
      }

      const result = await this.callAgent(
        PROFILE_MATCHER_PROMPT,
        `${jobSummary}\n\n${profileContent}\n\nExtract ONLY the most relevant parts of this profile for the job.`
      );

      if (!result.success) {
        console.error('Profile matcher failed:', result.error);
        return { data: null, tokensUsed: 0 };
      }

      // Parse JSON response
      const cleaned = result.content.trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as MatchedProfileData;
          return { data: parsed, tokensUsed: result.totalTokens };
        } catch (parseError) {
          console.error('Failed to parse matched profile JSON:', parseError);
          return { data: null, tokensUsed: result.totalTokens };
        }
      }
      return { data: null, tokensUsed: result.totalTokens };
    } catch (error) {
      console.error('Profile matching failed:', error);
      return { data: null, tokensUsed: 0 };
    }
  }

  /**
   * Convert RAG profile data to MatchedProfileData format
   * This bridges the vector search results with the existing prompt builder
   */
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

    // Best matching project from vector search
    if (ragProfile.bestProject) {
      const chunk = ragProfile.bestProject.chunk;
      result.bestMatchingProject = {
        description: chunk.text,
        relevance: `Semantic similarity: ${(ragProfile.bestProject.score * 100).toFixed(1)}%`,
        metrics: chunk.metadata?.metrics?.join(', ') || null,
      };
      
      // Use the best project text as the proof statement
      result.suggestedProofStatement = chunk.text;
    }

    // Achievements (take the best one)
    if (ragProfile.achievements.length > 0) {
      result.strongestAchievement = ragProfile.achievements[0].chunk.text;
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
   * Extract screening questions from job description (legacy - kept for fallback)
   */
  private async extractScreeningQuestions(description: string): Promise<string[]> {
    try {
      const result = await this.callAgent(
        QUESTION_EXTRACTOR_PROMPT,
        `Extract screening questions from this job posting:\n\n${description}`
      );
      
      if (!result.success) return [];
      
      // Parse JSON response
      const cleaned = result.content.trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        return JSON.parse(match[0]);
      }
      return [];
    } catch (error) {
      console.error('Question extraction failed:', error);
      return [];
    }
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
   * Call an agent (LLM)
   */
  private async callAgent(systemPrompt: string, userPrompt: string): Promise<LoadBalancerResult> {
    return this.loadBalancer.chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        temperature: 0.7,
        maxTokens: 2000,
      }
    );
  }

  /**
   * Build writer prompt
   */
  /**
   * Build writer prompt using AI-parsed job data
   */
  private buildWriterPromptWithParsedData(
    job: JobDetails, 
    parsedData: ParsedJobData, 
    length: ProposalLength,
    matchedProfile?: MatchedProfileData | null,
    intensity?: ProposalIntensity,
    githubProjectsPrompt?: string,
    learnedWarningsPrompt?: string,
    reviewerFeedback?: string
  ): string {
    const actualIntensity = intensity || (length === 'short' ? 'ultra-short' : 'full');
    let prompt = `## INTENSITY: ${actualIntensity.toUpperCase()}\n\n`;
    
    if (actualIntensity === 'ultra-short') {
      prompt += `Write a 3-5 sentence ultra-short proposal (Evan Fisher style).\n\n`;
    } else {
      prompt += `Write a 200-300 word full proposal (Josh Burns style).\n\n`;
    }
    
    // 🔴 INJECT REVIEWER FEEDBACK IF THIS IS A REWRITE
    if (reviewerFeedback) {
      prompt += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n`;
      prompt += `┃  🔄 THIS IS A REWRITE - PREVIOUS ATTEMPT FAILED     \n`;
      prompt += `┃  READ THE FEEDBACK BELOW AND FIX THE ISSUES        \n`;
      prompt += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n`;
      prompt += `## 🚨 REVIEWER FEEDBACK ON PREVIOUS ATTEMPT:\n\n`;
      prompt += reviewerFeedback;
      prompt += `\n\n---\n\n`;
      prompt += `Now rewrite the proposal addressing ALL the issues above.\n\n`;
    }
    
    // 🔴 INJECT LEARNED WARNINGS FIRST - before anything else!
    if (learnedWarningsPrompt) {
      prompt += `\n${learnedWarningsPrompt}\n`;
      prompt += `---\n\n`;
    }
    
    // Don't include the full job description to avoid confusing the AI with numbers
    // Instead, include a summary
    prompt += `## JOB SUMMARY:\n`;
    prompt += `Title: ${job.title}\n`;
    if (job.budget) prompt += `Budget: ${job.budget}\n`;
    prompt += `\n`;
    
    prompt += `## 🎯 AI-PARSED KEY INFORMATION:\n\n`;
    
    // Client name - make this VERY explicit with visual emphasis
    const clientName = parsedData.clientName || job.clientName;
    if (clientName && clientName.toLowerCase() !== 'unknown' && clientName.length > 1 && !/^\d+$/.test(clientName)) {
      prompt += `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n`;
      prompt += `┃  ⚠️  CLIENT NAME = "${clientName}"                    \n`;
      prompt += `┃  YOUR FIRST LINE MUST BE: "Hi ${clientName},"         \n`;
      prompt += `┃  DO NOT USE ANY OTHER NAME OR NUMBER!               \n`;
      prompt += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n`;
    } else {
      prompt += `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n`;
      prompt += `┃  ⚠️  NO CLIENT NAME FOUND                           \n`;
      prompt += `┃  YOUR FIRST LINE MUST BE: "Hi there,"              \n`;
      prompt += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n`;
    }
    
    // Unique hook line (the gold!)
    if (parsedData.uniqueHookLine) {
      prompt += `✅ **THEIR GOLDEN LINE (USE THIS!):** "${parsedData.uniqueHookLine}"\n`;
      prompt += `   → Quote or reference this in your opening! This is what they CARE about most.\n\n`;
    }
    
    // Pain points
    if (parsedData.painPoints && parsedData.painPoints.length > 0) {
      prompt += `✅ **CLIENT'S PAIN POINTS:**\n`;
      parsedData.painPoints.forEach((pain, i) => {
        prompt += `   ${i + 1}. ${pain}\n`;
      });
      prompt += `   → Address at least ONE pain point directly in your proposal\n\n`;
    }
    
    // Must-have skills
    if (parsedData.mustHaveSkills && parsedData.mustHaveSkills.length > 0) {
      prompt += `✅ **MUST-HAVE SKILLS:** ${parsedData.mustHaveSkills.join(', ')}\n`;
      prompt += `   → Show proof for AT LEAST the first 2 if you have it\n\n`;
    }
    
    // Nice-to-have skills
    if (parsedData.niceToHaveSkills && parsedData.niceToHaveSkills.length > 0) {
      prompt += `📌 **NICE-TO-HAVE SKILLS:** ${parsedData.niceToHaveSkills.join(', ')}\n`;
      prompt += `   → Mention if you have these (bonus points!)\n\n`;
    }
    
    // Budget
    const budget = parsedData.budget?.amount || job.budget;
    if (budget) {
      prompt += `💰 **BUDGET:** ${budget}`;
      if (parsedData.budget?.type) {
        prompt += ` (${parsedData.budget.type})`;
      }
      prompt += `\n   → Stay realistic to this number!\n\n`;
    }
    
    // Timeline
    if (parsedData.timeline) {
      prompt += `⏰ **TIMELINE:** ${parsedData.timeline}\n`;
      prompt += `   → Mention you can meet this timeline in your CTA\n\n`;
    }
    
    // Client quality assessment
    if (parsedData.clientQuality) {
      prompt += `📊 **CLIENT ASSESSMENT:**\n`;
      prompt += `   - Quality: ${parsedData.clientQuality.rating || 'Unknown'}\n`;
      if (parsedData.clientQuality.positives && parsedData.clientQuality.positives.length > 0) {
        prompt += `   - Positives: ${parsedData.clientQuality.positives.join(', ')}\n`;
      }
      prompt += `\n`;
    }
    
    // Red flags (for awareness, not to include in proposal)
    if (parsedData.redFlags && parsedData.redFlags.length > 0) {
      prompt += `⚠️ **RED FLAGS (be cautious but still professional):**\n`;
      parsedData.redFlags.forEach(flag => {
        prompt += `   - ${flag}\n`;
      });
      prompt += `\n`;
    }
    
    prompt += `---\n\n`;
    
    // Add matched profile (focused, relevant data only)
    if (matchedProfile) {
      prompt += `## 🎯 YOUR RELEVANT EXPERIENCE (AI-matched to this job):\n\n`;
      
      // Suggested proof statement (ready to use!)
      if (matchedProfile.suggestedProofStatement) {
        prompt += `✅ **READY-TO-USE PROOF STATEMENT:**\n`;
        prompt += `   "${matchedProfile.suggestedProofStatement}"\n`;
        prompt += `   → Use this or adapt it for your opening!\n\n`;
      }
      
      // Best matching project
      if (matchedProfile.bestMatchingProject) {
        prompt += `✅ **YOUR MOST RELEVANT PROJECT:**\n`;
        prompt += `   ${matchedProfile.bestMatchingProject.description}\n`;
        if (matchedProfile.bestMatchingProject.metrics) {
          prompt += `   📊 Metrics: ${matchedProfile.bestMatchingProject.metrics}\n`;
        }
        prompt += `   🎯 Why relevant: ${matchedProfile.bestMatchingProject.relevance}\n\n`;
      }
      
      // Relevant skills (matched to job)
      if (matchedProfile.relevantSkills && matchedProfile.relevantSkills.length > 0) {
        prompt += `✅ **YOUR MATCHING SKILLS:** ${matchedProfile.relevantSkills.join(', ')}\n\n`;
      }
      
      // Strongest achievement
      if (matchedProfile.strongestAchievement) {
        prompt += `✅ **YOUR STRONGEST ACHIEVEMENT:** ${matchedProfile.strongestAchievement}\n\n`;
      }
      
      // Certifications
      if (matchedProfile.relevantCertifications && matchedProfile.relevantCertifications.length > 0) {
        prompt += `📜 **RELEVANT CERTIFICATIONS:** ${matchedProfile.relevantCertifications.join(', ')}\n\n`;
      }
      
      // Social proof
      if (matchedProfile.socialProof) {
        if (matchedProfile.socialProof.notableClients && matchedProfile.socialProof.notableClients.length > 0) {
          prompt += `🏆 **NOTABLE CLIENTS:** ${matchedProfile.socialProof.notableClients.join(', ')}\n`;
        }
        if (matchedProfile.socialProof.yearsInDomain) {
          prompt += `📅 **YEARS IN THIS DOMAIN:** ${matchedProfile.socialProof.yearsInDomain}\n`;
        }
        prompt += `\n`;
      }
      
      // Unique value proposition
      if (matchedProfile.uniqueValueProposition) {
        prompt += `💎 **YOUR UNIQUE VALUE:** ${matchedProfile.uniqueValueProposition}\n\n`;
      }

      // GitHub Projects (if available) - REAL projects to prevent hallucination
      if (job.userProfile?.githubProjects && job.userProfile.githubProjects.length > 0) {
        prompt += this.buildGitHubProjectsSection(job.userProfile.githubProjects, parsedData);
      }

      prompt += `⚠️ CRITICAL:\n`;
      prompt += `- Use the PROOF STATEMENT above or adapt it naturally\n`;
      prompt += `- Do NOT say "As a seasoned..." or use generic phrases\n`;
      if (job.userProfile?.timezone) {
        prompt += `- Use your timezone (${job.userProfile.timezone}) for the CTA\n`;
      }
      prompt += `\n`;
    } else if (job.userProfile) {
      // Fallback to full profile if matching failed
      prompt += `## YOUR PROFILE DATA:\n`;
      prompt += this.buildProfileSection(job.userProfile);
      
      // GitHub Projects - prefer RAG-retrieved projects, fallback to static
      if (githubProjectsPrompt) {
        // Use RAG-retrieved projects from knowledge base (better matching)
        prompt += `\n${githubProjectsPrompt}\n`;
      } else if (job.userProfile.githubProjects && job.userProfile.githubProjects.length > 0) {
        // Fallback to static projects if RAG not available
        prompt += this.buildGitHubProjectsSection(job.userProfile.githubProjects, parsedData);
      }
      
      prompt += `\n⚠️ CRITICAL:\n`;
      prompt += `- Pick ONE achievement/project that matches their MUST-HAVE skills\n`;
      prompt += `- Reference their pain point when showing your proof\n`;
      prompt += `- Do NOT say "As a seasoned..." or copy profile text verbatim\n`;
      prompt += `- Use your timezone for the CTA (e.g., "I can call tomorrow at 10am ${job.userProfile.timezone || 'your time'}")\n\n`;
    } else {
      prompt += `## YOUR PROFILE: Not provided.\n`;
      
      // Still try to add GitHub projects if available via RAG
      if (githubProjectsPrompt) {
        prompt += `\n${githubProjectsPrompt}\n`;
      }
      
      prompt += `⚠️ CRITICAL: DO NOT MAKE UP PROJECT NAMES, CLIENT NAMES, OR SPECIFIC METRICS.\n`;
      prompt += `Instead, use phrases like:\n`;
      prompt += `- "a similar project last year" (not "for a fintech client" or specific company names)\n`;
      prompt += `- "reduced processing time significantly" (not "by 47%" unless you have real data)\n`;
      prompt += `- Sign with "[Your Name]" since no name was provided\n\n`;
    }
    
    // Determine the signature name
    const signatureName = job.userProfile?.name || job.userProfile?.customSignature || 'Your Name';
    
    // NOTE: learnedWarningsPrompt is now injected at the TOP of the prompt (see above)
    
    prompt += `---\n\n`;
    prompt += `## NOW WRITE THE PROPOSAL:\n`;
    prompt += `Remember:\n`;
    prompt += `- Start with "Hi ${clientName && clientName.toLowerCase() !== 'unknown' ? clientName : 'there'}," then reference THEIR unique line\n`;
    prompt += `- Address their #1 pain point with YOUR specific proof\n`;
    prompt += `- NO banned phrases (I'm excited, As a seasoned, I am confident, etc.)\n`;
    prompt += `- NO defensive language ("despite being in...", "available to help", "feel free")\n`;
    prompt += `- Include portfolio links to relevant work (REQUIRED - 9x hire rate boost)\n`;
    prompt += `- ${length === 'short' ? '80-150 words, no PS' : '200-300 words with P.S.'}\n`;
    prompt += `- ${actualIntensity === 'full' ? 'SIGN WITH: "Best regards,\\n' + signatureName + '"' : 'SIGN WITH: "— ' + signatureName + '"'} (FULL NAME!)\n`;

    return prompt;
  }

  /**
   * Legacy writer prompt builder (fallback if parsing fails)
   * Now simplified - AI will extract client name, unique lines, budget dynamically
   */
  private buildWriterPrompt(job: JobDetails, length: ProposalLength, intensity?: ProposalIntensity, learnedWarningsPrompt?: string, reviewerFeedback?: string): string {
    // Don't use hardcoded regex - let the AI extract everything dynamically
    const clientName = job.clientName;
    const budgetInfo = job.budget || '';
    const actualIntensity = intensity || (length === 'short' ? 'ultra-short' : 'full');

    let prompt = `## INTENSITY: ${actualIntensity.toUpperCase()}\n\n`;
    
    if (actualIntensity === 'ultra-short') {
      prompt += `Write a 3-5 sentence ultra-short proposal (Evan Fisher style).\n\n`;
    } else {
      prompt += `Write a 200-300 word full proposal (Josh Burns style).\n\n`;
    }
    
    // 🔴 INJECT REVIEWER FEEDBACK IF THIS IS A REWRITE
    if (reviewerFeedback) {
      prompt += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n`;
      prompt += `┃  🔄 THIS IS A REWRITE - PREVIOUS ATTEMPT FAILED     \n`;
      prompt += `┃  READ THE FEEDBACK BELOW AND FIX THE ISSUES        \n`;
      prompt += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n`;
      prompt += `## 🚨 REVIEWER FEEDBACK ON PREVIOUS ATTEMPT:\n\n`;
      prompt += reviewerFeedback;
      prompt += `\n\n---\n\n`;
      prompt += `Now rewrite the proposal addressing ALL the issues above.\n\n`;
    }
    
    // 🔴 INJECT LEARNED WARNINGS FIRST - before anything else!
    if (learnedWarningsPrompt) {
      prompt += `\n${learnedWarningsPrompt}\n`;
      prompt += `---\n\n`;
    }
    
    prompt += `## JOB POST:\n${job.description}\n\n`;
    prompt += `---\n\n`;
    
    prompt += `## YOUR TASKS (DO THIS YOURSELF - I'm not pre-extracting for you):\n\n`;
    prompt += `1. **FIND CLIENT NAME:** Look in the reviews section for names like "working with [Name]" or "It was great working with [Name]". If no clear human first name is found, use "there".\n\n`;
    prompt += `2. **FIND THEIR UNIQUE LINE:** Read the job post carefully - find ONE sentence that shows what they REALLY care about. Often in "Why This Project Is Different" or emotional/values-based language.\n\n`;
    prompt += `3. **UNDERSTAND THEIR PAIN:** What problems are they trying to solve? What frustrates them?\n\n`;
    
    if (clientName) {
      prompt += `✓ **HINT - CLIENT NAME:** I found "${clientName}" - verify this is correct!\n\n`;
    }
    
    if (budgetInfo) {
      prompt += `✓ **BUDGET:** ${budgetInfo}\n  → Stay realistic to this number!\n\n`;
    }
    
    prompt += `---\n\n`;
    
    // Add freelancer profile
    if (job.userProfile) {
      prompt += `## YOUR PROFILE DATA:\n`;
      prompt += this.buildProfileSection(job.userProfile);
      prompt += `\n⚠️ CRITICAL: \n`;
      prompt += `- Pick ONE achievement/project from above that's RELEVANT to this job\n`;
      prompt += `- Rewrite it naturally - do NOT say "As a seasoned..." or copy profile text verbatim\n`;
      prompt += `- Use your timezone/availability for the CTA (e.g., "I can call tomorrow at 10am ${job.userProfile.timezone || 'your time'}")\n\n`;
    } else {
      prompt += `## YOUR PROFILE: Not provided.\n`;
      prompt += `⚠️ CRITICAL: DO NOT MAKE UP PROJECT NAMES, CLIENT NAMES, OR SPECIFIC METRICS.\n`;
      prompt += `Instead, use phrases like:\n`;
      prompt += `- "a similar project last year" (not "for a fintech client" or invented names)\n`;
      prompt += `- "reduced processing time significantly" (not fake percentages)\n\n`;
    }

    // Determine the signature name
    const signatureName = job.userProfile?.name || job.userProfile?.customSignature || '[Your Name]';

    // NOTE: learnedWarningsPrompt is now injected at the TOP of the prompt

    prompt += `---\n\n`;
    prompt += `## NOW WRITE THE PROPOSAL:\n`;
    prompt += `Remember:\n`;
    prompt += `- Find the client name yourself from reviews, then start with "Hi [Name],"\n`;
    prompt += `- Quote or reference THEIR unique line in your hook\n`;
    prompt += `- NO banned phrases (I'm excited, As a seasoned, I am confident, etc.)\n`;
    prompt += `- NO defensive language ("despite being in...", "available to help", "feel free")\n`;
    prompt += `- ${length === 'short' ? '80-150 words, no PS' : '200-300 words with P.S.'}\n`;
    prompt += `- Include ONE specific proof with numbers AND portfolio link\n`;
    prompt += `- ${actualIntensity === 'full' ? 'SIGN WITH: "Best regards,\\n' + signatureName + '"' : 'SIGN WITH: "— ' + signatureName + '"'} (FULL NAME, DO NOT MAKE UP!)\n\n`;
    prompt += `Output ONLY the proposal:`;

    return prompt;
  }

  /**
   * Build review prompt - includes profile data for hallucination verification
   */
  private buildReviewPrompt(job: JobDetails, proposal: string, length: ProposalLength, githubProjectsPrompt?: string): string {
    let prompt = `## JOB CONTEXT:
**Title:** ${job.title}
**Client Name:** ${job.clientName || 'Unknown'}
**Budget:** ${job.budget || 'Not specified'}

**Job Description (first 500 chars):**
${job.description.substring(0, 500)}...

## PROPOSAL TO REVIEW:
${proposal}

## LENGTH TYPE: ${length.toUpperCase()} (${length === 'short' ? '80-150 words' : '200-350 words'})

## ═══════════════════════════════════════════════════════════
## FREELANCER'S ACTUAL DATA (USE THIS TO VERIFY CLAIMS)
## ═══════════════════════════════════════════════════════════
`;

    // Add profile data for verification
    if (job.userProfile) {
      prompt += `\n### PROFILE DATA:\n`;
      if (job.userProfile.title) prompt += `- Title: ${job.userProfile.title}\n`;
      if (job.userProfile.summary) prompt += `- Summary: ${job.userProfile.summary}\n`;
      if (job.userProfile.yearsExperience) prompt += `- Years Experience: ${job.userProfile.yearsExperience}\n`;
      if (job.userProfile.skills?.length) prompt += `- Skills: ${job.userProfile.skills.join(', ')}\n`;
      if (job.userProfile.achievements?.length) {
        prompt += `\n### ACHIEVEMENTS (verifiable claims):\n`;
        job.userProfile.achievements.forEach((a, i) => prompt += `  ${i + 1}. ${a}\n`);
      }
      if (job.userProfile.pastClients?.length) {
        prompt += `\n### PAST CLIENTS (can reference):\n`;
        job.userProfile.pastClients.forEach(c => prompt += `  - ${c}\n`);
      }
      if (job.userProfile.certifications?.length) {
        prompt += `\n### CERTIFICATIONS:\n`;
        job.userProfile.certifications.forEach(c => prompt += `  - ${c}\n`);
      }
      if (job.userProfile.additionalDetails) {
        prompt += `\n### ADDITIONAL DETAILS (truncated):\n${job.userProfile.additionalDetails.substring(0, 2000)}\n`;
      }
    } else {
      prompt += `\n(No profile data provided - ANY specific project claim is likely hallucination)\n`;
    }

    // Add GitHub projects if available
    if (githubProjectsPrompt) {
      prompt += `\n### GITHUB PROJECTS (verifiable):\n${githubProjectsPrompt}\n`;
    }

    prompt += `\n## ═══════════════════════════════════════════════════════════\n\n`;
    prompt += `## YOUR TASK:\n`;
    prompt += `1. **HALLUCINATION CHECK (CRITICAL)**: Does EVERY claim in the proposal match the data above?\n`;
    prompt += `   - If proposal says "built a booking system for a beauty chain" - is this in the data? \n`;
    prompt += `   - If proposal says "63% open rates" - is this exact metric in the data?\n`;
    prompt += `   - If proposal says "8 months without flagging" - is this verifiable?\n`;
    prompt += `   - ANY unverifiable specific claim = HALLUCINATION = SCORE 0\n\n`;
    prompt += `2. **DOMAIN RELEVANCE CHECK (CRITICAL)**: Is the claimed project relevant to the JOB?\n`;
    prompt += `   - Job: "Front-end engineer for e-commerce" + Proposal: "email automation" = IRRELEVANT = SCORE 0\n`;
    prompt += `   - Job: "Mobile app" + Proposal: "WordPress plugin" = IRRELEVANT = SCORE 0\n`;
    prompt += `   - Job: "React dashboard" + Proposal: "React analytics dashboard" = RELEVANT ✓\n`;
    prompt += `   - If project is from completely different domain, FLAG as irrelevantProject = true\n\n`;
    prompt += `3. Check for banned phrases, AI-sounding language, grammar errors\n`;
    prompt += `4. Verify it sounds human\n\n`;
    prompt += `Be EXTREMELY strict about hallucination AND relevance. When in doubt, FAIL.`;

    return prompt;
  }

  /**
   * Build refiner prompt - uses job title only to avoid metadata confusion
   */
  private buildRefinerPrompt(job: JobDetails, proposal: string, feedback: string, length: ProposalLength): string {
    let prompt = `## JOB CONTEXT:
**Title:** ${job.title}
**Client Name:** ${job.clientName || 'Unknown'}

## ORIGINAL PROPOSAL:
${proposal}

## REVIEWER FEEDBACK:
${feedback}

## FREELANCER PROFILE:`;

    prompt += this.buildProfileSection(job.userProfile);

    prompt += `\n---\n## REWRITE INSTRUCTIONS:\n\n`;
    prompt += `1. Fix ALL issues mentioned in the feedback\n`;
    prompt += `2. Make it sound MORE HUMAN\n`;
    prompt += `3. **CRITICAL - NO HALLUCINATION**: \n`;
    prompt += `   - If the feedback mentions "hallucination", you MUST remove the fake claim\n`;
    prompt += `   - Replace specific fake claims with vague language: "built something similar", "worked on a related project"\n`;
    prompt += `   - ONLY use projects/metrics that exist in the FREELANCER PROFILE above\n`;
    prompt += `4. **CRITICAL - NO METADATA NUMBERS**: \n`;
    prompt += `   - NEVER use numbers from job post metadata ("231 proposals", "50+ applicants", "posted 33 minutes ago")\n`;
    prompt += `   - These are NOT job requirements - don't treat "231 proposals" as "231 stores to manage"\n`;
    prompt += `   - Only use numbers FROM YOUR PROFILE or explicitly stated in job description\n`;
    prompt += `5. Length: ${length === 'short' ? '80-150 words' : '200-350 words'}\n\n`;
    prompt += `IMPORTANT: Do NOT reference any numbers from job metadata (like "33 minutes", "50+ proposals", "231 applicants"). Only use numbers FROM YOUR PROFILE DATA or EXPLICITLY in job description.\n\n`;
    prompt += `Output ONLY the proposal text.`;

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
    
    // Header with instructions
    section += `### USE THIS DATA FOR YOUR PROOF (but rewrite, don't copy):\n\n`;
    
    if (profile.title) {
      section += `**Your Title:** ${profile.title}\n`;
    }
    
    if (profile.summary) {
      section += `**Your Summary:** ${profile.summary}\n`;
    }
    
    if (profile.yearsExperience) {
      section += `**Years of Experience:** ${profile.yearsExperience} (use this number!)\n`;
    }
    
    if (profile.skills && profile.skills.length > 0) {
      section += `**Your Skills:** ${profile.skills.join(', ')}\n`;
    }
    
    if (profile.specializations && profile.specializations.length > 0) {
      section += `**Your Specializations:** ${profile.specializations.join(', ')}\n`;
    }
    
    if (profile.achievements && profile.achievements.length > 0) {
      section += `\n**⭐ YOUR ACHIEVEMENTS (BEST SOURCE FOR PROOF - pick ONE relevant to this job):**\n`;
      profile.achievements.forEach((a, i) => {
        section += `  ${i + 1}. ${a}\n`;
      });
    }
    
    if (profile.pastClients && profile.pastClients.length > 0) {
      section += `\n**Notable Clients:** ${profile.pastClients.join(', ')}\n`;
    }
    
    if (profile.certifications && profile.certifications.length > 0) {
      section += `**Certifications:** ${profile.certifications.join(', ')}\n`;
    }
    
    if (profile.availability) {
      section += `**Your Availability:** ${profile.availability} (use for CTA or P.S.!)\n`;
    }
    
    if (profile.timezone) {
      section += `**Your Timezone:** ${profile.timezone} (use for scheduling CTA!)\n`;
    }
    
    if (profile.hourlyRate) {
      section += `**Your Rate:** ${profile.hourlyRate}\n`;
    }

    if (profile.preferredTone) {
      section += `\n**TONE PREFERENCE:** Write in a ${profile.preferredTone} tone.\n`;
    }

    if (profile.customSignature) {
      section += `**SIGN OFF WITH:** "${profile.customSignature}"\n`;
    }

    // Resume content - include full text for AI to find relevant experience
    if (profile.resumeText && profile.resumeText.length > 100) {
      section += `\n**📄 RESUME/CV (scan for relevant projects to mention):**\n${profile.resumeText}\n`;
    }

    // Additional details - often contains case studies or specific examples
    if (profile.additionalDetails && profile.additionalDetails.trim()) {
      section += `\n**📝 ADDITIONAL CONTEXT (may contain case studies - USE THESE!):**\n${profile.additionalDetails}\n`;
    }

    return section;
  }

  /**
   * Build GitHub projects section - REAL projects to prevent hallucination
   * This matches GitHub projects to job requirements and provides verified proof
   */
  private buildGitHubProjectsSection(projects: GitHubProject[], parsedJob?: ParsedJobData | null): string {
    if (!projects || projects.length === 0) {
      return '';
    }

    // Match projects to job requirements
    const matchedProjects = this.matchGitHubProjectsToJob(projects, parsedJob);
    
    if (matchedProjects.length === 0) {
      return `\n## ⚠️ GITHUB PROJECTS (none matched this job):\n` +
             `You have ${projects.length} GitHub projects but none closely match this job's requirements.\n` +
             `DO NOT MAKE UP PROJECTS. Use generic phrases like "built similar systems" without specifics.\n\n`;
    }

    let section = `\n## 🔗 YOUR GITHUB PROJECTS — MANDATORY TO INCLUDE!\n`;
    section += `These are REAL projects. You MUST include at least one link or the proposal will be REJECTED.\n\n`;
    
    // Show the BEST matching project prominently
    const bestProject = matchedProjects[0];
    section += `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n`;
    section += `┃  📌 BEST MATCH — USE THIS IN YOUR PROPOSAL:        \n`;
    section += `┃  Name: ${bestProject.name}\n`;
    section += `┃  Link: ${bestProject.url}\n`;
    section += `┃  ${bestProject.description || 'No description'}\n`;
    section += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n`;
    
    section += `**Example usage:** "I built ${bestProject.name} (${bestProject.url}) which [describe relevance]"\n\n`;
    
    if (matchedProjects.length > 1) {
      section += `### Other relevant projects:\n`;
      matchedProjects.slice(1).forEach((project, index) => {
        section += `${index + 2}. ${project.name} — ${project.url}\n`;
        if (project.description && project.description !== 'No description') {
          section += `   ${project.description}\n`;
        }
      });
      section += `\n`;
    }

    section += `⛔ FAILURE TO INCLUDE A GITHUB LINK = INSTANT REJECTION\n`;
    section += `The validator checks for portfolio links. Include at least: ${bestProject.url}\n\n`;

    return section;
  }

  /**
   * Match GitHub projects to job requirements - STRICT RELEVANCE CHECK
   */
  private matchGitHubProjectsToJob(projects: GitHubProject[], parsedJob?: ParsedJobData | null): GitHubProject[] {
    if (!projects || projects.length === 0) return [];
    
    // Get keywords from job
    const keywords: string[] = [];
    if (parsedJob) {
      if (parsedJob.mustHaveSkills) keywords.push(...parsedJob.mustHaveSkills.map(s => s.toLowerCase()));
      if (parsedJob.niceToHaveSkills) keywords.push(...parsedJob.niceToHaveSkills.map(s => s.toLowerCase()));
      // Add pain points as keywords too (for domain matching)
      if (parsedJob.painPoints) {
        parsedJob.painPoints.forEach(p => {
          // Extract key terms from pain points
          const terms = p.toLowerCase().match(/\b(e-?commerce|payment|checkout|dashboard|api|mobile|web|app|data|analytics|saas|crm|cms)\b/g);
          if (terms) keywords.push(...terms);
        });
      }
    }
    
    // DOMAIN KEYWORDS - projects containing these are likely IRRELEVANT to most jobs
    const irrelevantDomains = ['email', 'cold-email', 'outreach', 'scraper', 'bot', 'spam', 'crawler'];

    // Score each project
    const scored = projects.map(project => {
      let score = 0;
      const projectName = project.name.toLowerCase();
      const projectDesc = (project.description || '').toLowerCase();
      
      // PENALTY: Check for irrelevant domain keywords in project name/description
      for (const domain of irrelevantDomains) {
        if (projectName.includes(domain) || projectDesc.includes(domain)) {
          // Only penalize if job doesn't mention this domain
          if (!keywords.some(k => k.includes(domain))) {
            score -= 50; // Heavy penalty for irrelevant projects
          }
        }
      }
      
      // Language match - only give points if language is in required skills
      if (project.language) {
        const lang = project.language.toLowerCase();
        if (keywords.some(k => k === lang || k.includes(lang))) {
          score += 5; // Reduced from 10
        }
      }
      
      // Topic matches - must be exact or very close
      if (project.topics) {
        for (const topic of project.topics) {
          const topicLower = topic.toLowerCase();
          if (keywords.some(k => k === topicLower || topicLower === k)) {
            score += 8; // Exact match
          } else if (keywords.some(k => k.includes(topicLower) || topicLower.includes(k))) {
            score += 3; // Partial match
          }
        }
      }
      
      // Description matches - look for DOMAIN relevance
      if (project.description) {
        const desc = project.description.toLowerCase();
        // Check for domain-specific keywords
        const domainKeywords = ['e-commerce', 'ecommerce', 'payment', 'checkout', 'cart', 'store', 'shop', 'dashboard', 'admin', 'api', 'backend', 'frontend'];
        for (const dk of domainKeywords) {
          if (desc.includes(dk) && keywords.some(k => k.includes(dk) || dk.includes(k))) {
            score += 10; // Strong domain match
          }
        }
      }
      
      // Bonus for stars (social proof)
      if (project.stars > 0) score += Math.min(project.stars, 3);
      
      return { project, score };
    });
    
    // Return top 2 with score > 5 (stricter threshold)
    return scored
      .filter(s => s.score > 5) // Increased from 0
      .sort((a, b) => b.score - a.score)
      .slice(0, 2) // Reduced from 3
      .map(s => s.project);
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
    
    // Apply humanizer to strip remaining AI patterns
    cleaned = this.humanizeProposal(cleaned);
    
    return cleaned.trim();
  }

  /**
   * Strip remaining AI-sounding patterns from the proposal
   * This is a last-line-of-defense to catch patterns the LLM couldn't avoid
   */
  private humanizeProposal(proposal: string): string {
    let result = proposal;
    
    // Replace overly formal transitions with natural alternatives
    const transitions = [
      [/\bFurthermore,?\s*/gi, ''],
      [/\bAdditionally,?\s*/gi, 'Also, '],
      [/\bMoreover,?\s*/gi, ''],
      [/\bIn addition,?\s*/gi, 'Also, '],
      [/\bConsequently,?\s*/gi, 'So '],
      [/\bTherefore,?\s*/gi, 'So '],
      [/\bThus,?\s*/gi, 'So '],
      [/\bNonetheless,?\s*/gi, 'Still, '],
      [/\bNevertheless,?\s*/gi, 'But '],
      [/\bSubsequently,?\s*/gi, 'Then '],
    ];
    
    for (const [pattern, replacement] of transitions) {
      result = result.replace(pattern as RegExp, replacement as string);
    }
    
    // ============================================
    // FIX FANCY PUNCTUATION (AI tells on itself with these)
    // ============================================
    
    // Replace ALL fancy dashes with simple hyphens
    // En-dash (–), Em-dash (—), Minus sign (−), Horizontal bar (―), Figure dash (‒)
    result = result.replace(/[–—−―‒]/g, '-');
    
    // Remove redundant dashes (user may not want ANY dashes)
    // Convert " - " surrounded by spaces to comma or nothing
    result = result.replace(/\s+-\s+/g, ', ');
    
    // Replace fancy quotes with simple ones
    result = result.replace(/[""]/g, '"');
    result = result.replace(/['']/g, "'");
    
    // Replace ellipsis character with three dots
    result = result.replace(/…/g, '...');
    
    // Remove colons in prose (keep in times like "2pm" or "P.S.:")
    // Replace "word: sentence" patterns with "word - sentence" or just remove
    result = result.replace(/(\w)\s*:\s+([A-Z])/g, '$1 - $2');
    
    // ============================================
    // REMOVE AI-SOUNDING PHRASES
    // ============================================
    
    // Replace corporate/AI phrases with human alternatives
    const corporatePhrases = [
      // Confidence phrases
      [/\bI am confident that\b/gi, "I think"],
      [/\bI am confident\b/gi, "I'm pretty sure"],
      [/\bI'm confident that\b/gi, "I think"],
      [/\bI'm confident\b/gi, "I'm pretty sure"],
      
      // Excitement phrases (huge red flag)
      [/\bI am excited to\b/gi, ""],
      [/\bI'm excited to\b/gi, ""],
      [/\bI was excited\b/gi, "I noticed"],
      [/\bI'm intrigued by\b/gi, "I noticed"],
      [/\bI am intrigued by\b/gi, "I noticed"],
      [/\bintrigued by\b/gi, "noticed"],
      
      // Passion phrases
      [/\bI am passionate about\b/gi, "I really like"],
      [/\bI'm passionate about\b/gi, "I really like"],
      
      // Would love phrases
      [/\bI would love to\b/gi, "I'd like to"],
      [/\bI'd love to\b/gi, "I'd like to"],
      
      // Expertise phrases
      [/\bWith my expertise in\b/gi, "With my experience in"],
      [/\bWith my expertise\b/gi, "With my background"],
      [/\bAs a seasoned\b/gi, "As a"],
      [/\bAs an experienced\b/gi, "As a"],
      
      // Alignment phrases
      [/\baligns with my experience\b/gi, "matches what I've done"],
      [/\baligns with your expectations\b/gi, "fits what you're looking for"],
      [/\baligns perfectly with\b/gi, "fits well with"],
      [/\baligns with\b/gi, "matches"],
      
      // Formal reach out phrases
      [/\bI look forward to\b/gi, "Looking forward to"],
      [/\bfeel free to reach out\b/gi, "shoot me a message"],
      [/\bFeel free to reach out\b/gi, "Shoot me a message"],
      [/\bfeel free to\b/gi, "just"],
      [/\bFeel free to\b/gi, "Just"],
      [/\bplease do not hesitate to\b/gi, "just"],
      [/\bPlease do not hesitate to\b/gi, "Just"],
      [/\bdon't hesitate to\b/gi, "just"],
      [/\bDon't hesitate to\b/gi, "Just"],
      
      // Belief phrases  
      [/\bI believe I am\b/gi, "I'm"],
      [/\bI believe that I am\b/gi, "I'm"],
      [/\bI believe\b/gi, "I think"],
      
      // Corporate jargon
      [/\bin my professional capacity\b/gi, ""],
      [/\bLeveraging my\b/gi, "Using my"],
      [/\bleveraging my\b/gi, "using my"],
      [/\bUtilizing my\b/gi, "Using my"],
      [/\butilizing my\b/gi, "using my"],
      [/\butilize\b/gi, "use"],
      [/\bUtilize\b/gi, "Use"],
      [/\bsynergy\b/gi, "fit"],
      [/\bSynergy\b/gi, "Fit"],
      [/\bvalue proposition\b/gi, "what I bring"],
      [/\bValue proposition\b/gi, "What I bring"],
      [/\bdeliver value\b/gi, "help out"],
      [/\bDeliver value\b/gi, "Help out"],
      [/\brobust\b/gi, "solid"],
      [/\bRobust\b/gi, "Solid"],
      [/\bseamless\b/gi, "smooth"],
      [/\bSeamless\b/gi, "Smooth"],
      [/\bstreamline\b/gi, "simplify"],
      [/\bStreamline\b/gi, "Simplify"],
      [/\boptimize\b/gi, "improve"],
      [/\bOptimize\b/gi, "Improve"],
      [/\bfacilitate\b/gi, "help with"],
      [/\bFacilitate\b/gi, "Help with"],
      
      // "I recall" sounds like a robot accessing memory
      [/\bI recall\b/gi, "I remember"],
      [/\bI recollect\b/gi, "I remember"],
      
      // Formal "explore" language
      [/\bI'd like to explore\b/gi, "I'd like to talk about"],
      [/\bI would like to explore\b/gi, "I'd like to talk about"],
      [/\bexplore if\b/gi, "see if"],
      [/\bexplore whether\b/gi, "see if"],
      
      // "If this is a good fit" is template language
      [/\bIf this is a good fit\b/gi, "If you're interested"],
      [/\bif this sounds like a good fit\b/gi, "if you're interested"],
      
      // "I'm here to help" is too salesy
      [/\bI'm here to help\b/gi, "happy to help"],
      [/\bI am here to help\b/gi, "happy to help"],
      
      // Remove "crucial" - sounds like ChatGPT
      [/\bcrucial\b/gi, "important"],
      [/\bCrucial\b/gi, "Important"],
      
      // Remove "significant" - vague AI word
      [/\bsignificantly\b/gi, "a lot"],
      [/\bSignificantly\b/gi, "A lot"],
    ];
    
    for (const [pattern, replacement] of corporatePhrases) {
      result = result.replace(pattern as RegExp, replacement as string);
    }
    
    // ============================================
    // ADD CONTRACTIONS (humans use them)
    // ============================================
    
    result = result.replace(/\bI am a\b/g, "I'm a");
    result = result.replace(/\bI am an\b/g, "I'm an");
    result = result.replace(/\bI am\b/g, "I'm");
    result = result.replace(/\bI have been\b/g, "I've been");
    result = result.replace(/\bI have\b/g, "I've");
    result = result.replace(/\bI will\b/g, "I'll");
    result = result.replace(/\bI would\b/g, "I'd");
    result = result.replace(/\bIt is\b/g, "It's");
    result = result.replace(/\bThat is\b/g, "That's");
    result = result.replace(/\bdo not\b/g, "don't");
    result = result.replace(/\bDo not\b/g, "Don't");
    result = result.replace(/\bcannot\b/g, "can't");
    result = result.replace(/\bCannot\b/g, "Can't");
    result = result.replace(/\bwill not\b/g, "won't");
    result = result.replace(/\bWill not\b/g, "Won't");
    result = result.replace(/\bwould not\b/g, "wouldn't");
    result = result.replace(/\bWould not\b/g, "Wouldn't");
    result = result.replace(/\bcould not\b/g, "couldn't");
    result = result.replace(/\bCould not\b/g, "Couldn't");
    result = result.replace(/\bshould not\b/g, "shouldn't");
    result = result.replace(/\bShould not\b/g, "Shouldn't");
    result = result.replace(/\bthat is\b/g, "that's");
    result = result.replace(/\bwhat is\b/g, "what's");
    result = result.replace(/\bhere is\b/g, "here's");
    result = result.replace(/\bthere is\b/g, "there's");
    result = result.replace(/\blet us\b/g, "let's");
    result = result.replace(/\bLet us\b/g, "Let's");
    
    // ============================================
    // CLEANUP
    // ============================================
    
    // Clean up any double spaces from removals
    result = result.replace(/  +/g, ' ');
    
    // Clean up any lines that became empty or just whitespace
    result = result.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    // Clean up spaces before punctuation
    result = result.replace(/ +([.,!?])/g, '$1');
    
    // Clean up double punctuation
    result = result.replace(/\.+/g, '.');
    result = result.replace(/,,+/g, ',');
    
    return result;
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
