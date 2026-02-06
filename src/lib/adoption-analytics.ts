/**
 * Adoption Analytics Engine
 * Computes segment-level API adoption rates and identifies cross-sell opportunities
 */

export interface APIAdoptionInfo {
  clientCount: number;
  adoptionRate: number; // 0-1
  totalRevenue: number;
  avgRevenuePerClient: number;
  clients: string[]; // client names using this API
}

export interface SegmentAdoption {
  segment: string;
  totalClients: number;
  apiAdoption: Record<string, APIAdoptionInfo>;
}

export interface CrossSellOpportunity {
  clientName: string;
  apiName: string;
  segmentAdoptionRate: number;
  segmentClientsUsing: number;
  segmentTotalClients: number;
  estimatedRevenue: number;
  priority: 'high' | 'medium' | 'low';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClientLike = any;

/**
 * Compute API adoption rates per segment
 */
export function computeSegmentAdoption(
  clients: ClientLike[],
  masterAPIs: string[]
): Record<string, SegmentAdoption> {
  const segments: Record<string, SegmentAdoption> = {};

  // Group clients by segment
  const clientsBySegment: Record<string, ClientLike[]> = {};
  clients.forEach(c => {
    const seg = c.profile?.segment || 'Unknown';
    if (!clientsBySegment[seg]) clientsBySegment[seg] = [];
    clientsBySegment[seg].push(c);
  });

  // For each segment, compute adoption for each API
  Object.entries(clientsBySegment).forEach(([segment, segClients]) => {
    const apiAdoption: Record<string, APIAdoptionInfo> = {};

    masterAPIs.forEach(api => {
      const usingClients: string[] = [];
      let totalRevenue = 0;

      segClients.forEach((c: ClientLike) => {
        // Check latest month data for API usage
        const latestMonth = c.monthly_data?.[0];
        const apiData = latestMonth?.apis?.find((a: { name: string; revenue_usd: number }) => a.name === api);
        const revenue = apiData?.revenue_usd || c.apiRevenues?.[api] || 0;

        if (revenue > 0) {
          usingClients.push(c.client_name);
          totalRevenue += revenue;
        }
      });

      if (usingClients.length > 0) {
        apiAdoption[api] = {
          clientCount: usingClients.length,
          adoptionRate: usingClients.length / segClients.length,
          totalRevenue,
          avgRevenuePerClient: totalRevenue / usingClients.length,
          clients: usingClients,
        };
      }
    });

    segments[segment] = {
      segment,
      totalClients: segClients.length,
      apiAdoption,
    };
  });

  return segments;
}

/**
 * Find cross-sell opportunities for a specific segment
 * Returns cells where the client doesn't use an API that's popular in their segment
 */
export function findCrossSellOpportunities(
  clients: ClientLike[],
  segmentAdoption: Record<string, SegmentAdoption>,
  selectedSegment: string,
  threshold: number = 0.4 // Minimum adoption rate to flag as opportunity
): CrossSellOpportunity[] {
  const adoption = segmentAdoption[selectedSegment];
  if (!adoption) return [];

  const opportunities: CrossSellOpportunity[] = [];

  // Get clients in this segment
  const segmentClients = clients.filter(
    c => (c.profile?.segment || 'Unknown') === selectedSegment
  );

  segmentClients.forEach((client: ClientLike) => {
    Object.entries(adoption.apiAdoption).forEach(([apiName, info]) => {
      // Only flag if adoption rate is above threshold
      if (info.adoptionRate < threshold) return;

      // Check if this client is NOT using this API
      const latestMonth = client.monthly_data?.[0];
      const apiData = latestMonth?.apis?.find((a: { name: string; revenue_usd: number }) => a.name === apiName);
      const revenue = apiData?.revenue_usd || client.apiRevenues?.[apiName] || 0;

      if (revenue === 0) {
        // This is a cross-sell opportunity
        const priority: 'high' | 'medium' | 'low' =
          info.adoptionRate >= 0.7 ? 'high' :
          info.adoptionRate >= 0.5 ? 'medium' : 'low';

        opportunities.push({
          clientName: client.client_name,
          apiName,
          segmentAdoptionRate: info.adoptionRate,
          segmentClientsUsing: info.clientCount,
          segmentTotalClients: adoption.totalClients,
          estimatedRevenue: info.avgRevenuePerClient,
          priority,
        });
      }
    });
  });

  // Sort: high priority first, then by adoption rate descending
  return opportunities.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.segmentAdoptionRate - a.segmentAdoptionRate;
  });
}

/**
 * Build a quick lookup set for cross-sell opportunities
 * Key format: "clientName::apiName"
 */
export function buildCrossSellLookup(
  opportunities: CrossSellOpportunity[]
): Map<string, CrossSellOpportunity> {
  const map = new Map<string, CrossSellOpportunity>();
  opportunities.forEach(opp => {
    map.set(`${opp.clientName}::${opp.apiName}`, opp);
  });
  return map;
}
