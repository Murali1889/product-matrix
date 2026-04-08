import { NextResponse } from 'next/server';
import { fetchPricing } from '@/lib/google-sheets-api';

export interface Anomaly {
  type: 'pricing-conflict' | 'slab-overlap';
  clientId: string;
  clientName: string;
  status: string;
  productName: string;
  moduleName: string;
  subModule: string;
  slabStart: number;
  entries: { moduleType: string; unit: string; slabStart: number; slabEnd: number; unitPrice: number }[];
  priceDiff: number;
}

let cachedResult: object | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

function makeProductName(modName: string, subMod: string): string {
  if (!subMod || subMod === '-' || subMod === modName) return modName;
  return `${modName} - ${subMod}`;
}

export async function GET() {
  try {
    if (cachedResult && Date.now() - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedResult);
    }

    const rows = await fetchPricing();

    // Group by Client ID | Module Name | Sub-Module | Slab Start
    const groups: Record<string, typeof rows> = {};
    for (const row of rows) {
      const key = `${row['Client ID']}|${row['Module Name']}|${row['Sub-Module']}|${row['Slab Start']}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    }

    // ── Type 1: Same slab start, different prices ──
    const anomalies: Anomaly[] = [];
    const seenKeys = new Set<string>(); // track to avoid duplicates with type 2

    for (const entries of Object.values(groups)) {
      if (entries.length < 2) continue;
      const prices = new Set(entries.map(e => e['Unit Price']));
      if (prices.size < 2) continue;

      const first = entries[0];
      const productName = makeProductName(first['Module Name'], first['Sub-Module']);
      const priceArr = entries.map(e => e['Unit Price']);
      const priceDiff = Math.max(...priceArr) - Math.min(...priceArr);
      const key = `${first['Client ID']}|${productName}|${first['Slab Start']}`;
      seenKeys.add(key);

      anomalies.push({
        type: 'pricing-conflict',
        clientId: first['Client ID'],
        clientName: first['Client Name'],
        status: first['Status'],
        productName,
        moduleName: first['Module Name'],
        subModule: first['Sub-Module'],
        slabStart: first['Slab Start'],
        entries: entries.map(e => ({
          moduleType: e['Module Type'],
          unit: e['Unit'],
          slabStart: e['Slab Start'],
          slabEnd: e['Slab End'],
          unitPrice: e['Unit Price'],
        })),
        priceDiff,
      });
    }

    // ── Type 2: Overlapping slabs with different prices ──
    // Group by Client ID | Module Name | Sub-Module (no slab start)
    const byProduct: Record<string, typeof rows> = {};
    for (const row of rows) {
      const key = `${row['Client ID']}|${row['Module Name']}|${row['Sub-Module']}`;
      if (!byProduct[key]) byProduct[key] = [];
      byProduct[key].push(row);
    }

    for (const productRows of Object.values(byProduct)) {
      if (productRows.length < 2) continue;
      const sorted = [...productRows].sort((a, b) => a['Slab Start'] - b['Slab Start']);

      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i], b = sorted[j];
          // Check overlap: a.start <= b.end AND b.start <= a.end
          if (a['Slab Start'] <= b['Slab End'] && b['Slab Start'] <= a['Slab End']) {
            // Same start is already caught by type 1
            if (a['Slab Start'] === b['Slab Start']) continue;
            // Only flag if different prices
            if (a['Unit Price'] === b['Unit Price']) continue;

            const productName = makeProductName(a['Module Name'], a['Sub-Module']);
            const key = `${a['Client ID']}|${productName}|overlap-${a['Slab Start']}-${b['Slab Start']}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);

            const priceDiff = Math.abs(a['Unit Price'] - b['Unit Price']);
            anomalies.push({
              type: 'slab-overlap',
              clientId: a['Client ID'],
              clientName: a['Client Name'],
              status: a['Status'],
              productName,
              moduleName: a['Module Name'],
              subModule: a['Sub-Module'],
              slabStart: a['Slab Start'],
              entries: [
                { moduleType: a['Module Type'], unit: a['Unit'], slabStart: a['Slab Start'], slabEnd: a['Slab End'], unitPrice: a['Unit Price'] },
                { moduleType: b['Module Type'], unit: b['Unit'], slabStart: b['Slab Start'], slabEnd: b['Slab End'], unitPrice: b['Unit Price'] },
              ],
              priceDiff,
            });
          }
        }
      }
    }

    // Separate by type
    const pricingConflicts = anomalies.filter(a => a.type === 'pricing-conflict');
    const slabOverlaps = anomalies.filter(a => a.type === 'slab-overlap');

    // Group by product name for matrix — separate maps
    const conflictsByProduct: Record<string, Anomaly[]> = {};
    for (const a of pricingConflicts) {
      if (!conflictsByProduct[a.productName]) conflictsByProduct[a.productName] = [];
      conflictsByProduct[a.productName].push(a);
    }

    const overlapsByProduct: Record<string, Anomaly[]> = {};
    for (const a of slabOverlaps) {
      if (!overlapsByProduct[a.productName]) overlapsByProduct[a.productName] = [];
      overlapsByProduct[a.productName].push(a);
    }

    const result = {
      pricingConflicts: conflictsByProduct,
      slabOverlaps: overlapsByProduct,
      stats: {
        conflicts: pricingConflicts.length,
        conflictClients: new Set(pricingConflicts.map(a => a.clientId)).size,
        conflictProducts: Object.keys(conflictsByProduct).length,
        overlaps: slabOverlaps.length,
        overlapClients: new Set(slabOverlaps.map(a => a.clientId)).size,
        overlapProducts: Object.keys(overlapsByProduct).length,
        totalRows: rows.length,
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
