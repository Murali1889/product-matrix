/**
 * Generate Cross-Sell Intelligence Data
 *
 * Reads client data and computes segment-level cross-sell opportunities.
 * Outputs to data/cross-sell-intelligence.json
 *
 * Run: npx tsx scripts/generate-cross-sell.ts
 */

import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const COMPLETE_DATA_PATH = path.join(DATA_DIR, 'complete_client_data_1770268082596.json');
const CLIENTS_PATH = path.join(DATA_DIR, 'clients.json');
const OUTPUT_PATH = path.join(DATA_DIR, 'cross-sell-intelligence.json');

// Normalize name for matching
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Currency conversion to USD (same rates used across the app)
const CURRENCY_TO_USD: Record<string, number> = {
  'USD': 1.0,
  'INR': 0.012,
  'NGN': 0.00062,
  'NGR': 0.00062,
  'VND': 0.000039,
};

function toUSD(amount: number, currency: string): number {
  const rate = CURRENCY_TO_USD[currency?.toUpperCase()] || 1;
  return amount * rate;
}

/**
 * Extract production appIds from businessUnits credentialList.
 * Matches the same logic as client-data-loader.ts
 */
function getProductionAppIds(businessUnits?: Record<string, { credentialList?: Array<{ type: string; appId: string }> }>): Set<string> {
  const productionAppIds = new Set<string>();
  if (!businessUnits) return productionAppIds;

  for (const bu of Object.values(businessUnits)) {
    if (bu.credentialList) {
      for (const cred of bu.credentialList) {
        if (cred.type === 'PRODUCTION' && cred.appId) {
          productionAppIds.add(cred.appId);
        }
      }
    }
  }

  return productionAppIds;
}

