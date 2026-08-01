'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { ShieldCheck, TrendingUp, AlertTriangle, Rocket, Target, CalendarClock, BadgeDollarSign, ChevronDown, ChevronUp } from 'lucide-react';
import type { ClientData } from '@/types/client';
import { RecommendationEngine } from '@/lib/recommendation-engine';
import {
  type FocusResult, type AttentionItem, type MetricTone,
  watchItems, growItems, protectItems,
  trialExpiringItems, readyToGoLiveItems, upsellGapItems, pricingIssueItems,
} from '@/lib/focus';

interface LifecycleLite {
  client_id: string;
  client_name: string;
  stage: 'production' | 'testing-only' | 'none';
  first_staging_date: string | null;
  staging_app_count: number;
}

interface Props {
  focus: FocusResult;
  clients: ClientData[];
  lifecycle: LifecycleLite[];
  masterAPIs: string[];
  formatUSD: (n: number) => string;
  onOpenClient: (clientName: string) => void;
}

const fetcher = (url: string) => fetch(url, { credentials: 'same-origin' }).then(r => r.json());

const TONE_TEXT: Record<MetricTone, string> = {
  red: 'text-red-600', amber: 'text-amber-600', emerald: 'text-emerald-600', slate: 'text-slate-600',
};
const ACCENT: Record<string, string> = {
  red: 'border-red-200', amber: 'border-amber-200', blue: 'border-blue-200', emerald: 'border-emerald-200', slate: 'border-slate-200',
};

function Row({ item, onOpen }: { item: AttentionItem; onOpen: (n: string) => void }) {
  return (
    <button
      onClick={() => onOpen(item.clientName)}
      className="w-full text-left rounded-lg bg-white smooth-shadow-sm hover:smooth-shadow-md hover:bg-amber-50/40 transition-all px-3 py-2"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-slate-800 text-[13px] truncate">{item.name}</span>
        <span className={`text-[12px] font-semibold tabular-nums shrink-0 ${TONE_TEXT[item.metricTone]}`}>{item.metric}</span>
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5 truncate">{item.reason}</div>
    </button>
  );
}

