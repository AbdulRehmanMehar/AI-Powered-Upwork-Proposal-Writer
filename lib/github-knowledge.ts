/**
 * GitHub Knowledge Base
 * Embeds deep repository analysis into Qdrant for RAG retrieval in proposals
 */

import { randomUUID } from 'crypto';
import { getQdrantClient, COLLECTIONS } from './qdrant';
import { generateEmbedding } from './gemini-embeddings';
import { DeepRepoAnalysis, analyzeUserRepositories, fetchAllUserRepos } from './github-deep-analyzer';
import { connectToDatabase } from './db/connection';
import { User } from './db/user';

// Collection name for GitHub projects
const GITHUB_COLLECTION = 'github_projects';

// Ensure collection exists
let collectionInitialized = false;

async function ensureCollection() {
  if (collectionInitialized) return;
  
  const client = getQdrantClient();
  
  try {
    const collections = await client.getCollections();
    const exists = collections.collections.some(c => c.name === GITHUB_COLLECTION);
    
    if (!exists) {
      await client.createCollection(GITHUB_COLLECTION, {
        vectors: {
          size: 768, // Gemini embedding size
          distance: 'Cosine',
        },
      });
      console.log(`Created Qdrant collection: ${GITHUB_COLLECTION}`);
    }
    
    collectionInitialized = true;
  } catch (error) {
    console.error('Failed to ensure GitHub collection:', error);
    throw error;
  }
}

/**
 * Sanitize text to remove invalid Unicode characters (lone surrogates)
 * that cause JSON parsing errors in Qdrant
 */
function sanitizeText(text: string): string {
  // Remove lone surrogates (invalid UTF-16 code points)
  // Surrogates are in range U+D800 to U+DFFF
  return text
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '') // Remove lone high surrogates
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '') // Remove lone low surrogates
    .replace(/\u0000/g, '') // Remove null bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // Remove other control characters
}

/**
 * Convert a repo analysis into embeddable chunks
 * Each chunk represents a different aspect of the project for better retrieval
 */
