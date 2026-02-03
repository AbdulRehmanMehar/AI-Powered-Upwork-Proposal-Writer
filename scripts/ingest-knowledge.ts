/**
 * Knowledge Ingestion Script
 * Processes practitioner transcripts and stores them in Qdrant
 * 
 * Run with: npx tsx scripts/ingest-knowledge.ts
 */

// Load environment variables first
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import mongoose from 'mongoose';
import { 
  chunkText, 
  extractExamples, 
  storeKnowledge, 
  clearKnowledge,
  getKnowledgeStats,
  KnowledgeChunk,
  KnowledgeCategory,
  Practitioner
} from '../lib/knowledge-base';
import { initializeCollections } from '../lib/qdrant';

const DOCS_DIR = path.join(process.cwd(), 'docs');

// Connect to MongoDB for usage tracking
async function connectMongoDB(): Promise<void> {
  const uri = process.env.DATABASE_URL;
  if (!uri) {
    console.log('⚠️ DATABASE_URL not set, skipping MongoDB connection (usage tracking disabled)');
    return;
  }
  
  try {
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB for usage tracking');
  } catch (error) {
    console.log('⚠️ MongoDB connection failed, continuing without usage tracking:', error);
  }
}

// ============================================
// Curated High-Value Examples
// These are hand-picked from the transcripts
// ============================================

