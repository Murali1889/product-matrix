import { NextResponse } from 'next/server';
import type { ClientData } from '@/types/client';
import { ProspectEngine } from '@/lib/prospect-engine';
import { loadMatrixData } from '@/lib/client-data-loader';

/**
 * Prospects API
 * SINGLE SOURCE OF TRUTH: complete_client_data_1770268082596.json
 */

let engineCache: { engine: ProspectEngine; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

async function loadClientData(): Promise<ClientData[]> {
  const matrixData = await loadMatrixData();

  // Convert TransformedClient to ClientData format
  return matrixData.clients.map(c => ({
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
}

async function getEngine(): Promise<ProspectEngine> {
  const now = Date.now();

  if (engineCache && (now - engineCache.timestamp) < CACHE_TTL) {
    return engineCache.engine;
  }

  const clients = await loadClientData();
  const engine = new ProspectEngine(clients);
  engineCache = { engine, timestamp: now };
  return engine;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'segments';
    const segment = searchParams.get('segment');

    const engine = await getEngine();

    switch (action) {
      case 'segments':
        return NextResponse.json({
          success: true,
          data: engine.getSegmentOptions()
        });

      case 'icp':
        if (!segment) {
          return NextResponse.json(
            { success: false, error: 'Segment required' },
            { status: 400 }
          );
        }
        return NextResponse.json({
          success: true,
          data: engine.getIdealCustomerProfile(segment)
        });

      case 'outreach':
        if (!segment) {
          return NextResponse.json(
            { success: false, error: 'Segment required' },
            { status: 400 }
          );
        }
        const geography = searchParams.get('geography') || 'India';
        return NextResponse.json({
          success: true,
          data: engine.generateOutreachPlan(segment, geography)
        });

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Prospects API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, companyName, segment, size, geography, description } = body;

    const engine = await getEngine();

    switch (action) {
      case 'analyze':
        // Auto-identify segment from description
        const identifiedSegment = description
          ? engine.identifySegment(description)
          : segment;

        if (!companyName || !identifiedSegment) {
          return NextResponse.json(
            { success: false, error: 'Company name and segment/description required' },
            { status: 400 }
          );
        }

        const prospect = engine.generateProspectRecommendations(
          companyName,
          identifiedSegment,
          size || 'medium',
          geography || 'India'
        );

        return NextResponse.json({
          success: true,
          data: prospect
        });

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Prospects POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