function createRepoChunks(repo: DeepRepoAnalysis, userId: string): Array<{
  id: string;
  text: string;
  metadata: Record<string, unknown>;
  chunkType: string;
}> {
  const chunks: Array<{
    id: string;
    text: string;
    metadata: Record<string, unknown>;
    chunkType: string;
  }> = [];

  const baseMetadata = {
    userId,
    repoName: repo.name,
    repoFullName: repo.fullName,
    repoUrl: repo.url,
    primaryLanguage: repo.primaryLanguage,
    stars: repo.stars,
    analyzedAt: repo.analyzedAt,
    isPrivate: repo.isPrivate || false,
  };

  // 1. Overview chunk - general description and purpose
  const overviewText = `
Project: ${repo.name}
${repo.description ? `Description: ${repo.description}` : ''}
${repo.homepage ? `Live: ${repo.homepage}` : ''}
URL: ${repo.url}
Tech: ${repo.primaryLanguage}${repo.techStack.frameworks.length ? ', ' + repo.techStack.frameworks.join(', ') : ''}
${repo.stars > 0 ? `Stars: ${repo.stars}` : ''}
${repo.problemsSolved.length ? `Solves: ${repo.problemsSolved.join('. ')}` : ''}
  `.trim();

  chunks.push({
    id: `${userId}-${repo.name}-overview`,
    text: overviewText,
    metadata: { ...baseMetadata, chunkType: 'overview' },
    chunkType: 'overview',
  });

  // 2. Tech stack chunk - detailed technology information
  const techText = `
Project ${repo.name} Technical Stack:
Languages: ${repo.techStack.languages.join(', ') || repo.primaryLanguage}
Frameworks: ${repo.techStack.frameworks.join(', ') || 'None specified'}
Databases: ${repo.techStack.databases.join(', ') || 'None specified'}
Tools & Services: ${repo.techStack.tools.join(', ') || 'None specified'}
${Object.keys(repo.techStack.dependencies).length > 0 ? 
  `Key Dependencies: ${Object.keys(repo.techStack.dependencies).slice(0, 15).join(', ')}` : ''}
  `.trim();

  chunks.push({
    id: `${userId}-${repo.name}-tech`,
    text: techText,
    metadata: { ...baseMetadata, chunkType: 'tech_stack' },
    chunkType: 'tech_stack',
  });

  // 3. Features chunk - what the project does
  if (repo.features.length > 0) {
    const featuresText = `
${repo.name} Features and Capabilities:
${repo.features.map((f, i) => `${i + 1}. ${f}`).join('\n')}
    `.trim();

    chunks.push({
      id: `${userId}-${repo.name}-features`,
      text: featuresText,
      metadata: { ...baseMetadata, chunkType: 'features' },
      chunkType: 'features',
    });
  }

  // 4. Case study chunk - ready-to-use talking points
  if (repo.caseStudyPoints.length > 0) {
    const caseStudyText = `
${repo.name} Case Study Points (use in proposals):
${repo.caseStudyPoints.map(p => `- ${p}`).join('\n')}
URL for portfolio: ${repo.url}
${repo.homepage ? `Live demo: ${repo.homepage}` : ''}
    `.trim();

    chunks.push({
      id: `${userId}-${repo.name}-casestudy`,
      text: caseStudyText,
      metadata: { ...baseMetadata, chunkType: 'case_study' },
      chunkType: 'case_study',
    });
  }

  // 5. README excerpt chunk - first 2000 chars of README for context
  if (repo.readme && repo.readme.length > 100) {
    const readmeExcerpt = repo.readme.substring(0, 2000);
    chunks.push({
      id: `${userId}-${repo.name}-readme`,
      text: `${repo.name} README:\n${readmeExcerpt}`,
      metadata: { ...baseMetadata, chunkType: 'readme' },
      chunkType: 'readme',
    });
  }

  // 6. Architecture chunk - structure and patterns
  const archText = `
${repo.name} Architecture:
Main directories: ${repo.structure.mainDirs.join(', ')}
${repo.structure.hasTests ? '✓ Has test suite' : ''}
${repo.structure.hasCI ? '✓ Has CI/CD' : ''}
${repo.structure.hasDocker ? '✓ Dockerized' : ''}
${repo.structure.hasDocs ? '✓ Has documentation' : ''}
Development activity: ${repo.commitFrequency}
${repo.recentCommits.length > 0 ? 
  `Recent work: ${repo.recentCommits.slice(0, 3).map(c => c.message).join(', ')}` : ''}
  `.trim();

  chunks.push({
    id: `${userId}-${repo.name}-architecture`,
    text: archText,
    metadata: { ...baseMetadata, chunkType: 'architecture' },
    chunkType: 'architecture',
  });

  return chunks;
}

/**
 * Embed and store a user's GitHub repositories
 */