async function generate() {
  console.log('Loading data...');

  // Load clients.json (master list)
  const clientsRaw = await fs.readFile(CLIENTS_PATH, 'utf-8');
  const clientMaster: { clients: Array<{
    id: number; name: string; clientId: string; segment?: string; geography?: string; kam?: string;
    actualRevenue?: { jan_26: number; dec_25: number; nov_25: number; oct_25: number };
  }> } = JSON.parse(clientsRaw);

  // Load complete client data (billing data)
  const completeRaw = await fs.readFile(COMPLETE_DATA_PATH, 'utf-8');
  const completeData: {
    data: Array<{
      clientName: string;
      clientId: string;
      clientDetails: {
        companyDetails: { billingCurrency?: string };
        businessUnits?: Record<string, {
          BUID: string;
          name: string;
          credentialList?: Array<{ type: string; appId: string }>;
        }>;
      };
      billing: Array<{
        period: string;
        data: {
          appId: Record<string, { usageRows: Array<{ moduleName: string; total: number; cost: number | null }> }>;
        };
      }>;
    }>;
  } = JSON.parse(completeRaw);

  console.log(`Loaded ${clientMaster.clients.length} master clients, ${completeData.data.length} billing clients`);

  // Build a map: normalized name → billing client data
  const billingMap = new Map<string, typeof completeData.data[0]>();
  for (const client of completeData.data) {
    billingMap.set(normalizeName(client.clientName), client);
    billingMap.set(normalizeName(client.clientId), client);
  }

  // For each master client, extract which APIs they actually use (from latest month billing data)
  interface ClientAPIInfo {
    name: string;
    clientId: string;
    segment: string;
    geography: string;
    kam: string;
    totalRevenue: number;
    apisUsed: Array<{ name: string; revenue: number; usage: number }>;
    apiNames: string[];
  }

  const clientInfos: ClientAPIInfo[] = [];
  const allApiNames = new Set<string>();

  let skippedStagingAPIs = 0;

  for (const mc of clientMaster.clients) {
    const billing = billingMap.get(normalizeName(mc.name)) || billingMap.get(normalizeName(mc.clientId));

    const apisUsed: Array<{ name: string; revenue: number; usage: number }> = [];

    const billingCurrency = billing?.clientDetails?.companyDetails?.billingCurrency || 'USD';

    if (billing && billing.billing.length > 0) {
      // Extract production appIds from credential list (same logic as client-data-loader.ts)
      const productionAppIds = getProductionAppIds(billing.clientDetails.businessUnits);

      // Aggregate APIs across latest 4 months — PRODUCTION appIds ONLY
      const apiTotals = new Map<string, { revenue: number; usage: number }>();

      for (const period of billing.billing.slice(0, 4)) {
        const appIdData = period.data.appId || {};
        for (const [appId, app] of Object.entries(appIdData)) {
          // Skip non-production appIds (if we have production credentials to filter by)
          if (productionAppIds.size > 0 && !productionAppIds.has(appId)) {
            skippedStagingAPIs++;
            continue;
          }
          for (const row of app.usageRows || []) {
            if (!row.moduleName || row.moduleName === 'total') continue;
            const existing = apiTotals.get(row.moduleName) || { revenue: 0, usage: 0 };
            existing.revenue += toUSD(row.cost || 0, billingCurrency);
            existing.usage += (row.total || 0);
            apiTotals.set(row.moduleName, existing);
          }
        }
        // buid data is intentionally excluded — only production appId data is used
      }

      for (const [name, totals] of apiTotals) {
        if (totals.revenue > 0 || totals.usage > 0) {
          apisUsed.push({ name, revenue: totals.revenue, usage: totals.usage });
          allApiNames.add(name);
        }
      }
    }

    const totalRev = mc.actualRevenue
      ? (mc.actualRevenue.jan_26 || 0)
      : 0;

    clientInfos.push({
      name: mc.name,
      clientId: mc.clientId,
      segment: mc.segment || 'Unknown',
      geography: mc.geography || 'Unknown',
      kam: mc.kam || '',
      totalRevenue: totalRev,
      apisUsed: apisUsed.sort((a, b) => b.revenue - a.revenue),
      apiNames: apisUsed.map(a => a.name),
    });
  }

  console.log(`Found ${allApiNames.size} unique APIs across all clients`);

  // Group by segment
  const segmentMap = new Map<string, ClientAPIInfo[]>();
  for (const c of clientInfos) {
    const list = segmentMap.get(c.segment) || [];
    list.push(c);
    segmentMap.set(c.segment, list);
  }

  // Build the cross-sell intelligence
  interface SegmentIntel {
    segment: string;
    totalClients: number;
    totalRevenue: number;
    // All APIs used by at least 1 client in this segment
    segmentAPIs: Array<{
      name: string;
      clientsUsing: number;
      adoptionRate: number; // 0-1
      totalRevenue: number;
      avgRevenuePerUser: number;
    }>;
    // Per-client breakdown
    clients: Array<{
      name: string;
      clientId: string;
      totalRevenue: number;
      kam: string;
      apisUsing: Array<{ name: string; revenue: number; usage: number }>;  // APIs with revenue info
      apisMissing: Array<{         // APIs this client doesn't use but peers do
        name: string;
        peerAdoptionRate: number;  // what % of segment uses it
        peersUsing: number;        // how many peers use it
        avgPeerRevenue: number;    // usage-based estimate
        avgPricingRevenue: number; // simple mean peer revenue
        topPeers: string[];        // up to 5 peer names who use it
        priority: 'high' | 'medium' | 'low';
        reason: string;            // human-readable WHY this is recommended
      }>;
      adoptionScore: number;       // what % of segment APIs this client uses (0-100)
      potentialRevenue: number;    // sum of usage-based estimates
      potentialRevenueAvg: number; // sum of avg pricing estimates
    }>;
    // Summary stats
    totalPotentialRevenue: number;
    totalPotentialRevenueAvg: number;
    avgAdoptionScore: number;
  }

  const segments: SegmentIntel[] = [];

  for (const [segName, clients] of segmentMap) {
    if (segName === 'Unknown') continue;
    if (clients.length < 2) continue; // Need at least 2 clients for cross-sell

    // Find all APIs used in this segment — track per-client revenue AND usage
    const apiStats = new Map<string, {
      clients: string[];
      perClientRevenue: number[];   // each peer's revenue for median calc
      perClientUsage: number[];     // each peer's usage for median calc
      totalRevenue: number;
      totalUsage: number;
    }>();

    for (const client of clients) {
      for (const api of client.apisUsed) {
        const stat = apiStats.get(api.name) || {
          clients: [], perClientRevenue: [], perClientUsage: [],
          totalRevenue: 0, totalUsage: 0,
        };
        stat.clients.push(client.name);
        stat.perClientRevenue.push(api.revenue);
        stat.perClientUsage.push(api.usage);
        stat.totalRevenue += api.revenue;
        stat.totalUsage += api.usage;
        apiStats.set(api.name, stat);
      }
    }

    // Helper: compute median of a sorted numeric array
    function median(values: number[]): number {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    const segmentAPIs = Array.from(apiStats.entries())
      .map(([name, stat]) => ({
        name,
        clientsUsing: stat.clients.length,
        adoptionRate: stat.clients.length / clients.length,
        totalRevenue: stat.totalRevenue,
        totalUsage: stat.totalUsage,
        avgRevenuePerUser: stat.totalRevenue / stat.clients.length,
        medianRevenue: median(stat.perClientRevenue),
        maxRevenue: Math.max(...stat.perClientRevenue),
        // Revenue per API call across all peers (for usage-based estimation)
        revenuePerCall: stat.totalUsage > 0 ? stat.totalRevenue / stat.totalUsage : 0,
      }))
      .sort((a, b) => b.adoptionRate - a.adoptionRate);

    // Only consider APIs with >= 20% adoption for cross-sell (meaningful signal)
    const crossSellAPIs = segmentAPIs.filter(a => a.adoptionRate >= 0.2);

    // Per-client analysis
    const clientResults = clients.map(client => {
      const clientAPISet = new Set(client.apiNames);

      // Client's own call volume: average calls per API they currently use
      const clientTotalCalls = client.apisUsed.reduce((s, a) => s + a.usage, 0);
      const clientAvgCallsPerAPI = client.apisUsed.length > 0 ? clientTotalCalls / client.apisUsed.length : 0;

      const apisMissing = crossSellAPIs
        .filter(api => !clientAPISet.has(api.name))
        .map(api => {
          const stat = apiStats.get(api.name)!;
          const pct = Math.round(api.adoptionRate * 100);
          const priority: 'high' | 'medium' | 'low' =
            api.adoptionRate >= 0.6 ? 'high' :
            api.adoptionRate >= 0.35 ? 'medium' : 'low';

          const peers = stat.clients.filter(n => n !== client.name).slice(0, 5);
          const peerList = peers.slice(0, 3).join(', ');

          // --- Estimate revenue using client's own call volume ---
          let estimatedRevenue: number;
          let estimationMethod: string;

          if (clientAvgCallsPerAPI > 0 && api.revenuePerCall > 0) {
            // Primary: client's avg calls/API × this API's revenue-per-call from peers
            estimatedRevenue = clientAvgCallsPerAPI * api.revenuePerCall;
            estimationMethod = 'usage-based';
          } else {
            // Fallback: median peer revenue (resistant to outliers)
            estimatedRevenue = api.medianRevenue;
            estimationMethod = 'median';
          }

          // Sanity cap: never exceed max peer revenue for this API
          estimatedRevenue = Math.min(estimatedRevenue, api.maxRevenue);
          // Floor: at least $1 if there's any signal
          estimatedRevenue = Math.max(estimatedRevenue, 0);

          const revStr = estimatedRevenue >= 1000
            ? `$${(estimatedRevenue / 1000).toFixed(1)}K`
            : `$${Math.round(estimatedRevenue)}`;

          // Build a clear reason
          let reason = `${pct}% of ${segName} clients (${api.clientsUsing} out of ${clients.length}) use ${api.name}.`;
          if (peers.length > 0) {
            reason += ` Companies like ${peerList} already use it.`;
          }
          reason += ` Est. revenue: ${revStr} (${estimationMethod}).`;
          if (priority === 'high') {
            reason += ` Widely adopted in your segment — strong cross-sell signal.`;
          } else if (priority === 'medium') {
            reason += ` Growing adoption in your segment — good opportunity.`;
          }

          // Average pricing estimate (simple mean of all peers)
          const avgPricingRevenue = api.avgRevenuePerUser;

          return {
            name: api.name,
            peerAdoptionRate: api.adoptionRate,
            peersUsing: api.clientsUsing,
            avgPeerRevenue: estimatedRevenue,
            avgPricingRevenue,
            topPeers: peers,
            priority,
            reason,
          };
        })
        .sort((a, b) => {
          const pOrder = { high: 0, medium: 1, low: 2 };
          if (pOrder[a.priority] !== pOrder[b.priority]) return pOrder[a.priority] - pOrder[b.priority];
          return b.peerAdoptionRate - a.peerAdoptionRate;
        });

      const adoptionScore = crossSellAPIs.length > 0
        ? Math.round((crossSellAPIs.filter(a => clientAPISet.has(a.name)).length / crossSellAPIs.length) * 100)
        : 100;

      const potentialRevenue = apisMissing.reduce((sum, a) => sum + a.avgPeerRevenue, 0);
      const potentialRevenueAvg = apisMissing.reduce((sum, a) => sum + a.avgPricingRevenue, 0);

      return {
        name: client.name,
        clientId: client.clientId,
        totalRevenue: client.totalRevenue,
        kam: client.kam,
        apisUsing: client.apisUsed.map(a => ({ name: a.name, revenue: a.revenue, usage: a.usage })),
        apisMissing,
        adoptionScore,
        potentialRevenue,
        potentialRevenueAvg,
      };
    }).sort((a, b) => b.potentialRevenue - a.potentialRevenue);

    const totalPotentialRevenue = clientResults.reduce((s, c) => s + c.potentialRevenue, 0);
    const totalPotentialRevenueAvg = clientResults.reduce((s, c) => s + c.potentialRevenueAvg, 0);
    const avgAdoptionScore = clientResults.length > 0
      ? Math.round(clientResults.reduce((s, c) => s + c.adoptionScore, 0) / clientResults.length)
      : 0;

    segments.push({
      segment: segName,
      totalClients: clients.length,
      totalRevenue: clients.reduce((s, c) => s + c.totalRevenue, 0),
      segmentAPIs,
      clients: clientResults,
      totalPotentialRevenue,
      totalPotentialRevenueAvg,
      avgAdoptionScore,
    });
  }

  // Sort segments by potential revenue
  segments.sort((a, b) => b.totalPotentialRevenue - a.totalPotentialRevenue);

  const output = {
    generatedAt: new Date().toISOString(),
    totalSegments: segments.length,
    totalPotentialRevenue: segments.reduce((s, seg) => s + seg.totalPotentialRevenue, 0),
    totalPotentialRevenueAvg: segments.reduce((s, seg) => s + seg.totalPotentialRevenueAvg, 0),
    segments,
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log(`\nGenerated cross-sell intelligence (production appIds only):`);
  console.log(`  Segments: ${segments.length}`);
  console.log(`  Staging appId entries skipped: ${skippedStagingAPIs}`);
  console.log(`  Total potential (usage-based): $${Math.round(output.totalPotentialRevenue).toLocaleString()}`);
  console.log(`  Total potential (avg pricing): $${Math.round(output.totalPotentialRevenueAvg).toLocaleString()}`);
  console.log(`\nTop 5 segments by opportunity:`);
  for (const seg of segments.slice(0, 5)) {
    console.log(`  ${seg.segment}: ${seg.totalClients} clients, ${seg.segmentAPIs.length} APIs, $${Math.round(seg.totalPotentialRevenue).toLocaleString()} potential`);
  }
  console.log(`\nSaved to: ${OUTPUT_PATH}`);
}

generate().catch(console.error);
