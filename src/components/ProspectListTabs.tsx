'use client';

/**
 * Prospect List Tabs
 * 60-30-10: Slate base, neutral text, amber accents
 */

import { useState, useEffect } from 'react';

interface ProspectData {
  tier: string;
  clients: { name: string; revenue: number; apiCount: number }[];
  totalRevenue: number;
}

const TABS = [
  { id: 'enterprise', label: 'Enterprise' },
  { id: 'growth', label: 'Growth' },
  { id: 'starter', label: 'Starter' },
];

export function ProspectListTabs() {
  const [activeTab, setActiveTab] = useState('enterprise');
  const [prospects, setProspects] = useState<ProspectData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/unified-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'summary' }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const clients = data.data.topClients || [];
          setProspects([
            {
              tier: 'Enterprise',
              clients: clients.filter((c: { revenue: number }) => c.revenue > 100000).slice(0, 6),
              totalRevenue: clients.filter((c: { revenue: number }) => c.revenue > 100000).reduce((s: number, c: { revenue: number }) => s + c.revenue, 0),
            },
            {
              tier: 'Growth',
              clients: clients.filter((c: { revenue: number }) => c.revenue > 25000 && c.revenue <= 100000).slice(0, 6),
              totalRevenue: 0,
            },
            {
              tier: 'Starter',
              clients: clients.filter((c: { revenue: number }) => c.revenue <= 25000).slice(0, 6),
              totalRevenue: 0,
            },
          ]);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const getActiveProspects = () => {
    const tierMap: Record<string, string> = { enterprise: 'Enterprise', growth: 'Growth', starter: 'Starter' };
    return prospects.find(p => p.tier === tierMap[activeTab])?.clients || [];
  };

  const activeProspects = getActiveProspects();

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-slate-700/50 px-5">
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium cursor-pointer transition-colors relative ${
                activeTab === tab.id ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500" />
              )}
            </button>
          ))}
        </div>
        <button
          disabled
          title="Coming soon - Export feature"
          className="text-xs text-slate-500 px-3 py-1.5 bg-slate-700/30 rounded cursor-not-allowed opacity-60"
        >
          Export
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-16">
            <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activeProspects.length === 0 ? (
          <div className="text-center py-4 text-slate-500 text-sm">No prospects</div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
            {activeProspects.map((client, i) => (
              <div
                key={`prospect-${i}-${client.name}`}
                className="flex-shrink-0 w-40 bg-slate-900/30 rounded-lg p-3 border border-slate-700/30 hover:border-slate-600/50 transition-colors cursor-default"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-600">#{i + 1}</span>
                  <span className="text-xs text-amber-400">${(client.revenue / 1000).toFixed(0)}K</span>
                </div>
                <div className="font-medium text-sm text-slate-200 truncate">{client.name}</div>
                <div className="text-xs text-slate-500 mt-1">{client.apiCount} APIs</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
