import { NextResponse } from 'next/server';
import { loadMatrixData, loadMasterAPIs } from '@/lib/client-data-loader';
import type { ClientData } from '@/types/client';
import { RecommendationEngine } from '@/lib/recommendation-engine';

/**
 * Recommendations API
 * SINGLE SOURCE OF TRUTH: complete_client_data_1770268082596.json
 */

// Cache the engine instance
let engineCache: { engine: RecommendationEngine; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getEngine(): Promise<RecommendationEngine> {
  const now = Date.now();

  if (engineCache && (now - engineCache.timestamp) < CACHE_TTL) {
    return engineCache.engine;
  }

  // Load from single source of truth
  const [matrixData, masterAPIsList] = await Promise.all([
    loadMatrixData(),
    loadMasterAPIs()
  ]);

  // Convert to ClientData format for the engine
  const clients: ClientData[] = matrixData.clients.map(c => ({
    client_name: c.client_name,
    profile: {
      legal_name: c.profile.legal_name,
      geography: c.profile.geography,
      segment: c.profile.segment,
      billing_entity: c.profile.billing_entity,
      payment_model: c.profile.payment_model,
      status: c.profile.status,
    },
    account_ids: {
      zoho_id: '',
      client_ids: [c.client_id],
      metabase_ids: [],
    },
    monthly_data: c.monthly_data.map(m => ({
      month: m.month,
      total_revenue_usd: m.total_revenue_usd,
      hv_api_revenue_usd: m.hv_api_revenue_usd,
      other_revenue_usd: m.other_revenue_usd,
      apis: m.apis.map(a => ({
        name: a.name,
        revenue_usd: a.revenue_usd,
        usage: a.usage,
      })),
    })),
    summary: {
      total_months: c.monthly_data.length,
      date_range: '',
      total_revenue_usd: c.totalRevenue,
      main_apis: Object.keys(c.apiRevenues).slice(0, 5),
    },
  }));

  const engine = new RecommendationEngine(
    clients,
    masterAPIsList.map(api => api.moduleName)
  );

  engineCache = { engine, timestamp: now };
  return engine;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'stats';
    const clientName = searchParams.get('client');
    const segment = searchParams.get('segment');

    const engine = await getEngine();

    switch (action) {
      case 'stats':
        return NextResponse.json({
          success: true,
          data: engine.getStats()
        });

      case 'client':
        if (!clientName) {
          return NextResponse.json(
            { success: false, error: 'Client name required' },
            { status: 400 }
          );
        }
        const recommendations = engine.getClientRecommendations(clientName);
        if (!recommendations) {
          return NextResponse.json(
            { success: false, error: 'Client not found' },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          data: recommendations
        });

      case 'similar':
        if (!clientName) {
          return NextResponse.json(
            { success: false, error: 'Client name required' },
            { status: 400 }
          );
        }
        const similar = engine.findSimilarCompanies(clientName, 20);
        return NextResponse.json({
          success: true,
          data: similar
        });

      case 'segments':
        return NextResponse.json({
          success: true,
          data: engine.getSegmentProfiles()
        });

      case 'segment':
        if (!segment) {
          return NextResponse.json(
            { success: false, error: 'Segment name required' },
            { status: 400 }
          );
        }
        const segmentRecs = engine.getSegmentRecommendations(segment);
        return NextResponse.json({
          success: true,
          data: segmentRecs
        });

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Recommendation API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