export async function embedUserGitHubProjects(
  userId: string,
  username: string,
  pat: string,
  batchSize: number = 10,
  fullResync: boolean = false
): Promise<{ 
  success: boolean; 
  embeddedCount: number; 
  errors: string[];
  syncedRepos: string[];
  totalRepos: number;
  newlySynced: number;
  alreadySynced: number;
}> {
  try {
    await ensureCollection();
    const client = getQdrantClient();
    await connectToDatabase();

    // Get user's current sync state
    const user = await User.findById(userId).select('profile.githubSyncedRepos profile.githubTotalRepos profile.githubProjectsCache').lean();
    const alreadySyncedRepos: string[] = (user?.profile?.githubSyncedRepos as string[]) || [];
    
    console.log(`Sync state for user ${userId}: ${alreadySyncedRepos.length} repos already synced`);
    
    // If full resync requested, clear everything
    if (fullResync) {
      try {
        await client.delete(GITHUB_COLLECTION, {
          filter: {
            must: [{ key: 'userId', match: { value: userId } }],
          },
        });
        console.log(`Full resync: Deleted existing GitHub embeddings for user ${userId}`);
      } catch {
        // Collection might be empty, ignore
      }
      // Clear the synced repos list
      await User.findByIdAndUpdate(userId, {
        $set: {
          'profile.githubSyncedRepos': [],
          'profile.githubSyncStartedAt': new Date(),
        },
      });
    }

    const skipRepos = fullResync ? [] : alreadySyncedRepos;

    // Analyze repositories (will skip already synced)
    console.log(`Analyzing GitHub repos for ${username} (skipping ${skipRepos.length} already synced)...`);
    if (skipRepos.length > 0) {
      console.log(`First 5 skip repos: ${skipRepos.slice(0, 5).join(', ')}`);
    }
    const analysis = await analyzeUserRepositories(username, pat, batchSize, skipRepos);
    
    if (!analysis.success) {
      return { 
        success: false, 
        embeddedCount: 0, 
        errors: analysis.errors,
        syncedRepos: alreadySyncedRepos,
        totalRepos: 0,
        newlySynced: 0,
        alreadySynced: analysis.skipped,
      };
    }

    if (analysis.repos.length === 0) {
      // No new repos to sync - might be all caught up
      return { 
        success: true, 
        embeddedCount: 0, 
        errors: [],
        syncedRepos: alreadySyncedRepos,
        totalRepos: alreadySyncedRepos.length,
        newlySynced: 0,
        alreadySynced: analysis.skipped,
      };
    }

    console.log(`Analyzed ${analysis.repos.length} new repos, creating embeddings...`);

    // Create chunks for all repos
    const allChunks: Array<{
      id: string;
      text: string;
      metadata: Record<string, unknown>;
      chunkType: string;
    }> = [];

    for (const repo of analysis.repos) {
      const chunks = createRepoChunks(repo, userId);
      allChunks.push(...chunks);
    }

    console.log(`Created ${allChunks.length} chunks, generating embeddings...`);

    // Generate embeddings in batches
    const embeddingBatchSize = 5;
    const points: Array<{
      id: string;
      vector: number[];
      payload: Record<string, unknown>;
    }> = [];

    for (let i = 0; i < allChunks.length; i += embeddingBatchSize) {
      const batch = allChunks.slice(i, i + embeddingBatchSize);
      
      // Sanitize text before generating embeddings
      const sanitizedBatch = batch.map(chunk => ({
        ...chunk,
        text: sanitizeText(chunk.text),
      }));
      
      const embeddings = await Promise.all(
        sanitizedBatch.map(chunk => generateEmbedding(chunk.text))
      );

      for (let j = 0; j < sanitizedBatch.length; j++) {
        if (embeddings[j]) {
          // Sanitize all string values in metadata
          const sanitizedMetadata: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(sanitizedBatch[j].metadata)) {
            sanitizedMetadata[key] = typeof value === 'string' ? sanitizeText(value) : value;
          }
          
          points.push({
            id: randomUUID(),
            vector: embeddings[j]!,
            payload: {
              ...sanitizedMetadata,
              text: sanitizedBatch[j].text,
              chunkId: sanitizedBatch[j].id,
            },
          });
        }
      }

      // Small delay between batches
      if (i + embeddingBatchSize < allChunks.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Upsert to Qdrant
    if (points.length > 0) {
      try {
        await client.upsert(GITHUB_COLLECTION, {
          wait: true,
          points,
        });
        console.log(`Embedded ${points.length} chunks to Qdrant`);
      } catch (upsertError: unknown) {
        const err = upsertError as { data?: unknown; status?: number; message?: string };
        console.error('Qdrant upsert error details:', JSON.stringify(err.data, null, 2));
        console.error('Sample point:', JSON.stringify(points[0], null, 2));
        throw upsertError;
      }
    }

    // Update sync tracking - add newly synced repos to the list
    const newlySyncedRepos = analysis.repos.map(r => r.fullName);
    const updatedSyncedRepos = [...new Set([...alreadySyncedRepos, ...newlySyncedRepos])];

    console.log(`Newly synced repos: ${newlySyncedRepos.join(', ')}`);
    console.log(`Total after merge: ${updatedSyncedRepos.length} (was ${alreadySyncedRepos.length})`);

    // Also update the projects cache with ALL synced repos' data
    const existingCache = user?.profile?.githubProjectsCache 
      ? JSON.parse(user.profile.githubProjectsCache as string) 
      : [];
    const newCacheEntries = analysis.repos.map(r => ({
      name: r.name,
      description: r.description,
      url: r.url,
      language: r.primaryLanguage,
      stars: r.stars,
      topics: r.techStack.frameworks,
      caseStudyPoints: r.caseStudyPoints,
      lastUpdated: r.pushedAt,
    }));
    const updatedCache = [...existingCache, ...newCacheEntries];

    // Use native MongoDB updateOne for reliable nested field updates
    const mongoose = await import('mongoose');
    const db = mongoose.connection.db;
    
    if (!db) {
      console.error('MongoDB connection not available!');
      throw new Error('Database connection not available');
    }
    
    const updateResult = await db.collection('users').updateOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      {
        $set: {
          'profile.githubLastFetched': new Date(),
          'profile.githubSyncedRepos': updatedSyncedRepos,
          'profile.githubProjectsCache': JSON.stringify(updatedCache),
        }
      }
    );
    
    console.log(`MongoDB updateOne result: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`);
    
    // Verify by reading back with native driver
    const verifyDoc = await db.collection('users').findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { projection: { 'profile.githubSyncedRepos': 1 } }
    );
    const savedRepos = (verifyDoc?.profile?.githubSyncedRepos as string[]) || [];
    console.log(`DB verify - githubSyncedRepos saved: ${savedRepos.length} repos`);
    
    if (savedRepos.length === 0 && updatedSyncedRepos.length > 0) {
      console.error('CRITICAL: Native MongoDB update failed to persist data!');
      console.error('Update result:', JSON.stringify(updateResult));
    }

    console.log(`Updated sync state: ${updatedSyncedRepos.length} repos now synced (added ${newlySyncedRepos.length} new)`);

    return { 
      success: true, 
      embeddedCount: points.length, 
      errors: analysis.errors,
      syncedRepos: updatedSyncedRepos,
      totalRepos: updatedSyncedRepos.length,
      newlySynced: analysis.repos.length,
      alreadySynced: analysis.skipped,
    };
  } catch (error) {
    console.error('GitHub embedding error:', error);
    return { 
      success: false, 
      embeddedCount: 0, 
      errors: [error instanceof Error ? error.message : 'Embedding failed'],
      syncedRepos: [],
      totalRepos: 0,
      newlySynced: 0,
      alreadySynced: 0,
    };
  }
}

