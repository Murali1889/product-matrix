import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadMatrixData, getDataSummary } from '@/lib/client-data-loader';
import type { AnalyticsResponse } from '@/types/client';

// Server-side Supabase client for fetching overrides
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SECRET_KEY || ''
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
  billable_filter?: Record<string, { codes?: string[]; discount?: number; kibana_exclude?: string[]; [key: string]: unknown }>;
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

// Total revenue overrides use client_api_overrides with api_name = '__total_revenue__'
const TOTAL_REVENUE_KEY = '__total_revenue__';

/**
 * Analytics API Route
 *
 * DATA SOURCE: Google Sheets API (via client-data-loader)
 * ENRICHED WITH: Supabase overrides (client_overrides, client_api_overrides, monthly_revenue_overrides)
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 200)
 * - all: If "true", returns all data (for Matrix view)
 * - months: Comma-separated YYYY-MM months (default: current month)
 */

// Cache for processed data (5 minutes), keyed by months
const responseCache = new Map<string, { data: AnalyticsResponse; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const returnAll = searchParams.get('all') === 'true';
    const month = searchParams.get('month') || undefined;
    const historyMonths = Math.max(1, Math.min(parseInt(searchParams.get('history') || '1', 10) || 1, 24));
    const cacheKey = `${month || 'default'}_${historyMonths}`;

    // Check cache
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('[Analytics] Cache hit');

      if (returnAll) {
        return NextResponse.json(cached.data, {
          headers: { 'Cache-Control': 'public, max-age=300' },
        });
      }

      const startIndex = (page - 1) * limit;
      const paginatedClients = cached.data.clients.slice(startIndex, startIndex + limit);

      return NextResponse.json({
        ...cached.data,
        clients: paginatedClients,
        pagination: {
          page,
          limit,
          total: cached.data.count,
          totalPages: Math.ceil(cached.data.count / limit),
          hasMore: startIndex + limit < cached.data.count,
        },
      }, {
        headers: { 'Cache-Control': 'public, max-age=300' },
      });
    }

    // Load base data from Google Sheets API
    const matrixData = await loadMatrixData(month, { historyMonths });

    // Fetch overrides from Supabase (parallel)
    let clientOverrides: ClientOverride[] = [];
    let apiCostOverrides: ApiCostOverride[] = [];

    // Also fetch from clients table for segment data
    let clientsTableSegments = new Map<string, { segment?: string; geography?: string }>();

    try {
      const [clientRes, apiRes, clientsRes] = await Promise.all([
        supabase.from('client_overrides').select('*'),
        supabase.from('client_api_overrides').select('*'),
        supabase.from('clients').select('client_name, segment, geography'),
      ]);

      clientOverrides = clientRes.data || [];
      apiCostOverrides = apiRes.data || [];

      // Build clients table lookup by name (lowercase) AND original case
      (clientsRes.data || []).forEach((c: { client_name: string; segment?: string; geography?: string }) => {
        if (c.client_name) {
          clientsTableSegments.set(c.client_name.toLowerCase(), c);
          clientsTableSegments.set(c.client_name, c);
        }
      });

      console.log(`[Analytics] Overrides: ${clientOverrides.length} client_overrides, ${apiCostOverrides.length} API, ${clientsTableSegments.size} clients table entries`);
    } catch (dbError) {
      console.warn('[Analytics] Could not fetch overrides (tables may not exist):', dbError);
    }

    // Build lookup maps
    const clientOverrideMap = new Map<string, ClientOverride>();
    clientOverrides.forEach(o => clientOverrideMap.set(o.client_id, o));

    // Separate API overrides from total revenue overrides
    const apiOverrideMap = new Map<string, ApiCostOverride>();
    const revenueOverrideMap = new Map<string, ApiCostOverride>();
    apiCostOverrides.forEach(o => {
      if (o.api_name === TOTAL_REVENUE_KEY) {
        revenueOverrideMap.set(`${o.client_id}|${o.month}`, o);
      } else {
        apiOverrideMap.set(`${o.client_id}|${o.api_name}|${o.month}`, o);
      }
    });

    // Apply overrides
    // Priority: client_overrides (by client_id) > clients table (by name) > inferSegment()
    matrixData.clients.forEach(client => {
      // Priority 1: client_overrides table
      const override = clientOverrideMap.get(client.client_id);
      if (override) {
        if (override.industry) client.profile.industry = override.industry;
        if (override.segment) client.profile.segment = override.segment;
        if (override.geography) client.profile.geography = override.geography;
        if (override.legal_name) client.profile.legal_name = override.legal_name;
        if (override.billing_currency) client.profile.billing_currency = override.billing_currency;
      }

      // Priority 2: clients table segment (only if client_overrides didn't set segment)
      if (!override?.segment) {
        const ct = clientsTableSegments.get(client.client_name.toLowerCase())
          || clientsTableSegments.get(client.client_name)
          || clientsTableSegments.get(client.client_id);
        if (ct?.segment) client.profile.segment = ct.segment;
        if (ct?.geography && (!client.profile.geography || client.profile.geography === 'Unknown')) {
          client.profile.geography = ct.geography;
        }
      }

      // API cost overrides + Revenue overrides
      client.monthly_data.forEach(monthData => {
        // Per-API overrides
        monthData.apis.forEach(api => {
          const apiKey = `${client.client_id}|${api.name}|${monthData.month}`;
          const apiOverride = apiOverrideMap.get(apiKey);
          if (apiOverride && apiOverride.cost_override !== undefined) {
            api.revenue_usd = apiOverride.cost_override;
            if (apiOverride.usage_override !== undefined) {
              api.usage = apiOverride.usage_override;
            }
          }
        });

        // Monthly total revenue override (uses client_api_overrides with api_name='__total_revenue__')
        const revKey = `${client.client_id}|${monthData.month}`;
        const revOverride = revenueOverrideMap.get(revKey);
        if (revOverride && revOverride.cost_override !== undefined) {
          const apiSum = monthData.apis.reduce((sum, api) => sum + api.revenue_usd, 0);
          const overrideTotal = revOverride.cost_override;
          const diff = overrideTotal - apiSum;

          // Add unattributed revenue if override > API sum
          if (diff > 0.01) {
            monthData.apis.push({
              name: 'Unattributed Revenue',
              moduleName: 'Unattributed Revenue',
              subModule: '',
              revenue_usd: diff,
              usage: 0,
              success: 0,
              currency: client.profile.billing_currency || 'INR',
              prodTotal: 0,
              prodBillable: 0,
              prodCostINR: 0,
              prodCostUSD: 0,
              stagingTotal: 0,
              stagingBillable: 0,
              stagingCostINR: 0,
              stagingCostUSD: 0,
            });
          }

          monthData.total_revenue_usd = overrideTotal;
        }
      });

      // Recalculate aggregates
      client.totalRevenue = client.monthly_data.reduce((sum, m) => sum + m.total_revenue_usd, 0);
      const latestMonth = client.monthly_data[0];
      if (latestMonth) {
        client.latestRevenue = latestMonth.total_revenue_usd;
      }

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

    // Transform to ClientData format
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
        account_owner: c.profile.account_owner,
        client_type: c.profile.client_type,
        billing_type: c.profile.billing_type,
        domain_list: c.profile.domain_list,
        go_live_date: c.profile.go_live_date,
        billing_start_month: c.profile.billing_start_month,
        zoho_name: c.profile.zoho_name,
        business_units: c.profile.business_units,
        industry: c.profile.industry,
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
      isInMasterList: c.isInMasterList,
      hasJan2026Data: c.hasJan2026Data,
      isActive: c.isActive,
    }));

    const response: AnalyticsResponse & { availableMonths?: string[] } = {
      clients,
      count: matrixData.clients.length,
      summary: {
        total_revenue: totalRevenue,
        segments,
        avg_months: avgMonths,
      },
      availableMonths: matrixData.availableMonths,
    };

    // Cache
    responseCache.set(cacheKey, { data: response, timestamp: Date.now() });
    console.log(`[Analytics] Cached ${response.count} clients (months: ${cacheKey})`);

    if (returnAll) {
      return NextResponse.json(response, {
        headers: { 'Cache-Control': 'public, max-age=300' },
      });
    }

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
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (error) {
    console.error('Analytics API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load analytics' },
      { status: 500 }
    );
  }
}
