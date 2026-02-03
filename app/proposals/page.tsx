'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

type ProposalOutcome = 'pending' | 'viewed' | 'messaged' | 'interviewed' | 'hired' | 'rejected' | 'no_response';

interface Proposal {
  _id: string;
  jobTitle: string;
  clientName?: string;
  budget?: string;
  generatedProposal: string;
  proposalLength: 'short' | 'full';
  outcome: ProposalOutcome;
  outcomeUpdatedAt?: string;
  submittedAt?: string;
  clientResponseTime?: number;
  rating?: number;
  notes?: string;
  whatWorked?: string;
  whatDidntWork?: string;
  modelUsed: string;
  tokensUsed: number;
  generationTime: number;
  createdAt: string;
  screeningAnswers?: Array<{ question: string; answer: string }>;
}

interface Stats {
  pending?: number;
  viewed?: number;
  messaged?: number;
  interviewed?: number;
  hired?: number;
  rejected?: number;
  no_response?: number;
}

const OUTCOME_CONFIG: Record<ProposalOutcome, { label: string; color: string; emoji: string }> = {
  pending: { label: 'Pending', color: 'bg-zinc-500', emoji: '⏳' },
  viewed: { label: 'Viewed', color: 'bg-blue-500', emoji: '👀' },
  messaged: { label: 'Got Reply', color: 'bg-purple-500', emoji: '💬' },
  interviewed: { label: 'Interviewed', color: 'bg-amber-500', emoji: '🎤' },
  hired: { label: 'Hired!', color: 'bg-emerald-500', emoji: '🎉' },
  rejected: { label: 'Rejected', color: 'bg-red-500', emoji: '❌' },
  no_response: { label: 'No Response', color: 'bg-zinc-400', emoji: '😶' },
};

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...(filter !== 'all' && { outcome: filter }),
      });
      
      const res = await fetch(`/api/proposals?${params}`);
      const data = await res.json();
      
      if (data.success) {
        setProposals(data.data.proposals);
        setStats(data.data.stats);
        setTotalPages(data.data.pagination.totalPages);
      }
    } catch (error) {
      console.error('Failed to fetch proposals:', error);
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  const updateProposal = async (id: string, updates: Partial<Proposal>) => {
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      
      if (res.ok) {
        const data = await res.json();
        setProposals(prev => prev.map(p => p._id === id ? data.data : p));
        if (selectedProposal?._id === id) {
          setSelectedProposal(data.data);
        }
        // Refetch to update stats
        fetchProposals();
      }
    } catch (error) {
      console.error('Failed to update proposal:', error);
    }
  };

  const deleteProposal = async (id: string) => {
    if (!confirm('Are you sure you want to delete this proposal?')) return;
    
    try {
      const res = await fetch(`/api/proposals/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setProposals(prev => prev.filter(p => p._id !== id));
        setSelectedProposal(null);
        fetchProposals();
      }
    } catch (error) {
      console.error('Failed to delete proposal:', error);
    }
  };

  const totalProposals = Object.values(stats).reduce((a, b) => a + (b || 0), 0);
  const hireRate = totalProposals > 0 ? ((stats.hired || 0) / totalProposals * 100).toFixed(1) : '0';
  const responseRate = totalProposals > 0 
    ? (((stats.messaged || 0) + (stats.interviewed || 0) + (stats.hired || 0)) / totalProposals * 100).toFixed(1) 
    : '0';

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 text-white pb-20 lg:pb-0">
      {/* Header */}
      <header className="border-b border-zinc-700/50 bg-zinc-900/80 backdrop-blur-lg sticky top-0 z-40 safe-top">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between flex-wrap gap-2 sm:gap-3">
            <div className="flex items-center gap-3 sm:gap-4">
              <Link href="/" className="text-zinc-400 hover:text-white transition-colors p-1 -ml-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-base sm:text-xl font-semibold">Proposal History</h1>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-4 text-[10px] sm:text-sm">
              <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-zinc-800/80 border border-zinc-700/50 rounded-lg sm:rounded-xl">
                <span className="text-zinc-400">Total:</span> {totalProposals}
              </div>
              <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-emerald-900/30 border border-emerald-700/30 rounded-lg sm:rounded-xl">
                <span className="text-emerald-400">{hireRate}%</span>
                <span className="text-zinc-400 hidden sm:inline"> Hired</span>
              </div>
              <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-purple-900/30 border border-purple-700/30 rounded-lg sm:rounded-xl">
                <span className="text-purple-400">{responseRate}%</span>
                <span className="text-zinc-400 hidden sm:inline"> Response</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-6">
        {/* Stats Bar - Horizontal scroll on mobile */}
        <div className="flex gap-2 mb-4 sm:mb-6 overflow-x-auto pb-2 -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-hide">
          <button
            onClick={() => { setFilter('all'); setPage(1); }}
            className={`px-3 sm:px-4 py-2 rounded-xl transition text-xs sm:text-sm whitespace-nowrap font-medium flex-shrink-0 active:scale-95 ${
              filter === 'all' 
                ? 'bg-emerald-600 text-white' 
                : 'bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 hover:bg-zinc-700/80'
            }`}
          >
            All ({totalProposals})
          </button>
          {(Object.entries(OUTCOME_CONFIG) as [ProposalOutcome, typeof OUTCOME_CONFIG[ProposalOutcome]][]).map(([key, config]) => (
            <button
              key={key}
              onClick={() => { setFilter(key); setPage(1); }}
              className={`px-3 sm:px-4 py-2 rounded-xl transition flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm whitespace-nowrap font-medium flex-shrink-0 active:scale-95 ${
                filter === key 
                  ? config.color + ' text-white' 
                  : 'bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 hover:bg-zinc-700/80'
              }`}
            >
              <span>{config.emoji}</span>
              <span className="hidden sm:inline">{config.label}</span>
              <span className="opacity-75">({stats[key] || 0})</span>
            </button>
          ))}
        </div>

        {/* Main Content - Responsive Layout */}
        <div className="flex flex-col lg:flex-row gap-4 sm:gap-6">
          {/* Proposals List */}
          <div className={`flex-1 ${selectedProposal ? 'hidden lg:block' : ''}`}>
            {loading ? (
              <div className="text-center py-12 text-zinc-400">
                <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto mb-3" />
                Loading...
              </div>
            ) : proposals.length === 0 ? (
              <div className="text-center py-12 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl">
                <div className="text-4xl mb-3">📝</div>
                <p className="text-zinc-400 mb-4">No proposals found</p>
                <Link href="/" className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors">
                  Generate your first proposal →
                </Link>
              </div>
            ) : (
              <div className="space-y-2 sm:space-y-3">
                {proposals.map(proposal => {
                  const outcome = proposal.outcome || 'pending';
                  const config = OUTCOME_CONFIG[outcome] || OUTCOME_CONFIG.pending;
                  
                  return (
                  <div
                    key={proposal._id}
                    onClick={() => setSelectedProposal(proposal)}
                    className={`p-3 sm:p-4 rounded-xl cursor-pointer transition-all ${
                      selectedProposal?._id === proposal._id
                        ? 'bg-zinc-700/80 ring-2 ring-emerald-500 border border-emerald-500/30'
                        : 'bg-zinc-800/60 border border-zinc-700/50 hover:bg-zinc-700/60 hover:border-zinc-600/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 sm:gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm sm:text-base truncate">{proposal.jobTitle}</h3>
                        <div className="flex items-center gap-2 sm:gap-3 mt-1.5 text-xs sm:text-sm text-zinc-400 flex-wrap">
                          {proposal.clientName && (
                            <span className="truncate max-w-[100px] sm:max-w-none">👤 {proposal.clientName}</span>
                          )}
                          {proposal.budget && (
                            <span>💰 {proposal.budget}</span>
                          )}
                          <span>📅 {new Date(proposal.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className={`px-2 sm:px-3 py-1 rounded-xl text-xs sm:text-sm ${config.color} whitespace-nowrap`}>
                        {config.emoji} <span className="hidden sm:inline">{config.label}</span>
                      </div>
                    </div>
                    {proposal.rating && (
                      <div className="mt-2 text-amber-400 text-sm">
                        {'★'.repeat(proposal.rating)}{'☆'.repeat(5 - proposal.rating)}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 mt-4 sm:mt-6">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 sm:px-4 py-2 bg-zinc-800/80 border border-zinc-700/50 rounded-xl disabled:opacity-50 text-sm hover:bg-zinc-700/80 transition-colors"
                >
                  ← <span className="hidden sm:inline">Previous</span>
                </button>
                <span className="px-2 sm:px-4 py-2 text-sm text-zinc-400">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 sm:px-4 py-2 bg-zinc-800/80 border border-zinc-700/50 rounded-xl disabled:opacity-50 text-sm hover:bg-zinc-700/80 transition-colors"
                >
                  <span className="hidden sm:inline">Next</span> →
                </button>
              </div>
            )}
          </div>

          {/* Proposal Detail Panel - Desktop sidebar, Mobile full-screen overlay */}
          {selectedProposal && (() => {
            const selectedOutcome = selectedProposal.outcome || 'pending';
            return (
            <>
              {/* Mobile overlay backdrop */}
              <div 
                className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden"
                onClick={() => setSelectedProposal(null)}
              />
              
              {/* Detail panel */}
              <div className="fixed inset-3 sm:inset-4 z-50 lg:relative lg:inset-auto lg:z-auto lg:w-[400px] xl:w-[500px] bg-zinc-800/95 border border-zinc-700/50 rounded-2xl p-4 sm:p-6 lg:sticky lg:top-24 max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2rem)] lg:max-h-[calc(100vh-120px)] overflow-y-auto shadow-2xl">
                <div className="flex items-start justify-between mb-4 gap-2">
                  <h2 className="text-base sm:text-lg font-semibold flex-1 min-w-0">
                    <span className="line-clamp-2">{selectedProposal.jobTitle}</span>
                  </h2>
                  <button
                    onClick={() => setSelectedProposal(null)}
                    className="text-zinc-400 hover:text-white p-2 -mr-2 hover:bg-zinc-700/50 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

              {/* Outcome Selector */}
              <div className="mb-4 sm:mb-6">
                <label className="block text-xs sm:text-sm text-zinc-400 mb-2 font-medium">Update Status</label>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {(Object.entries(OUTCOME_CONFIG) as [ProposalOutcome, typeof OUTCOME_CONFIG[ProposalOutcome]][]).map(([key, config]) => (
                    <button
                      key={key}
                      onClick={() => updateProposal(selectedProposal._id, { outcome: key as ProposalOutcome })}
                      className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl text-xs sm:text-sm transition-all ${
                        selectedOutcome === key
                          ? config.color + ' text-white shadow-lg'
                          : 'bg-zinc-700/50 border border-zinc-600/50 text-zinc-300 hover:bg-zinc-600/50'
                      }`}
                    >
                      {config.emoji} <span className="hidden sm:inline">{config.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Mark as Submitted */}
              {!selectedProposal.submittedAt && (
                <button
                  onClick={() => updateProposal(selectedProposal._id, { markSubmitted: true } as unknown as Partial<Proposal>)}
                  className="w-full mb-4 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors text-sm sm:text-base font-medium shadow-lg"
                >
                  📤 Mark as Submitted
                </button>
              )}
              {selectedProposal.submittedAt && (
                <div className="flex items-center gap-2 text-xs sm:text-sm text-emerald-400 mb-4 p-2 bg-emerald-900/20 border border-emerald-700/30 rounded-xl">
                  <span>✓</span>
                  <span>Submitted {new Date(selectedProposal.submittedAt).toLocaleString()}</span>
                  {selectedProposal.clientResponseTime && (
                    <span className="text-zinc-400">
                      (Response in {selectedProposal.clientResponseTime}h)
                    </span>
                  )}
                </div>
              )}

              {/* Rating */}
              <div className="mb-4">
                <label className="block text-xs sm:text-sm text-zinc-400 mb-2 font-medium">Your Rating</label>
                <div className="flex gap-1 sm:gap-2">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      onClick={() => updateProposal(selectedProposal._id, { rating: star })}
                      className={`text-xl sm:text-2xl transition-all hover:scale-110 ${
                        (selectedProposal.rating || 0) >= star ? 'text-amber-400' : 'text-zinc-600 hover:text-zinc-500'
                      }`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div className="mb-4">
                <label className="block text-xs sm:text-sm text-zinc-400 mb-2 font-medium">Notes</label>
                <textarea
                  value={selectedProposal.notes || ''}
                  onChange={(e) => setSelectedProposal({ ...selectedProposal, notes: e.target.value })}
                  onBlur={(e) => updateProposal(selectedProposal._id, { notes: e.target.value })}
                  placeholder="Add notes about this proposal..."
                  className="w-full px-3 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl text-xs sm:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all"
                  rows={2}
                />
              </div>

              {/* What Worked / Didn't Work */}
              {(selectedOutcome === 'hired' || selectedOutcome === 'messaged' || selectedOutcome === 'interviewed') && (
                <div className="mb-4">
                  <label className="block text-xs sm:text-sm text-zinc-400 mb-2 font-medium">✅ What Worked?</label>
                  <textarea
                    value={selectedProposal.whatWorked || ''}
                    onChange={(e) => setSelectedProposal({ ...selectedProposal, whatWorked: e.target.value })}
                    onBlur={(e) => updateProposal(selectedProposal._id, { whatWorked: e.target.value })}
                    placeholder="What made this proposal successful?"
                    className="w-full px-3 py-2.5 bg-emerald-900/20 border border-emerald-700/30 rounded-xl text-xs sm:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                    rows={2}
                  />
                </div>
              )}

              {(selectedOutcome === 'rejected' || selectedOutcome === 'no_response') && (
                <div className="mb-4">
                  <label className="block text-xs sm:text-sm text-zinc-400 mb-2 font-medium">❌ What Didn&apos;t Work?</label>
                  <textarea
                    value={selectedProposal.whatDidntWork || ''}
                    onChange={(e) => setSelectedProposal({ ...selectedProposal, whatDidntWork: e.target.value })}
                    onBlur={(e) => updateProposal(selectedProposal._id, { whatDidntWork: e.target.value })}
                    placeholder="What could have been better?"
                    className="w-full px-3 py-2.5 bg-red-900/20 border border-red-700/30 rounded-xl text-xs sm:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-500/50 transition-all"
                    rows={2}
                  />
                </div>
              )}

              {/* Proposal Content */}
              <div className="mb-4">
                <label className="block text-xs sm:text-sm text-zinc-400 mb-2 font-medium">Generated Proposal</label>
                <div className="p-3 bg-zinc-900/70 border border-zinc-700/50 rounded-xl text-xs sm:text-sm whitespace-pre-wrap max-h-40 sm:max-h-48 overflow-y-auto">
                  {selectedProposal.generatedProposal}
                </div>
              </div>

              {/* Screening Answers */}
              {selectedProposal.screeningAnswers && selectedProposal.screeningAnswers.length > 0 && (
                <div className="mb-4">
                  <label className="block text-xs sm:text-sm text-zinc-400 mb-2 font-medium">Screening Answers</label>
                  <div className="space-y-2">
                    {selectedProposal.screeningAnswers.map((qa, idx) => (
                      <div key={idx} className="p-3 bg-zinc-900/50 border border-zinc-700/50 rounded-xl text-xs sm:text-sm">
                        <p className="text-emerald-400 font-medium">Q: {qa.question}</p>
                        <p className="text-zinc-300 mt-1.5">A: {qa.answer}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Meta Info */}
              <div className="text-[10px] sm:text-xs text-zinc-500 space-y-1 p-2 bg-zinc-900/30 rounded-xl border border-zinc-800/50">
                <p><span className="text-zinc-400">Model:</span> {selectedProposal.modelUsed}</p>
                <p><span className="text-zinc-400">Tokens:</span> {selectedProposal.tokensUsed} | <span className="text-zinc-400">Time:</span> {(selectedProposal.generationTime / 1000).toFixed(1)}s</p>
                <p><span className="text-zinc-400">Created:</span> {new Date(selectedProposal.createdAt).toLocaleString()}</p>
              </div>

              {/* Delete Button */}
              <button
                onClick={() => deleteProposal(selectedProposal._id)}
                className="w-full mt-4 px-4 py-2.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 hover:text-red-300 border border-red-700/30 rounded-xl transition-all text-sm font-medium"
              >
                🗑️ Delete Proposal
              </button>
            </div>
            </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
