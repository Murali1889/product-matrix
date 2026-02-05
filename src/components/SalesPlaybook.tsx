'use client';

/**
 * Sales Playbook
 * 60-30-10: Slate base, neutral text, amber accents
 */

import { useMemo } from 'react';

interface Recommendation {
  api: string;
  priority: string;
  reason: string;
}

interface ClientData {
  name: string;
  totalRevenue: number;
  apiCount: number;
  monthlyAvgRevenue: number;
}

interface SalesPlaybookProps {
  companyName: string;
  isExisting: boolean;
  clientData?: ClientData;
  recommendations: Recommendation[];
  suggestedIndustry?: string;
}

export function SalesPlaybook({
  companyName,
  isExisting,
  clientData,
  recommendations,
  suggestedIndustry,
}: SalesPlaybookProps) {
  const opportunityValue = useMemo(() => {
    const criticalCount = recommendations.filter(
      r => r.priority === 'critical' || r.priority === 'must-have' || r.priority === 'high'
    ).length;

    if (isExisting && clientData) {
      const avgRevenuePerAPI = clientData.monthlyAvgRevenue / Math.max(clientData.apiCount, 1);
      return criticalCount * avgRevenuePerAPI * 12;
    }

    const industryAvg: Record<string, number> = {
      NBFC: 150000, Fintech: 100000, Insurance: 120000, Gaming: 60000, General: 75000,
    };
    return industryAvg[suggestedIndustry || 'General'] || 75000;
  }, [recommendations, isExisting, clientData, suggestedIndustry]);

  const dealPriority = useMemo(() => {
    const criticalAPIs = recommendations.filter(
      r => r.priority === 'critical' || r.priority === 'must-have'
    ).length;
    if (criticalAPIs >= 3) return 'hot';
    if (criticalAPIs >= 1 || recommendations.length >= 5) return 'warm';
    return 'cold';
  }, [recommendations]);

  const talkTrack = useMemo(() => {
    const topAPIs = recommendations.slice(0, 3).map(r => r.api);
    if (isExisting) {
      return `Based on your usage patterns, we've identified ${recommendations.length} additional APIs. Companies like ${companyName} see 30-40% efficiency gains with ${topAPIs[0] || 'these services'}.`;
    }
    return `For ${suggestedIndustry || 'your industry'}, ${topAPIs.join(', ')} are essential. Let me show you how ${companyName} can benefit.`;
  }, [companyName, isExisting, recommendations, suggestedIndustry]);

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-slate-700/50">
        <h2 className="font-medium text-lg text-slate-100">Sales Playbook</h2>
        <p className="text-xs text-slate-500 mt-1">Actionable intelligence</p>
      </div>

      {/* Content */}
      <div className="flex-1 p-5 overflow-y-auto custom-scrollbar space-y-5">
        {/* Deal Priority */}
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1.5 rounded text-sm font-medium ${
            dealPriority === 'hot'
              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              : dealPriority === 'warm'
              ? 'bg-slate-700/50 text-slate-300 border border-slate-600/50'
              : 'bg-slate-800/50 text-slate-500 border border-slate-700/30'
          }`}>
            {dealPriority === 'hot' ? 'Hot Lead' :
             dealPriority === 'warm' ? 'Warm Lead' : 'Cold Lead'}
          </div>
          <span className="text-xs text-slate-500">
            {isExisting ? 'Upsell' : 'New Business'}
          </span>
        </div>

        {/* Opportunity Value */}
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/30">
          <div className="text-xs text-slate-500 mb-1">Opportunity Value</div>
          <div className="text-2xl font-semibold text-amber-400">
            ${opportunityValue >= 1000000
              ? `${(opportunityValue / 1000000).toFixed(1)}M`
              : `${(opportunityValue / 1000).toFixed(0)}K`}
            <span className="text-sm font-normal text-slate-500">/year</span>
          </div>
        </div>

        {/* Talk Track */}
        <div>
          <div className="text-xs text-slate-500 mb-2">Talk Track</div>
          <div className="bg-slate-900/30 rounded-lg p-3 text-sm text-slate-300 border-l-2 border-amber-500/50">
            {talkTrack}
          </div>
        </div>

        {/* Best Time */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Best Time</span>
          <span className="text-slate-300">Tue-Thu, 10-11 AM</span>
        </div>

        {/* Target Roles */}
        <div>
          <div className="text-xs text-slate-500 mb-2">Target Champions</div>
          <div className="flex flex-wrap gap-2">
            {['VP Engineering', 'Head of Product', 'CTO'].map((role) => (
              <span
                key={role}
                className="px-2.5 py-1 bg-slate-900/50 text-slate-400 rounded text-xs border border-slate-700/30"
              >
                {role}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-slate-700/50 flex gap-2">
        <button
          disabled
          title="Coming soon - CRM integration"
          className="flex-1 px-3 py-2 bg-slate-700/50 text-slate-500 rounded text-xs font-medium cursor-not-allowed opacity-60"
        >
          Create CRM Task
        </button>
        <button
          disabled
          title="Coming soon - Email templates"
          className="px-3 py-2 bg-slate-700/30 text-slate-500 rounded text-xs cursor-not-allowed opacity-60"
        >
          Email
        </button>
      </div>
    </div>
  );
}
