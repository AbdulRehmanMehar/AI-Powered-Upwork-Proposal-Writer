/**
 * Deep GitHub Repository Analyzer
 * Fetches comprehensive project data for use as case studies in proposals
 */

export interface RepoFile {
  path: string;
  content: string;
  size: number;
}

export interface RepoCommit {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export interface TechStackInfo {
  languages: string[];
  frameworks: string[];
  databases: string[];
  tools: string[];
  dependencies: Record<string, string>;
}

export interface RepoStructure {
  totalFiles: number;
  totalDirs: number;
  mainDirs: string[];
  hasTests: boolean;
  hasCI: boolean;
  hasDocs: boolean;
  hasDocker: boolean;
}

export interface DeepRepoAnalysis {
  // Basic info
  name: string;
  fullName: string;
  description: string;
  url: string;
  homepage?: string;
  isPrivate?: boolean; // Whether repo is private (don't link in proposals)
  
  // Metrics
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  
  // Dates
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  
  // Content
  readme: string;
  readmeSections: Record<string, string>;
  
  // Tech analysis
  primaryLanguage: string;
  languages: Record<string, number>;
  techStack: TechStackInfo;
  
  // Structure
  structure: RepoStructure;
  
  // Recent activity
  recentCommits: RepoCommit[];
  commitFrequency: string; // "daily", "weekly", "monthly", "inactive"
  
  // Key features (extracted from README)
  features: string[];
  
  // What problems it solves
  problemsSolved: string[];
  
  // Potential case study talking points
  caseStudyPoints: string[];
  
  // Raw important files
  packageJson?: Record<string, unknown>;
  