const CURATED_EXAMPLES: KnowledgeChunk[] = [
  // ============ HOOKS (Opening lines) ============
  {
    text: "Hey John, seems like an awesome fit. I've helped other clients like ABC products and XYZ company boost their sales in the same way that you're looking for.",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 8',
    isExample: true,
    quality: 'good',
  },
  {
    text: "Hey — this looks like a great fit. I've done this exact thing for other clients. Here's a quick example [link]. What questions do you have for me?",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: true,
    quality: 'good',
  },
  {
    text: "Hey [Name], Seems like I might be able to help here — what questions do you have for me?",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 8',
    isExample: true,
    quality: 'good',
  },
  {
    text: "I reviewed your job, and did a bit of background research. Would you be able to fill in a few blanks?",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 8',
    isExample: true,
    quality: 'good',
  },
  {
    text: "Hey Mike I'm ready when you are. Send me a message and let's hop on a call to discuss.",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 8',
    isExample: true,
    quality: 'good',
  },
  {
    text: "I saw you're looking for someone who gets the compliance side of things. I actually just finished a project exactly like this — want me to show you how I approached it?",
    category: 'hook',
    practitioner: 'josh_burns',
    source: 'inferred from transcripts',
    isExample: true,
    quality: 'good',
  },
  
  // ============ BAD HOOKS (What NOT to do) ============
  {
    text: "Dear Sir / Madam. I am very interested in your project.",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 2',
    isExample: true,
    quality: 'bad',
  },
  {
    text: "I am certain that I fully understand your job requirements.",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 2',
    isExample: true,
    quality: 'bad',
  },
  {
    text: "Although it is true that I do not have much professional experience...",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 2',
    isExample: true,
    quality: 'bad',
  },
  {
    text: "I promise that I will do my best on this project.",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 2',
    isExample: true,
    quality: 'bad',
  },
  {
    text: "Please consider my proposal for this position.",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 2',
    isExample: true,
    quality: 'bad',
  },
  {
    text: "I couldn't help but notice your job posting on Upwork!",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 8',
    isExample: true,
    quality: 'bad',
  },
  {
    text: "I was excited to see that you are seeking a Digital Marketer...",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 8',
    isExample: true,
    quality: 'bad',
  },
  {
    text: "My experience as a Social Media Manager is so much more extensive than what I saw described in the job description...",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 8',
    isExample: true,
    quality: 'bad',
  },

  // ============ PROOF (Social proof, case studies) ============
  {
    text: "I've worked with another client in this space, and I think you might find it very interesting to have a chat.",
    category: 'proof',
    practitioner: 'evan_fisher',
    source: 'VIDEO 2',
    isExample: true,
    quality: 'good',
  },
  {
    text: "Recently helped a client just like you improve their workflow using the exact tools you mentioned. I attached a screenshot of what they said about working with me.",
    category: 'proof',
    practitioner: 'josh_burns',
    source: 'inferred from transcripts',
    isExample: true,
    quality: 'good',
  },
  {
    text: "I attached an example so you can get a feel for the level of quality that I produce.",
    category: 'proof',
    practitioner: 'evan_fisher',
    source: 'VIDEO 8',
    isExample: true,
    quality: 'good',
  },
  {
    text: "Here's a few work examples you can check out: [links]",
    category: 'proof',
    practitioner: 'evan_fisher',
    source: 'VIDEO 8',
    isExample: true,
    quality: 'good',
  },
  {
    text: "This is more YouTube-focused, but it doubled conversion.",
    category: 'proof',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: true,
    quality: 'good',
  },

  // ============ CTA (Call to Action) ============
  {
    text: "If it sounds like a good fit then let's connect today. Here's how: click the green Send a Message button, send me a message and feel free to let me know any other details you think might be relevant.",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: true,
    quality: 'good',
  },
  {
    text: "Press the green Schedule Meeting button and choose a time for a Zoom meeting.",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: true,
    quality: 'good',
  },
  {
    text: "To move forward the best next step would be to meet up on a quick Zoom to chat more about the project and see if we're a fit. Just message me below and we'll get it set up.",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: true,
    quality: 'good',
  },
  {
    text: "Shoot me a message and let's connect.",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: true,
    quality: 'good',
  },
  {
    text: "Let's jump on a call and talk specifics?",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 8',
    isExample: true,
    quality: 'good',
  },
  {
    text: "Want to learn more about how we can get this done? Shoot me a message and we'll talk more.",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: true,
    quality: 'good',
  },
  {
    text: "I'd love to get together and talk through your project and what's important to you. Are you free for a call right now?",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: true,
    quality: 'good',
  },
  {
    text: "Can you get together today to discuss? I have a few spots this afternoon at 1pm, 2:30pm and 4pm EST. Just let me know what works and we'll set it up.",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: true,
    quality: 'good',
  },
  {
    text: "My schedule is pretty full for this coming week but I can actually meet now. Are you available for a quick chat?",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: true,
    quality: 'good',
  },
  {
    text: "Next step would be to set up a call where we'll cover: your current situation, where you want to be, and how I can potentially help you get there.",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: true,
    quality: 'good',
  },
  
  // Bad CTAs
  {
    text: "I look forward to exploring how my skills align with your needs.",
    category: 'cta',
    practitioner: 'general',
    source: 'banned patterns',
    isExample: true,
    quality: 'bad',
  },
  {
    text: "Feel free to reach out if interested.",
    category: 'cta',
    practitioner: 'general',
    source: 'banned patterns',
    isExample: true,
    quality: 'bad',
  },
  {
    text: "Please let me know if you would like to see more examples of my work.",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 8',
    isExample: true,
    quality: 'bad',
  },

  // ============ P.S. Section ============
  {
    text: "P.S. — here's a few work examples you can check out: [links]",
    category: 'ps',
    practitioner: 'evan_fisher',
    source: 'VIDEO 8',
    isExample: true,
    quality: 'good',
  },
  {
    text: "P.S. I can share the data model from the Brisbane project if it helps you visualize the approach.",
    category: 'ps',
    practitioner: 'general',
    source: 'best practices',
    isExample: true,
    quality: 'good',
  },
  {
    text: "P.S. I've got one slot opening mid-February — this looks like a better fit than the others in my inbox.",
    category: 'ps',
    practitioner: 'general',
    source: 'best practices',
    isExample: true,
    quality: 'good',
  },
  {
    text: "P.S. Quick question — are you planning to handle consent tracking in-house or use a third party?",
    category: 'ps',
    practitioner: 'general',
    source: 'best practices',
    isExample: true,
    quality: 'good',
  },
  {
    text: "P.S. Just wrapped a similar build for a Melbourne clinic — happy to intro you if you want a reference.",
    category: 'ps',
    practitioner: 'general',
    source: 'best practices',
    isExample: true,
    quality: 'good',
  },

  // ============ SCARCITY / URGENCY Examples ============
  {
    text: "My plate is filling up but I have two spots left. I think there could be a fit here so why don't we hop on a call to talk about your needs. I can hold a spot for you either later today at 3:30pm or tomorrow at 11am. Do either of those times work for you?",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: true,
    quality: 'good',
  },
  {
    text: "Why don't we hop on a quick call and talk about what you're looking for. I should be able to get you an answer on whether we're a fit with just a few minutes chat.",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: true,
    quality: 'good',
  },

  // ============ STRATEGY (General guidance) ============
  {
    text: "Keep your proposals short and sweet. Surprise! The highest paying clients don't have time to read long messages!",
    category: 'strategy',
    practitioner: 'evan_fisher',
    source: 'VIDEO 2',
    isExample: false,
    quality: 'good',
  },
  {
    text: "You're not trying to get hired off of a single message. It just doesn't make sense. What you are trying to do is get them to respond to you.",
    category: 'strategy',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: false,
    quality: 'good',
  },
  {
    text: "79% of people read the P.S. first. If you send them a message, 79% of people will read the P.S. first and they won't even read the core of the message.",
    category: 'strategy',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: false,
    quality: 'good',
  },
  {
    text: "72% of clients have said that they will only engage with personalized marketing. So that means number one, do not copy-paste.",
    category: 'strategy',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: false,
    quality: 'good',
  },
  {
    text: "The first one to two sentences of your cover letter is what the client is going to see first when they're scrolling through tons of job proposals.",
    category: 'hook',
    practitioner: 'josh_burns',
    source: 'inferred from transcripts',
    isExample: false,
    quality: 'good',
  },
  {
    text: "Wherever possible, use the client's first name. It shows that the message is clearly personalized. You can find it in the feedback history.",
    category: 'strategy',
    practitioner: 'evan_fisher',
    source: 'VIDEO 2',
    isExample: false,
    quality: 'good',
  },
  {
    text: "Hit them with authority and social proof. You have to show them your value. What I like to do to establish authority is use client quotes from your profile.",
    category: 'proof',
    practitioner: 'evan_fisher',
    source: 'VIDEO 2',
    isExample: false,
    quality: 'good',
  },
  {
    text: "88% of customers value reviews as much as they would a personal recommendation. Use bits and pieces of your reviews to demonstrate that you know what you're doing.",
    category: 'proof',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: false,
    quality: 'good',
  },
  {
    text: "Cherry-pick tiny snippets from reviews and cut them down to make it easier for that client to find the best pieces of them.",
    category: 'proof',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: false,
    quality: 'good',
  },
  {
    text: "Upwork clients are not experts. They want to pay you to make this easy for them. You need to guide them along the way, show them what they need to do to take that next step with you.",
    category: 'strategy',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: false,
    quality: 'good',
  },
  {
    text: "Personalized calls to action convert 202% better than non-personalized CTAs. So if possible, try to find a way to use their name again in your CTA.",
    category: 'cta',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: false,
    quality: 'good',
  },
  {
    text: "You need to hook them in. You need to get them interested in potentially engaging with you. Show that you understand their frustrations.",
    category: 'hook',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: false,
    quality: 'good',
  },
  {
    text: "Aggressively put yourself in your client's shoes. Imagine you are John. What is frustrating you enough that you need to hire someone to get this job done?",
    category: 'strategy',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: false,
    quality: 'good',
  },
  {
    text: "If writing a proposal to a potential Upwork client is like online dating, then most people are putting way too much in there. Remember, this is not about you. It's about the client and their problems 90%.",
    category: 'strategy',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: false,
    quality: 'good',
  },
  {
    text: "You are a guide that can help the client accomplish their goals. Notice how the part about you comes AFTER focusing on the client first. That's important.",
    category: 'strategy',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: false,
    quality: 'good',
  },
  {
    text: "If the first word of your proposals is 'I', then you're definitely gonna want to steal my entire cover letter template.",
    category: 'banned',
    practitioner: 'evan_fisher',
    source: 'VIDEO 5',
    isExample: false,
    quality: 'good',
  },
  {
    text: "If you change fewer than 10 words every time you send a cover letter... You are playing a very dangerous game.",
    category: 'banned',
    practitioner: 'evan_fisher',
    source: 'VIDEO 5',
    isExample: false,
    quality: 'good',
  },
  {
    text: "If you spend less than a minute reading the job description, reviewing the client's past feedback and stats, and incorporating that into your cover letter — that's how people fail and quit Upwork forever.",
    category: 'strategy',
    practitioner: 'evan_fisher',
    source: 'VIDEO 5',
    isExample: false,
    quality: 'good',
  },

  // ============ BANNED (Things to avoid) ============
  {
    text: "You asked for two relevant work examples - I included four. (Don't do this — it shows you don't listen)",
    category: 'banned',
    practitioner: 'evan_fisher',
    source: 'VIDEO 2',
    isExample: true,
    quality: 'bad',
  },
  {
    text: "I have already done a draft of your job. (Don't do this — it shows you definitely don't listen)",
    category: 'banned',
    practitioner: 'evan_fisher',
    source: 'VIDEO 2',
    isExample: true,
    quality: 'bad',
  },
  {
    text: "Here are my questions about your job. Thank you, bye-bye! (Don't put questions in your initial proposal)",
    category: 'banned',
    practitioner: 'evan_fisher',
    source: 'VIDEO 2',
    isExample: true,
    quality: 'bad',
  },

  // ============ TONE ============
  {
    text: "My profile was focused on me, not on my client. I do this. I help with that. I use these systems to get the job done. The one thing that I learned? Assume that your potential client doesn't care about you.",
    category: 'tone',
    practitioner: 'evan_fisher',
    source: 'VIDEO 1',
    isExample: false,
    quality: 'good',
  },
  {
    text: "Choosing a freelancer is often like finding something that you lost in your house — it's always in the last place that you look because after you found it you stopped looking.",
    category: 'strategy',
    practitioner: 'evan_fisher',
    source: 'VIDEO 4',
    isExample: false,
    quality: 'good',
  },

  // ============ MINDSET ============
  {
    text: "Even today with as many proposals as I have sent, at least 90% do not even get a response. So be comfortable with the Nos, understand that that is a fact of life.",
    category: 'mindset',
    practitioner: 'evan_fisher',
    source: 'VIDEO 3',
    isExample: false,
    quality: 'good',
  },
  {
    text: "I'm the only person that is responsible for my own success. So I only get out what I put in.",
    category: 'mindset',
    practitioner: 'evan_fisher',
    source: 'VIDEO 6',
    isExample: false,
    quality: 'good',
  },
];

