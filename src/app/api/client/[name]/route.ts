import { NextResponse } from 'next/server';
import { getClientByName } from '@/lib/client-data-loader';

/**
 * Client Detail API
 * SINGLE SOURCE OF TRUTH: complete_client_data_1770268082596.json
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const clientName = decodeURIComponent(name);

    const client = await getClientByName(clientName);

    if (client) {
      // Return in the expected format
      return NextResponse.json({
        client_name: client.client_name,
        profile: client.profile,
        account_ids: {
          zoho_id: '',
          client_ids: [client.client_id],
          metabase_ids: [],
        },
        monthly_data: client.monthly_data.map(m => ({
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
          total_months: client.monthly_data.length,
          date_range: client.monthly_data.length > 0
            ? `${client.monthly_data[client.monthly_data.length - 1]?.month} - ${client.monthly_data[0]?.month}`
            : '',
          total_revenue_usd: client.totalRevenue,
          main_apis: Object.keys(client.apiRevenues).slice(0, 5),
        },
      });
    } else {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load client data' },
      { status: 500 }
    );
  }
}
