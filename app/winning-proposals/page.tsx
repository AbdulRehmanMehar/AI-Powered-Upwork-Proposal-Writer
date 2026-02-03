'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface WinningProposal {
  _id: string;
  proposalText: string;
  jobTitle: string;
  jobDescription?: string;
  clientName?: string;
  budget?: string;
  outcome: 'interview' | 'hired' | 'ongoing';
  hireDate?: string;
  earnings?: number;
  category?: string;
  tags?: string[];
  intensity: 'ultra-short' | 'full';
  responseTime?: number;
  competitorCount?: number;
  notes?: string;
  createdAt: string;
}

export default function WinningProposalsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [proposals, setProposals] = useState<WinningProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    proposalText: '',
    jobTitle: '',
    jobDescription: '',
    clientName: '',
    budget: '',
    outcome: 'interview' as 'interview' | 'hired' | 'ongoing',
    hireDate: '',
    earnings: '',
    category: '',
    tags: '',
    intensity: 'ultra-short' as 'ultra-short' | 'full',
    responseTime: '',
    competitorCount: '',
    notes: '',
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated') {
      fetchProposals();
    }
  }, [status, router]);

  const fetchProposals = async () => {
    try {
      const response = await fetch('/api/winning-proposals');
      const data = await response.json();
      if (data.success) {
        setProposals(data.data);
      }
    } catch (error) {
      console.error('Error fetching proposals:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const payload = {
      ...formData,
      earnings: formData.earnings ? parseFloat(formData.earnings) : undefined,
      responseTime: formData.responseTime ? parseInt(formData.responseTime) : undefined,
      competitorCount: formData.competitorCount ? parseInt(formData.competitorCount) : undefined,
      tags: formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    };

    try {
      const url = editingId
        ? `/api/winning-proposals/${editingId}`
        : '/api/winning-proposals';
      const method = editingId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      
      if (data.success) {
        await fetchProposals();
        resetForm();
      } else {
        alert(data.error || 'Failed to save proposal');
      }
    } catch (error) {
      console.error('Error saving proposal:', error);
      alert('Failed to save proposal');
    }
  };

  const handleEdit = (proposal: WinningProposal) => {
    setFormData({
      proposalText: proposal.proposalText,
      jobTitle: proposal.jobTitle,
      jobDescription: proposal.jobDescription || '',
      clientName: proposal.clientName || '',
      budget: proposal.budget || '',
      outcome: proposal.outcome,
      hireDate: proposal.hireDate ? proposal.hireDate.split('T')[0] : '',
      earnings: proposal.earnings?.toString() || '',
      category: proposal.category || '',
      tags: proposal.tags?.join(', ') || '',
      intensity: proposal.intensity,
      responseTime: proposal.responseTime?.toString() || '',
      competitorCount: proposal.competitorCount?.toString() || '',
      notes: proposal.notes || '',
    });
    setEditingId(proposal._id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this proposal?')) return;

    try {
      const response = await fetch(`/api/winning-proposals/${id}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (data.success) {
        await fetchProposals();
      } else {
        alert(data.error || 'Failed to delete proposal');
      }
    } catch (error) {
      console.error('Error deleting proposal:', error);
      alert('Failed to delete proposal');
    }
  };

  const resetForm = () => {
    setFormData({
      proposalText: '',
      jobTitle: '',
      jobDescription: '',
      clientName: '',
      budget: '',
      outcome: 'interview',
      hireDate: '',
      earnings: '',
      category: '',
      tags: '',
      intensity: 'ultra-short',
      responseTime: '',
      competitorCount: '',
      notes: '',
    });
    setEditingId(null);
    setShowForm(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 text-white">
      {/* Header */}
      <header className="border-b border-zinc-700/50 bg-zinc-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <a href="/" className="text-zinc-400 hover:text-white transition-colors">
              ← Back
            </a>
            <div>
              <h1 className="text-xl font-semibold">Winning Proposals</h1>
              <p className="text-sm text-zinc-400 hidden sm:block">
                Add proposals that won you interviews or jobs
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl transition-colors font-medium flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Add Proposal</span>
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 sm:p-6">
            <p className="text-zinc-400 text-xs sm:text-sm">Total Proposals</p>
            <p className="text-2xl sm:text-3xl font-bold mt-1">{proposals.length}</p>
          </div>
          <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 sm:p-6">
            <p className="text-zinc-400 text-xs sm:text-sm">Interviews</p>
            <p className="text-2xl sm:text-3xl font-bold text-amber-400 mt-1">
              {proposals.filter(p => p.outcome === 'interview').length}
            </p>
          </div>
          <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 sm:p-6">
            <p className="text-zinc-400 text-xs sm:text-sm">Hired</p>
            <p className="text-2xl sm:text-3xl font-bold text-emerald-400 mt-1">
              {proposals.filter(p => p.outcome === 'hired').length}
            </p>
          </div>
          <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 sm:p-6">
            <p className="text-zinc-400 text-xs sm:text-sm">Total Earnings</p>
            <p className="text-2xl sm:text-3xl font-bold text-emerald-400 mt-1">
              ${proposals.reduce((sum, p) => sum + (p.earnings || 0), 0).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Missing Job Data Warning */}
        {proposals.filter(p => !p.jobDescription).length > 0 && (
          <div className="bg-orange-900/20 border border-orange-700/30 rounded-xl p-4 mb-6 flex items-start gap-3">
            <span className="text-2xl">🧠</span>
            <div className="flex-1">
              <p className="text-orange-400 font-medium">
                {proposals.filter(p => !p.jobDescription).length} proposal{proposals.filter(p => !p.jobDescription).length > 1 ? 's' : ''} missing job data
              </p>
              <p className="text-zinc-400 text-sm mt-1">
                Add the original job posting to help the AI learn <strong className="text-orange-300">which proposal style works for which job type</strong>. 
                Click the orange "Add Job Data" button on each proposal.
              </p>
            </div>
          </div>
        )}

        {/* Form Modal */}
        {showForm && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
              onClick={resetForm}
            />
            
            {/* Modal */}
            <div className="fixed inset-3 sm:inset-4 z-50 flex items-start justify-center overflow-y-auto py-4">
              <div className="bg-zinc-800/95 border border-zinc-700/50 rounded-2xl shadow-2xl w-full max-w-4xl">
                <div className="p-4 sm:p-6">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl sm:text-2xl font-bold">
                      {editingId ? 'Edit' : 'Add'} Winning Proposal
                    </h2>
                    <button 
                      onClick={resetForm} 
                      className="text-zinc-400 hover:text-white p-2 hover:bg-zinc-700/50 rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
                    {/* AI Learning Info Banner */}
                    <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-4">
                      <div className="flex gap-3">
                        <div className="text-emerald-400 mt-0.5">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        </div>
                        <div className="text-sm">
                          <p className="text-emerald-400 font-medium">AI Learning Mode</p>
                          <p className="text-zinc-400 mt-1">
                            Paste both the <strong className="text-white">original job posting</strong> and your <strong className="text-white">winning proposal</strong>. 
                            The AI will analyze patterns to write better proposals for similar jobs.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Job Title */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-2">
                        Job Title *
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.jobTitle}
                        onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                        className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white placeholder-zinc-500"
                        placeholder="e.g., Build a Next.js E-commerce Site"
                      />
                    </div>

                    {/* Raw Job Data - NEW */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-2">
                        Raw Job Posting *
                        <span className="text-zinc-500 font-normal ml-2">(paste the entire job description from Upwork)</span>
                      </label>
                      <textarea
                        required
                        rows={8}
                        value={formData.jobDescription}
                        onChange={(e) => setFormData({ ...formData, jobDescription: e.target.value })}
                        className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white placeholder-zinc-500 font-mono text-sm"
                        placeholder={`Paste the complete job posting here...

Example:
We're looking for an experienced React developer to build a modern e-commerce platform...

Budget: $5,000 - $10,000
Skills: React, Next.js, TypeScript, Node.js
Experience Level: Expert
Project Length: 1-3 months`}
                      />
                    </div>

                    {/* Proposal Text */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-2">
                        Your Winning Proposal *
                        <span className="text-zinc-500 font-normal ml-2">(the proposal that won you the job/interview)</span>
                      </label>
                      <textarea
                        required
                        rows={8}
                        value={formData.proposalText}
                        onChange={(e) => setFormData({ ...formData, proposalText: e.target.value })}
                        className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white placeholder-zinc-500 font-mono text-sm"
                        placeholder="Paste your winning proposal here..."
                      />
                    </div>

                    {/* Row 1: Intensity & Outcome */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-2">
                          Intensity *
                        </label>
                        <select
                          required
                          value={formData.intensity}
                          onChange={(e) => setFormData({ ...formData, intensity: e.target.value as 'ultra-short' | 'full' })}
                          className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white"
                        >
                          <option value="ultra-short">Ultra-short (3-5 sentences)</option>
                          <option value="full">Full (200-300 words)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-2">
                          Outcome *
                        </label>
                        <select
                          required
                          value={formData.outcome}
                          onChange={(e) => setFormData({ ...formData, outcome: e.target.value as 'interview' | 'hired' | 'ongoing' })}
                          className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white"
                        >
                          <option value="interview">Got Interview</option>
                          <option value="hired">Got Hired</option>
                          <option value="ongoing">Ongoing Work</option>
                        </select>
                      </div>
                    </div>

                    {/* Row 2: Category & Budget */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-2">
                          Category
                        </label>
                        <input
                          type="text"
                          value={formData.category}
                          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                          className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white placeholder-zinc-500"
                          placeholder="e.g., web-development, ai-automation"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-2">
                          Budget
                        </label>
                        <input
                          type="text"
                          value={formData.budget}
                          onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                          className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white placeholder-zinc-500"
                          placeholder="e.g., $5,000 - $10,000"
                        />
                      </div>
                    </div>

                    {/* Tags */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-2">
                        Tags (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={formData.tags}
                        onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                        className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white placeholder-zinc-500"
                        placeholder="e.g., nextjs, stripe, authentication, react"
                      />
                    </div>

                    {/* Row 3: Client Name & Earnings */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-2">
                          Client Name
                        </label>
                        <input
                          type="text"
                          value={formData.clientName}
                          onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                          className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white placeholder-zinc-500"
                          placeholder="e.g., John Doe"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-2">
                          Total Earnings ($)
                        </label>
                        <input
                          type="number"
                          value={formData.earnings}
                          onChange={(e) => setFormData({ ...formData, earnings: e.target.value })}
                          className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white placeholder-zinc-500"
                          placeholder="e.g., 5000"
                        />
                      </div>
                    </div>

                    {/* Row 4: Response Time & Competitor Count */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-2">
                          Response Time (hours)
                        </label>
                        <input
                          type="number"
                          value={formData.responseTime}
                          onChange={(e) => setFormData({ ...formData, responseTime: e.target.value })}
                          className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white placeholder-zinc-500"
                          placeholder="e.g., 2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-2">
                          Number of Competitors
                        </label>
                        <input
                          type="number"
                          value={formData.competitorCount}
                          onChange={(e) => setFormData({ ...formData, competitorCount: e.target.value })}
                          className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white placeholder-zinc-500"
                          placeholder="e.g., 25"
                        />
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-2">
                        Notes (What worked about this proposal?)
                      </label>
                      <textarea
                        rows={3}
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        className="w-full px-4 py-2.5 bg-zinc-900/50 border border-zinc-700/50 rounded-xl focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all text-white placeholder-zinc-500"
                        placeholder="e.g., Strong hook, mentioned their budget, specific timeline"
                      />
                    </div>

                    {/* Buttons */}
                    <div className="flex justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={resetForm}
                        className="px-5 py-2.5 bg-zinc-700/50 border border-zinc-600/50 rounded-xl text-zinc-300 hover:bg-zinc-600/50 transition-colors font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors font-medium"
                      >
                        {editingId ? 'Update' : 'Add'} Proposal
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Proposals List */}
        <div className="space-y-4">
          {proposals.length === 0 ? (
            <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-2xl p-8 sm:p-12 text-center">
              <div className="text-4xl mb-3">🏆</div>
              <p className="text-zinc-400 mb-4">No winning proposals yet. Add your first one!</p>
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Proposal
              </button>
            </div>
          ) : (
            proposals.map((proposal) => (
              <div key={proposal._id} className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 sm:p-6 hover:border-zinc-600/50 transition-colors">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold truncate">{proposal.jobTitle}</h3>
                    <div className="flex items-center flex-wrap gap-2 mt-2 text-sm">
                      <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                        proposal.outcome === 'hired' ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-700/50' :
                        proposal.outcome === 'ongoing' ? 'bg-blue-900/50 text-blue-400 border border-blue-700/50' :
                        'bg-amber-900/50 text-amber-400 border border-amber-700/50'
                      }`}>
                        {proposal.outcome === 'hired' ? '✓ Hired' :
                         proposal.outcome === 'ongoing' ? '⟳ Ongoing' :
                         '→ Interview'}
                      </span>
                      <span className="px-2 py-1 rounded-lg bg-purple-900/50 text-purple-400 border border-purple-700/50 text-xs font-medium">
                        {proposal.intensity === 'ultra-short' ? 'Ultra-short' : 'Full'}
                      </span>
                      {proposal.category && (
                        <span className="text-zinc-400 text-xs">📁 {proposal.category}</span>
                      )}
                      {proposal.earnings && (
                        <span className="text-emerald-400 font-semibold">${proposal.earnings.toLocaleString()}</span>
                      )}
                      {!proposal.jobDescription && (
                        <span className="px-2 py-1 rounded-lg bg-orange-900/50 text-orange-400 border border-orange-700/50 text-xs font-medium animate-pulse">
                          ⚠️ Missing job data
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(proposal)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                        !proposal.jobDescription 
                          ? 'bg-orange-600/50 border border-orange-500/50 text-orange-200 hover:bg-orange-600/70' 
                          : 'bg-zinc-700/50 border border-zinc-600/50 text-zinc-300 hover:bg-zinc-600/50'
                      }`}
                    >
                      {!proposal.jobDescription ? '+ Add Job Data' : 'Edit'}
                    </button>
                    <button
                      onClick={() => handleDelete(proposal._id)}
                      className="px-3 py-1.5 text-sm bg-red-900/30 border border-red-700/30 rounded-lg text-red-400 hover:bg-red-900/50 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-700/30 rounded-xl p-4 mb-4">
                  <pre className="whitespace-pre-wrap text-sm text-zinc-300 font-mono">
                    {proposal.proposalText}
                  </pre>
                </div>

                {proposal.tags && proposal.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {proposal.tags.map((tag, i) => (
                      <span key={i} className="px-2 py-1 bg-zinc-700/50 text-zinc-300 rounded-lg text-xs border border-zinc-600/50">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {proposal.notes && (
                  <div className="text-sm text-zinc-400 mb-3 p-3 bg-zinc-900/30 rounded-lg border border-zinc-800/50">
                    <span className="text-zinc-500 font-medium">Notes:</span> {proposal.notes}
                  </div>
                )}

                <div className="text-xs text-zinc-500 flex flex-wrap gap-x-3 gap-y-1">
                  <span>Added {new Date(proposal.createdAt).toLocaleDateString()}</span>
                  {proposal.responseTime && <span>• Responded in {proposal.responseTime}h</span>}
                  {proposal.competitorCount && <span>• {proposal.competitorCount} competitors</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
