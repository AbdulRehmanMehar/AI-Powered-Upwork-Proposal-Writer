/**
 * User Profile Embeddings Module
 * Stores and retrieves user profile data (projects, achievements, skills) as embeddings
 * Enables semantic matching between job descriptions and relevant profile sections
 */

import { getQdrantClient, COLLECTIONS, VECTOR_DIMENSION } from './qdrant';
import { generateEmbedding, generateEmbeddings } from './gemini-embeddings';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// Types
// ============================================

export type ProfileChunkType = 
  | 'project'        // A specific project/case study
  | 'achievement'    // A specific achievement with metrics
  | 'skill_context'  // Skills with context of how they were used
  | 'client_work'    // Work done for a specific client
  | 'certification'  // Certifications with context
  | 'summary'        // Overall profile summary
  | 'testimonial';   // Client testimonials/reviews

export interface ProfileChunk {
  id?: string;
  userId: string;
  type: ProfileChunkType;
  text: string;
  metadata?: {
    clientName?: string;
    projectName?: string;
    technologies?: string[];
    industry?: string;
    metrics?: string[];        // e.g., ["40% faster", "$50k saved"]
    dateRange?: string;        // e.g., "2024-2025"
    relevanceKeywords?: string[]; // Keywords for better matching
  };
}

export interface RetrievedProfileChunk {
  chunk: ProfileChunk;
  score: number;
}

// ============================================
// Collection Initialization
// ============================================

/**
 * Initialize user profiles collection with proper indexes
 */
export async function initializeProfilesCollection(): Promise<void> {
  const client = getQdrantClient();
  
  try {
    const exists = await client.collectionExists(COLLECTIONS.USER_PROFILES);
    
    if (!exists.exists) {
      await client.createCollection(COLLECTIONS.USER_PROFILES, {
        vectors: {
          size: VECTOR_DIMENSION,
          distance: 'Cosine',
        },
      });
      
      // Create payload index for userId filtering
      await client.createPayloadIndex(COLLECTIONS.USER_PROFILES, {
        field_name: 'userId',
        field_schema: 'keyword',
      });
      
      // Create payload index for type filtering
      await client.createPayloadIndex(COLLECTIONS.USER_PROFILES, {
        field_name: 'type',
        field_schema: 'keyword',
      });
      
      console.log(`✅ Created collection: ${COLLECTIONS.USER_PROFILES}`);
    }
  } catch (error) {
    console.error('Error initializing profiles collection:', error);
    throw error;
  }
}

// ============================================
// Profile Parsing & Chunking
// ============================================

/**
 * Parse user profile into embeddable chunks
 */
export function parseProfileIntoChunks(
  userId: string,
  profile: {
    title?: string;
    summary?: string;
    skills?: string[];
    specializations?: string[];
    achievements?: string[];
    pastClients?: string[];
    certifications?: string[];
    resumeText?: string;
    additionalDetails?: string;
  }
): ProfileChunk[] {
  const chunks: ProfileChunk[] = [];
  
  // 1. Summary chunk
  if (profile.summary) {
    chunks.push({
      id: uuidv4(),
      userId,
      type: 'summary',
      text: `${profile.title ? profile.title + ': ' : ''}${profile.summary}`,
      metadata: {
        relevanceKeywords: profile.skills?.slice(0, 10),
      },
    });
  }
  
  // 2. Achievement chunks (each achievement separately)
  if (profile.achievements?.length) {
    for (const achievement of profile.achievements) {
      // Extract metrics from achievement text
      const metrics = achievement.match(/\d+%|\$[\d,]+k?|\d+x|\d+\+/g) || [];
      
      chunks.push({
        id: uuidv4(),
        userId,
        type: 'achievement',
        text: achievement,
        metadata: {
          metrics,
        },
      });
    }
  }
  
  // 3. Skills with context
  if (profile.skills?.length && profile.specializations?.length) {
    const skillsText = `Skills: ${profile.skills.join(', ')}. Specializes in: ${profile.specializations.join(', ')}.`;
    chunks.push({
      id: uuidv4(),
      userId,
      type: 'skill_context',
      text: skillsText,
      metadata: {
        technologies: profile.skills,
      },
    });
  }
  
  // 4. Past clients as social proof
  if (profile.pastClients?.length) {
    for (const client of profile.pastClients) {
      chunks.push({
        id: uuidv4(),
        userId,
        type: 'client_work',
        text: `Worked with: ${client}`,
        metadata: {
          clientName: client,
        },
      });
    }
  }
  
  // 5. Certifications
  if (profile.certifications?.length) {
    for (const cert of profile.certifications) {
      chunks.push({
        id: uuidv4(),
        userId,
        type: 'certification',
        text: `Certification: ${cert}`,
      });
    }
  }
  
  // 6. Parse resume text for projects (if structured)
  if (profile.resumeText) {
    const projectChunks = parseResumeForProjects(userId, profile.resumeText);
    chunks.push(...projectChunks);
  }
  
  // 7. Parse additional details (case studies, etc.)
  if (profile.additionalDetails) {
    const detailChunks = parseAdditionalDetails(userId, profile.additionalDetails);
    chunks.push(...detailChunks);
  }
  
  return chunks;
}

