/**
 * Focus, ranks accounts into Protect / Grow / Watch buckets so a KAM can see
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

export interface FocusCounts {
  total: number;    // active clients = watch + protect + grow + steady
  watch: number;
  protect: number;
  grow: number;
  steady: number;   // paying, no action needed right now
}

export interface FocusResult {
  protect: FocusAccount[];
  grow: FocusAccount[];
  watch: FocusAccount[];
  counts: FocusCounts;
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

  // 1) Watch, churned or declining (assigned first; highest concern).
  for (const r of rows) {
    const id = r.client.client_id || r.client.client_name;
    // Churned: was paying, now zero.
    if (r.latestRaw === 0 && (r.prevUSD ?? 0) >= MIN_MRR_USD) {
      watch.push(base(r, 'watch', 'churned', r.prevUSD ?? 0, false, `Churned, ${fmtK(r.prevUSD ?? 0)} lost`));
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

  // 2) Protect, top N grossers not in Watch.
  const protectPool = rows
    .filter(r => !claimed.has(r.client.client_id || r.client.client_name) && r.mrrUSD > 0)
    .sort((a, b) => b.mrrUSD - a.mrrUSD)
    .slice(0, topN);
  const protect: FocusAccount[] = protectPool.map(r => {
    const id = r.client.client_id || r.client.client_name;
    claimed.add(id);
    const slipping = r.momPct != null && r.momPct < 0;
    const reason = slipping ? `Top account slipping ${Math.round(r.momPct as number)}%, keep extra close` : 'Top account, stay close';
    return base(r, 'protect', slipping ? 'declining' : 'stable', 0, slipping, reason);
  });

  // 3) Grow: all up-movers not already claimed, with meaningful revenue.
  // Require BOTH months >= floor so the % is real momentum, not a jump from
  // near-zero (which produces absurd +20000% noise). Not capped, so the counts
  // reconcile with the total.
  const growPool = rows.filter(r => {
    const id = r.client.client_id || r.client.client_name;
    return !claimed.has(id) && r.momPct != null && r.momPct > GROW_MIN_PCT
      && r.mrrUSD >= MIN_MRR_USD && (r.prevUSD ?? 0) >= MIN_MRR_USD;
  });
  const grow: FocusAccount[] = growPool
    .map(r => base(r, 'grow', 'growing', 0, false, `+${Math.round(r.momPct as number)}% MoM, expand now`))
    .sort((a, b) => (b.momPct ?? 0) - (a.momPct ?? 0) || b.mrrUSD - a.mrrUSD);
  growPool.forEach(r => claimed.add(r.client.client_id || r.client.client_name));

  // 4) Steady: active (paying) clients not in any bucket. Counted so the buckets
  // reconcile with the total live-client count instead of leaving a gap.
  let steady = 0;
  for (const r of rows) {
    const id = r.client.client_id || r.client.client_name;
    if (!claimed.has(id) && r.mrrUSD > 0) steady++;
  }
  const total = watch.length + protect.length + grow.length + steady;

  return {
    protect, grow, watch,
    counts: { total, watch: watch.length, protect: protect.length, grow: grow.length, steady },
  };
}

// ============== ATTENTION SECTIONS (the "needs attention" hub) ==============
//
// Each builder returns a ranked AttentionItem[] for one section of the Focus
// hub. Pure and testable; the view supplies formatting/click handling.

export type MetricTone = 'red' | 'amber' | 'emerald' | 'slate';

export interface AttentionItem {
  id: string;
  name: string;
  clientName: string;   // passed to onOpenClient
  metric: string;       // right-aligned key figure
  metricTone: MetricTone;
  reason: string;       // one-line context
}

type Fmt = (n: number) => string;

// --- from FocusResult (Watch / Grow / Protect) ---

export function watchItems(f: FocusResult, fmt: Fmt): AttentionItem[] {
  return f.watch.map(a => ({
    id: a.client_id, name: a.client_name, clientName: a.client_name,
    metric: a.atRiskUSD > 0 ? `${fmt(a.atRiskUSD)} at risk` : a.reason,
    metricTone: 'red',
    reason: a.momPct != null ? `${a.reason} (now ${fmt(a.mrrUSD)}/mo)` : a.reason,
  }));
}

export function growItems(f: FocusResult, fmt: Fmt): AttentionItem[] {
  return f.grow.map(a => ({
    id: a.client_id, name: a.client_name, clientName: a.client_name,
    metric: `${fmt(a.mrrUSD)}/mo`,
    metricTone: 'emerald',
    reason: a.topUpsell ? `${a.reason}. ${a.topUpsell}` : a.reason,
  }));
}

export function protectItems(f: FocusResult, fmt: Fmt): AttentionItem[] {
  return f.protect.map(a => ({
    id: a.client_id, name: a.client_name, clientName: a.client_name,
    metric: `${fmt(a.mrrUSD)}/mo`,
    metricTone: a.slipping ? 'amber' : 'slate',
    reason: a.reason,
  }));
}

// --- Trial expiring (from client profiles) ---

export function trialExpiringItems(clients: ClientData[], withinDays = 30, nowMs = Date.now()): AttentionItem[] {
  const out: { item: AttentionItem; days: number }[] = [];
  for (const c of clients) {
    const raw = c.profile?.trial_expires;
    if (!raw) continue;
    const t = Date.parse(String(raw));
    if (Number.isNaN(t)) continue;
    const days = Math.round((t - nowMs) / 86_400_000);
    if (days < 0 || days > withinDays) continue;   // only upcoming, within window
    out.push({
      days,
      item: {
        id: c.client_id || c.client_name, name: c.client_name, clientName: c.client_name,
        metric: days === 0 ? 'expires today' : `expires in ${days}d`,
        metricTone: days <= 7 ? 'red' : 'amber',
        reason: `Trial ${c.profile?.segment ? `(${c.profile.segment})` : ''}, convert before it lapses`.replace(/\s+,/, ','),
      },
    });
  }
  return out.sort((a, b) => a.days - b.days).map(o => o.item);
}

// --- Ready to go live (from lifecycle rows) ---

interface LifecycleGoLive {
  client_id: string;
  client_name: string;
  stage: 'production' | 'testing-only' | 'none';
  first_staging_date: string | null;
  staging_app_count: number;
}

export function readyToGoLiveItems(rows: LifecycleGoLive[], withinDays = 120, nowMs = Date.now()): AttentionItem[] {
  // Only genuinely-recent testing counts as "ready to go live". Most testing-only
  // clients are years-old abandoned test credentials, not live onboarding, and
  // surfacing all ~1,900 of them would flood the hub instead of focusing it.
  const cutoff = nowMs - withinDays * 86_400_000;
  return rows
    .filter(r => r.stage === 'testing-only')
    .filter(r => {
      if (!r.first_staging_date) return false;
      const t = Date.parse(r.first_staging_date);
      return !Number.isNaN(t) && t >= cutoff;
    })
    .sort((a, b) => (b.first_staging_date || '').localeCompare(a.first_staging_date || ''))
    .map(r => ({
      id: r.client_id, name: r.client_name, clientName: r.client_name,
      metric: r.first_staging_date ? `testing since ${r.first_staging_date}` : 'in testing',
      metricTone: 'amber' as MetricTone,
      reason: `${r.staging_app_count} staging cred${r.staging_app_count === 1 ? '' : 's'}, not in production yet`,
    }));
}

// --- Big upsell gaps (from segment intelligence) ---

interface SegClientGap {
  name: string;
  clientId?: string;
  potentialRevenue: number;
  apisMissing: Array<{ name: string; priority: string }>;
}
interface SegData { segments?: Array<{ clients?: SegClientGap[] }> }

export function upsellGapItems(seg: SegData | null | undefined, fmt: Fmt): AttentionItem[] {
  if (!seg?.segments) return [];
  const scored: { pot: number; item: AttentionItem }[] = [];
  for (const s of seg.segments) {
    for (const c of s.clients || []) {
      const high = (c.apisMissing || []).filter(g => g.priority === 'high');
      if (high.length === 0 || c.potentialRevenue <= 0) continue;
      scored.push({
        pot: c.potentialRevenue,
        item: {
          id: c.clientId || c.name, name: c.name, clientName: c.name,
          metric: `~${fmt(c.potentialRevenue)}/mo`,
          metricTone: 'emerald',
          reason: `Missing ${high[0].name}${high.length > 1 ? ` +${high.length - 1} more` : ''}, peers already buy it`,
        },
      });
    }
  }
  return scored.sort((a, b) => b.pot - a.pot).map(s => s.item);
}

// --- Pricing / billing issues (from pricing-anomaly response) ---

interface AnomalyLite { clientId: string; clientName: string; priceDiff: number }
interface PricingResp {
  pricingConflicts?: Record<string, AnomalyLite[]>;
  slabOverlaps?: Record<string, AnomalyLite[]>;
  unmapped?: Record<string, AnomalyLite[]>;
}

export function pricingIssueItems(p: PricingResp | null | undefined): AttentionItem[] {
  if (!p) return [];
  const byClient = new Map<string, { name: string; count: number; maxDiff: number }>();
  const groups = [p.pricingConflicts, p.slabOverlaps, p.unmapped];
  for (const g of groups) {
    for (const arr of Object.values(g || {})) {
      for (const a of arr) {
        const key = a.clientName || a.clientId;
        if (!key) continue;
        const e = byClient.get(key) || { name: a.clientName || a.clientId, count: 0, maxDiff: 0 };
        e.count += 1;
        e.maxDiff = Math.max(e.maxDiff, a.priceDiff || 0);
        byClient.set(key, e);
      }
    }
  }
  return [...byClient.values()]
    .sort((a, b) => b.count - a.count || b.maxDiff - a.maxDiff)
    .map(e => ({
      id: e.name, name: e.name, clientName: e.name,
      metric: `${e.count} issue${e.count === 1 ? '' : 's'}`,
      metricTone: 'slate' as MetricTone,
      reason: 'Pricing conflict or unmapped usage, possible revenue leak',
    }));
}
