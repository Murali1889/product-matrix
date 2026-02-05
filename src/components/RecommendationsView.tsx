'use client';

import { useState, useEffect } from 'react';
import {
  Sparkles, Target, TrendingUp, Users, Search, Building2,
  ChevronRight, AlertCircle, CheckCircle2, Zap, ArrowRight,
  Globe, DollarSign, BarChart3, PieChart
} from 'lucide-react';
import type {
  ClientRecommendations,
  SegmentAPIProfile,
  CompanySimilarity,
  ProspectCompany,
  RecommendationEngineStats
} from '@/types/recommendation';

interface RecommendationsViewProps {
  clients: { client_name: string; profile?: { segment?: string } }[];
}

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const scoreColor = (score: number) => {
  if (score >= 80) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
  if (score >= 60) return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-slate-600 bg-slate-50 border-slate-200';
};

const categoryBadge = (category: string) => {
  const styles: Record<string, string> = {
    'segment_match': 'bg-blue-100 text-blue-700',
    'similar_company': 'bg-purple-100 text-purple-700',
    'cross_sell': 'bg-emerald-100 text-emerald-700',
    'upsell': 'bg-amber-100 text-amber-700',
    'trending': 'bg-rose-100 text-rose-700',
  };
  return styles[category] || 'bg-slate-100 text-slate-700';
};