  // Analysis timestamp
  analyzedAt: string;
}

export interface AnalysisResult {
  success: boolean;
  repo?: DeepRepoAnalysis;
  error?: string;
}

// GitHub API response types
interface GitHubRepoResponse {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  language: string | null;
  message?: string;
}

interface GitHubCommitResponse {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
}

interface GitHubContentResponse {
  name: string;
  type: 'file' | 'dir';
  path: string;
}

const GITHUB_API = 'https://api.github.com';

/**
 * Deep analyze a GitHub repository
 */
export async function analyzeRepository(
  owner: string,
  repo: string,
  pat: string
): Promise<AnalysisResult> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'upwork-proposal-writer',
    'Authorization': `Bearer ${pat}`,
  };

  try {
    // Fetch basic repo info
    const repoInfo = await fetchJSON(`${GITHUB_API}/repos/${owner}/${repo}`, headers) as GitHubRepoResponse | null;
    if (!repoInfo || repoInfo.message) {
      return { success: false, error: String(repoInfo?.message || 'Repository not found') };
    }

    // Parallel fetch all the data we need
    const [
      readme,
      languagesRaw,
      commitsRaw,
      contentsRaw,
      packageJson,
    ] = await Promise.all([
      fetchReadme(owner, repo, headers),
      fetchJSON(`${GITHUB_API}/repos/${owner}/${repo}/languages`, headers),
      fetchJSON(`${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=30`, headers),
      fetchJSON(`${GITHUB_API}/repos/${owner}/${repo}/contents`, headers),
      fetchFileContent(owner, repo, 'package.json', headers),
    ]);

    const languages = languagesRaw as Record<string, number> | null;
    const commits = commitsRaw as GitHubCommitResponse[] | null;
    const contents = contentsRaw as GitHubContentResponse[] | null;

    // Parse README sections
    const readmeSections = parseReadmeSections(readme);
    
    // Extract features from README
    const features = extractFeatures(readme, readmeSections);
    
    // Extract problems solved
    const problemsSolved = extractProblemsSolved(readme, readmeSections);
    
    // Analyze tech stack
    const techStack = analyzeTechStack(packageJson, languages, readme);
    
    // Analyze structure
    const structure = analyzeStructure(contents);
    
    // Process commits
    const recentCommits = processCommits(commits);
    const commitFrequency = calculateCommitFrequency(commits);
    
    // Generate case study talking points
    const caseStudyPoints = generateCaseStudyPoints({
      name: String(repoInfo.name || ''),
      description: String(repoInfo.description || ''),
      stars: Number(repoInfo.stargazers_count || 0),
      features,
      techStack,
      structure,
      recentCommits,
    });

    const analysis: DeepRepoAnalysis = {
      name: String(repoInfo.name || ''),
      fullName: String(repoInfo.full_name || ''),
      description: String(repoInfo.description || ''),
      url: String(repoInfo.html_url || ''),
      homepage: repoInfo.homepage ? String(repoInfo.homepage) : undefined,
      
      stars: Number(repoInfo.stargazers_count || 0),
      forks: Number(repoInfo.forks_count || 0),
      watchers: Number(repoInfo.watchers_count || 0),
      openIssues: Number(repoInfo.open_issues_count || 0),
      
      createdAt: String(repoInfo.created_at || ''),
      updatedAt: String(repoInfo.updated_at || ''),
      pushedAt: String(repoInfo.pushed_at || ''),
      
      readme,
      readmeSections,
      
      primaryLanguage: String(repoInfo.language || 'Unknown'),
      languages: languages || {},
      techStack,
      
      structure,
      
      recentCommits,
      commitFrequency,
      
      features,
      problemsSolved,
      caseStudyPoints,
      
      packageJson: packageJson ? JSON.parse(packageJson) : undefined,
      
      analyzedAt: new Date().toISOString(),
    };

    return { success: true, repo: analysis };
  } catch (error) {
    console.error(`Error analyzing ${owner}/${repo}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Analysis failed' 
    };
  }
}

/**
 * Fetch JSON from GitHub API
 */
async function fetchJSON(url: string, headers: Record<string, string>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch README content
 */
async function fetchReadme(owner: string, repo: string, headers: Record<string, string>): Promise<string> {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/readme`, { headers });
    if (!res.ok) return '';
    const data = await res.json();
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Fetch file content
 */
async function fetchFileContent(
  owner: string, 
  repo: string, 
  path: string, 
  headers: Record<string, string>
): Promise<string | null> {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse README into sections
 */
function parseReadmeSections(readme: string): Record<string, string> {
  const sections: Record<string, string> = {};
  if (!readme) return sections;

  // Split by markdown headers
  const lines = readme.split('\n');
  let currentSection = 'intro';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headerMatch) {
      // Save previous section
      if (currentContent.length > 0) {
        sections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
      }
      currentSection = headerMatch[1].toLowerCase().replace(/[^\w\s]/g, '').trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  
  // Save last section
  if (currentContent.length > 0) {
    sections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
  }

  return sections;
}

/**
 * Extract features from README
 */
function extractFeatures(readme: string, sections: Record<string, string>): string[] {
  const features: string[] = [];
  
  // Look for features section
  const featuresSections = ['features', 'key features', 'highlights', 'what it does'];
  for (const sectionName of featuresSections) {
    if (sections[sectionName]) {
      const bullets = extractBulletPoints(sections[sectionName]);
      features.push(...bullets);
    }
  }

  // Also look for bullet points in intro
  if (sections['intro'] && features.length === 0) {
    const bullets = extractBulletPoints(sections['intro']);
    features.push(...bullets.slice(0, 5));
  }

  // Fallback: look for emoji bullet points anywhere
  if (features.length === 0) {
    const emojiPattern = /[✅✨🚀💡⭐🔥]\s*(.+)/g;
    let match;
    while ((match = emojiPattern.exec(readme)) !== null) {
      features.push(match[1].trim());
    }
  }

  return features.slice(0, 10);
}

/**
 * Extract problems solved
 */
function extractProblemsSolved(readme: string, sections: Record<string, string>): string[] {
  const problems: string[] = [];
  
  // Look for problem/motivation sections
  const problemSections = ['problem', 'motivation', 'why', 'background', 'the problem'];
  for (const sectionName of problemSections) {
    if (sections[sectionName]) {
      // Extract key sentences
      const sentences = sections[sectionName].split(/[.!?]+/).filter(s => s.trim().length > 20);
      problems.push(...sentences.slice(0, 3).map(s => s.trim()));
    }
  }

  // Look for "solves" or "addresses" patterns
  const solvesPattern = /(?:solves?|addresses?|fixes?|eliminates?|reduces?)\s+(.+?)[.!?\n]/gi;
  let match;
  while ((match = solvesPattern.exec(readme)) !== null) {
    problems.push(match[1].trim());
  }

  return [...new Set(problems)].slice(0, 5);
}

/**
 * Extract bullet points from text
 */
function extractBulletPoints(text: string): string[] {
  const bullets: string[] = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    // Match various bullet formats
    const bulletMatch = line.match(/^[\s]*[-*•]\s+(.+)$/);
    if (bulletMatch) {
      bullets.push(bulletMatch[1].trim());
    }
  }
  
  return bullets;
}

/**
 * Analyze tech stack from package.json and languages
 */
function analyzeTechStack(
  packageJsonContent: string | null,
  languages: Record<string, number> | null,
  readme: string
): TechStackInfo {
  const techStack: TechStackInfo = {
    languages: [],
    frameworks: [],
    databases: [],
    tools: [],
    dependencies: {},
  };

  // From languages API
  if (languages) {
    techStack.languages = Object.keys(languages);
  }

  // From package.json
  if (packageJsonContent) {
    try {
      const pkg = JSON.parse(packageJsonContent);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      techStack.dependencies = allDeps;

      // Detect frameworks
      const frameworkMap: Record<string, string> = {
        'next': 'Next.js',
        'react': 'React',
        'vue': 'Vue.js',
        'angular': 'Angular',
        'svelte': 'Svelte',
        'express': 'Express.js',
        'fastify': 'Fastify',
        'nestjs': 'NestJS',
        '@nestjs/core': 'NestJS',
        'hono': 'Hono',
        'koa': 'Koa',
        'django': 'Django',
        'flask': 'Flask',
        'fastapi': 'FastAPI',
        'tailwindcss': 'Tailwind CSS',
        'prisma': 'Prisma',
        '@prisma/client': 'Prisma',
        'drizzle-orm': 'Drizzle ORM',
        'mongoose': 'Mongoose',
        'typeorm': 'TypeORM',
        'sequelize': 'Sequelize',
      };

      for (const dep of Object.keys(allDeps)) {
        if (frameworkMap[dep]) {
          techStack.frameworks.push(frameworkMap[dep]);
        }
      }

      // Detect databases
      const dbMap: Record<string, string> = {
        'pg': 'PostgreSQL',
        'mysql2': 'MySQL',
        'mongodb': 'MongoDB',
        'mongoose': 'MongoDB',
        'redis': 'Redis',
        'ioredis': 'Redis',
        '@supabase/supabase-js': 'Supabase',
        'firebase': 'Firebase',
        '@planetscale/database': 'PlanetScale',
      };

      for (const dep of Object.keys(allDeps)) {
        if (dbMap[dep]) {
          techStack.databases.push(dbMap[dep]);
        }
      }

      // Detect tools
      const toolMap: Record<string, string> = {
        'stripe': 'Stripe',
        '@stripe/stripe-js': 'Stripe',
        'openai': 'OpenAI',
        '@langchain/core': 'LangChain',
        'langchain': 'LangChain',
        '@aws-sdk/client-s3': 'AWS S3',
        'resend': 'Resend',
        'nodemailer': 'Nodemailer',
        '@sentry/nextjs': 'Sentry',
        'posthog-js': 'PostHog',
        'zod': 'Zod',
        'trpc': 'tRPC',
        '@trpc/server': 'tRPC',
      };

      for (const dep of Object.keys(allDeps)) {
        if (toolMap[dep]) {
          techStack.tools.push(toolMap[dep]);
        }
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  // Also detect from README mentions
  const readmeLower = readme.toLowerCase();
  const readmeDetections: Array<{ category: 'frameworks' | 'databases'; pattern: string; name: string }> = [
    { category: 'frameworks', pattern: 'next.js', name: 'Next.js' },
    { category: 'frameworks', pattern: 'nextjs', name: 'Next.js' },
    { category: 'frameworks', pattern: 'react', name: 'React' },
    { category: 'frameworks', pattern: 'vue', name: 'Vue.js' },
    { category: 'frameworks', pattern: 'angular', name: 'Angular' },
    { category: 'frameworks', pattern: 'svelte', name: 'Svelte' },
    { category: 'databases', pattern: 'postgresql', name: 'PostgreSQL' },
    { category: 'databases', pattern: 'postgres', name: 'PostgreSQL' },
    { category: 'databases', pattern: 'mysql', name: 'MySQL' },
    { category: 'databases', pattern: 'mongodb', name: 'MongoDB' },
    { category: 'databases', pattern: 'redis', name: 'Redis' },
    { category: 'databases', pattern: 'supabase', name: 'Supabase' },
  ];

  for (const { category, pattern, name } of readmeDetections) {
    if (readmeLower.includes(pattern) && !techStack[category].includes(name)) {
      techStack[category].push(name);
    }
  }

  // Dedupe
  techStack.frameworks = [...new Set(techStack.frameworks)];
  techStack.databases = [...new Set(techStack.databases)];
  techStack.tools = [...new Set(techStack.tools)];

  return techStack;
}

/**
 * Analyze repository structure
 */
function analyzeStructure(contents: GitHubContentResponse[] | null): RepoStructure {
  const structure: RepoStructure = {
    totalFiles: 0,
    totalDirs: 0,
    mainDirs: [],
    hasTests: false,
    hasCI: false,
    hasDocs: false,
    hasDocker: false,
  };

  if (!contents || !Array.isArray(contents)) return structure;

  for (const item of contents) {
    if (item.type === 'file') {
      structure.totalFiles++;
      const name = item.name;
      if (name === 'Dockerfile' || name === 'docker-compose.yml') {
        structure.hasDocker = true;
      }
    } else if (item.type === 'dir') {
      structure.totalDirs++;
      const name = item.name;
      structure.mainDirs.push(name);
      
      if (['test', 'tests', '__tests__', 'spec'].includes(name)) {
        structure.hasTests = true;
      }
      if (['.github', '.circleci', '.gitlab-ci'].includes(name)) {
        structure.hasCI = true;
      }
      if (['docs', 'documentation'].includes(name)) {
        structure.hasDocs = true;
      }
    }
  }

  return structure;
}

/**
 * Process commits into usable format
 */
function processCommits(commits: GitHubCommitResponse[] | null): RepoCommit[] {
  if (!commits || !Array.isArray(commits)) return [];

  return commits.slice(0, 10).map(commit => ({
    sha: commit.sha.substring(0, 7),
    message: commit.commit?.message?.split('\n')[0] || '',
    date: commit.commit?.author?.date || '',
    author: commit.commit?.author?.name || '',
  }));
}

/**
 * Calculate commit frequency
 */
function calculateCommitFrequency(commits: GitHubCommitResponse[] | null): string {
  if (!commits || !Array.isArray(commits) || commits.length < 2) return 'inactive';

  const dates = commits
    .map(c => new Date(c.commit?.author?.date || ''))
    .filter(d => !isNaN(d.getTime()));

  if (dates.length < 2) return 'inactive';

  const newest = dates[0].getTime();
  const oldest = dates[dates.length - 1].getTime();
  const daysBetween = (newest - oldest) / (1000 * 60 * 60 * 24);
  const commitsPerDay = commits.length / Math.max(daysBetween, 1);

  if (commitsPerDay >= 1) return 'daily';
  if (commitsPerDay >= 0.14) return 'weekly'; // ~1 per week
  if (commitsPerDay >= 0.03) return 'monthly'; // ~1 per month
  return 'inactive';
}

/**
 * Generate case study talking points
 */
function generateCaseStudyPoints(data: {
  name: string;
  description: string;
  stars: number;
  features: string[];
  techStack: TechStackInfo;
  structure: RepoStructure;
  recentCommits: RepoCommit[];
}): string[] {
  const points: string[] = [];

  // Tech stack point
  const allTech = [
    ...data.techStack.frameworks,
    ...data.techStack.databases,
    data.techStack.languages[0],
  ].filter(Boolean).slice(0, 4);
  
  if (allTech.length > 0) {
    points.push(`Built with ${allTech.join(', ')}`);
  }

  // Features point
  if (data.features.length > 0) {
    points.push(`Key features: ${data.features.slice(0, 3).join(', ')}`);
  }

  // Stars as social proof
  if (data.stars > 10) {
    points.push(`${data.stars} GitHub stars (community validated)`);
  }

  // Architecture points
  if (data.structure.hasTests) {
    points.push('Includes comprehensive test suite');
  }
  if (data.structure.hasCI) {
    points.push('CI/CD pipeline configured');
  }
  if (data.structure.hasDocker) {
    points.push('Dockerized for easy deployment');
  }

  // Active development
  if (data.recentCommits.length > 5) {
    points.push('Actively maintained with regular updates');
  }

  // Description as talking point
  if (data.description && data.description.length > 20) {
    points.push(data.description);
  }

  return points.slice(0, 6);
}

/**
 * Fetch ALL repositories for a user with pagination
 */
export async function fetchAllUserRepos(
  username: string,
  pat: string
): Promise<{ success: boolean; repos: Array<{ name: string; fullName: string; pushedAt: string; isPrivate: boolean }>; total: number; error?: string }> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'upwork-proposal-writer',
    'Authorization': `Bearer ${pat}`,
  };

  const allRepos: Array<{ name: string; fullName: string; pushedAt: string; isPrivate: boolean }> = [];
  let page = 1;
  const perPage = 100; // Max allowed by GitHub API

  try {
    // Use /user/repos to get ALL repos including private ones (requires auth)
    // affiliation=owner gets only repos owned by the user
    while (true) {
      const response = await fetch(
        `${GITHUB_API}/user/repos?sort=pushed&per_page=${perPage}&page=${page}&affiliation=owner`,
        { headers }
      );

      if (!response.ok) {
        return { success: false, repos: [], total: 0, error: `GitHub API error: ${response.status}` };
      }

      const repos = await response.json();
      
      if (repos.length === 0) break;

      // Filter out forks and archived, extract minimal info
      const filtered = repos
        .filter((r: Record<string, unknown>) => !r.fork && !r.archived)
        .map((r: Record<string, unknown>) => ({
          name: r.name as string,
          fullName: r.full_name as string,
          pushedAt: r.pushed_at as string,
          isPrivate: r.private as boolean,
        }));

      allRepos.push(...filtered);
      
      console.log(`Fetched page ${page}: ${filtered.length} repos (${filtered.filter((r: { isPrivate: boolean }) => r.isPrivate).length} private)`);
      
      if (repos.length < perPage) break; // Last page
      page++;
      
      // Small delay between pages
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const privateCount = allRepos.filter((r: { isPrivate: boolean }) => r.isPrivate).length;
    console.log(`Total repos found: ${allRepos.length} (${privateCount} private, ${allRepos.length - privateCount} public)`);

    return { success: true, repos: allRepos, total: allRepos.length };
  } catch (error) {
    console.error('Error fetching repos:', error);
    return { 
      success: false, 
      repos: [], 
      total: 0,
      error: error instanceof Error ? error.message : 'Failed to fetch repos'
    };
  }
}

/**
 * Analyze multiple repositories for a user (incremental - skips already synced)
 */
export async function analyzeUserRepositories(
  username: string,
  pat: string,
  maxRepos: number = 10,
  skipRepos: string[] = [] // List of repo fullNames to skip
): Promise<{ success: boolean; repos: DeepRepoAnalysis[]; errors: string[]; skipped: number }> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'upwork-proposal-writer',
    'Authorization': `Bearer ${pat}`,
  };

  const errors: string[] = [];
  const repos: DeepRepoAnalysis[] = [];
  let skipped = 0;

  try {
    // Fetch user's repos including private ones (sorted by recently pushed)
    // Using /user/repos with affiliation=owner to get private repos too
    const reposResponse = await fetch(
      `${GITHUB_API}/user/repos?sort=pushed&per_page=100&affiliation=owner`,
      { headers }
    );

    if (!reposResponse.ok) {
      return { success: false, repos: [], errors: ['Failed to fetch repositories'], skipped: 0 };
    }

    const reposList = await reposResponse.json();

    // Filter out forks, archived, and already synced repos
    const ownRepos = reposList.filter((r: Record<string, unknown>) => {
      if (r.fork || r.archived) return false;
      if (skipRepos.includes(r.full_name as string)) {
        skipped++;
        return false;
      }
      return true;
    });

    // Limit to maxRepos
    const reposToAnalyze = ownRepos.slice(0, maxRepos);
    
    console.log(`Analyzing ${reposToAnalyze.length} repos (skipped ${skipped} already synced)`);

    // Analyze each repo (with rate limiting - 2 at a time)
    for (let i = 0; i < reposToAnalyze.length; i += 2) {
      const batch = reposToAnalyze.slice(i, i + 2);
      const results = await Promise.all(
        batch.map((r: Record<string, unknown>) => 
          analyzeRepository(username, r.name as string, pat)
        )
      );

      for (const result of results) {
        if (result.success && result.repo) {
          repos.push(result.repo);
        } else if (result.error) {
          errors.push(result.error);
        }
      }

      // Small delay to avoid rate limiting
      if (i + 2 < reposToAnalyze.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return { success: true, repos, errors, skipped };
  } catch (error) {
    return { 
      success: false, 
      repos, 
      errors: [error instanceof Error ? error.message : 'Analysis failed'],
      skipped 
    };
  }
}
