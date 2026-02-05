import { NextResponse } from 'next/server';
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import type { ClientData } from '@/types/client';
import { AIRecommendationEngine } from '@/lib/ai-recommendation-engine';
import { getClientByName, searchByName, type SearchableClient } from '@/lib/client-search';

const CLIENTS_DIR = path.join(process.cwd(), '../extractor/output/clients');
const CACHE_DIR = path.join(process.cwd(), '../extractor/output/ai-cache');

// Normalize company name for cache key
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// Load all client data (for AI context)
async function loadAllClientData(): Promise<ClientData[]> {
  try {
    const files = await readdir(CLIENTS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const clients: ClientData[] = [];
    for (const file of jsonFiles) {
      try {
        const content = await readFile(path.join(CLIENTS_DIR, file), 'utf-8');
        const client = JSON.parse(content) as ClientData;
        if (client.client_name) {
          clients.push(client);
        }
      } catch {
        // Skip invalid files
      }
    }
    return clients;
  } catch {
    return [];
  }
}

// Find existing client using Fuse.js fuzzy search
async function findExistingClient(searchName: string): Promise<{ client: SearchableClient; matchScore: number } | null> {
  // First try exact match
  const exactMatch = await getClientByName(searchName);
  if (exactMatch) {
    return { client: exactMatch, matchScore: 100 };
  }

  // Fall back to fuzzy search
  const fuzzyResults = await searchByName(searchName, 1);
  if (fuzzyResults.length > 0 && fuzzyResults[0].score < 0.4) {
    // Good match (score is 0-1, lower is better)
    return {
      client: fuzzyResults[0].client,
      matchScore: Math.round((1 - fuzzyResults[0].score) * 100)
    };
  }

  return null;
}

// Extract current APIs from client data
function extractClientAPIs(client: ClientData): { name: string; revenue: number; subModule?: string }[] {
  const apiMap = new Map<string, { revenue: number; subModule?: string }>();

  client.monthly_data?.forEach(month => {
    month.apis?.forEach(api => {
      if (api.name) {
        const existing = apiMap.get(api.name);
        if (existing) {
          existing.revenue += api.revenue_usd || 0;
        } else {
          apiMap.set(api.name, {
            revenue: api.revenue_usd || 0,
            subModule: api.sub_module || undefined
          });
        }
      }
    });
  });

  return Array.from(apiMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.revenue - a.revenue);
}

// Get cached analysis
async function getCachedAnalysis(companyName: string): Promise<any | null> {
  try {
    const cacheFile = path.join(CACHE_DIR, `${normalizeCompanyName(companyName)}.json`);
    const content = await readFile(cacheFile, 'utf-8');
    const cached = JSON.parse(content);

    // Check if expired (7 days)
    const expiresAt = new Date(cached.expiresAt);
    if (expiresAt < new Date()) {
      return null;
    }

    return cached;
  } catch {
    return null;
  }
}

// Save analysis to cache
async function cacheAnalysis(companyName: string, analysis: any): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });

    const cacheFile = path.join(CACHE_DIR, `${normalizeCompanyName(companyName)}.json`);
    const cached = {
      ...analysis,
      cachedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
    };

    await writeFile(cacheFile, JSON.stringify(cached, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to cache analysis:', error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, companyName, companies, industry, geography, additionalContext, forceRefresh } = body;

    const apiKey = process.env.OPENAI_API_KEY;

    // Load all clients for checking and context
    const allClients = await loadAllClientData();

    switch (action) {
      case 'analyze': {
        if (!companyName) {
          return NextResponse.json(
            { success: false, error: 'Company name required' },
            { status: 400 }
          );
        }

        // Check cache first (unless force refresh)
        if (!forceRefresh) {
          const cached = await getCachedAnalysis(companyName);
          if (cached) {
            return NextResponse.json({
              success: true,
              data: cached,
              fromCache: true
            });
          }
        }

        // Check if this is an existing client using Fuse.js fuzzy search
        const searchResult = await findExistingClient(companyName);
        const existingClient = searchResult?.client;
        const matchScore = searchResult?.matchScore || 0;

        // Get current APIs and revenue from search result
        const currentAPIs = existingClient?.top_apis || [];
        const totalRevenue = existingClient?.total_revenue || 0;
        const monthCount = existingClient?.months_active || 0;

        // Build context for AI
        let clientContext = '';
        if (existingClient) {
          clientContext = `
IMPORTANT: This company is an EXISTING CLIENT named "${existingClient.client_name}" (Match confidence: ${matchScore}%).

Current Client Profile:
- Segment: ${existingClient.segment || 'Unknown'}
- Geography: ${existingClient.geography || 'Unknown'}
- Payment Model: ${existingClient.payment_model || 'Unknown'}
- Total Revenue: $${totalRevenue.toFixed(2)} over ${monthCount} months
- Monthly Average: $${existingClient.monthly_avg?.toFixed(2) || 0}

Current APIs They're Using (${existingClient.apis_used?.length || 0} total):
${currentAPIs.length > 0
  ? currentAPIs.map(a => `- ${a.name}: $${a.revenue.toFixed(2)} revenue`).join('\n')
  : '- No API usage data available'}

Your task: Recommend ADDITIONAL APIs they should be using based on their segment, current usage, and gaps. Focus on upsell and cross-sell opportunities.
`;
        }

        if (!apiKey) {
          // Return basic analysis without AI
          return NextResponse.json({
            success: true,
            data: {
              companyName,
              isExistingClient: !!existingClient,
              matchScore,
              clientData: existingClient ? {
                name: existingClient.client_name,
                segment: existingClient.segment,
                geography: existingClient.geography,
                paymentModel: existingClient.payment_model,
                totalRevenue,
                monthlyAverage: existingClient.monthly_avg,
                currentAPIs
              } : null,
              recommendations: [],
              message: 'OpenAI API key not configured. Showing existing client data only.'
            }
          });
        }

        // Use AI to analyze and recommend
        const engine = new AIRecommendationEngine(apiKey, allClients);
        const aiResult = await engine.analyzeCompany(
          companyName,
          `${additionalContext || ''}\n\n${clientContext}`
        );

        // Combine with existing client data
        const result = {
          companyName,
          isExistingClient: !!existingClient,
          matchScore,
          clientData: existingClient ? {
            name: existingClient.client_name,
            segment: existingClient.segment,
            geography: existingClient.geography,
            paymentModel: existingClient.payment_model,
            legalName: existingClient.legal_name,
            totalRevenue,
            monthlyAverage: existingClient.monthly_avg,
            activeMonths: monthCount,
            currentAPIs,
            apisCount: existingClient.apis_used?.length || 0
          } : null,
          analysis: aiResult.analysis,
          recommendations: aiResult.recommendations.filter(rec => {
            // Filter out APIs they already use (for existing clients)
            if (!existingClient) return true;
            return !currentAPIs.some(a =>
              normalizeCompanyName(a.name) === normalizeCompanyName(rec.api)
            );
          }),
          currentAPIs: existingClient ? currentAPIs : [],
          salesStrategy: aiResult.salesStrategy,
          outreachSuggestions: aiResult.outreachSuggestions,
          totalEstimatedValue: aiResult.totalEstimatedValue,
          upsellPotential: existingClient ? {
            currentMonthlySpend: existingClient.monthly_avg || 0,
            potentialAdditionalSpend: aiResult.totalEstimatedValue.monthly,
            growthOpportunity: ((aiResult.totalEstimatedValue.monthly / (existingClient.monthly_avg || 1)) * 100).toFixed(1) + '%'
          } : null
        };

        // Cache the result
        await cacheAnalysis(companyName, result);

        return NextResponse.json({
          success: true,
          data: result,
          fromCache: false
        });
      }

      case 'check-client': {
        // Quick check if company is existing client using fuzzy search
        if (!companyName) {
          return NextResponse.json(
            { success: false, error: 'Company name required' },
            { status: 400 }
          );
        }

        const checkResult = await findExistingClient(companyName);

        if (!checkResult) {
          return NextResponse.json({
            success: true,
            data: {
              isExistingClient: false,
              searchedName: companyName
            }
          });
        }

        const foundClient = checkResult.client;

        return NextResponse.json({
          success: true,
          data: {
            isExistingClient: true,
            matchScore: checkResult.matchScore,
            clientName: foundClient.client_name,
            segment: foundClient.segment,
            geography: foundClient.geography,
            totalRevenue: foundClient.total_revenue,
            monthlyAverage: foundClient.monthly_avg,
            currentAPIs: foundClient.top_apis.slice(0, 10),
            apisCount: foundClient.apis_used?.length || 0,
            monthsActive: foundClient.months_active
          }
        });
      }

      case 'batch': {
        if (!apiKey) {
          return NextResponse.json(
            { success: false, error: 'OpenAI API key not configured' },
            { status: 500 }
          );
        }

        if (!companies || !Array.isArray(companies)) {
          return NextResponse.json(
            { success: false, error: 'Companies array required' },
            { status: 400 }
          );
        }

        const engine = new AIRecommendationEngine(apiKey, allClients);
        const results = await engine.batchAnalyze(companies.slice(0, 10));

        return NextResponse.json({
          success: true,
          data: Object.fromEntries(results)
        });
      }

      case 'find-prospects': {
        if (!apiKey) {
          return NextResponse.json(
            { success: false, error: 'OpenAI API key not configured' },
            { status: 500 }
          );
        }

        if (!industry) {
          return NextResponse.json(
            { success: false, error: 'Industry required' },
            { status: 400 }
          );
        }

        const engine = new AIRecommendationEngine(apiKey, allClients);
        const prospects = await engine.findProspects(industry, geography || 'India', 10);

        return NextResponse.json({
          success: true,
          data: prospects
        });
      }

      case 'generate-outreach': {
        if (!apiKey) {
          return NextResponse.json(
            { success: false, error: 'OpenAI API key not configured' },
            { status: 500 }
          );
        }

        if (!body.analysis) {
          return NextResponse.json(
            { success: false, error: 'Analysis data required' },
            { status: 400 }
          );
        }

        const engine = new AIRecommendationEngine(apiKey, allClients);
        const outreach = await engine.generateOutreach(
          body.analysis,
          body.senderName || 'Sales Team',
          body.senderRole || 'Account Executive'
        );

        return NextResponse.json({
          success: true,
          data: outreach
        });
      }

      case 'list-clients': {
        // Return list of all clients for autocomplete
        const clientList = allClients.map(c => ({
          name: c.client_name,
          segment: c.profile?.segment,
          geography: c.profile?.geography
        })).sort((a, b) => a.name.localeCompare(b.name));

        return NextResponse.json({
          success: true,
          data: clientList
        });
      }

      case 'cached-analyses': {
        // Return all cached analyses
        try {
          const files = await readdir(CACHE_DIR);
          const analyses = [];

          for (const file of files) {
            if (file.endsWith('.json')) {
              try {
                const content = await readFile(path.join(CACHE_DIR, file), 'utf-8');
                const cached = JSON.parse(content);
                analyses.push({
                  companyName: cached.companyName,
                  isExistingClient: cached.isExistingClient,
                  cachedAt: cached.cachedAt,
                  totalPotential: cached.totalEstimatedValue?.annual || 0
                });
              } catch {
                // Skip invalid files
              }
            }
          }

          return NextResponse.json({
            success: true,
            data: analyses.sort((a, b) => b.totalPotential - a.totalPotential)
          });
        } catch {
          return NextResponse.json({
            success: true,
            data: []
          });
        }
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('AI Analyze API error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
