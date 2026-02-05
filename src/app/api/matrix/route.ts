import { NextRequest, NextResponse } from 'next/server';
import { loadMatrixData, loadMasterAPIs, getDataSummary } from '@/lib/client-data-loader';

/**
 * Matrix API Route
 *
 * GET: Load client data from local file (complete_client_data.json)
 * POST: Save edits (future: to Supabase when enabled)
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

// POST - Update a cell value (for future Supabase integration)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clientId, clientName, month, value, field = 'total_revenue_usd' } = body;

    if (!clientName || !month) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // For now, just acknowledge the edit request
    // TODO: Implement Supabase write when enabled
    console.log(`[Matrix API] Edit request: ${clientName} / ${month} / ${field} = ${value}`);

    return NextResponse.json({
      success: true,
      message: 'Edit recorded (local file is read-only, enable Supabase for persistence)',
      data: { clientName, month, field, value }
    });
  } catch (error) {
    console.error('Matrix API update error:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
