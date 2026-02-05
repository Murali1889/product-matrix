import { NextResponse } from 'next/server';
import {
  searchByName,
  searchBySegment,
  searchByAPI,
  searchByGeography,
  advancedSearch,
  getClientByName,
  getAllSegments,
  getAllAPIs,
  getSearchStats
} from '@/lib/client-search';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'search';
    const query = searchParams.get('q') || searchParams.get('query') || '';
    const segment = searchParams.get('segment');
    const geography = searchParams.get('geography');
    const api = searchParams.get('api');
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    switch (action) {
      case 'search': {
        if (!query) {
          return NextResponse.json(
            { success: false, error: 'Query required' },
            { status: 400 }
          );
        }

        const results = await searchByName(query, limit);
        return NextResponse.json({
          success: true,
          data: {
            query,
            count: results.length,
            results: results.map(r => ({
              client_name: r.client.client_name,
              legal_name: r.client.legal_name,
              segment: r.client.segment,
              geography: r.client.geography,
              total_revenue: r.client.total_revenue,
              monthly_avg: r.client.monthly_avg,
              months_active: r.client.months_active,
              apis_count: r.client.apis_used.length,
              top_apis: r.client.top_apis.slice(0, 5),
              match_score: Math.round((1 - r.score) * 100), // Higher = better match
              matches: r.matches
            }))
          }
        });
      }

      case 'exact': {
        if (!query) {
          return NextResponse.json(
            { success: false, error: 'Query required' },
            { status: 400 }
          );
        }

        const client = await getClientByName(query);
        if (!client) {
          return NextResponse.json({
            success: true,
            data: { found: false, query }
          });
        }

        return NextResponse.json({
          success: true,
          data: {
            found: true,
            client: {
              client_name: client.client_name,
              legal_name: client.legal_name,
              segment: client.segment,
              geography: client.geography,
              payment_model: client.payment_model,
              total_revenue: client.total_revenue,
              monthly_avg: client.monthly_avg,
              months_active: client.months_active,
              apis_used: client.apis_used,
              top_apis: client.top_apis,
              zoho_id: client.zoho_id
            }
          }
        });
      }

      case 'segment': {
        if (!segment) {
          // Return all segments
          const segments = await getAllSegments();
          return NextResponse.json({
            success: true,
            data: segments
          });
        }

        const clients = await searchBySegment(segment);
        return NextResponse.json({
          success: true,
          data: {
            segment,
            count: clients.length,
            clients: clients.slice(0, limit).map(c => ({
              client_name: c.client_name,
              total_revenue: c.total_revenue,
              monthly_avg: c.monthly_avg,
              apis_count: c.apis_used.length
            }))
          }
        });
      }

      case 'geography': {
        if (!geography) {
          return NextResponse.json(
            { success: false, error: 'Geography required' },
            { status: 400 }
          );
        }

        const clients = await searchByGeography(geography);
        return NextResponse.json({
          success: true,
          data: {
            geography,
            count: clients.length,
            clients: clients.slice(0, limit).map(c => ({
              client_name: c.client_name,
              segment: c.segment,
              total_revenue: c.total_revenue
            }))
          }
        });
      }

      case 'api': {
        if (!api) {
          // Return all APIs
          const apis = await getAllAPIs();
          return NextResponse.json({
            success: true,
            data: apis.slice(0, 50)
          });
        }

        const clients = await searchByAPI(api);
        return NextResponse.json({
          success: true,
          data: {
            api,
            count: clients.length,
            clients: clients.slice(0, limit).map(c => ({
              client_name: c.client_name,
              segment: c.segment,
              total_revenue: c.total_revenue,
              api_revenue: c.top_apis.find(a =>
                a.name.toLowerCase().includes(api.toLowerCase())
              )?.revenue || 0
            }))
          }
        });
      }

      case 'stats': {
        const stats = await getSearchStats();
        return NextResponse.json({
          success: true,
          data: stats
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Search API error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// Advanced search via POST
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query, segment, geography, api, minRevenue, maxRevenue, limit = 50 } = body;

    const results = await advancedSearch({
      query,
      segment,
      geography,
      api,
      minRevenue,
      maxRevenue
    }, limit);

    return NextResponse.json({
      success: true,
      data: {
        count: results.length,
        filters: { query, segment, geography, api, minRevenue, maxRevenue },
        results: results.map(c => ({
          client_name: c.client_name,
          legal_name: c.legal_name,
          segment: c.segment,
          geography: c.geography,
          total_revenue: c.total_revenue,
          monthly_avg: c.monthly_avg,
          months_active: c.months_active,
          apis_count: c.apis_used.length,
          top_apis: c.top_apis.slice(0, 5)
        }))
      }
    });
  } catch (error) {
    console.error('Search POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
