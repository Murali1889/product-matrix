/**
 * Company Research API
 * Real-time company intelligence using Google Search
 */

import { NextResponse } from 'next/server';
import {
  searchCompanyInfo,
  quickSearch,
  getQuotaStatus,
  getMockSearchResult,
} from '@/lib/google-search';
import { decideAndFetch, getDecisionSummary, startSession } from '@/lib/decision-engine';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, companyName, companies } = body;

    switch (action) {
      // Full company research
      case 'research': {
        if (!companyName) {
          return NextResponse.json(
            { success: false, error: 'Company name required' },
            { status: 400 }
          );
        }

        // Check if Google Search is configured
        const hasGoogleConfig = process.env.GOOGLE_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID;

        if (!hasGoogleConfig) {
          // Return mock data with a warning
          return NextResponse.json({
            success: true,
            data: getMockSearchResult(companyName),
            warning: 'Google Search API not configured. Add GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID to .env.local',
          });
        }

        const result = await searchCompanyInfo(companyName);

        return NextResponse.json({
          success: true,
          data: result,
        });
      }

      // Quick search - single query
      case 'quick': {
        if (!companyName) {
          return NextResponse.json(
            { success: false, error: 'Company name required' },
            { status: 400 }
          );
        }

        const hasGoogleConfig = process.env.GOOGLE_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID;

        if (!hasGoogleConfig) {
          return NextResponse.json({
            success: true,
            data: [],
            warning: 'Google Search API not configured',
          });
        }

        const results = await quickSearch(companyName);

        return NextResponse.json({
          success: true,
          data: results,
        });
      }

      // Get quota status
      case 'quota': {
        const quota = await getQuotaStatus();

        return NextResponse.json({
          success: true,
          data: quota,
        });
      }

      // Smart decide - uses decision engine to pick best data source
      case 'smart': {
        if (!companyName) {
          return NextResponse.json(
            { success: false, error: 'Company name required' },
            { status: 400 }
          );
        }

        // Ensure session is started
        startSession();

        const result = await decideAndFetch(companyName, {
          needsRecommendations: true,
          needsSimilar: true,
        });

        const summary = getDecisionSummary();

        return NextResponse.json({
          success: true,
          data: result,
          meta: {
            source: result.source,
            confidence: result.confidence,
            timeTaken: result.timeTaken,
            aiUsed: result.aiUsed,
            searchUsed: result.searchUsed,
            sessionSummary: summary,
          },
        });
      }

      // Batch smart lookup
      case 'batch-smart': {
        if (!companies || !Array.isArray(companies)) {
          return NextResponse.json(
            { success: false, error: 'Companies array required' },
            { status: 400 }
          );
        }

        startSession();

        const results: Record<string, unknown> = {};

        // Process sequentially to manage rate limits
        for (const company of companies.slice(0, 10)) {
          try {
            const result = await decideAndFetch(company, {
              needsRecommendations: true,
              needsSimilar: false, // Skip similar for batch to save time
            });
            results[company] = result;
          } catch {
            results[company] = { error: 'Failed to analyze' };
          }
        }

        const summary = getDecisionSummary();

        return NextResponse.json({
          success: true,
          data: results,
          meta: {
            totalCompanies: Object.keys(results).length,
            sessionSummary: summary,
          },
        });
      }

      // Get decision engine stats
      case 'stats': {
        const summary = getDecisionSummary();

        return NextResponse.json({
          success: true,
          data: summary,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Company Research API error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// GET for quick checks
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company');
  const action = searchParams.get('action') || 'smart';

  if (!company && action !== 'quota' && action !== 'stats') {
    return NextResponse.json(
      { success: false, error: 'Company parameter required' },
      { status: 400 }
    );
  }

  // Delegate to POST handler
  return POST(new Request(request.url, {
    method: 'POST',
    body: JSON.stringify({ action, companyName: company }),
    headers: { 'Content-Type': 'application/json' },
  }));
}
