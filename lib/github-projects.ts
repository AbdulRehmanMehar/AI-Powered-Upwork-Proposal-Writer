/**
 * GitHub Projects Fetcher
 * Fetches real project data from user's GitHub to prevent AI hallucination
 */

export interface GitHubRepo {
  name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  topics: string[];
  updated_at: string;
  fork: boolean;
  archived: boolean;
}

export interface GitHubProject {
  name: string;
  description: string;
  url: string;
  language: string;
  stars: number;
  topics: string[];
  readme?: string;
  lastUpdated: string;
}

export interface FetchResult {
  success: boolean;
  projects: GitHubProject[];
  error?: string;
}

/**
 * Fetch user's public repositories from GitHub
 */
export async function fetchGitHubProjects(
  username: string,
  pat?: string, // Personal Access Token for private repos
  maxRepos: number = 20
): Promise<FetchResult> {
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'upwork-proposal-writer',
    };

    // Add auth header if PAT provided (allows private repos + higher rate limit)
    if (pat) {
      headers['Authorization'] = `Bearer ${pat}`;
    }

    // Fetch repos sorted by recently updated
    const reposResponse = await fetch(
      `https://api.github.com/users/${username}/repos?sort=updated&per_page=${maxRepos}&type=all`,
      { headers }
    );

    if (!reposResponse.ok) {
      if (reposResponse.status === 404) {
        return { success: false, projects: [], error: `GitHub user "${username}" not found` };
      }
      if (reposResponse.status === 401) {
        return { success: false, projects: [], error: 'Invalid GitHub token' };
      }
      if (reposResponse.status === 403) {
        return { success: false, projects: [], error: 'GitHub rate limit exceeded. Try again later or add a PAT.' };
      }
      return { success: false, projects: [], error: `GitHub API error: ${reposResponse.status}` };
    }

    const repos: GitHubRepo[] = await reposResponse.json();

    // Filter out forks and archived repos (we want original work)
    const originalRepos = repos.filter(repo => !repo.fork && !repo.archived);

    // Fetch README for top repos (with rate limiting consideration)
    const projects: GitHubProject[] = await Promise.all(
      originalRepos.slice(0, 10).map(async (repo) => {
        let readme: string | undefined;

        try {
          // Try to fetch README
          const readmeResponse = await fetch(
            `https://api.github.com/repos/${username}/${repo.name}/readme`,
            { headers }
          );

          if (readmeResponse.ok) {
            const readmeData = await readmeResponse.json();
            // README is base64 encoded
            const decodedReadme = Buffer.from(readmeData.content, 'base64').toString('utf-8');
            // Take first 1000 chars, clean up markdown
            readme = cleanReadme(decodedReadme).substring(0, 1000);
          }
        } catch {
          // Ignore README fetch errors
        }

        return {
          name: repo.name,
          description: repo.description || 'No description',
          url: repo.html_url,
          language: repo.language || 'Unknown',
          stars: repo.stargazers_count,
          topics: repo.topics || [],
          readme,
          lastUpdated: repo.updated_at,
        };
      })
    );

    return { success: true, projects };
  } catch (error) {
    console.error('GitHub fetch error:', error);
    return {
      success: false,
      projects: [],
      error: error instanceof Error ? error.message : 'Failed to fetch GitHub projects',
    };
  }
}

/**
 * Clean up README markdown for AI consumption
 */
function cleanReadme(readme: string): string {
  return readme
    // Remove badges
    .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove code blocks but keep inline code
    .replace(/```[\s\S]*?```/g, '[code block]')
    // Simplify headers
    .replace(/^#+\s*/gm, '')
    // Remove excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Format projects for AI prompt
 */
export function formatProjectsForPrompt(projects: GitHubProject[]): string {
  if (projects.length === 0) {
    return `## YOUR GITHUB PROJECTS: None found relevant to this job.
⚠️ DO NOT MAKE UP PROJECT NAMES OR METRICS. Use generic phrasing like:
- "Built something similar before"
- "Worked on a project with these requirements"
- "Done this kind of work for other clients"`;
  }

  let prompt = `## YOUR REAL GITHUB PROJECTS (use these, don't make up others!):\n\n`;

  for (const project of projects) {
    prompt += `### ${project.name}\n`;
    prompt += `- **URL**: ${project.url}\n`;
    prompt += `- **Language**: ${project.language}\n`;
    if (project.description && project.description !== 'No description') {
      prompt += `- **What it does**: ${project.description}\n`;
    }
    if (project.topics.length > 0) {
      prompt += `- **Tech**: ${project.topics.join(', ')}\n`;
    }
    if (project.stars > 0) {
      prompt += `- **Stars**: ${project.stars}\n`;
    }
    if (project.readme) {
      prompt += `- **Details**: ${project.readme.substring(0, 300)}...\n`;
    }
    prompt += `\n`;
  }

  prompt += `⚠️ CRITICAL: Only reference these REAL projects. Include the GitHub URL as your portfolio link.\n`;
  prompt += `If none of these match the job well, use generic phrasing instead of making things up.`;

  return prompt;
}

/**
 * Check if we have valid GitHub credentials
 */
export function hasGitHubCredentials(profile: { githubUsername?: string; githubPat?: string }): boolean {
  return !!(profile.githubUsername && profile.githubUsername.length > 0);
}
