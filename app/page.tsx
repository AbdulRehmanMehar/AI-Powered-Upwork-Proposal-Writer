'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

interface UserProfile {
  title?: string;
  summary?: string;
  yearsExperience?: number;
  hourlyRate?: string;
  skills?: string[];
  specializations?: string[];
  achievements?: string[];
  certifications?: string[];
  availability?: string;
  timezone?: string;
  preferredTone?: string;
  customSignature?: string;
  additionalDetails?: string;
  resumeText?: string;
}

interface JobQuestion {
  id: string;
  question: string;
  answer: string;
  isGenerating: boolean;
}

interface UsageStats {
  models: Array<{
    modelId: string;
    config: {
      requestsPerMinute: number;
      requestsPerDay: number;
      tokensPerMinute: number;
      tokensPerDay: number | null;
      priority: number;
    };
    usage: {
      requestsThisMinute: number;
      requestsToday: number;
      tokensThisMinute: number;
      tokensToday: number;
    };
    availability: {
      canUseNow: boolean;
      score: number;
    };
  }>;
  totalRequestsToday: number;
  totalTokensToday: number;
}

interface ScreeningAnswer {
  question: string;
  answer: string;
}

interface GenerationResult {
  proposal: string;
  proposalLength: 'short' | 'full';
  screeningAnswers?: ScreeningAnswer[];
  reviewFeedback?: string;
  agentIterations?: number;
  modelUsed: string;
  tokensUsed: number;
  generationTime: number;
  proposalId: string;
}