/**
 * Retrieve relevant GitHub projects for a job description
 */
export async function retrieveRelevantProjects(
  userId: string,
  jobDescription: string,
  topK: number = 5
): Promise<Array<{
  repoName: string;
  repoUrl: string;
  text: string;
  chunkType: string;
  score: number;
  isPrivate?: boolean;
}>> {
  try {
    await ensureCollection();
    const client = getQdrantClient();

    // Generate embedding for job description
    const queryEmbedding = await generateEmbedding(jobDescription);
    if (!queryEmbedding) {
      console.error('Failed to generate query embedding');
      return [];
    }

    // Search for relevant chunks
    const results = await client.search(GITHUB_COLLECTION, {
      vector: queryEmbedding,
      filter: {
        must: [{ key: 'userId', match: { value: userId } }],
      },
      limit: topK * 2, // Get more, then dedupe by repo
      with_payload: true,
    });

    // Process results - dedupe by repo, prefer case_study and overview chunks
    const seenRepos = new Set<string>();
    const relevantProjects: Array<{
      repoName: string;
      repoUrl: string;
      text: string;
      chunkType: string;
      score: number;
      isPrivate?: boolean;
    }> = [];

    // Priority order for chunk types
    const chunkPriority: Record<string, number> = {
      case_study: 1,
      overview: 2,
      features: 3,
      tech_stack: 4,
      architecture: 5,
      readme: 6,
    };

    // Sort by score first, then process
    const sortedResults = results.sort((a, b) => {
      // Same repo? Prefer case_study/overview
      if (a.payload?.repoName === b.payload?.repoName) {
        const aPriority = chunkPriority[a.payload?.chunkType as string] || 99;
        const bPriority = chunkPriority[b.payload?.chunkType as string] || 99;
        return aPriority - bPriority;
      }
      return (b.score || 0) - (a.score || 0);
    });

    for (const result of sortedResults) {
      const repoName = result.payload?.repoName as string;
      
      // Skip if we already have this repo
      if (seenRepos.has(repoName)) continue;
      
      seenRepos.add(repoName);
      relevantProjects.push({
        repoName,
        repoUrl: result.payload?.repoUrl as string,
        text: result.payload?.text as string,
        chunkType: result.payload?.chunkType as string,
        score: result.score || 0,
        isPrivate: result.payload?.isPrivate as boolean || false,
      });

      if (relevantProjects.length >= topK) break;
    }

    return relevantProjects;
  } catch (error) {
    console.error('GitHub retrieval error:', error);
    return [];
  }
}

