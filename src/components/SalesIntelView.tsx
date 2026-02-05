'use client';

/**
 * Sales Intelligence View (Embedded Tab)
 * Used within the main dashboard as a tab
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, Send, Check, TrendingUp, ChevronDown, ChevronUp,
  Users, Sparkles, Target, Shield, Zap, BarChart3
} from 'lucide-react';
import {
  HYPERVERGE_PRICING_INR,
  getLikelyCompetitors,
  COMPETITORS,
} from '@/lib/competitive-intel';

// Types
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
}

// Pricing
const INR_TO_USD = 0.012;
const ESTIMATED_VOLUMES: Record<string, number> = {
  'Bank Account Verification': 5000,
  'Aadhaar OKYC': 8000,
  'PAN Verification': 10000,
  'Face Match': 6000,
  'default': 2000,
};

function getEstimatedVolume(apiName: string): number {
  for (const [key, volume] of Object.entries(ESTIMATED_VOLUMES)) {
    if (apiName.toLowerCase().includes(key.toLowerCase())) return volume;
  }
  return ESTIMATED_VOLUMES.default;
}

function calculateMonthlyRevenue(apiName: string): number {
  return Math.round(getEstimatedVolume(apiName) * HYPERVERGE_PRICING_INR * INR_TO_USD);
}

export default function SalesIntelView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientData | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [expandedAPIs, setExpandedAPIs] = useState(false);
  const [topClients, setTopClients] = useState<string[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load top clients
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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (query: string) => {
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
      // Use AI chat API
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query.trim(),
          history: messages.slice(-6).map(m => ({ type: m.type, content: m.content })),
        }),
      });

      const data = await res.json();

      if (data.success) {
        // Update client data and recommendations from AI response
        if (data.data?.client) {
          setSelectedClient(data.data.client);
        }
        if (data.data?.recommendations) {
          setRecommendations(data.data.recommendations);
        }

        // Add AI response to chat
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: data.response,
          timestamp: new Date(),
        }]);
      } else {
        // Fallback to basic search if AI fails
        const fallbackRes = await fetch('/api/company-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'smart', companyName: query.trim() }),
        });
        const fallbackData = await fallbackRes.json();

        if (fallbackData.success) {
          const result = fallbackData.data;
          const client = result.data?.client;
          const recs = result.data?.recommendations || result.data?.defaultRecommendations || [];

          setSelectedClient(client || null);
          setRecommendations(recs);

          let response = client
            ? `**${client.name}** - Revenue: $${client.totalRevenue.toLocaleString()}, APIs: ${client.apiCount}`
            : `**${query}** is a new prospect. Recommended APIs: ${recs.slice(0, 3).map((r: Recommendation) => r.api).join(', ')}`;

          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            type: 'assistant',
            content: response,
            timestamp: new Date(),
          }]);
        } else {
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            type: 'assistant',
            content: data.error || 'Sorry, I encountered an error. Please try again.',
            timestamp: new Date(),
          }]);
        }
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: 'Connection error. Please try again.',
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  const totalUpsell = recommendations.slice(0, 3).reduce((sum, rec) => sum + calculateMonthlyRevenue(rec.api), 0);

  return (
    <div className="flex gap-6 h-[calc(100vh-120px)]">
      {/* Left: Chat */}
      <div className="flex-1 flex flex-col bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 bg-stone-50">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-600" />
            <span className="font-medium text-slate-700">AI Sales Assistant</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Search any company for instant insights</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-medium text-slate-700 mb-2">Search Any Company</h3>
              <p className="text-sm text-slate-400 mb-6">Get instant insights on clients or prospects</p>
              <div className="flex flex-wrap justify-center gap-2">
                {topClients.slice(0, 6).map((company) => (
                  <button
                    key={company}
                    onClick={() => { setInputValue(company); sendMessage(company); }}
                    className="px-4 py-2 bg-stone-100 hover:bg-emerald-50 hover:text-emerald-700 border border-stone-200 hover:border-emerald-200 rounded-lg text-sm text-slate-600 cursor-pointer transition-all"
                  >
                    {company}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-xl px-4 py-3 ${
                  msg.type === 'user' ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-slate-700'
                }`}>
                  <div className="text-sm whitespace-pre-wrap">
                    {msg.content.split('\n').map((line, i) => {
                      const boldLine = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                      return <p key={i} className={i > 0 ? 'mt-1' : ''} dangerouslySetInnerHTML={{ __html: boldLine }} />;
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

        <form onSubmit={handleSubmit} className="p-4 border-t border-stone-100">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Search company (e.g., Rapido, Swiggy)"
                className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-lg text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={!inputValue.trim() || isLoading}
              className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:cursor-not-allowed text-white rounded-lg cursor-pointer"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>

      {/* Right: Details */}
      <div className="w-80 space-y-4 overflow-y-auto">
        {/* Recommended APIs - Always show first when available */}
        {recommendations.length > 0 && (
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-5">
            <div className="flex items-center gap-2 text-amber-700 font-semibold mb-4">
              <Sparkles className="w-5 h-5" />
              {selectedClient ? 'Recommended APIs' : 'APIs to Sell'}
            </div>
            <div className="space-y-3">
              {recommendations.slice(0, 5).map((rec, i) => (
                <div key={i} className="bg-white rounded-lg p-3 border border-amber-100">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-slate-800">{rec.api}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      rec.priority === 'critical' ? 'bg-red-100 text-red-700' :
                      rec.priority === 'must-have' ? 'bg-amber-100 text-amber-700' :
                      rec.priority === 'high-value' ? 'bg-emerald-100 text-emerald-700' :
                      rec.priority === 'high' ? 'bg-blue-100 text-blue-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>{rec.priority}</span>
                  </div>
                  {rec.reason && (
                    <p className="text-xs text-slate-500">{rec.reason}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Client Info */}
        {selectedClient ? (
          <>
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                <span className="text-xs text-emerald-600 font-medium">Existing Client</span>
              </div>
              <h2 className="text-xl font-semibold text-slate-800 mb-4">{selectedClient.name}</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-stone-50 rounded-lg p-3">
                  <div className="text-xs text-slate-400">Revenue</div>
                  <div className="text-lg font-bold text-slate-800">${selectedClient.totalRevenue.toLocaleString()}</div>
                </div>
                <div className="bg-stone-50 rounded-lg p-3">
                  <div className="text-xs text-slate-400">Usage</div>
                  <div className="text-lg font-bold text-slate-800">{(selectedClient.totalUsage / 1000000).toFixed(1)}M</div>
                </div>
              </div>

              {/* Monthly */}
              {((selectedClient.revenueSep || 0) > 0 || (selectedClient.revenueOct || 0) > 0) && (
                <div className="mt-4 pt-4 border-t border-stone-100">
                  <div className="text-xs text-slate-400 mb-2">Monthly Trend</div>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-slate-50 rounded p-2 text-center">
                      <div className="text-xs text-slate-400">Sep</div>
                      <div className="text-sm font-medium">${((selectedClient.revenueSep || 0) / 1000).toFixed(0)}K</div>
                    </div>
                    <div className="flex-1 bg-emerald-50 rounded p-2 text-center">
                      <div className="text-xs text-slate-400">Oct</div>
                      <div className="text-sm font-medium text-emerald-700">${((selectedClient.revenueOct || 0) / 1000).toFixed(0)}K</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Current APIs */}
            <div className="bg-white rounded-xl border border-stone-200">
              <button
                onClick={() => setExpandedAPIs(!expandedAPIs)}
                className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-stone-50"
              >
                <span className="text-sm font-medium text-slate-700">Current APIs ({selectedClient.apiCount})</span>
                {expandedAPIs ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
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
                      <span className="text-emerald-600 font-medium">${api.totalRevenue.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : recommendations.length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 p-6 text-center">
            <div className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <BarChart3 className="w-6 h-6 text-slate-400" />
            </div>
            <h3 className="text-sm font-medium text-slate-600 mb-1">No Company Selected</h3>
            <p className="text-xs text-slate-400">Search for a company to see details</p>
          </div>
        ) : null}

        {/* Why HyperVerge */}
        <div className="bg-gradient-to-br from-emerald-600 to-teal-600 rounded-xl p-5 text-white">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-5 h-5" />
            <span className="font-medium">Why HyperVerge?</span>
          </div>
          <div className="space-y-2 text-sm text-emerald-100">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              <span>₹0.50/call vs ₹2-4 (competitors)</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>99.9% accuracy, &lt;500ms</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span>India-based 24/7 support</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
