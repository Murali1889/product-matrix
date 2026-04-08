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

export type Severity = 'critical' | 'warning' | 'info';

export interface SlabEntry {
  moduleType: string;
  unit: string;
  start: number;
  end: number;
  unitPrice: number;
}

export interface Anomaly {
  severity: Severity;
  company: string;
  clientId: string;
  status: string;
  billingCurrency: string;
  productName: string; // Matrix column name: "Module Name - Sub-Module"
  entries: SlabEntry[];
  priceDiff: number;
  description: string;
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

async function loadModuleTypeMapping(): Promise<Record<string, string>> {
  // moduleType → "Module Name - Sub-Module"
  const map: Record<string, string> = {};
  try {
    const { fetchProducts } = await import('@/lib/google-sheets-api');
    const products = await fetchProducts();
    for (const p of products) {
      const mt = p['Module Type'];
      const modName = p['Module Name'] || '';
      const subMod = p['Sub-Module'] || '';
      if (mt) {
        map[mt] = (!subMod || subMod === '-' || subMod === modName) ? modName : `${modName} - ${subMod}`;
      }
    }
  } catch (e) {
    console.warn('Could not load products for module mapping:', e);
  }
  return map;
}

function detectAnomalies(
  companies: Company[],
  moduleTypeToProduct: Record<string, string>,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const withPricing = companies.filter(c => c.pricing?.length > 0);

  for (const c of withPricing) {
    // Group pricing entries by product name (resolved from moduleType → Module Name + Sub-Module)
    // Key: productName + "|" + start
    const byProduct: Record<string, SlabEntry[]> = {};

    for (const p of c.pricing) {
      const productName = moduleTypeToProduct[p.moduleType];
      if (!productName) continue; // skip if no mapping

      const key = `${productName}|${p.start}`;
      if (!byProduct[key]) byProduct[key] = [];
      byProduct[key].push({
        moduleType: p.moduleType,
        unit: p.unit,
        start: p.start,
        end: p.end,
        unitPrice: p.unitPrice,
      });
    }

    // Find conflicts: same product + same start, but different moduleTypes with different price/end
    for (const entries of Object.values(byProduct)) {
      const distinctModules = [...new Set(entries.map(e => e.moduleType))];
      if (distinctModules.length < 2) continue;

      let maxPD = 0;
      let hasEndDiff = false;
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          if (entries[i].moduleType === entries[j].moduleType) continue;
          maxPD = Math.max(maxPD, Math.abs(entries[i].unitPrice - entries[j].unitPrice));
          if (entries[i].end !== entries[j].end) hasEndDiff = true;
        }
      }
      if (maxPD === 0 && !hasEndDiff) continue;

      const productName = moduleTypeToProduct[entries[0].moduleType] || entries[0].unit;
      const parts = [];
      if (maxPD > 0) parts.push(`price diff ${maxPD.toFixed(2)}`);
      if (hasEndDiff) parts.push('slab range differs');

      anomalies.push({
        severity: maxPD > 1 ? 'critical' : 'warning',
        company: c.name,
        clientId: c.clientId,
        status: c.operationalStatus || '',
        billingCurrency: c.billingCurrency || 'INR',
        productName,
        entries,
        priceDiff: maxPD,
        description: `${distinctModules.join(' vs ')}: ${parts.join(', ')} (slab ${fmtS(entries[0].start)})`,
      });
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

    const moduleTypeToProduct = await loadModuleTypeMapping();
    const anomalies = detectAnomalies(parsed.companyList, moduleTypeToProduct);

    // Group by product name (matrix column) → anomalies per client
    const matrixAnomalies: Record<string, Anomaly[]> = {};
    for (const a of anomalies) {
      if (!matrixAnomalies[a.productName]) matrixAnomalies[a.productName] = [];
      matrixAnomalies[a.productName].push(a);
    }

    // Unique clients with anomalies
    const uniqueClients = [...new Set(anomalies.map(a => a.clientId))];

    const result = {
      matrixAnomalies,
      stats: {
        totalAnomalies: anomalies.length,
        totalCompanies: uniqueClients.length,
        totalScanned: parsed.companyList.length,
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
