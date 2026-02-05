'use client';

/**
 * Sales Intelligence Dashboard
 *
 * 60-30-10 Color Theory:
 * - 60% White/Stone-50 (backgrounds)
 * - 30% Slate (text, borders)
 * - 10% Emerald (primary actions), Amber (highlights)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, Send, Check, TrendingUp, ChevronDown, ChevronUp,
  Users, Sparkles, Target, Copy, Shield, Zap, MessageCircle,
  BarChart3, ArrowLeft
} from 'lucide-react';
import {
  HYPERVERGE_PRICING_INR,
  getBestComparison,
  getLikelyCompetitors,
  COMPETITORS,
} from '@/lib/competitive-intel';

// ============================================================================
// Types
// ============================================================================

interface ClientData {
  name: string;
  totalRevenue: number;
  totalUsage: number;
  apis: {
    moduleName: string;
    subModuleName?: string;
    totalUsage: number;
    totalRevenue: number;
    usageSep?: number;
    revenueSep?: number;
    usageOct?: number;
    revenueOct?: number;
  }[];
  apiCount: number;
  monthlyAvgRevenue: number;
  usageSep?: number;
  revenueSep?: number;
  usageOct?: number;
  revenueOct?: number;
}

interface Recommendation {
  api: string;
  priority: string;
  reason: string;
  category?: string;
}

interface SimilarClient {
  name: string;
  similarity: number;
  sharedAPIs: string[];
}

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  data?: {
    client?: ClientData;
    recommendations?: Recommendation[];
    similarClients?: SimilarClient[];
  };
}

// ============================================================================
// Pricing
// ============================================================================

const DEFAULT_PRICE_PER_CALL_INR = 0.50;
const INR_TO_USD = 0.012;

const ESTIMATED_VOLUMES: Record<string, number> = {
  'Bank Account Verification': 5000,
  'AML Search': 3000,
  'Aadhaar OKYC': 8000,
  'PAN Verification': 10000,
  'Face Match': 6000,
  'Selfie Validation': 5000,
  'CKYC': 4000,
  'default': 2000,
};

function getEstimatedVolume(apiName: string): number {
  for (const [key, volume] of Object.entries(ESTIMATED_VOLUMES)) {
    if (apiName.toLowerCase().includes(key.toLowerCase())) {
      return volume;
    }
  }
  return ESTIMATED_VOLUMES.default;
}

function calculateMonthlyRevenue(apiName: string): number {
  const volume = getEstimatedVolume(apiName);
  return Math.round(volume * DEFAULT_PRICE_PER_CALL_INR * INR_TO_USD);
}

// ============================================================================
// Main Component
// ============================================================================

export default function SalesIntelDashboard() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientData | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [similarClients, setSimilarClients] = useState<SimilarClient[]>([]);
  const [expandedAPIs, setExpandedAPIs] = useState(false);
  const [topClients, setTopClients] = useState<string[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load top clients on mount
  useEffect(() => {
    fetch('/api/unified-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'summary' }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data?.topClients) {
          setTopClients(data.data.topClients.slice(0, 8).map((c: { name: string }) => c.name));
        }
      })
      .catch(console.error);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Search function
  const searchCompany = useCallback(async (query: string) => {
    if (!query.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: query,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/company-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'smart', companyName: query.trim() }),
      });

      const data = await res.json();

      if (data.success) {
        const result = data.data;
        const isExisting = result.data?.client !== undefined;
        const client = result.data?.client;
        const recs = result.data?.recommendations || result.data?.defaultRecommendations || [];
        const similar = result.data?.similarClients || [];

        setSelectedClient(client || null);
        setRecommendations(recs);
        setSimilarClients(similar);

        // Build assistant response
        let response = '';
        if (isExisting && client) {
          response = `**${client.name}** is an existing client.\n\n`;
          response += `📊 **Revenue:** $${client.totalRevenue.toLocaleString()}\n`;
          response += `📈 **Total Usage:** ${client.totalUsage.toLocaleString()} API calls\n`;
          response += `🔌 **APIs Used:** ${client.apiCount}\n\n`;

          if (recs.length > 0) {
            response += `**Recommended APIs to upsell:**\n`;
            recs.slice(0, 3).forEach((rec: Recommendation) => {
              response += `• ${rec.api} (${rec.priority})\n`;
            });
          }
        } else {
          response = `**${query}** is a new prospect.\n\n`;
          response += `Based on industry analysis, here are recommended APIs:\n`;
          recs.slice(0, 3).forEach((rec: Recommendation) => {
            response += `• ${rec.api} - ${rec.reason}\n`;
          });
        }

        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: response,
          timestamp: new Date(),
          data: { client, recommendations: recs, similarClients: similar },
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: `I couldn't find information about "${query}". Try searching for another company.`,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: 'Sorry, there was an error processing your request. Please try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    searchCompany(inputValue);
  };

  const handleQuickSearch = (company: string) => {
    setInputValue(company);
    searchCompany(company);
  };

  const totalUpsellPotential = recommendations.slice(0, 3).reduce((sum, rec) => {
    return sum + calculateMonthlyRevenue(rec.api);
  }, 0);

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Header - Clean & Minimal */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="text-slate-400 hover:text-slate-600 cursor-pointer">
              <ArrowLeft size={20} />
            </a>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
                <Target className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-slate-800">Sales Intelligence</span>
            </div>
          </div>
          <div className="text-xs text-slate-400">
            ₹{HYPERVERGE_PRICING_INR}/call • 50+ APIs
          </div>
        </div>
      </header>

      {/* Main Content - 2 Column Layout */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-6 flex gap-6">
        {/* Left: Chat Interface */}
        <div className="flex-1 flex flex-col bg-white rounded-xl border border-stone-200 overflow-hidden">
          {/* Chat Header */}
          <div className="px-5 py-4 border-b border-stone-100 bg-stone-50">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-emerald-600" />
              <span className="font-medium text-slate-700">AI Assistant</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">Search any company to get instant insights</p>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-emerald-600" />
                </div>
                <h3 className="text-lg font-medium text-slate-700 mb-2">Search Any Company</h3>
                <p className="text-sm text-slate-400 mb-6 max-w-sm mx-auto">
                  Get instant insights on existing clients or research new prospects
                </p>

                {/* Quick Search Buttons */}
                <div className="flex flex-wrap justify-center gap-2">
                  {topClients.slice(0, 6).map((company) => (
                    <button
                      key={company}
                      onClick={() => handleQuickSearch(company)}
                      className="px-4 py-2 bg-stone-100 hover:bg-emerald-50 hover:text-emerald-700 border border-stone-200 hover:border-emerald-200 rounded-lg text-sm text-slate-600 cursor-pointer transition-all"
                    >
                      {company}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-4 py-3 ${
                      msg.type === 'user'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-stone-100 text-slate-700'
                    }`}
                  >
                    <div className="text-sm whitespace-pre-wrap">
                      {msg.content.split('\n').map((line, i) => {
                        // Handle markdown bold
                        const boldLine = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                        return (
                          <p key={i} className={i > 0 ? 'mt-1' : ''} dangerouslySetInnerHTML={{ __html: boldLine }} />
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-stone-100 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.1s]" />
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input Area */}
          <form onSubmit={handleSubmit} className="p-4 border-t border-stone-100 bg-white">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Search company (e.g., Rapido, Swiggy, CRED)"
                  className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-lg text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:cursor-not-allowed text-white rounded-lg transition-colors cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>

        {/* Right: Client Details Panel */}
        <div className="w-80 space-y-4">
          {selectedClient ? (
            <>
              {/* Client Overview */}
              <div className="bg-white rounded-xl border border-stone-200 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                  <span className="text-xs text-emerald-600 font-medium">Existing Client</span>
                </div>
                <h2 className="text-xl font-semibold text-slate-800 mb-4">{selectedClient.name}</h2>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-stone-50 rounded-lg p-3">
                    <div className="text-xs text-slate-400 mb-1">Revenue</div>
                    <div className="text-lg font-bold text-slate-800">
                      ${selectedClient.totalRevenue.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-stone-50 rounded-lg p-3">
                    <div className="text-xs text-slate-400 mb-1">Usage</div>
                    <div className="text-lg font-bold text-slate-800">
                      {(selectedClient.totalUsage / 1000000).toFixed(1)}M
                    </div>
                  </div>
                </div>

                {/* Monthly Data */}
                {((selectedClient.revenueSep || 0) > 0 || (selectedClient.revenueOct || 0) > 0) && (
                  <div className="border-t border-stone-100 pt-4">
                    <div className="text-xs text-slate-400 mb-2">Monthly Trend</div>
                    <div className="flex gap-2">
                      <div className="flex-1 bg-slate-50 rounded p-2 text-center">
                        <div className="text-xs text-slate-400">Sep</div>
                        <div className="text-sm font-medium text-slate-700">
                          ${((selectedClient.revenueSep || 0) / 1000).toFixed(0)}K
                        </div>
                      </div>
                      <div className="flex-1 bg-emerald-50 rounded p-2 text-center">
                        <div className="text-xs text-slate-400">Oct</div>
                        <div className="text-sm font-medium text-emerald-700">
                          ${((selectedClient.revenueOct || 0) / 1000).toFixed(0)}K
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Current APIs */}
              <div className="bg-white rounded-xl border border-stone-200">
                <button
                  onClick={() => setExpandedAPIs(!expandedAPIs)}
                  className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-stone-50 transition-colors"
                >
                  <span className="text-sm font-medium text-slate-700">
                    Current APIs ({selectedClient.apiCount})
                  </span>
                  {expandedAPIs ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>
                {expandedAPIs && (
                  <div className="px-5 pb-4 max-h-48 overflow-y-auto">
                    {selectedClient.apis.map((api, i) => (
                      <div key={i} className="flex justify-between py-2 border-b border-stone-100 last:border-0 text-sm">
                        <div>
                          <span className="text-slate-700">{api.moduleName}</span>
                          {api.subModuleName && api.subModuleName !== '-' && (
                            <span className="text-xs text-slate-400 block">{api.subModuleName}</span>
                          )}
                        </div>
                        <span className="text-emerald-600 font-medium">
                          ${api.totalRevenue.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Upsell Opportunity */}
              {recommendations.length > 0 && (
                <div className="bg-amber-50 rounded-xl border border-amber-200 p-5">
                  <div className="flex items-center gap-2 text-amber-700 font-medium mb-3">
                    <TrendingUp className="w-4 h-4" />
                    Upsell Opportunity
                  </div>
                  <div className="text-2xl font-bold text-slate-800 mb-3">
                    +${totalUpsellPotential.toLocaleString()}/mo
                  </div>
                  <div className="space-y-2">
                    {recommendations.slice(0, 3).map((rec, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">{rec.api}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          rec.priority === 'critical' ? 'bg-red-100 text-red-700' :
                          rec.priority === 'must-have' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {rec.priority}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Empty State */
            <div className="bg-white rounded-xl border border-stone-200 p-6 text-center">
              <div className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <BarChart3 className="w-6 h-6 text-slate-400" />
              </div>
              <h3 className="text-sm font-medium text-slate-600 mb-1">No Company Selected</h3>
              <p className="text-xs text-slate-400">Search for a company to see details</p>
            </div>
          )}

          {/* Why HyperVerge */}
          <div className="bg-gradient-to-br from-emerald-600 to-teal-600 rounded-xl p-5 text-white">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-5 h-5" />
              <span className="font-medium">Why HyperVerge?</span>
            </div>
            <div className="space-y-2 text-sm text-emerald-100">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                <span>₹0.50/call vs ₹2-4/call (competitors)</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>99.9% accuracy, &lt;500ms response</span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <span>India-based 24/7 support</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