/**
 * Get GitHub knowledge stats for a user
 */
export async function getGitHubKnowledgeStats(userId: string): Promise<{
  totalChunks: number;
  repos: string[];
  lastSynced: Date | null;
  syncedRepos: string[];
  isConfigured: boolean;
}> {
  try {
    await ensureCollection();
    const client = getQdrantClient();

    // Count chunks for user
    const countResult = await client.count(GITHUB_COLLECTION, {
      filter: {
        must: [{ key: 'userId', match: { value: userId } }],
      },
      exact: true,
    });

    // Get unique repos
    const scrollResult = await client.scroll(GITHUB_COLLECTION, {
      filter: {
        must: [{ key: 'userId', match: { value: userId } }],
      },
      limit: 100,
      with_payload: ['repoName'],
    });

    const repos = [...new Set(
      scrollResult.points.map(p => p.payload?.repoName as string).filter(Boolean)
    )];

    // Get sync info from DB
    await connectToDatabase();
    const user = await User.findById(userId).select('profile.githubLastFetched profile.githubSyncedRepos profile.githubTotalRepos').lean();

    return {
      totalChunks: countResult.count,
      repos,
      lastSynced: user?.profile?.githubLastFetched || null,
      syncedRepos: (user?.profile?.githubSyncedRepos as string[]) || [],
      isConfigured: repos.length > 0,
    };
  } catch (error) {
    console.error('GitHub stats error:', error);
    return { totalChunks: 0, repos: [], lastSynced: null, syncedRepos: [], isConfigured: false };
  }
}

/**
 * Get total repo count for a user (for sync progress display)
 */
export async function getTotalRepoCount(
  username: string,
  pat: string
): Promise<{ total: number; error?: string }> {
  try {
    const result = await fetchAllUserRepos(username, pat);
    return { total: result.total, error: result.error };
  } catch (error) {
    return { total: 0, error: error instanceof Error ? error.message : 'Failed to count repos' };
  }
}

/**
 * Format retrieved projects for proposal generation
 * Only includes PUBLIC repos since we'll be linking to them
 */
export function formatProjectsForProposal(
  projects: Array<{
    repoName: string;
    repoUrl: string;
    text: string;
    chunkType: string;
    score: number;
    isPrivate?: boolean;
  }>
): string {
  // Filter out private repos - we can't link to them in proposals!
  const publicProjects = projects.filter(p => !p.isPrivate);
  if (publicProjects.length === 0) {
    return `## YOUR GITHUB PROJECTS: None found relevant to this job (or only private repos matched).
⚠️ DO NOT MAKE UP PROJECT NAMES OR METRICS. Use generic phrasing like:
- "Built something similar before"
- "Worked on a project with these requirements"
- DO NOT link to any GitHub repos`;
  }

  let prompt = `## 🔗 YOUR VERIFIED PUBLIC GITHUB PROJECTS (matched to this job):\n\n`;
  prompt += `These are REAL PUBLIC projects from your GitHub. Use them as case studies!\n\n`;

  for (const project of publicProjects) {
    prompt += `### ${project.repoName}\n`;
    prompt += `**URL:** ${project.repoUrl} ← INCLUDE THIS LINK!\n`;
    prompt += `**Match Score:** ${(project.score * 100).toFixed(0)}%\n`;
    prompt += `\n${project.text}\n\n`;
    prompt += `---\n\n`;
  }

  prompt += `⚠️ CRITICAL RULES:\n`;
  prompt += `- Reference these REAL projects with their GitHub URLs\n`;
  prompt += `- Use the case study points naturally in your proposal\n`;
  prompt += `- DO NOT make up metrics not listed above\n`;
  prompt += `- Pick the MOST relevant project (highest match score)\n`;

  return prompt;
}
