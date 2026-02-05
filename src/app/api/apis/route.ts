import { NextResponse } from 'next/server';
import { loadMasterAPIs, loadMatrixData } from '@/lib/client-data-loader';

/**
 * APIs Route
 *
 * Returns both:
 * 1. Master API list from api.json (official API catalog)
 * 2. APIs actually used by clients (from complete_client_data.json)
 */

export interface APIModule {
  moduleName: string;
  subModuleName: string;
  billingUnit: string;
  moduleOwner?: string;
}

export async function GET() {
  try {
    // Load master API list
    const masterAPIs = await loadMasterAPIs();

    // Group by moduleName with subModules
    const grouped: Record<string, {
      moduleName: string;
      subModules: string[];
      billingUnit: string;
    }> = {};

    masterAPIs.forEach((api: APIModule) => {
      if (!grouped[api.moduleName]) {
        grouped[api.moduleName] = {
          moduleName: api.moduleName,
          subModules: [],
          billingUnit: api.billingUnit || '-'
        };
      }
      if (api.subModuleName && api.subModuleName !== '-') {
        grouped[api.moduleName].subModules.push(api.subModuleName);
      }
    });

    // Also get APIs actually used from client data
    const matrixData = await loadMatrixData();
    const usedAPIs = matrixData.apis; // Already sorted by revenue

    // Calculate usage stats for each API
    const apiStats: Record<string, { revenue: number; clientCount: number; usage: number }> = {};
    matrixData.clients.forEach(c => {
      c.monthly_data.forEach(m => {
        m.apis.forEach(api => {
          if (!apiStats[api.name]) {
            apiStats[api.name] = { revenue: 0, clientCount: 0, usage: 0 };
          }
          apiStats[api.name].revenue += api.revenue_usd;
          apiStats[api.name].usage += api.usage;
        });
      });
      // Count unique clients per API
      Object.keys(c.apiRevenues).forEach(apiName => {
        if (apiStats[apiName]) {
          apiStats[apiName].clientCount++;
        }
      });
    });

    // Build a set of master API names for matching
    const masterAPINames = new Set<string>();
    masterAPIs.forEach(api => {
      masterAPINames.add(api.moduleName.toLowerCase());
      if (api.subModuleName && api.subModuleName !== '-') {
        masterAPINames.add(`${api.moduleName} - ${api.subModuleName}`.toLowerCase());
      }
    });

    // Find APIs used by clients that are NOT in master list
    const unmatchedAPIs: string[] = [];
    usedAPIs.forEach(apiName => {
      const lowerName = apiName.toLowerCase();
      const parts = apiName.split(' - ');
      const modulePart = parts[0]?.toLowerCase() || '';

      // Check if this API matches any master API
      const isMatched = masterAPINames.has(lowerName) || masterAPINames.has(modulePart);
      if (!isMatched) {
        unmatchedAPIs.push(apiName);
      }
    });

    return NextResponse.json({
      // Master API catalog (grouped)
      masterAPIs: Object.values(grouped),
      masterCount: Object.keys(grouped).length,

      // APIs actually used (with stats)
      usedAPIs: usedAPIs.map(name => ({
        name,
        ...apiStats[name],
        inMasterList: !unmatchedAPIs.includes(name),
      })),
      usedCount: usedAPIs.length,

      // APIs used but NOT in master list (need attention)
      unmatchedAPIs: unmatchedAPIs.map(name => ({
        name,
        ...apiStats[name],
        inMasterList: false,
      })),
      unmatchedCount: unmatchedAPIs.length,

      // Raw master list
      raw: masterAPIs,
    });
  } catch (error) {
    console.error('APIs route error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load API list' },
      { status: 500 }
    );
  }
}
