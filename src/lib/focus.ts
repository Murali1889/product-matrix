/**
 * Focus — ranks accounts into Protect / Grow / Watch buckets so a KAM can see
 * at a glance who to stay close to, who to expand, and who to defend.
 *
 * Pure and dependency-injected: `toUSD` is passed in (convertToUSD lives in
 * page.tsx and isn't exported), so this module stays free of page/React
 * coupling and is trivially testable. All ranking is done in USD so accounts
 * in different billing currencies compare correctly.
 */

import type { ClientData } from '@/types/client';
import { computeRevenueTrend } from './account-brief';

export type FocusBucket = 'protect' | 'grow' | 'watch';
export type FocusRiskKind = 'churned' | 'declining' | 'growing' | 'stable' | 'no-history';

export interface FocusAccount {
  client_id: string;
  client_name: string;
  segment: string;
  mrrUSD: number;
  prevUSD: number | null;
  momPct: number | null;
  bucket: FocusBucket;
  riskKind: FocusRiskKind;
  atRiskUSD: number;   // Watch only (else 0)
  slipping: boolean;   // Protect flag: momPct < 0
  reason: string;
  topUpsell?: string;  // filled in by the view (needs the recommendation engine)
}

export interface FocusResult {
  protect: FocusAccount[];
  grow: FocusAccount[];
  watch: FocusAccount[];
}

type ToUSD = (amount: number, currency?: string | null) => number;

const MIN_MRR_USD = 500;    // floor for churn/decline/grow so tiny accounts don't add noise
const GROW_MIN_PCT = 10;    // MoM must beat +10% to count as momentum

interface Row {
  client: ClientData;
  mrrUSD: number;
  prevUSD: number | null;
  momPct: number | null;
  latestRaw: number;
  previousRaw: number | null;
  hasHistory: boolean;
}

function toRow(client: ClientData, toUSD: ToUSD): Row {
  const t = computeRevenueTrend(client);
  const currency = client.profile?.billing_currency;
  const mrrUSD = toUSD(t.latest, currency);
  const prevUSD = t.previous != null ? toUSD(t.previous, currency) : null;
  const momPct = prevUSD != null && prevUSD > 0 ? ((mrrUSD - prevUSD) / prevUSD) * 100 : null;
  return { client, mrrUSD, prevUSD, momPct, latestRaw: t.latest, previousRaw: t.previous, hasHistory: t.hasHistory };
}

const fmtK = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`);

function base(row: Row, bucket: FocusBucket, riskKind: FocusRiskKind, atRiskUSD: number, slipping: boolean, reason: string): FocusAccount {
  return {
    client_id: row.client.client_id || row.client.client_name,
    client_name: row.client.client_name,
    segment: row.client.profile?.segment || 'Other',
    mrrUSD: Math.round(row.mrrUSD),
    prevUSD: row.prevUSD != null ? Math.round(row.prevUSD) : null,
    momPct: row.momPct != null ? Math.round(row.momPct) : null,
    bucket, riskKind, atRiskUSD: Math.round(atRiskUSD), slipping, reason,
  };
}

export function computeFocus(clients: ClientData[], opts: { toUSD: ToUSD; topN?: number }): FocusResult {
  const { toUSD, topN = 15 } = opts;
  const rows = clients.map(c => toRow(c, toUSD));

  const watch: FocusAccount[] = [];
  const claimed = new Set<string>();

  // 1) Watch — churned or declining (assigned first; highest concern).
  for (const r of rows) {
    const id = r.client.client_id || r.client.client_name;
    // Churned: was paying, now zero.
    if (r.latestRaw === 0 && (r.prevUSD ?? 0) >= MIN_MRR_USD) {
      watch.push(base(r, 'watch', 'churned', r.prevUSD ?? 0, false, `Churned — ${fmtK(r.prevUSD ?? 0)} lost`));
      claimed.add(id);
      continue;
    }
    // Declining: >10% drop on a non-trivial base.
    if (r.momPct != null && r.momPct < -10 && (r.prevUSD ?? 0) >= MIN_MRR_USD && r.mrrUSD < (r.prevUSD ?? 0)) {
      const atRisk = (r.prevUSD ?? 0) - r.mrrUSD;
      watch.push(base(r, 'watch', 'declining', atRisk, false, `Declining ${Math.round(r.momPct)}% MoM · ${fmtK(atRisk)} at risk`));
      claimed.add(id);
    }
  }
  watch.sort((a, b) => b.atRiskUSD - a.atRiskUSD);

  // 2) Protect — top N grossers not in Watch.
  const protectPool = rows
    .filter(r => !claimed.has(r.client.client_id || r.client.client_name) && r.mrrUSD > 0)
    .sort((a, b) => b.mrrUSD - a.mrrUSD)
    .slice(0, topN);
  const protect: FocusAccount[] = protectPool.map(r => {
    const id = r.client.client_id || r.client.client_name;
    claimed.add(id);
    const slipping = r.momPct != null && r.momPct < 0;
    const reason = slipping ? `Top account slipping ${Math.round(r.momPct as number)}% — keep extra close` : 'Top account — stay close';
    return base(r, 'protect', slipping ? 'declining' : 'stable', 0, slipping, reason);
  });

  // 3) Grow — up-movers not already claimed, with meaningful revenue.
  const grow: FocusAccount[] = rows
    .filter(r => {
      const id = r.client.client_id || r.client.client_name;
      // Require BOTH months >= floor so the % is real momentum, not a
      // jump from near-zero (which produces absurd +20000% noise).
      return !claimed.has(id) && r.momPct != null && r.momPct > GROW_MIN_PCT
        && r.mrrUSD >= MIN_MRR_USD && (r.prevUSD ?? 0) >= MIN_MRR_USD;
    })
    .map(r => base(r, 'grow', 'growing', 0, false, `+${Math.round(r.momPct as number)}% MoM — expand now`))
    .sort((a, b) => (b.momPct ?? 0) - (a.momPct ?? 0) || b.mrrUSD - a.mrrUSD)
    .slice(0, topN);

  return { protect, grow, watch };
}
