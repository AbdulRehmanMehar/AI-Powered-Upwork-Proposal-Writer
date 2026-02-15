'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Profile {
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
  resumeFileName?: string;
  resumeUploadedAt?: string;
  // GitHub integration
  githubUsername?: string;
  githubPat?: string;
  githubProjectsCache?: string;
  githubLastFetched?: string;
}

interface GitHubProject {
  name: string;
  description: string;
  url: string;
  language: string;
  stars: number;
  topics: string[];
  lastUpdated: string;
}

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [name, setName] = useState('');
  const [profile, setProfile] = useState<Profile>({});
  
  // Array field helpers (convert to comma-separated strings for editing)
  const [skillsText, setSkillsText] = useState('');
  const [specializationsText, setSpecializationsText] = useState('');
  const [portfolioLinksText, setPortfolioLinksText] = useState('');
  const [pastClientsText, setPastClientsText] = useState('');
  const [achievementsText, setAchievementsText] = useState('');
  const [certificationsText, setCertificationsText] = useState('');
  
  // Additional details
  const [additionalDetails, setAdditionalDetails] = useState('');
  
  // Resume upload state
  const [uploadingResume, setUploadingResume] = useState(false);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [resumeUploadedAt, setResumeUploadedAt] = useState<string | null>(null);
  
  // Upwork import state
  const [upworkUrl, setUpworkUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [needsManualInput, setNeedsManualInput] = useState(false);
  const [manualContent, setManualContent] = useState('');
  const [importInstructions, setImportInstructions] = useState<string[]>([]);

  // GitHub integration state
  const [githubUsername, setGithubUsername] = useState('');
  const [githubPat, setGithubPat] = useState('');
  const [githubProjects, setGithubProjects] = useState<GitHubProject[]>([]);
  const [githubLastFetched, setGithubLastFetched] = useState<string | null>(null);
  const [fetchingGithub, setFetchingGithub] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubSuccess, setGithubSuccess] = useState(false);
  const [syncingGithub, setSyncingGithub] = useState(false);
  const [githubSyncStats, setGithubSyncStats] = useState<{
    totalChunks: number;
    repos: string[];
    isConfigured: boolean;
  } | null>(null);
  const [githubSyncProgress, setGithubSyncProgress] = useState<{
    totalSynced: number;
    totalRepos: number;
    remainingToSync: number;
    percentComplete: number;
    isComplete: boolean;
  } | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login?callbackUrl=/settings');
    }
  }, [status, router]);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch('/api/profile');
        if (res.ok) {
          const data = await res.json();
          setName(data.data.name || '');
          setProfile(data.data.profile || {});
          
          // Set array fields as text
          setSkillsText(data.data.profile?.skills?.join(', ') || '');
          setSpecializationsText(data.data.profile?.specializations?.join(', ') || '');
          setPortfolioLinksText(data.data.profile?.portfolioLinks?.join('\n') || '');
          setPastClientsText(data.data.profile?.pastClients?.join(', ') || '');
          setAchievementsText(data.data.profile?.achievements?.join('\n') || '');
          setCertificationsText(data.data.profile?.certifications?.join(', ') || '');
          
          // Set additional details and resume info
          setAdditionalDetails(data.data.profile?.additionalDetails || '');
          setResumeFileName(data.data.profile?.resumeFileName || null);
          setResumeUploadedAt(data.data.profile?.resumeUploadedAt || null);
          
          // Set GitHub info
          setGithubUsername(data.data.profile?.githubUsername || '');
          // Note: PAT is not returned by default for security
          if (data.data.profile?.githubProjectsCache) {
            try {
              setGithubProjects(JSON.parse(data.data.profile.githubProjectsCache));
            } catch {
              setGithubProjects([]);
            }
          }
          setGithubLastFetched(data.data.profile?.githubLastFetched || null);
          
          // Fetch GitHub sync status
          fetchGithubSyncStatus();
        }
      } catch (err) {
        console.error('Failed to fetch profile:', err);
      } finally {
        setLoading(false);
      }
    };

    if (status === 'authenticated') {
      fetchProfile();
    }
  }, [status]);

  // Resume upload handler
  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingResume(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('resume', file);

      const res = await fetch('/api/profile/upload-resume', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to upload resume');
      }

      setResumeFileName(data.data.fileName);
      setResumeUploadedAt(new Date().toISOString());
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload resume');
    } finally {
      setUploadingResume(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Resume delete handler
  const handleDeleteResume = async () => {
    if (!confirm('Are you sure you want to delete your resume?')) return;

    try {
      const res = await fetch('/api/profile/upload-resume', {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to delete resume');
      }

      setResumeFileName(null);
      setResumeUploadedAt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete resume');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Parse array fields
      const updatedProfile: Profile = {
        ...profile,
        skills: skillsText.split(',').map(s => s.trim()).filter(Boolean),
        specializations: specializationsText.split(',').map(s => s.trim()).filter(Boolean),
        portfolioLinks: portfolioLinksText.split('\n').map(s => s.trim()).filter(Boolean),
        pastClients: pastClientsText.split(',').map(s => s.trim()).filter(Boolean),
        achievements: achievementsText.split('\n').map(s => s.trim()).filter(Boolean),
        certifications: certificationsText.split(',').map(s => s.trim()).filter(Boolean),
        additionalDetails: additionalDetails.trim() || undefined,
      };

      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, profile: updatedProfile }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      // Re-sync profile embeddings in the background (so vector search uses fresh data)
      fetch('/api/profile/embeddings', { method: 'POST' })
        .then(r => r.ok ? console.log('✅ Profile embeddings refreshed') : console.warn('⚠️ Embedding refresh failed'))
        .catch(e => console.warn('⚠️ Embedding refresh error:', e));

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleImportUpwork = async (useManualContent = false) => {
    if (!useManualContent && !upworkUrl.trim()) {
      setError('Please enter your Upwork profile URL');
      return;
    }
    
    if (useManualContent && !manualContent.trim()) {
      setError('Please paste your Upwork profile content');
      return;
    }

    setImporting(true);
    setError(null);
    setImportSuccess(false);

    try {
      const res = await fetch('/api/profile/import-upwork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          useManualContent 
            ? { manualContent: manualContent.trim() }
            : { upworkUrl: upworkUrl.trim() }
        ),
      });

      const data = await res.json();

      // Handle the case where manual input is needed
      if (data.needsManualInput) {
        setNeedsManualInput(true);
        setImportInstructions(data.instructions || []);
        setImporting(false);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to import profile');
      }

      const extracted = data.data.extracted;

      // Update profile fields with extracted data
      if (extracted.title) {
        setProfile(prev => ({ ...prev, title: extracted.title }));
      }
      if (extracted.summary) {
        setProfile(prev => ({ ...prev, summary: extracted.summary }));
      }
      if (extracted.yearsExperience) {
        setProfile(prev => ({ ...prev, yearsExperience: extracted.yearsExperience }));
      }
      if (extracted.hourlyRate) {
        setProfile(prev => ({ ...prev, hourlyRate: extracted.hourlyRate }));
      }
      if (extracted.availability) {
        setProfile(prev => ({ ...prev, availability: extracted.availability }));
      }
      if (extracted.timezone) {
        setProfile(prev => ({ ...prev, timezone: extracted.timezone }));
      }
      
      // Update array fields
      if (extracted.skills?.length) {
        setSkillsText(extracted.skills.join(', '));
      }
      if (extracted.specializations?.length) {
        setSpecializationsText(extracted.specializations.join(', '));
      }
      if (extracted.certifications?.length) {
        setCertificationsText(extracted.certifications.join(', '));
      }
      if (extracted.achievements?.length) {
        setAchievementsText(extracted.achievements.join('\n'));
      }

      setImportSuccess(true);
      setUpworkUrl('');
      setManualContent('');
      setNeedsManualInput(false);
      setTimeout(() => setImportSuccess(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import profile');
    } finally {
      setImporting(false);
    }
  };

  // GitHub integration handler
  const handleFetchGithub = async () => {
    if (!githubUsername.trim()) {
      setGithubError('Please enter your GitHub username');
      return;
    }

    setFetchingGithub(true);
    setGithubError(null);
    setGithubSuccess(false);

    try {
      const res = await fetch('/api/profile/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: githubUsername.trim(),
          pat: githubPat.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch GitHub projects');
      }

      setGithubProjects(data.data.projects);
      setGithubLastFetched(new Date().toISOString());
      setGithubSuccess(true);
      // Clear PAT from state for security (it's saved server-side)
      setGithubPat('');
      setTimeout(() => setGithubSuccess(false), 5000);
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : 'Failed to fetch GitHub projects');
    } finally {
      setFetchingGithub(false);
    }
  };

  // Clear GitHub integration
  const handleClearGithub = async () => {
    if (!confirm('Are you sure you want to disconnect GitHub? This will remove all cached projects.')) return;

    try {
      const res = await fetch('/api/profile/github', {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to disconnect GitHub');
      }

      setGithubUsername('');
      setGithubPat('');
      setGithubProjects([]);
      setGithubLastFetched(null);
      setGithubSyncStats(null);
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : 'Failed to disconnect GitHub');
    }
  };

  // Deep sync GitHub projects to knowledge base (incremental)
  const handleDeepSyncGithub = async (fullResync = false) => {
    if (!githubUsername.trim()) {
      setGithubError('Please enter your GitHub username first');
      return;
    }
    if (!githubPat.trim() && !githubProjects.length) {
      setGithubError('A Personal Access Token is required for deep sync');
      return;
    }

    setSyncingGithub(true);
    setGithubError(null);

    try {
      // First save credentials if PAT is provided
      if (githubPat.trim()) {
        await fetch('/api/profile/github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: githubUsername.trim(),
            pat: githubPat.trim(),
          }),
        });
      }

      // Then trigger deep sync (incremental by default)
      const params = new URLSearchParams();
      if (fullResync) params.set('fullResync', 'true');
      params.set('batchSize', '15'); // Sync 15 repos per batch
      
      const res = await fetch(`/api/profile/github/sync?${params.toString()}`, {
        method: 'POST',
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Deep sync failed');
      }

      setGithubSyncStats({
        totalChunks: data.data.embeddedChunks,
        repos: data.data.repos,
        isConfigured: true,
      });
      setGithubSyncProgress(data.data.progress);
      setGithubLastFetched(data.data.lastSynced);
      setGithubSuccess(true);
      setGithubPat(''); // Clear PAT from UI
      setTimeout(() => setGithubSuccess(false), 5000);
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : 'Deep sync failed');
    } finally {
      setSyncingGithub(false);
    }
  };

  // Fetch GitHub sync status on load
  const fetchGithubSyncStatus = async () => {
    try {
      const res = await fetch('/api/profile/github/sync');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setGithubSyncStats({
            totalChunks: data.data.totalChunks,
            repos: data.data.repos,
            isConfigured: data.data.isConfigured,
          });
          if (data.data.progress) {
            setGithubSyncProgress(data.data.progress);
          }
        }
      }
    } catch {
      // Ignore errors
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 pb-20 lg:pb-0">
      {/* Header */}
      <header className="border-b border-zinc-700/50 bg-zinc-900/80 backdrop-blur-lg sticky top-0 z-40 safe-top">
        <div className="max-w-4xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/" className="text-zinc-400 hover:text-white transition-colors p-1 -ml-1 lg:hidden">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <Link href="/" className="hidden lg:flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <span className="text-xl font-bold text-white">ProposalAI</span>
            </Link>
            <h1 className="text-base sm:text-lg font-semibold text-white lg:hidden">Settings</h1>
          </div>
          <Link
            href="/"
            className="hidden lg:flex px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            ← Back to Generator
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
        <div className="mb-4 sm:mb-8 hidden sm:block">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Profile Settings</h1>
          <p className="text-zinc-400 mt-1 text-sm sm:text-base">Configure your background for better proposals</p>
        </div>

        <form onSubmit={handleSave} className="space-y-4 sm:space-y-6">
          {/* Notifications */}
          {error && (
            <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300">
              {error}
            </div>
          )}
          {success && (
            <div className="p-4 bg-emerald-900/30 border border-emerald-700/50 rounded-xl text-emerald-300">
              Settings saved successfully!
            </div>
          )}
          {importSuccess && (
            <div className="p-4 bg-blue-900/30 border border-blue-700/50 rounded-xl text-blue-300">
              ✨ Profile imported successfully! Review the fields below and save.
            </div>
          )}

          {/* Upwork Import Section */}
          <div className="bg-gradient-to-br from-emerald-900/30 to-teal-900/30 rounded-2xl border border-emerald-700/50 p-6">
            <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import from Upwork
            </h2>
            <p className="text-zinc-400 text-sm mb-4">
              Enter your Upwork profile URL to auto-fill your details using AI
            </p>
            
            {!needsManualInput ? (
              <>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={upworkUrl}
                    onChange={(e) => setUpworkUrl(e.target.value)}
                    placeholder="https://www.upwork.com/freelancers/~yourprofileid"
                    disabled={importing}
                    className="flex-1 px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => handleImportUpwork(false)}
                    disabled={importing || !upworkUrl.trim()}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                  >
                    {importing ? (
                      <>
                        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Importing...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                        </svg>
                        Import Profile
                      </>
                    )}
                  </button>
                </div>
                <p className="text-zinc-500 text-xs mt-2">
                  Supported formats: Full URL (upwork.com/freelancers/~id or upwork.com/fl/username) or just the profile ID
                </p>
                
                {/* Quick method: paste profile content directly */}
                <div className="mt-4 pt-4 border-t border-zinc-700/50">
                  <button
                    type="button"
                    onClick={() => setNeedsManualInput(true)}
                    className="text-emerald-400 hover:text-emerald-300 text-sm font-medium flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Or paste profile content directly (recommended)
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-blue-900/30 border border-blue-700/50 rounded-xl">
                  <p className="text-blue-300 font-medium mb-2">📋 Paste Your Profile Content</p>
                  <p className="text-blue-200/80 text-sm mb-3">
                    Copy your Upwork profile content and paste it below. Our AI will extract your details automatically.
                  </p>
                  <ol className="text-zinc-300 text-sm space-y-1 list-decimal list-inside">
                    <li>Open your Upwork profile in a browser</li>
                    <li>Select all text on the page (Cmd+A or Ctrl+A)</li>
                    <li>Copy it (Cmd+C or Ctrl+C)</li>
                    <li>Paste it below</li>
                  </ol>
                </div>
                
                <textarea
                  value={manualContent}
                  onChange={(e) => setManualContent(e.target.value)}
                  placeholder="Paste your Upwork profile content here...

Example of what to paste:
- Your name and title
- Your bio/overview
- Skills listed on your profile
- Work history and portfolio items
- Hourly rate and availability
- Any certifications or achievements"
                  rows={10}
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all resize-none"
                />
                
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setNeedsManualInput(false);
                      setManualContent('');
                    }}
                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleImportUpwork(true)}
                    disabled={importing || !manualContent.trim()}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {importing ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Extracting with AI...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Extract & Import
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Resume Upload Section */}
          <div className="bg-gradient-to-br from-violet-900/30 to-purple-900/30 rounded-2xl border border-violet-700/50 p-6">
            <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Resume / CV
            </h2>
            <p className="text-zinc-400 text-sm mb-4">
              Upload your resume to provide additional context for AI-generated proposals
            </p>
            
            {resumeFileName ? (
              <div className="bg-zinc-900/50 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-violet-600/20 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium">{resumeFileName}</p>
                    {resumeUploadedAt && (
                      <p className="text-zinc-500 text-sm">
                        Uploaded {new Date(resumeUploadedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-all cursor-pointer">
                    Replace
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.txt,.md"
                      onChange={handleResumeUpload}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleDeleteResume}
                    className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium rounded-lg transition-all"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <label className="block">
                <div className={`border-2 border-dashed border-zinc-700 hover:border-violet-500/50 rounded-xl p-8 text-center cursor-pointer transition-all ${uploadingResume ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploadingResume ? (
                    <div className="flex flex-col items-center gap-3">
                      <svg className="w-8 h-8 text-violet-500 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <p className="text-zinc-400">Uploading...</p>
                    </div>
                  ) : (
                    <>
                      <svg className="w-12 h-12 text-zinc-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <p className="text-white font-medium mb-1">Drop your resume here or click to upload</p>
                      <p className="text-zinc-500 text-sm">PDF, DOCX, TXT, or MD (max 5MB)</p>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  onChange={handleResumeUpload}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* GitHub Integration Section */}
          <div className="bg-gradient-to-br from-slate-900/50 to-zinc-900/50 rounded-2xl border border-slate-700/50 p-6">
            <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub Integration
            </h2>
            <p className="text-zinc-400 text-sm mb-4">
              Connect your GitHub to automatically use your real projects in proposals. No more made-up examples!
            </p>

            {githubError && (
              <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
                {githubError}
              </div>
            )}
            {githubSuccess && (
              <div className="mb-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm">
                ✨ GitHub projects fetched successfully!
              </div>
            )}

            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">GitHub Username</label>
                  <input
                    type="text"
                    value={githubUsername}
                    onChange={(e) => setGithubUsername(e.target.value)}
                    placeholder="your-username"
                    disabled={fetchingGithub}
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-slate-500/50 focus:border-slate-500 transition-all disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Personal Access Token <span className="text-zinc-500">(optional)</span>
                  </label>
                  <input
                    type="password"
                    value={githubPat}
                    onChange={(e) => setGithubPat(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxx"
                    disabled={fetchingGithub}
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-slate-500/50 focus:border-slate-500 transition-all disabled:opacity-50"
                  />
                </div>
              </div>
              
              <p className="text-zinc-500 text-xs">
                💡 <strong>PAT is optional</strong> but recommended. It allows access to private repos and has higher rate limits. 
                <a href="https://github.com/settings/tokens/new?scopes=repo&description=Proposal%20Writer" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-300 ml-1">
                  Create a token →
                </a>
              </p>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleFetchGithub}
                  disabled={fetchingGithub || syncingGithub || !githubUsername.trim()}
                  className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {fetchingGithub ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Fetching...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Quick Fetch
                    </>
                  )}
                </button>
                
                {/* Deep Sync Button */}
                <button
                  type="button"
                  onClick={() => handleDeepSyncGithub(false)}
                  disabled={fetchingGithub || syncingGithub || !githubUsername.trim()}
                  className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {syncingGithub ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Syncing ({githubSyncProgress ? `${githubSyncProgress.percentComplete}%` : '...'})
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                      </svg>
                      {githubSyncProgress && githubSyncProgress.totalSynced > 0 && !githubSyncProgress.isComplete 
                        ? 'Continue Sync' 
                        : 'Deep Sync to AI'
                      }
                    </>
                  )}
                </button>
                
                {githubProjects.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearGithub}
                    disabled={fetchingGithub || syncingGithub}
                    className="px-4 py-3 bg-red-600/20 hover:bg-red-600/30 text-red-400 font-medium rounded-xl transition-all disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                )}
              </div>
              
              {/* Deep Sync explanation */}
              <div className="bg-zinc-900/50 rounded-lg p-3 text-xs text-zinc-400">
                <p className="font-medium text-zinc-300 mb-1">Quick Fetch vs Deep Sync:</p>
                <ul className="space-y-1 ml-3">
                  <li>• <strong>Quick Fetch:</strong> Gets basic repo info (name, description, stars)</li>
                  <li>• <strong>Deep Sync:</strong> Analyzes READMEs, tech stacks, features, and embeds into AI knowledge base for better matching</li>
                </ul>
                <p className="mt-2 text-emerald-400">💡 Deep Sync requires a PAT and takes 30-60 seconds per batch. Syncs incrementally!</p>
              </div>

              {/* Sync Progress */}
              {githubSyncProgress && githubSyncProgress.totalRepos > 0 && (
                <div className="mt-4 p-4 bg-zinc-900/50 border border-zinc-700/50 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-zinc-300 font-medium">Sync Progress</span>
                    <span className="text-zinc-400 text-sm">
                      {githubSyncProgress.totalSynced} / {githubSyncProgress.totalRepos} repos
                    </span>
                  </div>
                  
                  {/* Progress bar */}
                  <div className="w-full bg-zinc-800 rounded-full h-2 mb-3">
                    <div 
                      className={`h-2 rounded-full transition-all duration-500 ${
                        githubSyncProgress.isComplete ? 'bg-emerald-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${githubSyncProgress.percentComplete}%` }}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">
                      {githubSyncProgress.isComplete 
                        ? '✓ All repos synced!' 
                        : `${githubSyncProgress.remainingToSync} repos remaining`
                      }
                    </span>
                    
                    {!githubSyncProgress.isComplete && (
                      <button
                        onClick={() => handleDeepSyncGithub(false)}
                        disabled={syncingGithub}
                        className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-1"
                      >
                        {syncingGithub ? (
                          <>
                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Syncing...
                          </>
                        ) : (
                          <>Continue Sync</>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Knowledge Base Status */}
              {githubSyncStats && githubSyncStats.isConfigured && (
                <div className="mt-4 p-4 bg-emerald-900/20 border border-emerald-700/50 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-emerald-300 font-medium">Knowledge Base Active</span>
                    </div>
                    
                    {/* Full resync button */}
                    <button
                      onClick={() => handleDeepSyncGithub(true)}
                      disabled={syncingGithub}
                      className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded disabled:opacity-50"
                      title="Clear all and sync from scratch"
                    >
                      Full Resync
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-zinc-500">Repos Indexed</p>
                      <p className="text-white font-medium">{githubSyncStats.repos.length}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Knowledge Chunks</p>
                      <p className="text-white font-medium">{githubSyncStats.totalChunks}</p>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 mt-2">
                    ✓ Your projects are embedded in AI and will be automatically matched to job requirements
                  </p>
                </div>
              )}

              {/* Display fetched projects */}
              {githubProjects.length > 0 && (
                <div className="mt-4 pt-4 border-t border-zinc-700/50">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-zinc-300">
                      {githubProjects.length} projects found
                    </p>
                    {githubLastFetched && (
                      <p className="text-xs text-zinc-500">
                        Last updated: {new Date(githubLastFetched).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="grid gap-2 max-h-60 overflow-y-auto pr-2">
                    {githubProjects.map((project, index) => (
                      <div key={index} className="bg-zinc-900/50 rounded-lg p-3 flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <a 
                              href={project.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-slate-300 hover:text-white font-medium truncate"
                            >
                              {project.name}
                            </a>
                            {project.stars > 0 && (
                              <span className="text-xs text-yellow-500 flex items-center gap-0.5">
                                ★ {project.stars}
                              </span>
                            )}
                          </div>
                          {project.description && project.description !== 'No description' && (
                            <p className="text-zinc-500 text-xs mt-0.5 truncate">
                              {project.description}
                            </p>
                          )}
                        </div>
                        {project.language && (
                          <span className="text-xs px-2 py-1 bg-zinc-800 text-zinc-400 rounded ml-2 shrink-0">
                            {project.language}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-zinc-500 text-xs mt-3">
                    ✓ These projects will be automatically matched to job requirements in your proposals
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Additional Details Section */}
          <div className="bg-gradient-to-br from-amber-900/30 to-orange-900/30 rounded-2xl border border-amber-700/50 p-6">
            <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Additional Details
            </h2>
            <p className="text-zinc-400 text-sm mb-4">
              Add any extra context that will help generate better proposals (work style, unique value props, specific experiences, etc.)
            </p>
            
            <textarea
              value={additionalDetails}
              onChange={(e) => setAdditionalDetails(e.target.value)}
              placeholder="Examples:
• I prefer async communication and deliver work ahead of deadlines
• I've built 50+ React apps with a focus on performance optimization  
• I offer free post-project support for 2 weeks
• I've worked with clients in healthcare, fintech, and e-commerce
• My superpower is translating complex requirements into simple solutions"
              rows={6}
              className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all resize-none"
            />
            <p className="text-zinc-500 text-xs mt-2">
              This information will be used as additional context when generating your proposals
            </p>
          </div>

          {/* Basic Info */}
          <div className="bg-zinc-800/50 rounded-2xl border border-zinc-700/50 p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Basic Information
            </h2>
            
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Professional Title</label>
                <input
                  type="text"
                  value={profile.title || ''}
                  onChange={(e) => setProfile({ ...profile, title: e.target.value })}
                  placeholder="e.g., Senior React Developer"
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Years of Experience</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={profile.yearsExperience || ''}
                  onChange={(e) => setProfile({ ...profile, yearsExperience: parseInt(e.target.value) || undefined })}
                  placeholder="5"
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Hourly Rate</label>
                <input
                  type="text"
                  value={profile.hourlyRate || ''}
                  onChange={(e) => setProfile({ ...profile, hourlyRate: e.target.value })}
                  placeholder="e.g., $50-75/hour"
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-zinc-300 mb-1">Professional Summary</label>
              <textarea
                value={profile.summary || ''}
                onChange={(e) => setProfile({ ...profile, summary: e.target.value })}
                placeholder="A brief summary of your professional background and what you specialize in..."
                rows={3}
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all resize-none"
              />
            </div>
          </div>

          {/* Skills & Expertise */}
          <div className="bg-zinc-800/50 rounded-2xl border border-zinc-700/50 p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Skills & Expertise
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Skills <span className="text-zinc-500">(comma separated)</span>
                </label>
                <input
                  type="text"
                  value={skillsText}
                  onChange={(e) => setSkillsText(e.target.value)}
                  placeholder="React, Node.js, TypeScript, PostgreSQL"
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Specializations <span className="text-zinc-500">(comma separated)</span>
                </label>
                <input
                  type="text"
                  value={specializationsText}
                  onChange={(e) => setSpecializationsText(e.target.value)}
                  placeholder="E-commerce, SaaS, Fintech, Healthcare"
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Certifications <span className="text-zinc-500">(comma separated)</span>
                </label>
                <input
                  type="text"
                  value={certificationsText}
                  onChange={(e) => setCertificationsText(e.target.value)}
                  placeholder="AWS Solutions Architect, Google Cloud Professional"
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Social Proof */}
          <div className="bg-zinc-800/50 rounded-2xl border border-zinc-700/50 p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
              Social Proof & Portfolio
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Notable Past Clients <span className="text-zinc-500">(comma separated)</span>
                </label>
                <input
                  type="text"
                  value={pastClientsText}
                  onChange={(e) => setPastClientsText(e.target.value)}
                  placeholder="Google, Microsoft, Startup XYZ"
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Key Achievements <span className="text-zinc-500">(one per line)</span>
                </label>
                <textarea
                  value={achievementsText}
                  onChange={(e) => setAchievementsText(e.target.value)}
                  placeholder="Increased client's conversion rate by 40%&#10;Built a platform serving 1M+ users&#10;Reduced API response time by 70%"
                  rows={4}
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Portfolio Links <span className="text-zinc-500">(one per line)</span>
                </label>
                <textarea
                  value={portfolioLinksText}
                  onChange={(e) => setPortfolioLinksText(e.target.value)}
                  placeholder="https://github.com/yourname&#10;https://yourportfolio.com&#10;https://dribbble.com/yourname"
                  rows={3}
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all resize-none"
                />
              </div>
            </div>
          </div>

          {/* Preferences */}
          <div className="bg-zinc-800/50 rounded-2xl border border-zinc-700/50 p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Preferences
            </h2>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Availability</label>
                <input
                  type="text"
                  value={profile.availability || ''}
                  onChange={(e) => setProfile({ ...profile, availability: e.target.value })}
                  placeholder="e.g., 30 hours/week"
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Timezone</label>
                <input
                  type="text"
                  value={profile.timezone || ''}
                  onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
                  placeholder="e.g., EST (UTC-5)"
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-zinc-300 mb-1">Preferred Tone</label>
                <select
                  value={profile.preferredTone || 'professional'}
                  onChange={(e) => setProfile({ ...profile, preferredTone: e.target.value as Profile['preferredTone'] })}
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                >
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="casual">Casual</option>
                  <option value="formal">Formal</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Custom Signature <span className="text-zinc-500">(for proposal endings)</span>
                </label>
                <input
                  type="text"
                  value={profile.customSignature || ''}
                  onChange={(e) => setProfile({ ...profile, customSignature: e.target.value })}
                  placeholder="e.g., Best regards, John"
                  className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="py-3 px-8 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? (
                <>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Save Settings
                </>
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
