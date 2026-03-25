import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadMatrixData, loadMasterAPIs } from '@/lib/client-data-loader';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// Currency conversion — match page.tsx rates
const CONVERSION_TO_USD: Record<string, number> = {
  'USD': 1,
  'INR': 0.012,
  'NGN': 0.00062,
  'NGR': 0.00062,
  'VND': 0.000039,
};
function toUSD(amount: number, currency?: string): number {
  const curr = (currency || 'USD').toUpperCase();
  return amount * (CONVERSION_TO_USD[curr] || 1);
}

// Cache computed cross-sell data (5 min)
let cachedResult: CrossSellData | null = null;
let cachedMonthKey = '';
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

interface CrossSellData {
  generatedAt: string;
  totalSegments: number;
  totalPotentialRevenue: number;
  totalPotentialRevenueAvg: number;
  segments: SegmentIntel[];
}

interface SegmentIntel {
  segment: string;
  totalClients: number;
  totalRevenue: number;
  segmentAPIs: Array<{
    name: string;
    clientsUsing: number;
    adoptionRate: number;
    totalRevenue: number;
    avgRevenuePerUser: number;
  }>;
  clients: Array<{
    name: string;
    clientId: string;
    totalRevenue: number;
    kam: string;
    apisUsing: Array<{ name: string; revenue: number; usage: number }>;
    apisMissing: Array<{
      name: string;
      peerAdoptionRate: number;
      peersUsing: number;
      avgPeerRevenue: number;
      avgPricingRevenue: number;
      topPeers: string[];
      priority: 'high' | 'medium' | 'low';
      reason: string;
    }>;
    adoptionScore: number;
    potentialRevenue: number;
    potentialRevenueAvg: number;
  }>;
  totalPotentialRevenue: number;
  totalPotentialRevenueAvg: number;
  avgAdoptionScore: number;
}

/**
 * Compute cross-sell intelligence from live API data
 */
