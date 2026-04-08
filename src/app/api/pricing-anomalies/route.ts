import { NextResponse } from 'next/server';
import { fetchPricing } from '@/lib/google-sheets-api';

export interface Anomaly {
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

    // Find conflicts: same group, different prices
    const anomalies: Anomaly[] = [];
    for (const entries of Object.values(groups)) {
      if (entries.length < 2) continue;
      const prices = new Set(entries.map(e => e['Unit Price']));
      if (prices.size < 2) continue;

      const first = entries[0];
      const productName = makeProductName(first['Module Name'], first['Sub-Module']);
      const priceArr = entries.map(e => e['Unit Price']);
      const priceDiff = Math.max(...priceArr) - Math.min(...priceArr);

      anomalies.push({
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

    // Group by product name for matrix
    const matrixAnomalies: Record<string, Anomaly[]> = {};
    for (const a of anomalies) {
      if (!matrixAnomalies[a.productName]) matrixAnomalies[a.productName] = [];
      matrixAnomalies[a.productName].push(a);
    }

    const uniqueClients = [...new Set(anomalies.map(a => a.clientId))];

    const result = {
      matrixAnomalies,
      stats: {
        totalAnomalies: anomalies.length,
        totalCompanies: uniqueClients.length,
        totalRows: rows.length,
        productsAffected: Object.keys(matrixAnomalies).length,
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