export default function Home() {
  const { data: session, status } = useSession();
  
  const [jobTitle, setJobTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [clientName, setClientName] = useState('');
  const [budget, setBudget] = useState('');
  const [skills, setSkills] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');
  const [proposalLength, setProposalLength] = useState<'short' | 'full'>('short');
  
  // Raw job paste mode
  const [inputMode, setInputMode] = useState<'structured' | 'raw'>('raw');
  const [rawJobData, setRawJobData] = useState('');
  
  // Job questions
  const [jobQuestions, setJobQuestions] = useState<JobQuestion[]>([]);
  const [newQuestion, setNewQuestion] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedQuestionId, setCopiedQuestionId] = useState<string | null>(null);
  
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  
  // Feedback and regeneration state
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);

  // Fetch usage stats
  const fetchUsageStats = async () => {
    try {
      const response = await fetch('/api/usage');
      const data = await response.json();
      if (data.success) {
        setUsageStats(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch usage stats:', err);
    }
  };

  useEffect(() => {
    fetchUsageStats();
    const interval = setInterval(fetchUsageStats, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Fetch user profile if logged in
  useEffect(() => {
    const fetchProfile = async () => {
      if (status === 'authenticated') {
        try {
          const res = await fetch('/api/profile');
          if (res.ok) {
            const data = await res.json();
            setUserProfile(data.data.profile || null);
          }
        } catch (err) {
          console.error('Failed to fetch profile:', err);
        }
      }
    };
    fetchProfile();
  }, [status]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setJobQuestions([]); // Clear previous questions

    try {
      // Prepare job data based on input mode
      // Use multi-agent endpoint for better quality
      const jobData = inputMode === 'raw' 
        ? {
            title: 'Job from Raw Data',
            rawJobData: rawJobData,
            userProfile: userProfile || undefined,
            proposalLength,
            // Include any manually added questions
            screeningQuestions: jobQuestions.map(q => q.question),
          }
        : {
            title: jobTitle,
            description: jobDescription,
            clientName: clientName || undefined,
            budget: budget || undefined,
            skills: skills ? skills.split(',').map(s => s.trim()) : undefined,
            additionalContext: additionalContext || undefined,
            userProfile: userProfile || undefined,
            proposalLength,
            screeningQuestions: jobQuestions.map(q => q.question),
          };
      
      // Use multi-agent endpoint
      const response = await fetch('/api/proposals/multi-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate proposal');
      }

      setResult(data.data);
      
      // If screening answers were generated, add them to jobQuestions
      if (data.data.screeningAnswers && data.data.screeningAnswers.length > 0) {
        const answeredQuestions: JobQuestion[] = data.data.screeningAnswers.map((sa: ScreeningAnswer, idx: number) => ({
          id: `auto-${Date.now()}-${idx}`,
          question: sa.question,
          answer: sa.answer,
          isGenerating: false,
        }));
        setJobQuestions(answeredQuestions);
      }
      
      fetchUsageStats(); // Refresh stats after generation
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Add a new question
  const addQuestion = () => {
    if (!newQuestion.trim()) return;
    
    const question: JobQuestion = {
      id: Date.now().toString(),
      question: newQuestion.trim(),
      answer: '',
      isGenerating: false,
    };
    
    setJobQuestions(prev => [...prev, question]);
    setNewQuestion('');
  };

  // Remove a question
  const removeQuestion = (id: string) => {
    setJobQuestions(prev => prev.filter(q => q.id !== id));
  };

  // Generate answer for a question
  const generateAnswer = async (questionId: string) => {
    const question = jobQuestions.find(q => q.id === questionId);
    if (!question) return;

    // Update state to show loading
    setJobQuestions(prev => 
      prev.map(q => q.id === questionId ? { ...q, isGenerating: true } : q)
    );

    try {
      const jobContext = inputMode === 'raw' ? rawJobData : `${jobTitle}\n\n${jobDescription}`;
      const proposalContext = result?.proposal || '';

      const response = await fetch('/api/proposals/answer-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question.question,
          jobContext,
          proposalContext,
          userProfile: userProfile || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate answer');
      }

      setJobQuestions(prev => 
        prev.map(q => q.id === questionId ? { ...q, answer: data.data.answer, isGenerating: false } : q)
      );
      
      fetchUsageStats();
    } catch (err) {
      setJobQuestions(prev => 
        prev.map(q => q.id === questionId ? { ...q, isGenerating: false } : q)
      );
      setError(err instanceof Error ? err.message : 'Failed to generate answer');
    }
  };

  // Generate all answers at once
  const generateAllAnswers = async () => {
    const unanswered = jobQuestions.filter(q => !q.answer && !q.isGenerating);
    for (const question of unanswered) {
      await generateAnswer(question.id);
    }
  };

  // Copy question answer
  const copyAnswer = async (id: string, answer: string) => {
    await navigator.clipboard.writeText(answer);
    setCopiedQuestionId(id);
    setTimeout(() => setCopiedQuestionId(null), 2000);
  };

  const copyToClipboard = async () => {
    if (result?.proposal) {
      await navigator.clipboard.writeText(result.proposal);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Submit feedback and learn from it
  const submitFeedback = async () => {
    if (!result?.proposalId || !feedbackText.trim()) return;
    
    setSubmittingFeedback(true);
    setFeedbackSuccess(null);
    
    try {
      const response = await fetch('/api/proposals/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: result.proposalId,
          feedback: feedbackText,
          originalProposal: result.proposal,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit feedback');
      }
      
      // Show success message with the extracted learning
      setFeedbackSuccess(`✓ Learned: "${data.data.extractedLearning.rule}"`);
      setFeedbackText('');
      setShowFeedbackInput(false);
      
      // Regenerate the proposal with new learnings
      setTimeout(() => {
        regenerateProposal();
      }, 500);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  // Regenerate proposal (with feedback already saved)
  const regenerateProposal = () => {
    // Simply re-trigger generation - the feedback learnings are now in the DB
    // and will be automatically included in the next generation
    const form = document.querySelector('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  };

  const clearForm = () => {
    setJobTitle('');
    setJobDescription('');
    setClientName('');
    setBudget('');
    setSkills('');
    setAdditionalContext('');
    setRawJobData('');
    setProposalLength('full');
    setJobQuestions([]);
    setNewQuestion('');
    setResult(null);
    setError(null);
  };

  // Show loading while checking auth (after all hooks)
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <p className="text-zinc-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 pb-20 lg:pb-0">
      {/* Header - Simplified for mobile */}
      <header className="border-b border-zinc-700/50 bg-zinc-900/80 backdrop-blur-lg sticky top-0 z-40 safe-top">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold text-white truncate">Proposal Writer</h1>
              <p className="text-[10px] sm:text-xs text-zinc-400 hidden sm:block">Powered by AI Load Balancing</p>
            </div>
          </div>
          
          {/* Desktop Navigation - Hidden on mobile (uses bottom nav instead) */}
          <div className="hidden lg:flex items-center gap-3">
            <button
              onClick={() => setShowUsage(!showUsage)}
              className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Usage
            </button>
            
            <Link
              href="/proposals"
              className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              History
            </Link>
            
            <Link
              href="/winning-proposals"
              className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              Winners
            </Link>
            
            <Link
              href="/settings"
              className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </Link>
            
            <div className="relative group">
              <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-xs font-bold">
                  {session?.user?.name?.charAt(0).toUpperCase() || 'U'}
                </div>
                <span className="hidden sm:inline max-w-24 truncate">{session?.user?.name || 'User'}</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div className="absolute right-0 mt-2 w-48 py-2 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                <div className="px-4 py-2 text-sm text-zinc-400 border-b border-zinc-700">
                  {session?.user?.email}
                </div>
                <Link
                  href="/proposals"
                  className="block px-4 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors"
                >
                  Proposal History
                </Link>
                <Link
                  href="/winning-proposals"
                  className="block px-4 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors"
                >
                  Winning Proposals
                </Link>
                <Link
                  href="/settings"
                  className="block px-4 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors"
                >
                  Profile Settings
                </Link>
                <button
                  onClick={() => signOut()}
                  className="w-full text-left px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-zinc-700 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
          
          {/* Mobile Header Actions */}
          <div className="flex lg:hidden items-center gap-2">
            <button
              onClick={() => setShowUsage(!showUsage)}
              className="p-2.5 text-zinc-400 hover:text-white bg-zinc-800/80 hover:bg-zinc-700 rounded-xl transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-xs font-bold">
              {session?.user?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
          </div>
        </div>
      </header>

      {/* Usage Stats Panel */}
      {showUsage && usageStats && (
        <div className="bg-zinc-800/50 border-b border-zinc-700/50 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-300">Model Usage Today</h2>
              <div className="text-xs text-zinc-500">
                Total: {usageStats.totalRequestsToday} requests / {usageStats.totalTokensToday.toLocaleString()} tokens
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {usageStats.models.slice(0, 6).map((model) => (
                <div
                  key={model.modelId}
                  className={`p-2 rounded-lg border ${
                    model.availability.canUseNow
                      ? 'bg-zinc-700/30 border-zinc-600/50'
                      : 'bg-red-900/20 border-red-700/30'
                  }`}
                >
                  <div className="text-xs font-medium text-zinc-300 truncate" title={model.modelId}>
                    {model.modelId.split('/').pop()}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">
                    {model.usage.requestsToday}/{model.config.requestsPerDay} req
                  </div>
                  <div className="w-full bg-zinc-700 rounded-full h-1 mt-1">
                    <div
                      className={`h-1 rounded-full ${
                        model.availability.canUseNow ? 'bg-emerald-500' : 'bg-red-500'
                      }`}
                      style={{
                        width: `${Math.min(100, (model.usage.requestsToday / model.config.requestsPerDay) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
        {/* Profile Banner */}
        <div className={`mb-4 sm:mb-6 p-3 sm:p-4 rounded-xl border ${
          userProfile?.skills?.length ? 'bg-emerald-900/20 border-emerald-700/30' : 'bg-amber-900/20 border-amber-700/30'
        }`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              {userProfile?.skills?.length ? (
                <>
                  <svg className="w-5 h-5 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-emerald-300">Profile Active</p>
                    <p className="text-xs text-emerald-400/70 truncate">
                      {userProfile?.title || 'Personalized proposals enabled'}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-300">Profile Incomplete</p>
                    <p className="text-xs text-amber-400/70">Add your background</p>
                  </div>
                </>
              )}
            </div>
            <Link
              href="/settings"
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors flex-shrink-0"
            >
              {userProfile?.skills?.length ? 'Edit' : 'Setup'}
            </Link>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4 sm:gap-8">
          {/* Input Form */}
          <div className="space-y-4 sm:space-y-6">
            <div className="bg-zinc-800/50 rounded-2xl border border-zinc-700/50 p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4 gap-2">
                <h2 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="truncate">Job Details</span>
                </h2>
                
                {/* Input Mode Toggle */}
                <div className="flex items-center gap-1 p-1 bg-zinc-900/50 rounded-lg flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setInputMode('structured')}
                    className={`px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      inputMode === 'structured'
                        ? 'bg-emerald-600 text-white'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Form
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('raw')}
                    className={`px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      inputMode === 'raw'
                        ? 'bg-emerald-600 text-white'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Paste
                  </button>
                </div>
              </div>
              
              <form onSubmit={handleSubmit} className="space-y-4">
                {inputMode === 'raw' ? (
                  /* Raw Job Paste Mode */
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">
                      Paste Job Data <span className="text-red-400">*</span>
                    </label>
                    <p className="text-xs text-zinc-500 mb-2">
                      Copy the entire job posting from Upwork
                    </p>
                    <textarea
                      value={rawJobData}
                      onChange={(e) => setRawJobData(e.target.value)}
                      placeholder={`Paste the complete job posting here...

Example:
Senior React Developer Needed

We're looking for an experienced React developer...

Budget: $2,000 - $5,000
Skills: React, TypeScript, Node.js`}
                      rows={10}
                      className="w-full px-3 sm:px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all resize-none font-mono text-sm"
                      required
                    />
                  </div>
                ) : (
                  /* Structured Input Mode */
                  <>
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-1">
                        Job Title <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={jobTitle}
                        onChange={(e) => setJobTitle(e.target.value)}
                        placeholder="e.g., React Developer for E-commerce Platform"
                        className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-1">
                        Job Description <span className="text-red-400">*</span>
                      </label>
                      <textarea
                        value={jobDescription}
                        onChange={(e) => setJobDescription(e.target.value)}
                        placeholder="Paste the full job description here..."
                        rows={8}
                        className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all resize-none"
                        required
                      />
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-1">
                          Client Name <span className="text-zinc-500">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={clientName}
                          onChange={(e) => setClientName(e.target.value)}
                          placeholder="e.g., John"
                          className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-1">
                          Budget <span className="text-zinc-500">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={budget}
                          onChange={(e) => setBudget(e.target.value)}
                          placeholder="e.g., $500-$1000"
                          className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-1">
                        Required Skills <span className="text-zinc-500">(comma separated)</span>
                      </label>
                      <input
                        type="text"
                        value={skills}
                        onChange={(e) => setSkills(e.target.value)}
                        placeholder="e.g., React, Node.js, TypeScript"
                        className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    Your Background/Context <span className="text-zinc-500">(optional)</span>
                  </label>
                  <textarea
                    value={additionalContext}
                    onChange={(e) => setAdditionalContext(e.target.value)}
                    placeholder="Describe your relevant experience, past projects, or any specific information you want included..."
                    rows={3}
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all resize-none"
                  />
                </div>

                {/* Proposal Length Toggle */}
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">
                    Proposal Length
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setProposalLength('short')}
                      className={`flex-1 py-3 sm:py-3 px-3 sm:px-4 rounded-xl border transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 min-h-[60px] sm:min-h-0 ${
                        proposalLength === 'short'
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                          : 'bg-zinc-900/50 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span className="font-medium text-sm">Short</span>
                      <span className="text-[10px] sm:text-xs opacity-70 hidden sm:inline">(80-150)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProposalLength('full')}
                      className={`flex-1 py-3 sm:py-3 px-3 sm:px-4 rounded-xl border transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 min-h-[60px] sm:min-h-0 ${
                        proposalLength === 'full'
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                          : 'bg-zinc-900/50 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="font-medium text-sm">Full</span>
                      <span className="text-[10px] sm:text-xs opacity-70 hidden sm:inline">(200-350)</span>
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 sm:gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={loading || (inputMode === 'structured' ? (!jobTitle || !jobDescription) : !rawJobData)}
                    className="flex-1 py-3.5 sm:py-3 px-4 sm:px-6 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm sm:text-base active:scale-[0.98]"
                  >
                    {loading ? (
                      <>
                        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Generate Proposal
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={clearForm}
                    className="py-3 px-6 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-xl transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </form>
            </div>

            {/* Job Questions Section */}
            <div className="bg-gradient-to-br from-blue-900/30 to-indigo-900/30 rounded-2xl border border-blue-700/50 p-6">
              <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Screening Questions
                {jobQuestions.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 bg-blue-600/30 text-blue-300 text-xs rounded-full">
                    {jobQuestions.filter(q => q.answer).length}/{jobQuestions.length} answered
                  </span>
                )}
              </h2>
              <p className="text-zinc-400 text-sm mb-4">
                Questions are <span className="text-blue-400">auto-extracted</span> from the job posting and answered when you generate a proposal. You can also add questions manually.
              </p>

              {/* Add Question Input */}
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addQuestion())}
                  placeholder="Enter a question from the job posting..."
                  className="flex-1 px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                />
                <button
                  type="button"
                  onClick={addQuestion}
                  disabled={!newQuestion.trim()}
                  className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>

              {/* Questions List */}
              {jobQuestions.length > 0 && (
                <div className="space-y-3">
                  {jobQuestions.map((q, index) => (
                    <div key={q.id} className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-700/50">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-start gap-2">
                          <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
                            {index + 1}
                          </span>
                          <p className="text-white font-medium text-sm">{q.question}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeQuestion(q.id)}
                          className="text-zinc-500 hover:text-red-400 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      {q.answer ? (
                        <div className="mt-3 pl-8">
                          <div className="bg-zinc-800/50 rounded-lg p-3 text-zinc-300 text-sm whitespace-pre-wrap">
                            {q.answer}
                          </div>
                          <button
                            type="button"
                            onClick={() => copyAnswer(q.id, q.answer)}
                            className="mt-2 px-3 py-1 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors flex items-center gap-1"
                          >
                            {copiedQuestionId === q.id ? (
                              <>
                                <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Copied!
                              </>
                            ) : (
                              <>
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                Copy Answer
                              </>
                            )}
                          </button>
                        </div>
                      ) : (
                        <div className="mt-2 pl-8">
                          <button
                            type="button"
                            onClick={() => generateAnswer(q.id)}
                            disabled={q.isGenerating}
                            className="px-3 py-1.5 text-xs font-medium text-blue-300 hover:text-white bg-blue-600/20 hover:bg-blue-600 rounded-lg transition-all disabled:opacity-50 flex items-center gap-1"
                          >
                            {q.isGenerating ? (
                              <>
                                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Generating...
                              </>
                            ) : (
                              <>
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                Generate Answer
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Generate All Answers Button */}
                  {jobQuestions.some(q => !q.answer && !q.isGenerating) && (
                    <button
                      type="button"
                      onClick={generateAllAnswers}
                      className="w-full py-2 text-sm font-medium text-blue-300 hover:text-white bg-blue-600/20 hover:bg-blue-600 rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Generate All Answers
                    </button>
                  )}
                </div>
              )}

              {jobQuestions.length === 0 && (
                <div className="text-center py-6 text-zinc-500 text-sm">
                  <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p>Questions will appear here after generating a proposal.</p>
                  <p className="text-xs mt-1">Or add them manually using the input above.</p>
                </div>
              )}
            </div>
          </div>

          {/* Output Panel */}
          <div className="space-y-4 sm:space-y-6">
            <div className="bg-zinc-800/50 rounded-2xl border border-zinc-700/50 p-4 sm:p-6 min-h-[400px] sm:min-h-[600px] flex flex-col">
              <div className="flex items-center justify-between mb-4 gap-2">
                <h2 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="truncate">Generated Proposal</span>
                </h2>
                {result && (
                  <button
                    onClick={copyToClipboard}
                    className="px-3 py-2 text-sm font-medium text-zinc-300 hover:text-white bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors flex items-center gap-2 flex-shrink-0 active:scale-95"
                  >
                    {copied ? (
                      <>
                        <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                )}
              </div>

              {error && (
                <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm mb-4">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                  </div>
                </div>
              )}

              {result ? (
                <div className="flex-1 flex flex-col">
                  <div className="flex-1 bg-zinc-900/50 rounded-xl p-4 border border-zinc-700/50 overflow-auto">
                    <pre className="whitespace-pre-wrap text-zinc-200 text-sm font-sans leading-relaxed">
                      {result.proposal}
                    </pre>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-zinc-500">
                    <span className={`flex items-center gap-1 px-2 py-1 rounded-full ${
                      result.proposalLength === 'short' 
                        ? 'bg-amber-900/30 text-amber-400' 
                        : 'bg-emerald-900/30 text-emerald-400'
                    }`}>
                      {result.proposalLength === 'short' ? '⚡ Short' : '📄 Full'}
                    </span>
                    {result.agentIterations && (
                      <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-purple-900/30 text-purple-400">
                        🤖 {result.agentIterations} agents
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      {result.modelUsed.split('/').pop()}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      {result.tokensUsed} tokens
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {(result.generationTime / 1000).toFixed(2)}s
                    </span>
                  </div>
                  
                  {/* Feedback Success Message */}
                  {feedbackSuccess && (
                    <div className="mt-4 p-3 bg-emerald-900/30 border border-emerald-700/50 rounded-xl text-emerald-300 text-sm">
                      <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {feedbackSuccess}
                      </div>
                    </div>
                  )}

                  {/* Regenerate with Feedback UI */}
                  <div className="mt-4 pt-4 border-t border-zinc-700/50">
                    {!showFeedbackInput ? (
                      <div className="flex gap-3">
                        <button
                          onClick={() => setShowFeedbackInput(true)}
                          className="flex-1 py-2.5 px-4 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 hover:text-amber-200 border border-amber-700/50 rounded-xl transition-all text-sm font-medium flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                          </svg>
                          Not Happy? Give Feedback
                        </button>
                        <button
                          onClick={regenerateProposal}
                          disabled={loading}
                          className="py-2.5 px-4 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white rounded-xl transition-all text-sm font-medium flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Regenerate
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-zinc-300 mb-2">
                            What&apos;s wrong with this proposal?
                          </label>
                          <p className="text-xs text-zinc-500 mb-2">
                            Be specific! Your feedback will be learned and applied to all future proposals.
                          </p>
                          <textarea
                            value={feedbackText}
                            onChange={(e) => setFeedbackText(e.target.value)}
                            placeholder="e.g., 'The hook sounds robotic', 'Too many projects mentioned', 'Signature is wrong'..."
                            className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all resize-none"
                            rows={3}
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={submitFeedback}
                            disabled={!feedbackText.trim() || submittingFeedback}
                            className="flex-1 py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-xl transition-all text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            {submittingFeedback ? (
                              <>
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Learning...
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                </svg>
                                Save Feedback & Regenerate
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => { setShowFeedbackInput(false); setFeedbackText(''); }}
                            className="py-2.5 px-4 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white rounded-xl transition-all text-sm font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center text-zinc-500">
                    <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p>Your generated proposal will appear here</p>
                    <p className="text-sm mt-1 text-zinc-600">Fill in the job details and click Generate</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-700/50 bg-zinc-900/50 mt-8 sm:mt-12 hidden lg:block">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center text-zinc-500 text-sm">
          Built with strategies from top Upwork earners ($2.3M+ combined) • AI-powered load balancing
        </div>
      </footer>
    </div>
  );
}
