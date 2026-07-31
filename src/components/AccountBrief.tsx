'use client';

import { Rocket, TrendingUp, TrendingDown, Target, AlertTriangle, ShieldCheck, Minus } from 'lucide-react';
import type { ClientData } from '@/types/client';
import type { APIRecommendation } from '@/types/recommendation';
import { computeRevenueTrend, computeRiskSignal } from '@/lib/account-brief';

// Structural subset of the page's LifecycleRow — only the fields the Brief reads.
export interface LifecycleBrief {
  went_to_production_date: string | null;
  go_live_approximate: boolean;
  currently_in_production: boolean;
  active_prod_app_count: number;
  prod_app_count: number;
  first_staging_date: string | null;
  stage: 'production' | 'testing-only' | 'none';
  geography?: string;
  kam?: string;
  account_owner?: string;
  mrr_bucket?: string;
  operational_status?: string;
}

interface Props {
  client: ClientData;
  lifecycle: LifecycleBrief | null;
  topRecommendation: APIRecommendation | null;
  formatUSD: (n: number) => string;
}

// ---- tiny inline sparkline (no dependency) ----
function Sparkline({ points, className = '' }: { points: number[]; className?: string }) {
  if (points.length < 2) return <span className="text-slate-300 text-[11px]">no trend</span>;
  const w = 120, h = 32, pad = 2;
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });
  const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1];
  const rising = points[points.length - 1] >= points[0];
  const stroke = rising ? '#059669' : '#dc2626';
  return (
    <svg width={w} height={h} className={className} aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2} fill={stroke} />
    </svg>
  );
}

const Card = ({ title, icon, children, tone = 'default' }: { title: string; icon: React.ReactNode; children: React.ReactNode; tone?: 'default' | 'emerald' | 'amber' | 'red' }) => {
  const border = tone === 'emerald' ? 'border-emerald-100' : tone === 'amber' ? 'border-amber-100' : tone === 'red' ? 'border-red-100' : 'border-slate-100';
  const bg = tone === 'emerald' ? 'bg-emerald-50/40' : tone === 'amber' ? 'bg-amber-50/40' : tone === 'red' ? 'bg-red-50/40' : 'bg-slate-50/60';
  return (
    <div className={`rounded-xl border ${border} ${bg} p-3`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
        {icon}{title}
      </div>
      {children}
    </div>
  );
};

export default function AccountBrief({ client, lifecycle, topRecommendation, formatUSD }: Props) {
  const trend = computeRevenueTrend(client);
  const risk = computeRiskSignal(client, lifecycle);

  const momUp = trend.momPct != null && trend.momPct >= 0;
  const riskTone = risk.kind === 'churned' ? 'red' : risk.kind === 'declining' ? 'amber' : risk.kind === 'growing' ? 'emerald' : 'default';

  return (
    <div className="stagger-children space-y-3">
      {/* Context strip */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 px-0.5">
        <span className="font-semibold text-slate-800 text-[13px]">{client.client_name}</span>
        {(lifecycle?.kam || client.profile?.account_owner) && (
          <><span className="text-slate-300">·</span><span title={lifecycle?.account_owner}>KAM: {lifecycle?.kam || client.profile?.account_owner}</span></>
        )}
        {lifecycle?.geography && <><span className="text-slate-300">·</span><span>{lifecycle.geography}</span></>}
        {lifecycle?.mrr_bucket && <><span className="text-slate-300">·</span><span>MRR {lifecycle.mrr_bucket}</span></>}
        {(lifecycle?.operational_status || client.profile?.status) && (
          <><span className="text-slate-300">·</span><span className="text-slate-600">{lifecycle?.operational_status || client.profile?.status}</span></>
        )}
      </div>

      {/* 2x2 cards */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Lifecycle */}
        <Card title="Lifecycle" icon={<Rocket size={11} className="text-amber-500" />} tone={lifecycle?.currently_in_production ? 'emerald' : 'default'}>
          {lifecycle?.went_to_production_date ? (
            <>
              <div className="text-[13px] font-semibold text-slate-800 tabular-nums">
                Live since {lifecycle.go_live_approximate ? '≤ ' : ''}{lifecycle.went_to_production_date}
              </div>
              <div className={`text-[11px] mt-0.5 font-medium ${lifecycle.currently_in_production ? 'text-emerald-600' : 'text-slate-400'}`}>
                {lifecycle.currently_in_production ? `● active (${lifecycle.active_prod_app_count}/${lifecycle.prod_app_count} creds)` : 'prod creds disabled'}
              </div>
              {lifecycle.first_staging_date && <div className="text-[10px] text-slate-400 mt-0.5">Testing since {lifecycle.first_staging_date}</div>}
            </>
          ) : lifecycle?.stage === 'testing-only' ? (
            <div className="text-[12px] text-amber-600 font-medium">Testing only — not in production{lifecycle.first_staging_date ? ` (since ${lifecycle.first_staging_date})` : ''}</div>
          ) : (
            <div className="text-[12px] text-slate-400">No lifecycle data</div>
          )}
        </Card>

        {/* Revenue trend */}
        <Card title="Revenue trend" icon={momUp ? <TrendingUp size={11} className="text-emerald-500" /> : <TrendingDown size={11} className="text-red-500" />}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[13px] font-semibold text-slate-800 tabular-nums">{formatUSD(trend.latest)}<span className="text-[10px] text-slate-400 font-normal">/mo</span></div>
              {trend.momPct != null ? (
                <div className={`text-[11px] mt-0.5 font-medium ${momUp ? 'text-emerald-600' : 'text-red-600'}`}>
                  {momUp ? '▲' : '▼'} {momUp ? '+' : ''}{Math.round(trend.momPct)}% MoM
                </div>
              ) : (
                <div className="text-[11px] mt-0.5 text-slate-400">Not enough history</div>
              )}
            </div>
            <Sparkline points={trend.points} />
          </div>
        </Card>

        {/* Top upsell */}
        <Card title="Top upsell" icon={<Target size={11} className="text-blue-500" />}>
          {topRecommendation ? (
            <>
              <div className="text-[13px] font-semibold text-slate-800 truncate" title={topRecommendation.apiName}>{topRecommendation.apiName}</div>
              <div className="text-[11px] mt-0.5 text-slate-500">
                score {topRecommendation.score}
                {topRecommendation.potentialRevenue > 0 && <> · ~{formatUSD(topRecommendation.potentialRevenue)}/mo</>}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{topRecommendation.reason}</div>
            </>
          ) : (
            <div className="text-[12px] text-slate-400">No upsell suggestion right now</div>
          )}
        </Card>

        {/* Risk */}
        <Card
          title="Risk"
          icon={risk.kind === 'churned' || risk.kind === 'declining' ? <AlertTriangle size={11} className="text-red-500" /> : risk.kind === 'growing' ? <ShieldCheck size={11} className="text-emerald-500" /> : <Minus size={11} className="text-slate-400" />}
          tone={riskTone}
        >
          <div className={`text-[13px] font-semibold ${risk.kind === 'churned' ? 'text-red-600' : risk.kind === 'declining' ? 'text-amber-600' : risk.kind === 'growing' ? 'text-emerald-600' : 'text-slate-600'}`}>
            {risk.label}
          </div>
          {risk.atRisk > 0 && <div className="text-[11px] mt-0.5 text-red-500 font-medium tabular-nums">{formatUSD(risk.atRisk)} at risk</div>}
          {risk.kind === 'stable' && risk.momPct == null && <div className="text-[10px] text-slate-400 mt-0.5">no month-over-month signal</div>}
        </Card>
      </div>
    </div>
  );
}
