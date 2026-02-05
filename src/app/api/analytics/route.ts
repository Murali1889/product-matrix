import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadMatrixData, getDataSummary } from '@/lib/client-data-loader';
import type { AnalyticsResponse } from '@/types/client';

// Server-side Supabase client for fetching overrides
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// Types for database overrides
interface ClientOverride {
  id: string;
  client_id: string;
  client_name: string;
  industry?: string;
  segment?: string;
  geography?: string;
  legal_name?: string;
  billing_currency?: string;
  notes?: string;
  updated_by?: string;
  updated_at?: string;
}

interface ApiCostOverride {
  id: string;
  client_id: string;
  client_name: string;
  api_name: string;
  month: string;
  cost_override?: number;
  usage_override?: number;
  notes?: string;
  updated_by?: string;
  updated_at?: string;
}

/**
 * Analytics API Route
 *
 * SINGLE SOURCE OF TRUTH: complete_client_data_1770268082596.json
 * ENRICHED WITH: Database overrides (client_overrides, client_api_overrides)
 *
 * Returns client data and summary stats for the dashboard
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 200)
 * - all: If "true", returns all data (for Matrix view)
 */

// Cache for processed data (5 minutes)
let cachedResponse: any = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const returnAll = searchParams.get('all') === 'true';

    // Check cache first
    const now = Date.now();
    if (cachedResponse && (now - cacheTimestamp) < CACHE_TTL) {
      console.log('[Analytics] Returning cached response');

      if (returnAll) {
        return NextResponse.json(cachedResponse, {
          headers: {
            'Cache-Control': 'public, max-age=300', // Browser cache 5 min
          },
        });
      }

      // Return paginated response
      const startIndex = (page - 1) * limit;
      const paginatedClients = cachedResponse.clients.slice(startIndex, startIndex + limit);

      return NextResponse.json({
        ...cachedResponse,
        clients: paginatedClients,
        pagination: {
          page,
          limit,
          total: cachedResponse.count,
          totalPages: Math.ceil(cachedResponse.count / limit),
          hasMore: startIndex + limit < cachedResponse.count,
        },
      }, {
        headers: {
          'Cache-Control': 'public, max-age=300',
        },
      });
    }
    // Load base data from JSON file
    const matrixData = await loadMatrixData();

    // Fetch overrides from database (parallel for performance)
    let clientOverrides: ClientOverride[] = [];
    let apiCostOverrides: ApiCostOverride[] = [];

    try {
      const [clientRes, apiRes] = await Promise.all([
        supabase.from('client_overrides').select('*'),
        supabase.from('client_api_overrides').select('*'),
      ]);

      clientOverrides = clientRes.data || [];
      apiCostOverrides = apiRes.data || [];

      console.log(`[Analytics] Loaded ${clientOverrides.length} client overrides, ${apiCostOverrides.length} API cost overrides from database`);
    } catch (dbError) {
      console.warn('[Analytics] Could not fetch database overrides (tables may not exist yet):', dbError);
    }

    // Create lookup maps for fast merging
    const clientOverrideMap = new Map<string, ClientOverride>();
    clientOverrides.forEach(o => clientOverrideMap.set(o.client_id, o));

    // Group API cost overrides by client_id + api_name + month
    const apiOverrideMap = new Map<string, ApiCostOverride>();
    apiCostOverrides.forEach(o => {
      const key = `${o.client_id}|${o.api_name}|${o.month}`;
      apiOverrideMap.set(key, o);
    });

    // Apply overrides to matrix data
    matrixData.clients.forEach(client => {
      const override = clientOverrideMap.get(client.client_id);
      if (override) {
        // Apply client-level overrides
        if (override.industry) client.profile.industry = override.industry;
        if (override.segment) client.profile.segment = override.segment;
        if (override.geography) client.profile.geography = override.geography;
        if (override.legal_name) client.profile.legal_name = override.legal_name;
        if (override.billing_currency) client.profile.billing_currency = override.billing_currency;
      }

      // Apply API cost overrides
      client.monthly_data.forEach(monthData => {
        monthData.apis.forEach(api => {
          const apiKey = `${client.client_id}|${api.name}|${monthData.month}`;
          const apiOverride = apiOverrideMap.get(apiKey);
          if (apiOverride && apiOverride.cost_override !== undefined) {
            api.revenue_usd = apiOverride.cost_override;
            // Update usage if provided
            if (apiOverride.usage_override !== undefined) {
              api.usage = apiOverride.usage_override;
            }
          }
        });
      });

      // Recalculate aggregates after applying overrides
      const totalRevenue = client.monthly_data.reduce((sum, m) =>
        sum + m.apis.reduce((apiSum, api) => apiSum + api.revenue_usd, 0), 0);
      client.totalRevenue = totalRevenue;

      const latestMonth = client.monthly_data[0];
      if (latestMonth) {
        client.latestRevenue = latestMonth.apis.reduce((sum, api) => sum + api.revenue_usd, 0);
      }

      // Recalculate API revenues
      client.apiRevenues = {};
      client.monthly_data.forEach(m => {
        m.apis.forEach(api => {
          client.apiRevenues[api.name] = (client.apiRevenues[api.name] || 0) + api.revenue_usd;
        });
      });
    });

    // Calculate summary stats
    const totalRevenue = matrixData.clients.reduce((sum, c) => sum + c.totalRevenue, 0);

    const segments: Record<string, number> = {};
    matrixData.clients.forEach(c => {
      const seg = c.profile?.segment || 'Unknown';
      segments[seg] = (segments[seg] || 0) + 1;
    });

    const totalMonths = matrixData.clients.reduce((s, c) => s + c.monthly_data.length, 0);
    const avgMonths = matrixData.clients.length > 0
      ? Math.round(totalMonths / matrixData.clients.length)
      : 0;

    // Transform to expected ClientData format
    const clients = matrixData.clients.map(c => ({
      client_name: c.client_name,
      client_id: c.client_id,
      profile: {
        legal_name: c.profile.legal_name,
        geography: c.profile.geography,
        segment: c.profile.segment,
        billing_entity: c.profile.billing_entity,
        billing_currency: c.profile.billing_currency,
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
        date_range: c.monthly_data.length > 0
          ? `${c.monthly_data[c.monthly_data.length - 1]?.month} - ${c.monthly_data[0]?.month}`
          : '',
        total_revenue_usd: c.totalRevenue,
        main_apis: Object.entries(c.apiRevenues)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name]) => name),
      },
      // Status flags
      isInMasterList: c.isInMasterList,
      hasJan2026Data: c.hasJan2026Data,
      isActive: c.isActive,
    }));

    const response: AnalyticsResponse = {
      clients,
      count: matrixData.clients.length,
      summary: {
        total_revenue: totalRevenue,
        segments,
        avg_months: avgMonths,
      },
    };

    // Cache the full response
    cachedResponse = response;
    cacheTimestamp = Date.now();
    console.log(`[Analytics] Cached ${response.count} clients`);

    // Return based on pagination params
    if (returnAll) {
      return NextResponse.json(response, {
        headers: {
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    // Return paginated response
    const startIndex = (page - 1) * limit;
    const paginatedClients = clients.slice(startIndex, startIndex + limit);

    return NextResponse.json({
      ...response,
      clients: paginatedClients,
      pagination: {
        page,
        limit,
        total: response.count,
        totalPages: Math.ceil(response.count / limit),
        hasMore: startIndex + limit < response.count,
      },
    }, {
      headers: {
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('Analytics API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load analytics' },
      { status: 500 }
    );
  }
}
