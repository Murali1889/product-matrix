import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const DATA_PATH = path.join(process.cwd(), 'data', 'cross-sell-intelligence.json');
const CLIENTS_PATH = path.join(process.cwd(), 'data', 'clients.json');

// Cache the JSON file in memory (reload every 10 min)
let cachedData: CrossSellData | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000;

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

async function loadData(): Promise<CrossSellData> {
  const now = Date.now();
  if (cachedData && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedData;
  }

  const content = await fs.readFile(DATA_PATH, 'utf-8');
  cachedData = JSON.parse(content);
  cacheTimestamp = Date.now();
  return cachedData!;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'overview';
    const data = await loadData();

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
        // Return complete cross-sell data in a single response
        return NextResponse.json({ success: true, data });

      case 'client-meta': {
        // Return lightweight client metadata for filter enrichment
        try {
          const clientsContent = await fs.readFile(CLIENTS_PATH, 'utf-8');
          const clientsData = JSON.parse(clientsContent) as {
            clients: Array<{
              name: string;
              clientId: string;
              segment?: string;
              geography?: string;
              mrrBucket?: string;
              kam?: string;
              category?: string;
            }>;
          };
          const meta = clientsData.clients.map(c => ({
            name: c.name,
            clientId: c.clientId,
            segment: c.segment || '',
            geography: c.geography || '',
            mrrBucket: c.mrrBucket || '',
            kam: c.kam || '',
            category: c.category || '',
          }));
          return NextResponse.json({ success: true, data: meta });
        } catch (e) {
          console.error('Failed to load client meta:', e);
          return NextResponse.json({ success: false, error: 'Could not load client metadata' }, { status: 500 });
        }
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
