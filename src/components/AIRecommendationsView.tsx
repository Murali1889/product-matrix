'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Target, TrendingUp, Search, Building2,
  AlertCircle, CheckCircle2, Zap,
  DollarSign, Brain, Loader2, RefreshCw, Copy, Check,
  Database, UserCheck, BadgeCheck, ChevronDown, ChevronUp,
  Users, ArrowUpRight
} from 'lucide-react';

interface ClientAPI {
  name: string;
  revenue: number;
  subModule?: string;
  totalUsage?: number;
}

interface ClientData {
  name: string;
  segment?: string;
  geography?: string;
  paymentModel?: string;
  totalRevenue: number;
  monthlyAverage: number;
  activeMonths?: number;
  currentAPIs: ClientAPI[];
  apiCount?: number;
}

interface AIRecommendation {
  api: string;
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  useCase: string;
  regulatoryNeed?: string;
  estimatedVolume: string;
  estimatedRevenue: { monthly: number; annual: number };
}

interface SimilarClient {
  name: string;
  similarity: number;
  sharedAPIs: string[];
  additionalAPIs: string[];
}

interface AnalysisResult {
  companyName: string;
  isExistingClient: boolean;
  clientData: ClientData | null;
  analysis?: {
    companyName: string;
    description: string;
    industry: string;
    businessModel: string;
    geography: string;
    companySize: string;
  };
  recommendations: AIRecommendation[];
  currentAPIs: ClientAPI[];
  similarClients?: SimilarClient[];
  recommendedFromSimilarClients?: string[];
  salesStrategy?: {
    primaryPitch: string;
    keyValueProps: string[];
  };
  totalEstimatedValue?: { monthly: number; annual: number };
  upsellPotential?: {
    currentMonthlySpend: number;
    potentialAdditionalSpend: number;
    growthOpportunity: string;
  };
}

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const formatNumber = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);

const priorityColors: Record<string, string> = {
  critical: 'bg-rose-100 text-rose-700',
  high: 'bg-amber-100 text-amber-700',
  medium: 'bg-blue-100 text-blue-700',
  low: 'bg-slate-100 text-slate-600'
};

