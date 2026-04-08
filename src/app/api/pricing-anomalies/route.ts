import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface PricingEntry {
  _id: string;
  clientId: string;
  moduleType: string;
  unit: string;
  start: number;
  end: number;
  unitPrice: number;
  createdAt: string;
  updatedAt: string;
}

interface Company {
  name: string;
  clientId: string;
  clientType: string;
  accountOwner: string;
  geography: string[];
  industry: string[];
  operationalStatus: string;
  billingCurrency: string;
  pricing: PricingEntry[];
}

export type AnomalyType =
  | 'cross-module'     // Same unit in different modules with different pricing
  | 'overlap'          // Overlapping slab ranges within same module+unit
  | 'missing-top'      // No infinity/MAX slab at the top
  | 'gap'              // Gap between consecutive slabs
  | 'duplicate'        // Exact duplicate slab entries
  | 'null-module'      // Null/missing moduleType
  | 'price-inversion'  // Price goes UP with volume (should decrease)
  | 'outlier';         // Price far above peer median

export type Severity = 'critical' | 'warning' | 'info';

export interface SlabEntry {
  moduleType: string;
  unit: string;
  start: number;
  end: number;
  unitPrice: number;
}

export interface Anomaly {
  type: AnomalyType;
  severity: Severity;
  company: string;
  clientId: string;
  clientType: string;
  status: string;
  accountOwner: string;
  geography: string[];
  industry: string[];
  billingCurrency: string;
  moduleType: string;
  unit: string;
  entries: SlabEntry[];
  priceDiff: number;
  description: string;
  peerMedian?: number;
}

const MAX_SAFE = 9007199254740000;

let cachedResult: object | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