/**
 * Parse resume text to extract project sections
 */
function parseResumeForProjects(userId: string, resumeText: string): ProfileChunk[] {
  const chunks: ProfileChunk[] = [];
  
  // Split by common project delimiters
  const sections = resumeText.split(/(?=(?:Project|Client|Company|Experience)[\s:]+)/i);
  
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length < 50) continue; // Skip very short sections
    if (trimmed.length > 1500) {
      // Split long sections
      const sentences = trimmed.match(/[^.!?]+[.!?]+/g) || [trimmed];
      let current = '';
      for (const sentence of sentences) {
        if (current.length + sentence.length > 1000) {
          if (current.trim()) {
            chunks.push({
              id: uuidv4(),
              userId,
              type: 'project',
              text: current.trim(),
              metadata: extractMetadataFromText(current),
            });
          }
          current = sentence;
        } else {
          current += sentence;
        }
      }
      if (current.trim()) {
        chunks.push({
          id: uuidv4(),
          userId,
          type: 'project',
          text: current.trim(),
          metadata: extractMetadataFromText(current),
        });
      }
    } else {
      chunks.push({
        id: uuidv4(),
        userId,
        type: 'project',
        text: trimmed,
        metadata: extractMetadataFromText(trimmed),
      });
    }
  }
  
  return chunks;
}

/**
 * Parse additional details / case studies
 */