function Section({ title, subtitle, icon, tone, items, loading, onOpen, forceExpanded }: {
  title: string; subtitle: string; icon: React.ReactNode; tone: string;
  items: AttentionItem[]; loading?: boolean; onOpen: (n: string) => void; forceExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const TOP = 5;
  const isExpanded = forceExpanded || expanded;
  const shown = isExpanded ? items : items.slice(0, TOP);
  return (
    <div className="mb-5">
      <div className={`flex items-center gap-2 pb-1.5 mb-2 border-b-2 ${ACCENT[tone]}`}>
        {icon}
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-slate-800">
            {title} <span className="text-slate-400 font-medium">({loading ? '...' : items.length})</span>
          </div>
          <div className="text-[10px] text-slate-400 truncate">{subtitle}</div>
        </div>
      </div>
      {loading ? (
        <div className="text-[11px] text-slate-400 py-3 px-1">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-slate-400 py-2 px-1">All clear</div>
      ) : (
        <div className="space-y-1.5">
          {shown.map(it => <Row key={`${it.id}`} item={it} onOpen={onOpen} />)}
          {items.length > TOP && !forceExpanded && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 px-1 py-1 cursor-pointer"
            >
              {isExpanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show all {items.length}</>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function FocusView({ focus, clients, lifecycle, masterAPIs, formatUSD, onOpenClient }: Props) {
  const engine = useMemo(() => new RecommendationEngine(clients, masterAPIs), [clients, masterAPIs]);

  // Grow enrichment: attach each up-mover's top upsell (cheap, only the shortlist).
  const enrichedFocus = useMemo(() => ({
    ...focus,
    grow: focus.grow.map(a => {
      const top = engine.getClientRecommendations(a.client_name)?.recommendations?.[0]?.apiName;
      return top ? { ...a, topUpsell: `Upsell: ${top}` } : a;
    }),
  }), [focus, engine]);

  // Fetched sections (cached server-side).
  const { data: segResp, isLoading: segLoading } = useSWR('/api/segment-intelligence?action=all', fetcher, { revalidateOnFocus: false, keepPreviousData: true });
  const { data: pricingResp, isLoading: pricingLoading } = useSWR('/api/pricing-anomalies', fetcher, { revalidateOnFocus: false, keepPreviousData: true });

  const sections = useMemo(() => ([
    { key: 'watch', title: 'Watch', subtitle: 'At risk, defend now', tone: 'red',
      icon: <AlertTriangle size={17} className="text-red-500" />, items: watchItems(enrichedFocus, formatUSD) },
    { key: 'trial', title: 'Trial expiring', subtitle: 'Convert before it lapses', tone: 'amber',
      icon: <CalendarClock size={17} className="text-amber-500" />, items: trialExpiringItems(clients) },
    { key: 'golive', title: 'Ready to go live', subtitle: 'Unlock revenue stuck in testing', tone: 'blue',
      icon: <Rocket size={17} className="text-blue-500" />, items: readyToGoLiveItems(lifecycle) },
    { key: 'upsell', title: 'Big upsell gaps', subtitle: 'Segment peers already buy this', tone: 'emerald',
      icon: <Target size={17} className="text-emerald-600" />, items: upsellGapItems(segResp?.data, formatUSD), loading: segLoading && !segResp },
    { key: 'grow', title: 'Grow', subtitle: 'Ride momentum, expand now', tone: 'emerald',
      icon: <TrendingUp size={17} className="text-blue-600" />, items: growItems(enrichedFocus, formatUSD) },
    { key: 'pricing', title: 'Pricing and billing issues', subtitle: 'Fix revenue leaks', tone: 'slate',
      icon: <BadgeDollarSign size={17} className="text-slate-500" />, items: pricingIssueItems(pricingResp), loading: pricingLoading && !pricingResp },
    { key: 'protect', title: 'Protect', subtitle: 'Top accounts, stay close', tone: 'slate',
      icon: <ShieldCheck size={17} className="text-emerald-600" />, items: protectItems(enrichedFocus, formatUSD) },
  ]), [enrichedFocus, clients, lifecycle, segResp, pricingResp, segLoading, pricingLoading, formatUSD]);

  // Distinct accounts needing attention (an account can appear in more than one section).
  const distinctAccounts = useMemo(() => {
    const s = new Set<string>();
    sections.forEach(sec => sec.items.forEach(i => s.add(i.clientName)));
    return s.size;
  }, [sections]);

  // Chip filter: 'all' shows every section, otherwise just the picked one.
  const [active, setActive] = useState<string>('all');
  const chipCls = (on: boolean) =>
    `text-[11px] px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${
      on ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
    }`;
  const visible = active === 'all' ? sections : sections.filter(s => s.key === active);

  return (
    <div className="h-full flex flex-col">
      <div className="px-1 pb-3 shrink-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-lg font-bold text-slate-800">Focus</h2>
          <span className="text-[12px] text-slate-500">
            {distinctAccounts.toLocaleString()} accounts need attention today. Click a category to filter.
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <button onClick={() => setActive('all')} className={chipCls(active === 'all')}>
            All <span className="font-semibold">{distinctAccounts}</span>
          </button>
          {sections.map(s => (
            <button key={s.key} onClick={() => setActive(active === s.key ? 'all' : s.key)} className={chipCls(active === s.key)}>
              {s.title}: <span className="font-semibold">{s.loading ? '...' : s.items.length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {visible.map(s => (
          <Section key={s.key} title={s.title} subtitle={s.subtitle} icon={s.icon} tone={s.tone}
            items={s.items} loading={s.loading} onOpen={onOpenClient}
            forceExpanded={active === s.key} />
        ))}
      </div>
    </div>
  );
}
