
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables IMMEDIATELY
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function runTest() {
    console.log('🚀 Starting FreelanceMVP Proposal Generation Test...\n');

    // Dynamic import to ensure env vars are loaded first
    const { getMultiAgentGenerator } = await import('../lib/multi-agent-proposal');
    // We need types, but can't import them dynamically for type usage in the same way. 
    // We'll just use 'any' or assume structure for this test script to keep it simple.

    const generator = getMultiAgentGenerator();

    // Mock User Profile
    const userProfile = {
        name: 'Abdul Rehman',
        title: 'Senior React & Node.js Developer',
        summary: 'I build high-performance web apps that scale. 8+ years experience.',
        yearsExperience: 8,
        skills: ['React', 'Next.js', 'Node.js', 'TypeScript', 'PostgreSQL'],
        pastClients: ['TechFlow', 'StartupInc', 'MegaCorp'],
        achievements: [
            'Built a dashboard that saved Client A 20 hours/week of manual data entry.',
            'Optimized an API to handle 10k requests/sec, reducing costs by 40%.',
        ],
        availability: '20 hours/week',
        timezone: 'EST',
        preferredTone: 'professional',
        customSignature: 'Abdul',
    };

    // Mock Job Description
    const jobDescription = `
    Using React not Angular.
    
    Hi, I'm Matt.
    We are looking for a React developer to help us finish our admin dashboard. 
    The previous developer ghosted us halfway through and left a mess of code.
    We need someone to come in, clean up the codebase, and implement the user management feature.
    
    Must be available to start immediately. Budget is $1000 fixed price.
    
    Please include the word "blue" in your proposal so I know you read this.
  `;

    const jobDetails = {
        title: 'React Developer needed to fix unfinished dashboard',
        description: jobDescription,
        clientName: 'Matt',
        budget: '$1000',
        userProfile: userProfile,
        proposalLength: 'short' as const,
        screeningQuestions: ['What is your experience with cleaning up messy code?'],
    };

    try {
        console.log('📝 Generating proposal for job: "React Developer needed..."');
        console.log('--------------------------------------------------');

        const result = await generator.generate(jobDetails as any);

        console.log('\n✅ GENERATION COMPLETE');
        console.log('--------------------------------------------------');
        console.log('TOKEN COMPATIBILITY:', result.success ? 'PASS' : 'FAIL');
        console.log('MODEL USED:', result.modelUsed);
        console.log('TOKENS USED:', result.tokensUsed);
        console.log('TIME:', result.generationTime + 'ms');
        console.log('--------------------------------------------------');
        console.log('\n📄 FINAL PROPOSAL:\n');
        console.log(result.proposal);
        console.log('\n--------------------------------------------------');

        if (result.screeningAnswers && result.screeningAnswers.length > 0) {
            console.log('\n❓ SCREENING ANSWERS:\n');
            result.screeningAnswers.forEach(a => {
                console.log(`Q: ${a.question}`);
                console.log(`A: ${a.answer}\n`);
            });
        }

        if (result.reviewFeedback) {
            console.log('\n🔍 REVIEWER FEEDBACK:\n');
            console.log(result.reviewFeedback);
        }

    } catch (error) {
        console.error('❌ Error generating proposal:', error);
    }
}

runTest();