function fmtS(n: number): string {
  if (n >= MAX_SAFE) return 'MAX';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function base(c: Company) {
  return {
    company: c.name, clientId: c.clientId, clientType: c.clientType || '',
    status: c.operationalStatus || '', accountOwner: c.accountOwner || '',
    geography: c.geography || [], industry: c.industry || [],
    billingCurrency: c.billingCurrency || 'INR',
  };
}

function detectAll(companies: Company[]): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const withPricing = companies.filter(c => c.pricing?.length > 0);

  // ─── Pre-compute peer price stats per unit (for outlier detection) ───
  const unitPrices: Record<string, number[]> = {};
  for (const c of withPricing) {
    for (const p of c.pricing) {
      if (p.unitPrice > 0) {
        if (!unitPrices[p.unit]) unitPrices[p.unit] = [];
        unitPrices[p.unit].push(p.unitPrice);
      }
    }
  }
  const unitStats: Record<string, { median: number; q1: number; q3: number; iqr: number; upper: number; count: number }> = {};
  for (const [unit, prices] of Object.entries(unitPrices)) {
    if (prices.length < 10) continue;
    const s = [...prices].sort((a, b) => a - b);
    const q1 = s[Math.floor(s.length * 0.25)];
    const q3 = s[Math.floor(s.length * 0.75)];
    const iqr = q3 - q1;
    unitStats[unit] = { median: s[Math.floor(s.length / 2)], q1, q3, iqr, upper: q3 + 2 * iqr, count: s.length };
  }

  // ─── Per-company detection ───
  for (const c of withPricing) {
    const b = base(c);

    // ── Type 1: Cross-module conflicts ──
    const byUnitStart: Record<string, SlabEntry[]> = {};
    for (const p of c.pricing) {
      const key = `${p.unit}|${p.start}`;
      if (!byUnitStart[key]) byUnitStart[key] = [];
      byUnitStart[key].push({ moduleType: p.moduleType || 'null', unit: p.unit, start: p.start, end: p.end, unitPrice: p.unitPrice });
    }
    for (const entries of Object.values(byUnitStart)) {
      const mods = [...new Set(entries.map(e => e.moduleType))];
      if (mods.length < 2) continue;
      let maxPD = 0, hasEndDiff = false;
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          if (entries[i].moduleType === entries[j].moduleType) continue;
          maxPD = Math.max(maxPD, Math.abs(entries[i].unitPrice - entries[j].unitPrice));
          if (entries[i].end !== entries[j].end) hasEndDiff = true;
        }
      }
      if (maxPD === 0 && !hasEndDiff) continue;
      const parts = [];
      if (maxPD > 0) parts.push(`price diff ${maxPD.toFixed(2)}`);
      if (hasEndDiff) parts.push('slab range differs');
      anomalies.push({
        ...b, type: 'cross-module', severity: maxPD > 1 ? 'critical' : 'warning',
        moduleType: mods.join(' vs '), unit: entries[0].unit, entries, priceDiff: maxPD,
        description: `"${entries[0].unit}" in ${mods.join(' & ')}: ${parts.join(', ')}`,
      });
    }

    // ── Group by moduleType+unit ──
    const byMU: Record<string, PricingEntry[]> = {};
    for (const p of c.pricing) {
      const key = `${p.moduleType || 'null'}|${p.unit}`;
      if (!byMU[key]) byMU[key] = [];
      byMU[key].push(p);
    }

    for (const slabsRaw of Object.values(byMU)) {
      const slabs = [...slabsRaw].sort((a, b) => a.start - b.start);
      const mod = slabs[0].moduleType || 'null';
      const unit = slabs[0].unit;
      const toEntry = (s: PricingEntry): SlabEntry => ({ moduleType: mod, unit: s.unit, start: s.start, end: s.end, unitPrice: s.unitPrice });

      // ── Type 6: Null moduleType ──
      if (!slabs[0].moduleType || slabs[0].moduleType === 'null') {
        anomalies.push({
          ...b, type: 'null-module', severity: 'warning',
          moduleType: 'null', unit, entries: slabs.map(toEntry), priceDiff: 0,
          description: `${slabs.length} slab(s) with null moduleType`,
        });
      }

      // ── Type 5: Duplicate slabs ──
      for (let i = 0; i < slabs.length; i++) {
        for (let j = i + 1; j < slabs.length; j++) {
          if (slabs[i].start === slabs[j].start && slabs[i].end === slabs[j].end && slabs[i].unit === slabs[j].unit) {
            const pd = Math.abs(slabs[i].unitPrice - slabs[j].unitPrice);
            anomalies.push({
              ...b, type: 'duplicate', severity: pd > 0 ? 'critical' : 'warning',
              moduleType: mod, unit, entries: [toEntry(slabs[i]), toEntry(slabs[j])], priceDiff: pd,
              description: `Duplicate slab ${fmtS(slabs[i].start)}-${fmtS(slabs[i].end)}: ${slabs[i].unitPrice} vs ${slabs[j].unitPrice}`,
            });
          }
        }
      }

      // ── Type 7: Price inversion (goes UP with volume) ──
      if (slabs.length >= 2) {
        for (let i = 0; i < slabs.length - 1; i++) {
          if (slabs[i + 1].unitPrice > slabs[i].unitPrice && slabs[i].unitPrice > 0) {
            const jump = slabs[i + 1].unitPrice - slabs[i].unitPrice;
            anomalies.push({
              ...b, type: 'price-inversion', severity: jump > 5 ? 'critical' : 'warning',
              moduleType: mod, unit, entries: slabs.map(toEntry), priceDiff: jump,
              description: `Price jumps from ${slabs[i].unitPrice} to ${slabs[i + 1].unitPrice} at ${fmtS(slabs[i + 1].start)} volume (+${jump.toFixed(2)})`,
            });
            break;
          }
        }
      }

      // ── Type 8: Price outlier vs peers ──
      const stats = unitStats[unit];
      if (stats && stats.iqr > 0) {
        for (const s of slabs) {
          if (s.unitPrice > 0 && s.unitPrice > stats.upper) {
            anomalies.push({
              ...b, type: 'outlier', severity: s.unitPrice > stats.upper * 2 ? 'critical' : 'info',
              moduleType: mod, unit, entries: [toEntry(s)], priceDiff: +(s.unitPrice - stats.median).toFixed(2),
              description: `${s.unitPrice} vs peer median ${stats.median.toFixed(2)} (${stats.count} peers, upper bound ${stats.upper.toFixed(2)})`,
              peerMedian: stats.median,
            });
            break; // one outlier alert per module+unit
          }
        }
      }

      if (slabs.length < 2) continue;

      // ── Type 2: Overlapping slabs ──
      for (let i = 0; i < slabs.length - 1; i++) {
        const curr = slabs[i], next = slabs[i + 1];
        if (curr.end >= next.start && curr.end !== next.start - 1 && curr.start !== next.start) {
          const isBoundary = curr.end === next.start; // off-by-one: end=start instead of end+1=start
          const isTrueOverlap = curr.end > next.start;
          anomalies.push({
            ...b, type: 'overlap', severity: isTrueOverlap ? 'critical' : 'warning',
            moduleType: mod, unit, entries: [toEntry(curr), toEntry(next)],
            priceDiff: Math.abs(curr.unitPrice - next.unitPrice),
            description: isBoundary
              ? `Boundary overlap: slab ends at ${fmtS(curr.end)} but next starts at ${fmtS(next.start)} (should be ${fmtS(curr.end + 1)})`
              : `True overlap at ${fmtS(next.start)}-${fmtS(Math.min(curr.end, next.end))}: [${fmtS(curr.start)}-${fmtS(curr.end)}] and [${fmtS(next.start)}-${fmtS(next.end)}]`,
          });
        }

        // ── Type 4: Gap between slabs ──
        if (next.start > curr.end + 1 && curr.end < MAX_SAFE) {
          anomalies.push({
            ...b, type: 'gap', severity: 'critical',
            moduleType: mod, unit, entries: [toEntry(curr), toEntry(next)], priceDiff: 0,
            description: `No pricing for ${fmtS(curr.end + 1)}-${fmtS(next.start - 1)}`,
          });
        }
      }

      // ── Type 3: Missing top slab ──
      const maxEnd = Math.max(...slabs.map(s => s.end));
      if (maxEnd < MAX_SAFE) {
        anomalies.push({
          ...b, type: 'missing-top', severity: 'warning',
          moduleType: mod, unit, entries: slabs.map(toEntry), priceDiff: 0,
          description: `Last slab ends at ${fmtS(maxEnd)} — no pricing above. ${slabs.length} slab(s).`,
        });
      }
    }
  }

  return anomalies;
}

