/**
 * Account Brief helpers, pure functions that turn a client's monthly revenue
 * history into a trend and a risk signal for the "Brief" tab. No React, no
 * fetching, so they're trivially testable.
 *
 * `monthly_data` is ordered latest-first: index 0 = most recent month.
 */

import type { ClientData } from '@/types/client';

export interface RevenueTrend {
  points: number[];        // oldest → newest monthly total_revenue_usd (up to 8)
  latest: number;
  previous: number | null;
  momPct: number | null;   // month-over-month %, null when <2 months of history
  hasHistory: boolean;     // false when <2 months
}

export type RiskKind = 'churned' | 'declining' | 'growing' | 'stable' | 'not-in-prod';

export interface RiskSignal {
  kind: RiskKind;
  momPct: number | null;
  atRisk: number;          // USD in danger (0 unless churned/declining)
  label: string;
}

/** Minimal lifecycle shape needed to detect "not yet in production". */
interface LifecycleLike {
  currently_in_production?: boolean;
  stage?: string;
  went_to_production_date?: string | null;
}

const SPARK_MONTHS = 8;

export function computeRevenueTrend(client: ClientData): RevenueTrend {
  const md = client.monthly_data ?? [];
  // latest-first → take up to 8, then reverse to oldest→newest for the sparkline
  const points = md.slice(0, SPARK_MONTHS).map(m => m.total_revenue_usd || 0).reverse();
  const latest = md[0]?.total_revenue_usd ?? 0;
  const previous = md.length >= 2 ? (md[1]?.total_revenue_usd ?? 0) : null;
  const momPct =
    previous != null && previous > 0 ? ((latest - previous) / previous) * 100 : null;
  return { points, latest, previous, momPct, hasHistory: md.length >= 2 };
}

export function computeRiskSignal(client: ClientData, lifecycle?: LifecycleLike | null): RiskSignal {
  // A client that never reached production isn't a churn/decline case.
  const neverLive =
    lifecycle != null &&
    (lifecycle.stage === 'testing-only' || (!lifecycle.currently_in_production && !lifecycle.went_to_production_date));

  const md = client.monthly_data ?? [];
  if (md.length < 2) {
    if (neverLive) return { kind: 'not-in-prod', momPct: null, atRisk: 0, label: 'Not in production yet' };
    return { kind: 'stable', momPct: null, atRisk: 0, label: 'Not enough history' };
  }

  const latest = md[0]?.total_revenue_usd ?? 0;
  const previous = md[1]?.total_revenue_usd ?? 0;
  const momPct = previous > 0 ? ((latest - previous) / previous) * 100 : null;

  // Churned: was paying, now zero.
  if (latest === 0 && previous > 0) {
    return { kind: 'churned', momPct, atRisk: previous, label: 'Churned, stopped paying' };
  }
  // Declining: >10% drop on a non-trivial base.
  if (momPct != null && momPct < -10 && previous > 100 && latest < previous) {
    return { kind: 'declining', momPct, atRisk: previous - latest, label: `Declining ${Math.round(momPct)}% MoM` };
  }
  // Growing: >10% up.
  if (momPct != null && momPct > 10) {
    return { kind: 'growing', momPct, atRisk: 0, label: `Growing +${Math.round(momPct)}% MoM` };
  }
  return { kind: 'stable', momPct, atRisk: 0, label: 'Stable' };
}
