import { NextRequest, NextResponse } from 'next/server';
import { loadMatrixData, loadMasterAPIs, getDataSummary } from '@/lib/client-data-loader';
import { requireServerSupabaseClient } from '@/lib/supabase-server';

/**
 * Matrix API Route
 *
 * GET: Load client data from local file (complete_client_data.json)
 * POST: Save revenue edits to Supabase (client_api_overrides)
 *
 * SINGLE SOURCE OF TRUTH: complete_client_data_1770268082596.json
 */

// GET - Fetch matrix data from local file
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view'); // 'matrix' | 'summary' | 'apis'

    // Return summary stats
    if (view === 'summary') {
      const summary = await getDataSummary();
      return NextResponse.json(summary);
    }

    // Return master APIs list
    if (view === 'apis') {
      const apis = await loadMasterAPIs();
      return NextResponse.json({ apis, count: apis.length });
    }

    // Default: Return full matrix data
    const matrixData = await loadMatrixData();

    // Transform to expected format for the dashboard
    const response = {
      clients: matrixData.clients.map(c => ({
        client_name: c.client_name,
        client_id: c.client_id,
        profile: c.profile,
        monthly_data: c.monthly_data,
        // Add computed fields expected by MatrixView
        totalRevenue: c.totalRevenue,
        months: c.monthly_data.length,
        avgMonthly: c.monthly_data.length > 0
          ? c.totalRevenue / c.monthly_data.length
          : 0,
        latestRevenue: c.latestRevenue,
        latestMonth: c.latestMonth,
        apiRevenues: c.apiRevenues,
      })),
      apis: matrixData.apis,
      months: matrixData.months,
      count: matrixData.totalClients,
      extractedAt: matrixData.extractedAt,
      source: 'local_file',
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Matrix API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch matrix data', details: String(error) },
      { status: 500 }
    );
  }
}

// POST - Save revenue edit to Supabase
export async function POST(request: NextRequest) {
  try {
    const supabase = await requireServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Support batch saves (array of edits) or single edit
    const edits = body.edits || [body];

    const results = [];
    for (const edit of edits) {
      const { clientName, clientId, api, month, value, field = 'total_revenue_usd' } = edit;

      if (!clientName || !(api || month)) {
        results.push({ clientName, success: false, error: 'Missing required fields' });
        continue;
      }

      const apiName = api || month; // 'api' from cell edit, 'month' from pending edits

      const { data, error } = await supabase
        .from('client_api_overrides')
        .upsert(
          {
            client_id: clientId || clientName,
            client_name: clientName,
            api_name: apiName,
            month: month || apiName,
            cost_override: value || 0,
            notes: `${field} edit by ${user.email}`,
            updated_by: user.email || 'unknown',
          },
          { onConflict: 'client_id,api_name,month' }
        )
        .select()
        .single();

      if (error) {
        console.error(`[Matrix API] Save failed for ${clientName}/${apiName}:`, error);
        results.push({ clientName, apiName, success: false, error: error.message });
      } else {
        results.push({ clientName, apiName, success: true, id: data.id });
      }
    }

    const allSuccess = results.every(r => r.success);

    return NextResponse.json({
      success: allSuccess,
      results,
      saved: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    });
  } catch (error) {
    console.error('Matrix API update error:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