export default function RecommendationsView({ clients }: RecommendationsViewProps) {
  const [activeTab, setActiveTab] = useState<'client' | 'segment' | 'prospect'>('client');
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [clientSearch, setClientSearch] = useState('');
  const [recommendations, setRecommendations] = useState<ClientRecommendations | null>(null);
  const [segmentProfiles, setSegmentProfiles] = useState<SegmentAPIProfile[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<string>('');
  const [stats, setStats] = useState<RecommendationEngineStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prospect state
  const [prospectName, setProspectName] = useState('');
  const [prospectSegment, setProspectSegment] = useState('');
  const [prospectSize, setProspectSize] = useState<'small' | 'medium' | 'large' | 'enterprise'>('medium');
  const [prospectGeography, setProspectGeography] = useState('India');
  const [prospectResult, setProspectResult] = useState<ProspectCompany | null>(null);

  // Load stats on mount
  useEffect(() => {
    fetch('/api/recommendations?action=stats')
      .then(res => res.json())
      .then(data => {
        if (data.success) setStats(data.data);
      })
      .catch(console.error);

    fetch('/api/recommendations?action=segments')
      .then(res => res.json())
      .then(data => {
        if (data.success) setSegmentProfiles(data.data);
      })
      .catch(console.error);
  }, []);

  // Fetch client recommendations
  const fetchClientRecommendations = async (clientName: string) => {
    if (!clientName) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/recommendations?action=client&client=${encodeURIComponent(clientName)}`);
      const data = await res.json();

      if (data.success) {
        setRecommendations(data.data);
      } else {
        setError(data.error || 'Failed to load recommendations');
      }
    } catch {
      setError('Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  };

  // Analyze prospect
  const analyzeProspect = async () => {
    if (!prospectName || !prospectSegment) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'analyze',
          companyName: prospectName,
          segment: prospectSegment,
          size: prospectSize,
          geography: prospectGeography
        })
      });
      const data = await res.json();

      if (data.success) {
        setProspectResult(data.data);
      } else {
        setError(data.error || 'Failed to analyze prospect');
      }
    } catch {
      setError('Failed to analyze prospect');
    } finally {
      setLoading(false);
    }
  };

  const filteredClients = clients.filter(c =>
    c.client_name.toLowerCase().includes(clientSearch.toLowerCase())
  );

  return (
    <div className="space-y-8">
      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white">
            <div className="flex items-center gap-2 text-blue-100 text-sm mb-2">
              <Users size={16} />
              Clients Analyzed
            </div>
            <div className="text-3xl font-bold">{stats.totalClientsAnalyzed}</div>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-6 text-white">
            <div className="flex items-center gap-2 text-purple-100 text-sm mb-2">
              <Zap size={16} />
              APIs Tracked
            </div>
            <div className="text-3xl font-bold">{stats.totalAPIsTracked}</div>
          </div>
          <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl p-6 text-white">
            <div className="flex items-center gap-2 text-amber-100 text-sm mb-2">
              <PieChart size={16} />
              Segments
            </div>
            <div className="text-3xl font-bold">{stats.segmentsIdentified.length}</div>
          </div>
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-6 text-white">
            <div className="flex items-center gap-2 text-emerald-100 text-sm mb-2">
              <Sparkles size={16} />
              Avg Recommendations
            </div>
            <div className="text-3xl font-bold">{stats.avgRecommendationsPerClient}</div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2 bg-slate-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('client')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'client'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span className="flex items-center gap-2">
            <Target size={16} />
            Client Recommendations
          </span>
        </button>
        <button
          onClick={() => setActiveTab('segment')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'segment'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span className="flex items-center gap-2">
            <BarChart3 size={16} />
            Segment Analysis
          </span>
        </button>
        <button
          onClick={() => setActiveTab('prospect')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'prospect'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span className="flex items-center gap-2">
            <Building2 size={16} />
            New Prospect
          </span>
        </button>
      </div>

      {/* Client Recommendations Tab */}
      {activeTab === 'client' && (
        <div className="grid grid-cols-3 gap-8">
          {/* Client Selector */}
          <div className="bg-white rounded-xl border border-stone-200 p-6">
            <h3 className="text-sm font-semibold text-slate-600 mb-4">Select Client</h3>

            <div className="relative mb-4">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search clients..."
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="max-h-96 overflow-y-auto space-y-1">
              {filteredClients.slice(0, 50).map(client => (
                <button
                  key={client.client_name}
                  onClick={() => {
                    setSelectedClient(client.client_name);
                    fetchClientRecommendations(client.client_name);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                    selectedClient === client.client_name
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="font-medium">{client.client_name}</div>
                  {client.profile?.segment && (
                    <div className="text-xs text-slate-400">{client.profile.segment}</div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Recommendations Panel */}
          <div className="col-span-2 space-y-6">
            {loading && (
              <div className="bg-white rounded-xl border border-stone-200 p-12 text-center">
                <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-slate-500">Loading recommendations...</p>
              </div>
            )}

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-center gap-3 text-rose-700">
                <AlertCircle size={20} />
                {error}
              </div>
            )}

            {recommendations && !loading && (
              <>
                {/* Client Summary */}
                <div className="bg-white rounded-xl border border-stone-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{recommendations.clientName}</h3>
                      <p className="text-sm text-slate-500">{recommendations.segment}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-slate-500">Potential Upsell</div>
                      <div className="text-2xl font-bold text-emerald-600">
                        {formatCurrency(recommendations.potentialUpsell)}/mo
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs text-slate-500">Current APIs:</span>
                    {recommendations.currentAPIs.slice(0, 8).map(api => (
                      <span key={api} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">
                        {api}
                      </span>
                    ))}
                    {recommendations.currentAPIs.length > 8 && (
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">
                        +{recommendations.currentAPIs.length - 8} more
                      </span>
                    )}
                  </div>
                </div>

                {/* API Recommendations */}
                <div className="bg-white rounded-xl border border-stone-200 p-6">
                  <h3 className="text-sm font-semibold text-slate-600 mb-4 flex items-center gap-2">
                    <Sparkles size={16} className="text-amber-500" />
                    Recommended APIs
                  </h3>

                  <div className="space-y-3">
                    {recommendations.recommendations.map((rec, i) => (
                      <div
                        key={`${rec.apiName}-${i}`}
                        className="border border-stone-200 rounded-lg p-4 hover:shadow-sm transition-shadow"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-slate-900">{rec.apiName}</span>
                              <span className={`px-2 py-0.5 rounded text-xs ${categoryBadge(rec.category)}`}>
                                {rec.category.replace('_', ' ')}
                              </span>
                            </div>
                            <p className="text-sm text-slate-500 mb-2">{rec.reason}</p>
                            {rec.adoptedBy.length > 0 && (
                              <div className="flex items-center gap-1 text-xs text-slate-400">
                                <Users size={12} />
                                Used by: {rec.adoptedBy.slice(0, 3).join(', ')}
                                {rec.adoptedBy.length > 3 && ` +${rec.adoptedBy.length - 3}`}
                              </div>
                            )}
                          </div>
                          <div className="text-right ml-4">
                            <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border ${scoreColor(rec.score)}`}>
                              {rec.score}%
                            </div>
                            <div className="text-sm text-slate-500 mt-1">
                              ~{formatCurrency(rec.potentialRevenue)}/mo
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Similar Companies */}
                <div className="bg-white rounded-xl border border-stone-200 p-6">
                  <h3 className="text-sm font-semibold text-slate-600 mb-4 flex items-center gap-2">
                    <Users size={16} className="text-purple-500" />
                    Similar Companies
                  </h3>

                  <div className="grid grid-cols-2 gap-4">
                    {recommendations.similarCompanies.slice(0, 6).map(company => (
                      <div
                        key={company.clientName}
                        className="border border-stone-200 rounded-lg p-4"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-slate-900">{company.clientName}</span>
                          <span className="text-sm text-slate-500">
                            {(company.similarityScore * 100).toFixed(0)}% similar
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mb-2">{company.segment}</div>
                        {company.uniqueAPIs.length > 0 && (
                          <div className="text-xs text-emerald-600">
                            <span className="font-medium">They also use:</span>{' '}
                            {company.uniqueAPIs.slice(0, 3).join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {!recommendations && !loading && !error && (
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-12 text-center">
                <Target size={48} className="mx-auto text-slate-300 mb-4" />
                <p className="text-slate-500">Select a client to see personalized API recommendations</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Segment Analysis Tab */}
      {activeTab === 'segment' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {segmentProfiles.map(profile => (
              <div
                key={profile.segment}
                onClick={() => setSelectedSegment(
                  selectedSegment === profile.segment ? '' : profile.segment
                )}
                className={`bg-white rounded-xl border p-5 cursor-pointer transition-all ${
                  selectedSegment === profile.segment
                    ? 'border-blue-300 ring-2 ring-blue-100'
                    : 'border-stone-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-slate-900">{profile.segment}</h4>
                  <ChevronRight
                    size={16}
                    className={`text-slate-400 transition-transform ${
                      selectedSegment === profile.segment ? 'rotate-90' : ''
                    }`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-slate-400">Companies</div>
                    <div className="font-semibold text-slate-700">{profile.totalCompanies}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Total Revenue</div>
                    <div className="font-semibold text-slate-700">{formatCurrency(profile.totalRevenue)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {selectedSegment && (
            <div className="bg-white rounded-xl border border-stone-200 p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">
                {selectedSegment} - API Adoption
              </h3>

              {(() => {
                const profile = segmentProfiles.find(p => p.segment === selectedSegment);
                if (!profile) return null;

                return (
                  <div className="space-y-3">
                    {profile.apis.slice(0, 15).map(api => (
                      <div key={api.name} className="flex items-center gap-4">
                        <div className="w-48 text-sm text-slate-700 truncate">{api.name}</div>
                        <div className="flex-1">
                          <div className="h-6 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                api.importance === 'critical' ? 'bg-emerald-500' :
                                api.importance === 'common' ? 'bg-blue-500' : 'bg-slate-400'
                              }`}
                              style={{ width: `${api.adoptionRate}%` }}
                            />
                          </div>
                        </div>
                        <div className="w-16 text-right text-sm font-medium text-slate-600">
                          {api.adoptionRate.toFixed(0)}%
                        </div>
                        <div className="w-24 text-right text-sm text-slate-400">
                          {formatCurrency(api.avgRevenue)}/mo
                        </div>
                        <div className={`w-20 text-xs px-2 py-1 rounded text-center ${
                          api.importance === 'critical' ? 'bg-emerald-100 text-emerald-700' :
                          api.importance === 'common' ? 'bg-blue-100 text-blue-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {api.importance}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* New Prospect Tab */}
      {activeTab === 'prospect' && (
        <div className="grid grid-cols-2 gap-8">
          {/* Prospect Form */}
          <div className="bg-white rounded-xl border border-stone-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-6">Analyze New Prospect</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Company Name</label>
                <input
                  type="text"
                  value={prospectName}
                  onChange={(e) => setProspectName(e.target.value)}
                  placeholder="e.g., Acme Financial Services"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Segment</label>
                <select
                  value={prospectSegment}
                  onChange={(e) => setProspectSegment(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select segment...</option>
                  {segmentProfiles.map(p => (
                    <option key={p.segment} value={p.segment}>{p.segment}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Company Size</label>
                  <select
                    value={prospectSize}
                    onChange={(e) => setProspectSize(e.target.value as typeof prospectSize)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="small">Small (under 100 employees)</option>
                    <option value="medium">Medium (100-500)</option>
                    <option value="large">Large (500-2000)</option>
                    <option value="enterprise">Enterprise (2000+)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Geography</label>
                  <select
                    value={prospectGeography}
                    onChange={(e) => setProspectGeography(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="India">India</option>
                    <option value="ASEAN">ASEAN</option>
                    <option value="Vietnam">Vietnam</option>
                    <option value="Indonesia">Indonesia</option>
                    <option value="Nigeria">Nigeria</option>
                    <option value="Kenya">Kenya</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <button
                onClick={analyzeProspect}
                disabled={!prospectName || !prospectSegment || loading}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {loading ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    Generate Recommendations
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Prospect Results */}
          <div>
            {prospectResult ? (
              <div className="space-y-4">
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 text-white">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="text-xl font-bold">{prospectResult.name}</h4>
                      <p className="text-slate-300">{prospectResult.segment} • {prospectResult.geography}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-slate-400">Fit Score</div>
                      <div className="text-3xl font-bold text-emerald-400">{prospectResult.fitScore}%</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-700">
                    <div>
                      <div className="text-sm text-slate-400">Est. Annual Value</div>
                      <div className="text-2xl font-bold">{formatCurrency(prospectResult.estimatedAnnualValue)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-400">Company Size</div>
                      <div className="text-lg font-semibold capitalize">{prospectResult.estimatedSize}</div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-stone-200 p-6">
                  <h4 className="font-semibold text-slate-900 mb-4">Recommended APIs to Pitch</h4>

                  <div className="space-y-3">
                    {prospectResult.recommendedAPIs.slice(0, 8).map((rec, i) => (
                      <div
                        key={`${rec.apiName}-${i}`}
                        className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                            i < 3 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {i + 1}
                          </div>
                          <div>
                            <div className="font-medium text-slate-900">{rec.apiName}</div>
                            <div className="text-xs text-slate-400">{rec.reason}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-slate-700">
                            ~{formatCurrency(rec.potentialRevenue)}/mo
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-12 text-center h-full flex flex-col items-center justify-center">
                <Building2 size={48} className="text-slate-300 mb-4" />
                <p className="text-slate-500">Fill in prospect details and click analyze</p>
                <p className="text-sm text-slate-400 mt-2">Get instant API recommendations and revenue estimates</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