// ============================================
// Main Ingestion Logic
// ============================================

async function processTranscript(
  filePath: string, 
  practitioner: Practitioner,
  source: string
): Promise<KnowledgeChunk[]> {
  console.log(`\n📄 Processing: ${source}`);
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const chunks: KnowledgeChunk[] = [];
  
  // Split by VIDEO markers if present
  const videoSections = content.split(/VIDEO \d+/i);
  
  for (let i = 1; i < videoSections.length; i++) {
    const section = videoSections[i];
    const videoSource = `${source} - VIDEO ${i}`;
    
    // Determine category based on content
    const sectionLower = section.toLowerCase();
    let category: KnowledgeCategory = 'strategy';
    
    if (sectionLower.includes('cover letter') || sectionLower.includes('first sentence') || sectionLower.includes('hook')) {
      category = 'hook';
    } else if (sectionLower.includes('call to action') || sectionLower.includes('cta') || sectionLower.includes('next step')) {
      category = 'cta';
    } else if (sectionLower.includes('p.s.') || sectionLower.includes('ps ')) {
      category = 'ps';
    } else if (sectionLower.includes('proof') || sectionLower.includes('review') || sectionLower.includes('testimonial')) {
      category = 'proof';
    }
    
    // Chunk the section
    const sectionChunks = chunkText(section, {
      category,
      practitioner,
      source: videoSource,
      jobType: 'general',
    });
    
    chunks.push(...sectionChunks);
    
    // Also extract specific examples
    const examples = extractExamples(section, practitioner);
    examples.forEach(ex => {
      ex.source = videoSource;
    });
    chunks.push(...examples);
  }
  
  // If no VIDEO markers, chunk the whole thing
  if (videoSections.length <= 1) {
    const allChunks = chunkText(content, {
      category: 'strategy',
      practitioner,
      source,
      jobType: 'general',
    });
    chunks.push(...allChunks);
    
    const examples = extractExamples(content, practitioner);
    examples.forEach(ex => {
      ex.source = source;
    });
    chunks.push(...examples);
  }
  
  console.log(`  ✓ Extracted ${chunks.length} chunks`);
  return chunks;
}

