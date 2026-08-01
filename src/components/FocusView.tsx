'use client';

import { useMemo } from 'react';
import { ShieldCheck, TrendingUp, AlertTriangle, ArrowUpRight } from 'lucide-react';
import type { ClientData } from '@/types/client';
import { computeFocus, type FocusAccount } from '@/lib/focus';
import { RecommendationEngine } from '@/lib/recommendation-engine';

interface Props {
  clients: ClientData[];
  masterAPIs: string[];
  toUSD: (amount: number, currency?: string | null) => number;
  formatUSD: (n: number) => string;
  onOpenClient: (clientName: string) => void;
}

const MoM = ({ pct }: { pct: number | null }) => {
  if (pct == null) return <span className="text-slate-300 text-[10px]">—</span>;
  const up = pct >= 0;
  return <span className={`text-[11px] font-medium tabular-nums ${up ? 'text-emerald-600' : 'text-red-600'}`}>{up ? '▲' : '▼'} {up ? '+' : ''}{pct}%</span>;
};

function Row({ a, formatUSD, onOpen }: { a: FocusAccount; formatUSD: (n: number) => string; onOpen: (n: string) => void }) {
  return (
    <button
      onClick={() => onOpen(a.client_name)}
      className="w-full text-left rounded-lg border border-slate-100 bg-white hover:bg-amber-50/40 hover:border-amber-200 transition-colors p-2.5 group"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-800 text-[13px] truncate">{a.client_name}</span>
        <span className="text-[12px] font-semibold text-slate-700 tabular-nums shrink-0">{formatUSD(a.mrrUSD)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <span className="text-[10px] text-slate-400 truncate">{a.segment}</span>
        <MoM pct={a.momPct} />
      </div>
      <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
        {a.slipping && <AlertTriangle size={10} className="text-amber-500 shrink-0" />}
        <span className="truncate">{a.reason}</span>
      </div>
      {a.topUpsell && (
        <div className="text-[10px] text-blue-600 mt-1 flex items-center gap-1 truncate">
          <ArrowUpRight size={10} className="shrink-0" /> {a.topUpsell}
        </div>
      )}
    </button>
  );
}

function Column({ title, subtitle, icon, accent, items, formatUSD, onOpen, empty }: {
  title: string; subtitle: string; icon: React.ReactNode; accent: string;
  items: FocusAccount[]; formatUSD: (n: number) => string; onOpen: (n: string) => void; empty: string;
}) {
  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className={`flex items-center gap-2 pb-2 mb-2 border-b-2 ${accent}`}>
        {icon}
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-slate-800">{title} <span className="text-slate-400 font-medium">({items.length})</span></div>
          <div className="text-[10px] text-slate-400 truncate">{subtitle}</div>
        </div>
      </div>
      <div className="space-y-2 overflow-y-auto pr-1">
        {items.length === 0
          ? <div className="text-[11px] text-slate-400 py-6 text-center">{empty}</div>
          : items.map(a => <Row key={a.client_id} a={a} formatUSD={formatUSD} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

export default function FocusView({ clients, masterAPIs, toUSD, formatUSD, onOpenClient }: Props) {
  const engine = useMemo(() => new RecommendationEngine(clients, masterAPIs), [clients, masterAPIs]);

  const focus = useMemo(() => {
    const f = computeFocus(clients, { toUSD });
    // Enrich Grow rows with the account's top upsell (cheap — only the shortlist).
    f.grow = f.grow.map(a => {
      const top = engine.getClientRecommendations(a.client_name)?.recommendations?.[0]?.apiName;
      return top ? { ...a, topUpsell: `Upsell: ${top}` } : a;
    });
    return f;
  }, [clients, toUSD, engine]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-1 pb-3">
        <h2 className="text-lg font-bold text-slate-800">Focus</h2>
        <p className="text-[12px] text-slate-500">Who to work today — protect your best, ride momentum, defend what&apos;s slipping.</p>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-3 gap-4">
        <Column
          title="Protect" subtitle="Top accounts — stay close"
          icon={<ShieldCheck size={18} className="text-emerald-600" />} accent="border-emerald-200"
          items={focus.protect} formatUSD={formatUSD} onOpen={onOpenClient} empty="Nothing to protect right now"
        />
        <Column
          title="Grow" subtitle="Momentum + upsell — expand now"
          icon={<TrendingUp size={18} className="text-blue-600" />} accent="border-blue-200"
          items={focus.grow} formatUSD={formatUSD} onOpen={onOpenClient} empty="No up-movers right now"
        />
        <Column
          title="Watch" subtitle="Slipping or churned — defend"
          icon={<AlertTriangle size={18} className="text-red-500" />} accent="border-red-200"
          items={focus.watch} formatUSD={formatUSD} onOpen={onOpenClient} empty="Nothing at risk right now"
        />
      </div>
    </div>
  );
}
