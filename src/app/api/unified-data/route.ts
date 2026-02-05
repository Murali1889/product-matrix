/**
 * Unified Data API
 * Single endpoint for all data queries - connects api.json, clients-api.csv, clients.json
 */

import { NextResponse } from 'next/server';
import {
  loadAPICatalog,
  loadClientUsage,
  loadClientMaster,
  getUnifiedClientData,
  getAPIWithStats,
  getUnusedAPIsForClient,
  findSimilarClients,
  getAllClientsSummary,
  searchClientsByName,
  getAPICategories
} from '@/lib/unified-data-connector';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'summary';
    const clientName = searchParams.get('client') || searchParams.get('name');
    const query = searchParams.get('q') || searchParams.get('query');
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    switch (action) {
      // Get overall summary
      case 'summary': {
        const summary = await getAllClientsSummary();
        return NextResponse.json({
          success: true,
          data: summary
        });
      }

      // Get complete data for a specific client
      case 'client': {
        if (!clientName) {
          return NextResponse.json(
            { success: false, error: 'Client name required (?client=...)' },
            { status: 400 }
          );
        }

        const clientData = await getUnifiedClientData(clientName);
        if (!clientData) {
          return NextResponse.json({
            success: true,
            data: { found: false, searchedFor: clientName }
          });
        }

        return NextResponse.json({
          success: true,
          data: {
            found: true,
            client: clientData
          }
        });
      }

      // Search clients
      case 'search': {
        if (!query) {
          return NextResponse.json(
            { success: false, error: 'Query required (?q=...)' },
            { status: 400 }
          );
        }

        const results = await searchClientsByName(query, limit);
        return NextResponse.json({
          success: true,
          data: {
            query,
            count: results.length,
            results
          }
        });
      }

      // Get all APIs with usage stats
      case 'apis': {
        const apis = await getAPIWithStats();
        return NextResponse.json({
          success: true,
          data: {
            count: apis.length,
            apis: apis.slice(0, limit)
          }
        });
      }

      // Get APIs grouped by category
      case 'api-categories': {
        const categories = await getAPICategories();
        return NextResponse.json({
          success: true,
          data: categories
        });
      }

      // Get APIs not used by a client (for recommendations)
      case 'unused-apis': {
        if (!clientName) {
          return NextResponse.json(
            { success: false, error: 'Client name required (?client=...)' },
            { status: 400 }
          );
        }

        const unusedAPIs = await getUnusedAPIsForClient(clientName);
        return NextResponse.json({
          success: true,
          data: {
            client: clientName,
            count: unusedAPIs.length,
            apis: unusedAPIs.slice(0, limit)
          }
        });
      }

      // Find similar clients (collaborative filtering)
      case 'similar-clients': {
        if (!clientName) {
          return NextResponse.json(
            { success: false, error: 'Client name required (?client=...)' },
            { status: 400 }
          );
        }

        const similar = await findSimilarClients(clientName, limit);
        return NextResponse.json({
          success: true,
          data: {
            client: clientName,
            count: similar.length,
            similar
          }
        });
      }

      // Get raw API catalog
      case 'catalog': {
        const catalog = await loadAPICatalog();
        // catalog is now an array of APICatalogEntry
        const result: Record<string, any> = {};
        catalog.forEach(entry => {
          result[entry.moduleName] = entry;
        });
        return NextResponse.json({
          success: true,
          data: {
            moduleCount: catalog.length,
            catalog: result
          }
        });
      }

      // Get all clients with their API usage
      case 'all-clients': {
        const usage = await loadClientUsage();
        const clients = Array.from(usage.values())
          .sort((a, b) => b.totalRevenue - a.totalRevenue)
          .slice(0, limit);

        return NextResponse.json({
          success: true,
          data: {
            count: usage.size,
            clients
          }
        });
      }

      // Get client master list
      case 'client-master': {
        const master = await loadClientMaster();
        const clients = Array.from(master.values()).slice(0, limit);
        return NextResponse.json({
          success: true,
          data: {
            count: master.size,
            clients
          }
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Unified Data API error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST for complex queries
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, clients, limit = 50 } = body;

    switch (action) {
      // Summary - same as GET
      case 'summary': {
        const summary = await getAllClientsSummary();
        return NextResponse.json({
          success: true,
          data: summary
        });
      }

      // Batch get client data
      case 'batch-clients': {
        if (!clients || !Array.isArray(clients)) {
          return NextResponse.json(
            { success: false, error: 'clients array required' },
            { status: 400 }
          );
        }

        const results: Record<string, any> = {};
        for (const clientName of clients.slice(0, limit)) {
          const data = await getUnifiedClientData(clientName);
          results[clientName] = data || { found: false };
        }

        return NextResponse.json({
          success: true,
          data: results
        });
      }

      // Get recommendation data for a client
      case 'recommendation-data': {
        const { clientName } = body;
        if (!clientName) {
          return NextResponse.json(
            { success: false, error: 'clientName required' },
            { status: 400 }
          );
        }

        const [clientData, unusedAPIs, similarClients, apiCategories] = await Promise.all([
          getUnifiedClientData(clientName),
          getUnusedAPIsForClient(clientName),
          findSimilarClients(clientName, 5),
          getAPICategories()
        ]);

        // Group unused APIs by category for recommendations
        const categoryMap = new Map<string, any[]>();
        for (const api of unusedAPIs) {
          const cat = api.category || 'Other';
          const existing = categoryMap.get(cat) || [];
          existing.push(api);
          categoryMap.set(cat, existing);
        }

        // Get APIs used by similar clients but not by this client
        const recommendedFromSimilar: string[] = [];
        if (clientData) {
          const clientAPIs = new Set(clientData.apis.map(a => a.moduleName.toLowerCase()));
          for (const sim of similarClients) {
            for (const api of sim.client.apis) {
              if (!clientAPIs.has(api.moduleName.toLowerCase())) {
                if (!recommendedFromSimilar.includes(api.moduleName)) {
                  recommendedFromSimilar.push(api.moduleName);
                }
              }
            }
          }
        }

        return NextResponse.json({
          success: true,
          data: {
            client: clientData,
            isExistingClient: !!clientData,
            currentAPIs: clientData?.apis || [],
            totalUnusedAPIs: unusedAPIs.length,
            unusedAPIsByCategory: Object.fromEntries(categoryMap),
            similarClients: similarClients.map(s => ({
              name: s.client.name,
              similarity: Math.round(s.similarity * 100),
              sharedAPIs: s.sharedAPIs,
              additionalAPIs: s.client.apis
                .filter(a => !clientData?.apis.some(ca => ca.moduleName === a.moduleName))
                .map(a => a.moduleName)
            })),
            recommendedFromSimilarClients: recommendedFromSimilar.slice(0, 10),
            apiCategories
          }
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Unified Data POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