async function main() {
  console.log('🚀 Starting Knowledge Ingestion\n');
  console.log('=' .repeat(50));
  
  // Connect to MongoDB for usage tracking
  console.log('\n📊 Connecting to MongoDB...');
  await connectMongoDB();
  
  // Initialize Qdrant
  console.log('\n📦 Initializing Qdrant...');
  await initializeCollections();
  
  // Clear existing knowledge for fresh start
  console.log('\n🗑️ Clearing existing knowledge...');
  await clearKnowledge();
  
  const allChunks: KnowledgeChunk[] = [];
  
  // 1. Add curated high-value examples first
  console.log('\n⭐ Adding curated examples...');
  allChunks.push(...CURATED_EXAMPLES);
  console.log(`  ✓ Added ${CURATED_EXAMPLES.length} curated examples`);
  
  // 2. Process Josh Burns transcript
  const joshPath = path.join(DOCS_DIR, 'josh_burns_temp.txt');
  if (fs.existsSync(joshPath)) {
    const joshChunks = await processTranscript(joshPath, 'josh_burns', 'Josh Burns Tech');
    allChunks.push(...joshChunks);
  }
  
  // 3. Process Evan Fisher transcript
  const evanPath = path.join(DOCS_DIR, 'freelance_mvp_temp.txt');
  if (fs.existsSync(evanPath)) {
    const evanChunks = await processTranscript(evanPath, 'evan_fisher', 'Freelance MVP');
    allChunks.push(...evanChunks);
  }
  
  // 4. Process comparative analysis
  const comparativePath = path.join(DOCS_DIR, 'COMPARATIVE_ANALYSIS.md');
  if (fs.existsSync(comparativePath)) {
    console.log('\n📄 Processing: COMPARATIVE_ANALYSIS.md');
    const content = fs.readFileSync(comparativePath, 'utf-8');
    const chunks = chunkText(content, {
      category: 'strategy',
      practitioner: 'general',
      source: 'COMPARATIVE_ANALYSIS.md',
      jobType: 'general',
    });
    allChunks.push(...chunks);
    console.log(`  ✓ Extracted ${chunks.length} chunks`);
  }
  
  // 5. Process proposal guide
  const guidePath = path.join(DOCS_DIR, 'UPWORK_PROPOSAL_GUIDE.md');
  if (fs.existsSync(guidePath)) {
    console.log('\n📄 Processing: UPWORK_PROPOSAL_GUIDE.md');
    const content = fs.readFileSync(guidePath, 'utf-8');
    const chunks = chunkText(content, {
      category: 'strategy',
      practitioner: 'general',
      source: 'UPWORK_PROPOSAL_GUIDE.md',
      jobType: 'general',
    });
    allChunks.push(...chunks);
    console.log(`  ✓ Extracted ${chunks.length} chunks`);
  }
  
  // Store all chunks
  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Total chunks to store: ${allChunks.length}`);
  
  await storeKnowledge(allChunks);
  
  // Print stats
  const stats = await getKnowledgeStats();
  console.log('\n✅ Ingestion Complete!');
  console.log(`   Total chunks in Qdrant: ${stats.totalChunks}`);
  
  // Test retrieval
  console.log('\n🔍 Testing retrieval...');
  const { retrieveKnowledge } = await import('../lib/knowledge-base');
  
  const testQuery = "I need to write an opening hook for a web development job";
  const results = await retrieveKnowledge(testQuery, { category: 'hook', limit: 3 });
  
  console.log(`\n   Query: "${testQuery}"`);
  console.log('   Top 3 results:');
  results.forEach((r, i) => {
    console.log(`   ${i + 1}. [${r.score.toFixed(3)}] ${r.chunk.text.slice(0, 80)}...`);
  });
  
  // Disconnect MongoDB
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
    console.log('\n📊 Disconnected from MongoDB');
  }
  
  console.log('\n🎉 Done!');
}

main().catch(console.error);
