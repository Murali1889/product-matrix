/**
 * Sales Intelligence API
 * The $100M Revenue Generator Endpoint
 */

import { NextResponse } from 'next/server';
import {
  getCompanyIntelligence,
  scoreProspects,
  findHighPotentialProspects
} from '@/lib/sales-intelligence-engine';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, companyName, companies, industry, count } = body;
    const apiKey = process.env.OPENAI_API_KEY;

    switch (action) {
      // Full intelligence report for a company
      case 'intelligence': {
        if (!companyName) {
          return NextResponse.json(
            { success: false, error: 'Company name required' },
            { status: 400 }
          );
        }

        const intelligence = await getCompanyIntelligence(companyName, apiKey);

        return NextResponse.json({
          success: true,
          data: intelligence
        });
      }

      // Score and rank multiple prospects
      case 'score-prospects': {
        if (!companies || !Array.isArray(companies)) {
          return NextResponse.json(
            { success: false, error: 'Companies array required' },
            { status: 400 }
          );
        }

        const scores = await scoreProspects(companies.slice(0, 20), apiKey);

        return NextResponse.json({
          success: true,
          data: {
            count: scores.length,
            prospects: scores
          }
        });
      }

      // Find high-potential prospects in an industry
      case 'find-prospects': {
        if (!industry) {
          return NextResponse.json(
            { success: false, error: 'Industry required' },
            { status: 400 }
          );
        }

        if (!apiKey) {
          return NextResponse.json(
            { success: false, error: 'OpenAI API key required for prospect finding' },
            { status: 500 }
          );
        }

        const prospects = await findHighPotentialProspects(
          industry,
          apiKey,
          count || 20
        );

        // Score the found prospects
        const scores = await scoreProspects(prospects.slice(0, 10), apiKey);

        return NextResponse.json({
          success: true,
          data: {
            industry,
            prospects: scores
          }
        });
      }

      // Quick check - is this company in our database?
      case 'quick-check': {
        if (!companyName) {
          return NextResponse.json(
            { success: false, error: 'Company name required' },
            { status: 400 }
          );
        }

        const intel = await getCompanyIntelligence(companyName, undefined);

        return NextResponse.json({
          success: true,
          data: {
            company: companyName,
            isExistingClient: intel.isExistingClient,
            currentRevenue: intel.currentData?.totalRevenue || 0,
            currentAPIs: intel.currentData?.apisUsed.length || 0,
            opportunityValue: intel.salesIntel.totalOpportunityValue.annual,
            topRecommendations: intel.recommendations.slice(0, 3).map(r => ({
              api: r.api,
              priority: r.priority,
              reason: r.reasoning
            })),
            dealPriority: intel.salesIntel.dealPriority
          }
        });
      }

      // Batch intelligence for multiple companies
      case 'batch-intelligence': {
        if (!companies || !Array.isArray(companies)) {
          return NextResponse.json(
            { success: false, error: 'Companies array required' },
            { status: 400 }
          );
        }

        const results: Record<string, any> = {};

        for (const company of companies.slice(0, 10)) {
          try {
            const intel = await getCompanyIntelligence(company, apiKey);
            results[company] = {
              isExisting: intel.isExistingClient,
              currentRevenue: intel.currentData?.totalRevenue || 0,
              opportunityValue: intel.salesIntel.totalOpportunityValue.annual,
              dealPriority: intel.salesIntel.dealPriority,
              topAPIs: intel.recommendations.slice(0, 3).map(r => r.api),
              pitch: intel.salesIntel.pitch
            };
          } catch {
            results[company] = { error: 'Failed to analyze' };
          }
        }

        return NextResponse.json({
          success: true,
          data: results
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Unknown action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Sales Intel API error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}