async function computeCrossSellData(month?: string): Promise<CrossSellData> {
  const monthKey = month || 'default';
  const now = Date.now();
  if (cachedResult && cachedMonthKey === monthKey && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedResult;
  }

  const matrixData = await loadMatrixData(month);
  const liveClients = matrixData.clients.filter(c => c.isInMasterList);

  // Apply Supabase segment overrides.
  // Priority: client_overrides (by client_id) > clients table (by client_name) > inferSegment()
  try {
    const [{ data: overrides }, { data: clientsTable }] = await Promise.all([
      supabase.from('client_overrides').select('client_id, segment, industry'),
      supabase.from('clients').select('client_name, segment, geography'),
    ]);

    // Build lookups
    const overrideById = new Map<string, { segment?: string; industry?: string }>();
    (overrides || []).forEach(o => overrideById.set(o.client_id, o));

    const clientsByName = new Map<string, { segment?: string; geography?: string }>();
    (clientsTable || []).forEach(c => {
      if (c.client_name) {
        clientsByName.set(c.client_name.toLowerCase(), c);
        clientsByName.set(c.client_name, c);
      }
    });

    liveClients.forEach(c => {
      // Priority 1: client_overrides table (manually set per client_id)
      const ov = overrideById.get(c.client_id);
      if (ov?.segment) { c.profile.segment = ov.segment; return; }
      if (ov?.industry) { c.profile.industry = ov.industry; return; }

      // Priority 2: clients table (by client_name or client_id)
      const ct = clientsByName.get(c.client_name.toLowerCase())
        || clientsByName.get(c.client_name)
        || clientsByName.get(c.client_id);
      if (ct?.segment) { c.profile.segment = ct.segment; return; }
      if (ct?.geography && c.profile.geography === 'Unknown') { c.profile.geography = ct.geography; }

      // Priority 3: inferSegment() already applied by data loader — keep as is
    });
  } catch { /* Supabase not configured — use inferred segments */ }

  // Collect all unique API names from data
  const allAPINames = new Set<string>();
  liveClients.forEach(c => {
    c.monthly_data.forEach(m => {
      m.apis.forEach(a => { if (a.name) allAPINames.add(a.name); });
    });
  });

  // Group clients by segment
  const bySegment: Record<string, typeof liveClients> = {};
  liveClients.forEach(c => {
    const seg = c.profile.segment || 'Unknown';
    if (!bySegment[seg]) bySegment[seg] = [];
    bySegment[seg].push(c);
  });

  const segments: SegmentIntel[] = [];
  let grandTotalPotential = 0;
  let grandTotalPotentialAvg = 0;

  Object.entries(bySegment).forEach(([segment, segClients]) => {
    if (segClients.length < 2) return; // Skip segments with < 2 clients

    // Compute per-API adoption within this segment
    const apiStats: Record<string, {
      clients: string[];
      totalRevenue: number;
      totalUsage: number;
    }> = {};

    segClients.forEach(client => {
      const curr = client.profile.billing_currency;
      const latestMonth = client.monthly_data[0];
      latestMonth?.apis?.forEach(api => {
        if (!api.name || api.revenue_usd <= 0) return;
        if (!apiStats[api.name]) {
          apiStats[api.name] = { clients: [], totalRevenue: 0, totalUsage: 0 };
        }
        apiStats[api.name].clients.push(client.client_name);
        apiStats[api.name].totalRevenue += toUSD(api.revenue_usd, curr);
        apiStats[api.name].totalUsage += api.usage || 0;
      });
    });

    const segmentAPIs = Object.entries(apiStats)
      .map(([name, stats]) => ({
        name,
        clientsUsing: stats.clients.length,
        adoptionRate: stats.clients.length / segClients.length,
        totalRevenue: stats.totalRevenue,
        avgRevenuePerUser: stats.clients.length > 0 ? stats.totalRevenue / stats.clients.length : 0,
      }))
      .sort((a, b) => b.adoptionRate - a.adoptionRate);

    // Per-client analysis
    let segPotential = 0;
    let segPotentialAvg = 0;

    const clients = segClients.map(client => {
      const curr = client.profile.billing_currency;
      const latestMonth = client.monthly_data[0];
      const clientAPIs = new Set(
        (latestMonth?.apis || []).filter(a => a.revenue_usd > 0).map(a => a.name)
      );

      const apisUsing = (latestMonth?.apis || [])
        .filter(a => a.revenue_usd > 0)
        .map(a => ({ name: a.name, revenue: toUSD(a.revenue_usd, curr), usage: a.usage || 0 }));

      // Find gaps: APIs popular in segment but not used by this client
      const apisMissing = segmentAPIs
        .filter(api => api.adoptionRate >= 0.3 && !clientAPIs.has(api.name))
        .map(api => {
          const priority: 'high' | 'medium' | 'low' =
            api.adoptionRate >= 0.7 ? 'high' :
            api.adoptionRate >= 0.5 ? 'medium' : 'low';

          return {
            name: api.name,
            peerAdoptionRate: api.adoptionRate,
            peersUsing: api.clientsUsing,
            avgPeerRevenue: api.avgRevenuePerUser,
            avgPricingRevenue: api.avgRevenuePerUser,
            topPeers: apiStats[api.name]?.clients.slice(0, 3) || [],
            priority,
            reason: `${Math.round(api.adoptionRate * 100)}% of ${segment} clients use this`,
          };
        });

      const adoptionScore = segmentAPIs.length > 0
        ? Math.round((clientAPIs.size / segmentAPIs.filter(a => a.adoptionRate >= 0.3).length) * 100)
        : 0;

      const potentialRevenue = apisMissing.reduce((sum, a) => sum + a.avgPeerRevenue, 0);
      const potentialRevenueAvg = apisMissing.length > 0 ? potentialRevenue / apisMissing.length : 0;
      segPotential += potentialRevenue;
      segPotentialAvg += potentialRevenueAvg;

      return {
        name: client.client_name,
        clientId: client.client_id,
        totalRevenue: toUSD(latestMonth?.total_revenue_usd || 0, curr),
        kam: client.profile.account_owner || '',
        apisUsing,
        apisMissing,
        adoptionScore: Math.min(adoptionScore, 100),
        potentialRevenue,
        potentialRevenueAvg,
      };
    });

    const avgAdoptionScore = clients.length > 0
      ? Math.round(clients.reduce((s, c) => s + c.adoptionScore, 0) / clients.length)
      : 0;

    grandTotalPotential += segPotential;
    grandTotalPotentialAvg += segPotentialAvg;

    segments.push({
      segment,
      totalClients: segClients.length,
      totalRevenue: segClients.reduce((s, c) => s + toUSD(c.monthly_data[0]?.total_revenue_usd || 0, c.profile.billing_currency), 0),
      segmentAPIs,
      clients,
      totalPotentialRevenue: segPotential,
      totalPotentialRevenueAvg: segPotentialAvg,
      avgAdoptionScore,
    });
  });

  // Sort segments by revenue
  segments.sort((a, b) => b.totalRevenue - a.totalRevenue);

  const result: CrossSellData = {
    generatedAt: new Date().toISOString(),
    totalSegments: segments.length,
    totalPotentialRevenue: grandTotalPotential,
    totalPotentialRevenueAvg: grandTotalPotentialAvg,
    segments,
  };

  cachedResult = result;
  cachedMonthKey = monthKey;
  cacheTimestamp = Date.now();
  return result;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'overview';
    const month = searchParams.get('month') || undefined;
    const data = await computeCrossSellData(month);

    switch (action) {
      case 'overview':
        return NextResponse.json({
          success: true,
          data: {
            generatedAt: data.generatedAt,
            totalSegments: data.totalSegments,
            totalPotentialRevenue: data.totalPotentialRevenue,
            segments: data.segments.map(s => ({
              segment: s.segment,
              totalClients: s.totalClients,
              totalRevenue: s.totalRevenue,
              apisInSegment: s.segmentAPIs.length,
              totalPotentialRevenue: s.totalPotentialRevenue,
              avgAdoptionScore: s.avgAdoptionScore,
              topAPIs: s.segmentAPIs.slice(0, 5).map(a => ({
                name: a.name,
                adoptionRate: a.adoptionRate,
                clientsUsing: a.clientsUsing,
              })),
            })),
          },
        });

      case 'segment': {
        const segName = searchParams.get('segment');
        if (!segName) {
          return NextResponse.json({ success: false, error: 'segment param required' }, { status: 400 });
        }
        const segment = data.segments.find(s => s.segment === segName);
        if (!segment) {
          return NextResponse.json({ success: false, error: `Segment "${segName}" not found` }, { status: 404 });
        }
        return NextResponse.json({ success: true, data: segment });
      }

      case 'all':
        return NextResponse.json({ success: true, data });

      case 'client-meta': {
        const matrixData = await loadMatrixData(month);
        const meta = matrixData.clients.map(c => ({
          name: c.client_name,
          clientId: c.client_id,
          segment: c.profile.segment || '',
          geography: c.profile.geography || '',
          mrrBucket: '',
          kam: c.profile.account_owner || '',
          category: c.profile.industry || '',
        }));
        return NextResponse.json({ success: true, data: meta });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('Segment Intelligence API error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
