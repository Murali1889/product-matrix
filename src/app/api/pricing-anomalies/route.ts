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

export interface AnomalyConflictEntry {
  moduleType: string;
  unit: string;
  start: number;
  end: number;
  unitPrice: number;
}

export interface Anomaly {
  company: string;
  clientId: string;
  clientType: string;
  status: string;
  accountOwner: string;
  geography: string[];
  industry: string[];
  billingCurrency: string;
  unit: string;
  start: number;
  entries: AnomalyConflictEntry[];
  priceDiff: number;
  endDiff: boolean;
}

let cachedData: { anomalies: Anomaly[]; stats: Record<string, number> } | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

function detectAnomalies(companies: Company[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  for (const company of companies) {
    if (!company.pricing || company.pricing.length === 0) continue;

    // Group by unit + start (ignoring moduleType)
    const groups: Record<string, AnomalyConflictEntry[]> = {};
    for (const p of company.pricing) {
      const key = `${p.unit}|${p.start}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push({
        moduleType: p.moduleType,
        unit: p.unit,
        start: p.start,
        end: p.end,
        unitPrice: p.unitPrice,
      });
    }

    for (const entries of Object.values(groups)) {
      const distinctModules = [...new Set(entries.map(e => e.moduleType))];
      if (distinctModules.length < 2) continue;

      // Check for price or end differences across different modules
      let hasPriceDiff = false;
      let hasEndDiff = false;
      let maxPriceDiff = 0;

      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          if (entries[i].moduleType === entries[j].moduleType) continue;
          const pd = Math.abs(entries[i].unitPrice - entries[j].unitPrice);
          if (pd > 0) {
            hasPriceDiff = true;
            maxPriceDiff = Math.max(maxPriceDiff, pd);
          }
          if (entries[i].end !== entries[j].end) hasEndDiff = true;
        }
      }

      if (!hasPriceDiff && !hasEndDiff) continue;

      anomalies.push({
        company: company.name,
        clientId: company.clientId,
        clientType: company.clientType || '',
        status: company.operationalStatus,
        accountOwner: company.accountOwner || '',
        geography: company.geography || [],
        industry: company.industry || [],
        billingCurrency: company.billingCurrency || 'INR',
        unit: entries[0].unit,
        start: entries[0].start,
        entries,
        priceDiff: maxPriceDiff,
        endDiff: hasEndDiff,
      });
    }
  }

  return anomalies;
}

export async function GET() {
  try {
    if (cachedData && Date.now() - cacheTime < CACHE_TTL) {
      return NextResponse.json(cachedData);
    }

    const filePath = path.join(process.cwd(), 'data', 'HyperVerge Companies Pricing Apr 2026 (1).json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as { companyList: Company[] };

    const anomalies = detectAnomalies(data.companyList);

    // Compute stats
    const uniqueClients = [...new Set(anomalies.map(a => a.clientId))];
    const uniqueUnits = [...new Set(anomalies.map(a => a.unit))];
    const priceConflicts = anomalies.filter(a => a.priceDiff > 0).length;
    const endConflicts = anomalies.filter(a => a.endDiff).length;

    const statusCounts: Record<string, number> = {};
    for (const a of anomalies) {
      statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
    }

    const result = {
      anomalies,
      stats: {
        totalAnomalies: anomalies.length,
        totalCompanies: uniqueClients.length,
        totalUnits: uniqueUnits.length,
        priceConflicts,
        endConflicts,
        totalCompaniesScanned: data.companyList.length,
        ...statusCounts,
      },
    };

    cachedData = result;
    cacheTime = Date.now();

    return NextResponse.json(result);
  } catch (err) {
    console.error('Pricing anomalies error:', err);
    return NextResponse.json({ error: 'Failed to detect anomalies' }, { status: 500 });
  }
}