export default function AIRecommendationsView() {
  const [companyName, setCompanyName] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Top clients for quick access
  const [topClients, setTopClients] = useState<{ name: string; revenue: number; apiCount: number }[]>([]);
  const [topAPIs, setTopAPIs] = useState<{ name: string; clientCount: number; revenue: number }[]>([]);

  // Expansion state
  const [expandedSection, setExpandedSection] = useState<string | null>('recommendations');

  // Load summary data on mount
  useEffect(() => {
    fetch('/api/unified-data?action=summary')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setTopClients(data.data.topClients?.slice(0, 8) || []);
          setTopAPIs(data.data.topAPIs?.slice(0, 8) || []);
        }
      })
      .catch(console.error);
  }, []);

  // Analyze function using unified data endpoint
  const analyzeCompany = useCallback(async (name?: string, forceRefresh = false) => {
    const searchName = name || companyName;
    if (!searchName.trim()) return;

    setLoading(true);
    setError(null);
    setFromCache(false);

    try {
      // First get real data from unified connector
      const unifiedRes = await fetch('/api/unified-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'recommendation-data',
          clientName: searchName.trim()
        })
      });
      const unifiedData = await unifiedRes.json();

      // Then get AI analysis (cached or fresh)
      const aiRes = await fetch('/api/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'analyze',
          companyName: searchName.trim(),
          forceRefresh
        })
      });
      const aiData = await aiRes.json();

      if (unifiedData.success && unifiedData.data.client) {
        // Combine unified data with AI analysis
        const client = unifiedData.data.client;
        setResult({
          companyName: client.name,
          isExistingClient: true,
          clientData: {
            name: client.name,
            segment: aiData.data?.clientData?.segment,
            geography: aiData.data?.clientData?.geography,
            totalRevenue: client.totalRevenue,
            monthlyAverage: client.monthlyAvgRevenue,
            currentAPIs: client.apis.map((a: any) => ({
              name: a.moduleName,
              revenue: a.totalRevenue,
              subModule: a.subModuleName,
              totalUsage: a.totalUsage
            })),
            apiCount: client.apiCount
          },
          currentAPIs: client.apis.map((a: any) => ({
            name: a.moduleName,
            revenue: a.totalRevenue,
            subModule: a.subModuleName,
            totalUsage: a.totalUsage
          })),
          recommendations: aiData.data?.recommendations || [],
          similarClients: unifiedData.data.similarClients,
          recommendedFromSimilarClients: unifiedData.data.recommendedFromSimilarClients,
          salesStrategy: aiData.data?.salesStrategy,
          totalEstimatedValue: aiData.data?.totalEstimatedValue,
          upsellPotential: aiData.data?.upsellPotential
        });
        setFromCache(aiData.fromCache || false);
      } else if (aiData.success) {
        // New prospect - use AI data
        setResult(aiData.data);
        setFromCache(aiData.fromCache || false);
      } else {
        setError(aiData.error || 'Analysis failed');
      }
    } catch (err) {
      setError('Failed to analyze company');
    } finally {
      setLoading(false);
    }
  }, [companyName]);

  const quickSelect = (name: string) => {
    setCompanyName(name);
    analyzeCompany(name);
  };

  const copyPitch = () => {
    if (result?.salesStrategy?.primaryPitch) {
      navigator.clipboard.writeText(result.salesStrategy.primaryPitch);
      setCopiedText('pitch');
      setTimeout(() => setCopiedText(null), 2000);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Compact Header + Search */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Brain className="text-purple-600" size={24} />
            <h2 className="text-lg font-bold text-slate-900">AI Sales Intelligence</h2>
          </div>

          {/* Inline Search */}
          <div className="flex-1 max-w-md">
            <div className="relative">
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Search company (e.g., Razorpay, Swiggy, Cred)"
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-text"
                onKeyDown={(e) => e.key === 'Enter' && analyzeCompany()}
              />
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <button
            onClick={() => analyzeCompany()}
            disabled={!companyName.trim() || loading}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white rounded-lg font-medium flex items-center gap-2 text-sm cursor-pointer disabled:cursor-not-allowed transition-all"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>

          {fromCache && (
            <button
              onClick={() => analyzeCompany(undefined, true)}
              className="p-2 text-slate-500 hover:text-purple-600 cursor-pointer transition-colors"
              title="Refresh from AI"
            >
              <RefreshCw size={16} />
            </button>
          )}
        </div>

        {/* Quick Access - Top Clients */}
        <div className="flex items-center gap-2 mt-3 overflow-x-auto">
          <span className="text-xs text-slate-500 whitespace-nowrap">Top clients:</span>
          {topClients.slice(0, 6).map(c => (
            <button
              key={c.name}
              onClick={() => quickSelect(c.name)}
              className="px-2 py-1 bg-slate-100 hover:bg-purple-100 text-slate-700 hover:text-purple-700 rounded text-xs whitespace-nowrap transition-colors cursor-pointer"
            >
              {c.name}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-3 p-2 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700 flex items-center gap-2">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
      </div>

      {/* Main Content - No scroll needed */}
      <div className="flex-1 overflow-hidden">
        {result ? (
          <div className="h-full grid grid-cols-3 gap-0">
            {/* Left: Client Overview */}
            <div className="border-r border-slate-200 p-4 overflow-y-auto">
              {/* Client Header */}
              <div className={`rounded-lg p-4 mb-4 ${result.isExistingClient ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-800 text-white'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {result.isExistingClient ? (
                    <BadgeCheck size={18} className="text-emerald-600" />
                  ) : (
                    <Building2 size={18} className="text-white" />
                  )}
                  <span className={`text-sm font-medium ${result.isExistingClient ? 'text-emerald-700' : 'text-slate-300'}`}>
                    {result.isExistingClient ? 'Existing Client' : 'New Prospect'}
                  </span>
                </div>

                <h3 className={`text-xl font-bold ${result.isExistingClient ? 'text-slate-900' : 'text-white'}`}>
                  {result.companyName}
                </h3>

                {result.analysis?.description && (
                  <p className={`text-sm mt-1 ${result.isExistingClient ? 'text-slate-600' : 'text-slate-300'}`}>
                    {result.analysis.description}
                  </p>
                )}
              </div>

              {/* Key Metrics */}
              {result.isExistingClient && result.clientData && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-blue-50 rounded-lg p-3">
                    <div className="text-xs text-blue-600 font-medium">Total Revenue</div>
                    <div className="text-lg font-bold text-blue-900">{formatCurrency(result.clientData.totalRevenue)}</div>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-3">
                    <div className="text-xs text-purple-600 font-medium">APIs Used</div>
                    <div className="text-lg font-bold text-purple-900">{result.clientData.apiCount || result.currentAPIs.length}</div>
                  </div>
                </div>
              )}

              {/* Upsell Opportunity */}
              {result.upsellPotential && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp size={16} className="text-amber-600" />
                    <span className="text-sm font-semibold text-amber-800">Upsell Opportunity</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-amber-600">Potential Add</span>
                      <div className="text-lg font-bold text-amber-900">
                        {formatCurrency(result.upsellPotential.potentialAdditionalSpend)}/mo
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-amber-600">Growth</span>
                      <div className="text-lg font-bold text-emerald-600">
                        +{result.upsellPotential.growthOpportunity}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Current APIs */}
              {result.currentAPIs && result.currentAPIs.length > 0 && (
                <div>
                  <button
                    onClick={() => toggleSection('currentAPIs')}
                    className="w-full flex items-center justify-between text-sm font-medium text-slate-700 mb-2 cursor-pointer hover:text-purple-600 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Database size={14} className="text-blue-500" />
                      Current APIs ({result.currentAPIs.length})
                    </span>
                    {expandedSection === 'currentAPIs' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {expandedSection === 'currentAPIs' && (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {result.currentAPIs.map((api, i) => (
                        <div key={i} className="flex items-center justify-between py-1 text-sm border-b border-slate-100 last:border-0">
                          <span className="text-slate-700 truncate">{api.name}</span>
                          <span className="text-slate-500 text-xs whitespace-nowrap ml-2">
                            {formatCurrency(api.revenue)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Similar Clients */}
              {result.similarClients && result.similarClients.length > 0 && (
                <div className="mt-4">
                  <button
                    onClick={() => toggleSection('similar')}
                    className="w-full flex items-center justify-between text-sm font-medium text-slate-700 mb-2 cursor-pointer hover:text-purple-600 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Users size={14} className="text-purple-500" />
                      Similar Clients ({result.similarClients.length})
                    </span>
                    {expandedSection === 'similar' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {expandedSection === 'similar' && (
                    <div className="space-y-2">
                      {result.similarClients.slice(0, 5).map((sim, i) => (
                        <button
                          key={i}
                          onClick={() => quickSelect(sim.name)}
                          className="w-full text-left bg-slate-50 hover:bg-purple-50 rounded p-2 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm text-slate-800">{sim.name}</span>
                            <span className="text-xs text-purple-600">{sim.similarity}% match</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Uses: {sim.additionalAPIs.slice(0, 3).join(', ')}
                            {sim.additionalAPIs.length > 3 && ` +${sim.additionalAPIs.length - 3}`}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Center: Recommendations */}
            <div className="border-r border-slate-200 p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Sparkles size={16} className="text-amber-500" />
                  Recommended APIs
                </h4>
                {result.totalEstimatedValue && (
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Est. Annual</div>
                    <div className="font-bold text-emerald-600">{formatCurrency(result.totalEstimatedValue.annual)}</div>
                  </div>
                )}
              </div>

              {/* From Similar Clients */}
              {result.recommendedFromSimilarClients && result.recommendedFromSimilarClients.length > 0 && (
                <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <div className="text-xs font-medium text-purple-700 mb-2 flex items-center gap-1">
                    <Zap size={12} />
                    Based on similar clients
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {result.recommendedFromSimilarClients.slice(0, 6).map((api, i) => (
                      <span key={i} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">
                        {api}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Recommendations */}
              <div className="space-y-3">
                {result.recommendations?.slice(0, 8).map((rec, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg p-3 hover:border-purple-300 transition-colors">
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 text-sm">{rec.api}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${priorityColors[rec.priority]}`}>
                          {rec.priority}
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-emerald-600">
                        {formatCurrency(rec.estimatedRevenue?.monthly || 0)}/mo
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 mb-1">{rec.reason}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">{rec.category}</span>
                      <span className="text-[10px] text-slate-400">{rec.estimatedVolume}</span>
                    </div>
                  </div>
                ))}
              </div>

              {result.recommendations?.length === 0 && (
                <div className="text-center py-8 text-slate-500 text-sm">
                  No additional API recommendations at this time.
                </div>
              )}
            </div>

            {/* Right: Sales Strategy */}
            <div className="p-4 overflow-y-auto bg-slate-50">
              <h4 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Target size={16} className="text-blue-500" />
                Sales Playbook
              </h4>

              {/* Quick Pitch */}
              {result.salesStrategy?.primaryPitch && (
                <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-slate-500">Quick Pitch</span>
                    <button onClick={copyPitch} className="text-slate-400 hover:text-slate-600 cursor-pointer transition-colors">
                      {copiedText === 'pitch' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                  </div>
                  <p className="text-sm text-slate-800">{result.salesStrategy.primaryPitch}</p>
                </div>
              )}

              {/* Value Props */}
              {result.salesStrategy?.keyValueProps && (
                <div className="mb-4">
                  <div className="text-xs font-medium text-slate-500 mb-2">Key Value Props</div>
                  <div className="space-y-2">
                    {result.salesStrategy.keyValueProps.map((prop, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-slate-700">
                        <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                        <span>{prop}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div className="mt-6 pt-4 border-t border-slate-200">
                <div className="text-xs font-medium text-slate-500 mb-3">Quick Actions</div>
                <div className="space-y-2">
                  <button className="w-full flex items-center justify-between px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 hover:border-slate-300 cursor-pointer transition-all">
                    <span>View Full Profile</span>
                    <ArrowUpRight size={14} />
                  </button>
                  <button className="w-full flex items-center justify-between px-3 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 cursor-pointer transition-all">
                    <span>Generate Outreach</span>
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </div>

              {/* API Stats */}
              {topAPIs.length > 0 && !result.isExistingClient && (
                <div className="mt-6 pt-4 border-t border-slate-200">
                  <div className="text-xs font-medium text-slate-500 mb-3">Popular APIs</div>
                  <div className="space-y-1">
                    {topAPIs.slice(0, 5).map((api, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-slate-700">{api.name}</span>
                        <span className="text-slate-400">{api.clientCount} clients</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Empty State - Also useful */
          <div className="h-full flex items-center justify-center">
            <div className="max-w-lg text-center">
              <Brain size={64} className="text-slate-200 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-700 mb-2">Search Any Company</h3>
              <p className="text-slate-500 mb-6">
                Get instant insights on existing clients or research new prospects with AI-powered analysis.
              </p>

              <div className="grid grid-cols-2 gap-4 text-left">
                <div className="bg-emerald-50 rounded-lg p-4">
                  <UserCheck className="text-emerald-600 mb-2" size={20} />
                  <h4 className="font-medium text-slate-900 text-sm">Existing Clients</h4>
                  <p className="text-xs text-slate-600 mt-1">View current API usage, revenue, and upsell opportunities</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-4">
                  <Target className="text-purple-600 mb-2" size={20} />
                  <h4 className="font-medium text-slate-900 text-sm">New Prospects</h4>
                  <p className="text-xs text-slate-600 mt-1">Get company profile, API recommendations, and sales playbook</p>
                </div>
              </div>

              {/* Top Clients Quick Access */}
              {topClients.length > 0 && (
                <div className="mt-6 pt-6 border-t border-slate-200">
                  <div className="text-xs text-slate-500 mb-3">Top Clients by Revenue</div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {topClients.slice(0, 8).map(c => (
                      <button
                        key={c.name}
                        onClick={() => quickSelect(c.name)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-purple-100 text-slate-700 hover:text-purple-700 rounded-full text-sm transition-colors cursor-pointer"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