function parseAdditionalDetails(userId: string, details: string): ProfileChunk[] {
  const chunks: ProfileChunk[] = [];
  
  // Pre-filter: strip JSON blocks, code blocks, and metadata sections
  let cleaned = details;
  // Remove JSON objects/arrays (including multi-line)
  cleaned = cleaned.replace(/[{\[][\s\S]*?[}\]]/g, (match) => {
    // Only strip if it looks like JSON (has "key": patterns)
    if (/"\w+"\s*:/.test(match)) return '';
    return match;
  });
  // Remove code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  // Remove lines that are SEO/metadata fields
  cleaned = cleaned.replace(/^\s*"?(?:seo_focus_keywords|focus_keywords|meta_description|meta_title|slug|canonical_url|og_image)"?\s*:.*/gim, '');
  
  // Split by double newlines (paragraphs) or headers
  const sections = cleaned.split(/\n\n+|(?=#{1,3}\s)/);
  
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length < 30) continue;
    
    // Skip sections that still look like metadata/JSON remnants
    if (/"\w+"\s*:/.test(trimmed)) continue;
    if (/^\s*[{\[]/.test(trimmed)) continue;
    
    // Determine type based on content
    let type: ProfileChunkType = 'project';
    const lowerText = trimmed.toLowerCase();
    
    if (lowerText.includes('testimonial') || lowerText.includes('said') || lowerText.includes('review')) {
      type = 'testimonial';
    } else if (lowerText.includes('achieved') || lowerText.includes('increased') || lowerText.includes('reduced')) {
      type = 'achievement';
    }
    
    // Split if too long
    if (trimmed.length > 1500) {
      const parts = trimmed.match(/.{1,1200}(?:\s|$)/g) || [trimmed];
      for (const part of parts) {
        chunks.push({
          id: uuidv4(),
          userId,
          type,
          text: part.trim(),
          metadata: extractMetadataFromText(part),
        });
      }
    } else {
      chunks.push({
        id: uuidv4(),
        userId,
        type,
        text: trimmed,
        metadata: extractMetadataFromText(trimmed),
      });
    }
  }
  
  return chunks;
}

/**
 * Extract metadata from text content
 */
function extractMetadataFromText(text: string): ProfileChunk['metadata'] {
  const metadata: ProfileChunk['metadata'] = {};
  
  // Extract metrics
  const metrics = text.match(/\d+%|\$[\d,]+k?M?|\d+x|\d+\+\s*\w+/g);
  if (metrics?.length) {
    metadata.metrics = metrics;
  }
  
  // Extract technologies (common tech keywords)
  const techKeywords = [
    'React', 'Node', 'Python', 'TypeScript', 'JavaScript', 'PostgreSQL', 'MongoDB',
    'AWS', 'Azure', 'Docker', 'Kubernetes', 'Next.js', 'Vue', 'Angular', 'Django',
    'FastAPI', 'GraphQL', 'REST', 'API', 'AI', 'ML', 'Machine Learning', 'OpenAI',
    'LLM', 'NLP', 'Computer Vision', 'Data Science', 'Analytics', 'ETL', 'SQL',
  ];
  const foundTech = techKeywords.filter(tech => 
    new RegExp(`\\b${tech}\\b`, 'i').test(text)
  );
  if (foundTech.length) {
    metadata.technologies = foundTech;
  }
  
  // Extract industry keywords
  const industryKeywords = [
    'healthcare', 'fintech', 'e-commerce', 'ecommerce', 'SaaS', 'B2B', 'B2C',
    'startup', 'enterprise', 'government', 'education', 'real estate', 'logistics',
    'manufacturing', 'retail', 'media', 'entertainment', 'travel', 'hospitality',
    'NDIS', 'disability', 'aged care', 'telehealth', 'insurance', 'banking',
  ];
  const foundIndustry = industryKeywords.find(ind => 
    new RegExp(`\\b${ind}\\b`, 'i').test(text)
  );
  if (foundIndustry) {
    metadata.industry = foundIndustry;
  }
  
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

// ============================================
// Storage
// ============================================

/**
 * Store user profile chunks in Qdrant
 */
export async function storeProfileChunks(chunks: ProfileChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  
  const client = getQdrantClient();
  await initializeProfilesCollection();
  
  console.log(`📥 Storing ${chunks.length} profile chunks...`);
  
  // Generate embeddings
  const texts = chunks.map(c => c.text);
  const embeddings = await generateEmbeddings(texts, 'embed_batch');
  
  // Prepare points
  const points = chunks.map((chunk, index) => ({
    id: chunk.id || uuidv4(),
    vector: embeddings[index],
    payload: {
      userId: chunk.userId,
      type: chunk.type,
      text: chunk.text,
      clientName: chunk.metadata?.clientName || null,
      projectName: chunk.metadata?.projectName || null,
      technologies: chunk.metadata?.technologies || [],
      industry: chunk.metadata?.industry || null,
      metrics: chunk.metadata?.metrics || [],
      dateRange: chunk.metadata?.dateRange || null,
      relevanceKeywords: chunk.metadata?.relevanceKeywords || [],
    },
  }));
  
  // Upsert
  await client.upsert(COLLECTIONS.USER_PROFILES, {
    wait: true,
    points,
  });
  
  console.log(`✅ Stored ${chunks.length} profile chunks for user`);
}

/**
 * Update user profile embeddings (clears old and stores new)
 */
export async function updateUserProfileEmbeddings(
  userId: string,
  profile: Parameters<typeof parseProfileIntoChunks>[1]
): Promise<{ chunksStored: number }> {
  // Clear existing profile chunks for this user
  await clearUserProfileChunks(userId);
  
  // Parse profile into chunks
  const chunks = parseProfileIntoChunks(userId, profile);
  
  if (chunks.length === 0) {
    console.log('No profile data to embed');
    return { chunksStored: 0 };
  }
  
  // Store new chunks
  await storeProfileChunks(chunks);
  
  return { chunksStored: chunks.length };
}

/**
 * Clear all profile chunks for a user
 */
export async function clearUserProfileChunks(userId: string): Promise<void> {
  const client = getQdrantClient();
  
  try {
    await client.delete(COLLECTIONS.USER_PROFILES, {
      filter: {
        must: [
          { key: 'userId', match: { value: userId } },
        ],
      },
    });
    console.log(`🗑️ Cleared profile chunks for user: ${userId}`);
  } catch (error) {
    // Collection might not exist yet
    console.log('No existing profile chunks to clear');
  }
}

// ============================================
// Retrieval
// ============================================

export interface ProfileRetrievalOptions {
  types?: ProfileChunkType[];
  industry?: string;
  technologies?: string[];
  limit?: number;
}

/**
 * Retrieve relevant profile chunks for a job description
 */
export async function retrieveRelevantProfile(
  userId: string,
  jobDescription: string,
  options: ProfileRetrievalOptions = {},
  precomputedEmbedding?: number[]
): Promise<RetrievedProfileChunk[]> {
  const client = getQdrantClient();
  const { types, industry, technologies, limit = 5 } = options;
  
  // Use precomputed embedding or generate one
  const queryEmbedding = precomputedEmbedding || await generateEmbedding(jobDescription);
  
  // Build filter
  const mustConditions: any[] = [
    { key: 'userId', match: { value: userId } },
  ];
  
  if (types?.length) {
    mustConditions.push({
      key: 'type',
      match: { any: types },
    });
  }
  
  if (industry) {
    mustConditions.push({
      key: 'industry',
      match: { value: industry },
    });
  }
  
  // Search
  const results = await client.search(COLLECTIONS.USER_PROFILES, {
    vector: queryEmbedding,
    limit,
    filter: { must: mustConditions },
    with_payload: true,
  });
  
  return results.map(result => ({
    chunk: {
      id: result.id as string,
      userId: result.payload?.userId as string,
      type: result.payload?.type as ProfileChunkType,
      text: result.payload?.text as string,
      metadata: {
        clientName: result.payload?.clientName as string | undefined,
        projectName: result.payload?.projectName as string | undefined,
        technologies: result.payload?.technologies as string[] | undefined,
        industry: result.payload?.industry as string | undefined,
        metrics: result.payload?.metrics as string[] | undefined,
        dateRange: result.payload?.dateRange as string | undefined,
      },
    },
    score: result.score,
  }));
}

/**
 * Retrieve profile chunks organized by type for proposal generation
 */
export async function retrieveProfileForProposal(
  userId: string,
  jobDescription: string,
  precomputedEmbedding?: number[]
): Promise<{
  bestProject: RetrievedProfileChunk | null;
  achievements: RetrievedProfileChunk[];
  skills: RetrievedProfileChunk | null;
  testimonials: RetrievedProfileChunk[];
  summary: RetrievedProfileChunk | null;
}> {
  // Embed once and reuse across all 5 parallel searches
  const embedding = precomputedEmbedding || await generateEmbedding(jobDescription);

  // Run multiple searches in parallel (all reuse the same embedding)
  const [projects, achievements, skills, testimonials, summary] = await Promise.all([
    retrieveRelevantProfile(userId, jobDescription, { types: ['project', 'client_work'], limit: 3 }, embedding),
    retrieveRelevantProfile(userId, jobDescription, { types: ['achievement'], limit: 3 }, embedding),
    retrieveRelevantProfile(userId, jobDescription, { types: ['skill_context'], limit: 1 }, embedding),
    retrieveRelevantProfile(userId, jobDescription, { types: ['testimonial'], limit: 2 }, embedding),
    retrieveRelevantProfile(userId, jobDescription, { types: ['summary'], limit: 1 }, embedding),
  ]);
  
  return {
    bestProject: projects[0] || null,
    achievements,
    skills: skills[0] || null,
    testimonials,
    summary: summary[0] || null,
  };
}

// ============================================
// Stats
// ============================================

/**
 * Get profile embedding stats for a user
 */
export async function getUserProfileStats(userId: string): Promise<{
  totalChunks: number;
  byType: Record<string, number>;
}> {
  const client = getQdrantClient();
  
  try {
    // Count total chunks for user
    const countResult = await client.count(COLLECTIONS.USER_PROFILES, {
      filter: {
        must: [{ key: 'userId', match: { value: userId } }],
      },
      exact: true,
    });
    
    return {
      totalChunks: countResult.count,
      byType: {}, // Would need to scroll to get by-type counts
    };
  } catch (error) {
    return { totalChunks: 0, byType: {} };
  }
}