export async function GET() {
  try {
    if (cachedResult && Date.now() - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedResult);
    }

    const filePath = path.join(process.cwd(), 'data', 'HyperVerge Companies Pricing Apr 2026 (1).json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { companyList: Company[] };

    const anomalies = detectAll(parsed.companyList);

    const uniqueClients = new Set(anomalies.map(a => a.clientId));
    const byType: Record<string, number> = {};
    const companiesByType: Record<string, Set<string>> = {};
    const bySeverity: Record<string, number> = {};
    for (const a of anomalies) {
      byType[a.type] = (byType[a.type] || 0) + 1;
      if (!companiesByType[a.type]) companiesByType[a.type] = new Set();
      companiesByType[a.type].add(a.clientId);
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
    }

    const result = {
      anomalies,
      stats: {
        totalAnomalies: anomalies.length,
        totalCompanies: uniqueClients.size,
        totalScanned: parsed.companyList.length,
        critical: bySeverity['critical'] || 0,
        warning: bySeverity['warning'] || 0,
        info: bySeverity['info'] || 0,
        byType: Object.fromEntries(
          Object.entries(byType).map(([t, count]) => [t, { count, companies: companiesByType[t]?.size || 0 }])
        ),
      },
    };

    cachedResult = result;
    cacheTime = Date.now();
    return NextResponse.json(result);
  } catch (err) {
    console.error('Pricing anomalies error:', err);
    return NextResponse.json({ error: 'Failed to detect anomalies' }, { status: 500 });
  }
}
