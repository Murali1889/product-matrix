/**
 * Decision Engine for AI/Database/Search Routing
 * Minimizes AI costs by using the right data source for each query
 *
 * Priority:
 * 1. Database (instant, free) - for existing clients
 * 2. Rule-based (instant, free) - for standard recommendations
 * 3. Google Search (fast, cheap) - for real-time company info
 * 4. AI (slower, expensive) - for complex analysis only
 */

import {
  getUnifiedClientData,
  findSimilarClients,
  getUnusedAPIsForClient,
  searchClientsByName,
  getAllClientsSummary,
  UnifiedClientData,
} from './unified-data-connector';
import { INDUSTRY_API_REQUIREMENTS } from './sales-intelligence-engine';

// ============================================================================
// Types
// ============================================================================

export type DataSource = 'database' | 'rules' | 'google' | 'ai' | 'combined';

export interface DecisionResult {
  source: DataSource;
  confidence: number; // 0-1
  reasoning: string;
  data: unknown;
  aiUsed: boolean;
  searchUsed: boolean;
  timeTaken: number;
}

export interface UsageStats {
  sessionId: string;
  startedAt: Date;
  databaseHits: number;
  ruleHits: number;
  googleSearches: number;
  aiCalls: number;
  totalQueries: number;
  estimatedCost: number; // in USD
}

// ============================================================================
// Usage Tracking
// ============================================================================

let currentSession: UsageStats | null = null;

const COST_ESTIMATES = {
  database: 0,
  rules: 0,
  google: 0.005, // $5 per 1000 queries
  ai: 0.01, // $0.01 per call (GPT-4o-mini average)
};

/**
 * Start a new tracking session
 */
export function startSession(): UsageStats {
  currentSession = {
    sessionId: `sess_${Date.now()}`,
    startedAt: new Date(),
    databaseHits: 0,
    ruleHits: 0,
    googleSearches: 0,
    aiCalls: 0,
    totalQueries: 0,
    estimatedCost: 0,
  };
  return currentSession;
}

/**
 * Get current session stats
 */
export function getSessionStats(): UsageStats | null {
  return currentSession;
}

/**
 * Track a query
 */
function trackQuery(source: DataSource): void {
  if (!currentSession) {
    startSession();
  }

  currentSession!.totalQueries++;

  switch (source) {
    case 'database':
      currentSession!.databaseHits++;
      break;
    case 'rules':
      currentSession!.ruleHits++;
      break;
    case 'google':
      currentSession!.googleSearches++;
      currentSession!.estimatedCost += COST_ESTIMATES.google;
      break;
    case 'ai':
      currentSession!.aiCalls++;
      currentSession!.estimatedCost += COST_ESTIMATES.ai;
      break;
    case 'combined':
      // Multiple sources used
      break;
  }
}

// ============================================================================
// Decision Logic
// ============================================================================

export interface QueryIntent {
  type:
    | 'company_lookup'
    | 'recommendations'
    | 'similar_companies'
    | 'pitch_generation'
    | 'competitor_analysis'
    | 'prospect_research'
    | 'batch_analysis';
  companyName?: string;
  industry?: string;
  requiresRealtime?: boolean;
  complexity: 'simple' | 'moderate' | 'complex';
}

/**
 * Analyze query to determine intent
 */
export function analyzeIntent(query: string, context?: Record<string, unknown>): QueryIntent {
  const q = query.toLowerCase();

  // Company lookup
  if (context?.companyName || q.includes('client') || q.includes('company info')) {
    return {
      type: 'company_lookup',
      companyName: context?.companyName as string,
      complexity: 'simple',
    };
  }

  // Recommendations
  if (q.includes('recommend') || q.includes('suggest') || q.includes('upsell')) {
    return {
      type: 'recommendations',
      companyName: context?.companyName as string,
      complexity: 'simple',
    };
  }

  // Similar companies
  if (q.includes('similar') || q.includes('like') || q.includes('competitors')) {
    return {
      type: 'similar_companies',
      companyName: context?.companyName as string,
      complexity: 'simple',
    };
  }

  // Pitch generation (requires AI)
  if (q.includes('pitch') || q.includes('talk track') || q.includes('script')) {
    return {
      type: 'pitch_generation',
      companyName: context?.companyName as string,
      complexity: 'complex',
    };
  }

  // Competitor analysis (may require search)
  if (q.includes('competitor') || q.includes('market') || q.includes('analysis')) {
    return {
      type: 'competitor_analysis',
      companyName: context?.companyName as string,
      industry: context?.industry as string,
      requiresRealtime: true,
      complexity: 'moderate',
    };
  }

  // Prospect research (requires external data)
  if (q.includes('prospect') || q.includes('research') || q.includes('find companies')) {
    return {
      type: 'prospect_research',
      industry: context?.industry as string,
      requiresRealtime: true,
      complexity: 'moderate',
    };
  }

  // Default to simple lookup
  return {
    type: 'company_lookup',
    complexity: 'simple',
  };
}

/**
 * Main decision function - routes query to appropriate data source
 */
export async function decideAndFetch(
  companyName: string,
  options: {
    needsRecommendations?: boolean;
    needsSimilar?: boolean;
    needsPitch?: boolean;
    needsRealtime?: boolean;
    forceAI?: boolean;
    forceSearch?: boolean;
  } = {}
): Promise<DecisionResult> {
  const startTime = Date.now();

  // Step 1: Always try database first
  const clientData = await getUnifiedClientData(companyName);
  const isExistingClient = clientData !== null;

  if (isExistingClient && !options.needsRealtime && !options.forceAI && !options.forceSearch) {
    // Existing client - use database + rules
    const result = await buildDatabaseResponse(clientData!, options);
    trackQuery('database');

    return {
      source: 'database',
      confidence: 0.95,
      reasoning: `Found ${companyName} in database with $${clientData!.totalRevenue.toLocaleString()} revenue`,
      data: result,
      aiUsed: false,
      searchUsed: false,
      timeTaken: Date.now() - startTime,
    };
  }

  // Step 2: For non-clients, check if we need external data
  if (!isExistingClient && (options.needsRealtime || options.forceSearch)) {
    // Would use Google Search here - but return placeholder for now
    trackQuery('google');

    return {
      source: 'google',
      confidence: 0.7,
      reasoning: `${companyName} not in database. Would search Google for company info.`,
      data: {
        company: companyName,
        isExistingClient: false,
        needsExternalResearch: true,
        placeholder: true,
      },
      aiUsed: false,
      searchUsed: true,
      timeTaken: Date.now() - startTime,
    };
  }

  // Step 3: For complex requests, use AI
  if (options.needsPitch || options.forceAI) {
    trackQuery('ai');

    return {
      source: 'ai',
      confidence: 0.85,
      reasoning: `Complex request for ${companyName} - using AI for pitch generation`,
      data: {
        company: companyName,
        isExistingClient,
        clientData: clientData || undefined,
        requiresAI: true,
      },
      aiUsed: true,
      searchUsed: false,
      timeTaken: Date.now() - startTime,
    };
  }

  // Step 4: For unknown companies without special requirements, use rules
  trackQuery('rules');

  return {
    source: 'rules',
    confidence: 0.6,
    reasoning: `${companyName} not in database. Using industry defaults.`,
    data: await buildRuleBasedResponse(companyName),
    aiUsed: false,
    searchUsed: false,
    timeTaken: Date.now() - startTime,
  };
}

// ============================================================================
// Response Builders
// ============================================================================

/**
 * Build response using database data
 */
async function buildDatabaseResponse(
  client: UnifiedClientData,
  options: {
    needsRecommendations?: boolean;
    needsSimilar?: boolean;
  }
): Promise<{
  client: UnifiedClientData;
  recommendations?: { api: string; priority: string; reason: string }[];
  similarClients?: { name: string; similarity: number; sharedAPIs: string[] }[];
}> {
  const result: {
    client: UnifiedClientData;
    recommendations?: { api: string; priority: string; reason: string }[];
    similarClients?: { name: string; similarity: number; sharedAPIs: string[] }[];
  } = { client };

  if (options.needsRecommendations !== false) {
    // Get unused APIs and generate recommendations
    const unusedAPIs = await getUnusedAPIsForClient(client.name);
    const clientAPIs = client.apis.map(a => a.moduleName.toLowerCase());

    // Prioritize based on what similar clients use
    const similar = await findSimilarClients(client.name, 5);
    const popularAmongSimilar = new Map<string, number>();

    for (const s of similar) {
      for (const api of s.client.apis) {
        if (!clientAPIs.includes(api.moduleName.toLowerCase())) {
          popularAmongSimilar.set(
            api.moduleName,
            (popularAmongSimilar.get(api.moduleName) || 0) + 1
          );
        }
      }
    }

    result.recommendations = unusedAPIs
      .slice(0, 10)
      .map(api => ({
        api: api.moduleName,
        priority: popularAmongSimilar.has(api.moduleName)
          ? 'high'
          : api.category?.includes('Verification') ? 'medium' : 'low',
        reason: popularAmongSimilar.has(api.moduleName)
          ? `${popularAmongSimilar.get(api.moduleName)} similar clients use this`
          : `Complements ${api.category || 'your'} stack`,
      }));
  }

  if (options.needsSimilar !== false) {
    const similar = await findSimilarClients(client.name, 5);
    result.similarClients = similar.map(s => ({
      name: s.client.name,
      similarity: Math.round(s.similarity * 100),
      sharedAPIs: s.sharedAPIs,
    }));
  }

  return result;
}

/**
 * Build response using rule-based logic for unknown companies
 */
async function buildRuleBasedResponse(companyName: string): Promise<{
  company: string;
  isExistingClient: false;
  defaultRecommendations: { api: string; priority: string; reason: string }[];
  suggestedIndustry: string;
}> {
  // Try to guess industry from company name
  const nameLower = companyName.toLowerCase();
  let suggestedIndustry = 'General';

  const industryKeywords: Record<string, string[]> = {
    NBFC: ['finance', 'capital', 'lending', 'credit', 'loan', 'money'],
    Fintech: ['pay', 'wallet', 'fintech', 'bank', 'payment'],
    Insurance: ['insurance', 'insure', 'life', 'health', 'policy'],
    'Real Estate': ['realty', 'estate', 'property', 'housing', 'home'],
    Crypto: ['crypto', 'coin', 'chain', 'web3', 'defi'],
    Gaming: ['game', 'gaming', 'esport', 'play'],
    Telecom: ['telecom', 'mobile', 'airtel', 'jio', 'vi'],
    'E-Commerce': ['mart', 'shop', 'store', 'commerce', 'buy'],
  };

  for (const [industry, keywords] of Object.entries(industryKeywords)) {
    if (keywords.some(kw => nameLower.includes(kw))) {
      suggestedIndustry = industry;
      break;
    }
  }

  // Get industry-specific recommendations
  const industryReqs = INDUSTRY_API_REQUIREMENTS[suggestedIndustry] || INDUSTRY_API_REQUIREMENTS.General;

  return {
    company: companyName,
    isExistingClient: false,
    defaultRecommendations: [
      ...industryReqs.mustHave.slice(0, 3).map(api => ({
        api,
        priority: 'critical',
        reason: `Required for ${suggestedIndustry} compliance`,
      })),
      ...industryReqs.recommended.slice(0, 3).map(api => ({
        api,
        priority: 'high',
        reason: `Commonly used by ${suggestedIndustry} companies`,
      })),
    ],
    suggestedIndustry,
  };
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Process multiple companies efficiently
 */
export async function batchDecide(
  companies: string[],
  options: {
    needsRecommendations?: boolean;
    maxConcurrent?: number;
  } = {}
): Promise<Map<string, DecisionResult>> {
  const results = new Map<string, DecisionResult>();
  const maxConcurrent = options.maxConcurrent || 5;

  // Process in batches
  for (let i = 0; i < companies.length; i += maxConcurrent) {
    const batch = companies.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(company => decideAndFetch(company, options))
    );

    batch.forEach((company, idx) => {
      results.set(company, batchResults[idx]);
    });
  }

  return results;
}

/**
 * Get decision summary - useful for debugging and optimization
 */
export function getDecisionSummary(): {
  totalQueries: number;
  bySource: Record<DataSource, number>;
  aiPercentage: number;
  estimatedCost: number;
  recommendation: string;
} {
  const stats = getSessionStats();
  if (!stats) {
    return {
      totalQueries: 0,
      bySource: { database: 0, rules: 0, google: 0, ai: 0, combined: 0 },
      aiPercentage: 0,
      estimatedCost: 0,
      recommendation: 'No queries yet',
    };
  }

  const aiPercentage = stats.totalQueries > 0
    ? (stats.aiCalls / stats.totalQueries) * 100
    : 0;

  let recommendation = 'Great efficiency!';
  if (aiPercentage > 20) {
    recommendation = 'Consider caching AI responses for repeated queries';
  }
  if (stats.googleSearches > stats.databaseHits) {
    recommendation = 'Many unknown companies - consider enriching database';
  }

  return {
    totalQueries: stats.totalQueries,
    bySource: {
      database: stats.databaseHits,
      rules: stats.ruleHits,
      google: stats.googleSearches,
      ai: stats.aiCalls,
      combined: 0,
    },
    aiPercentage: Math.round(aiPercentage),
    estimatedCost: stats.estimatedCost,
    recommendation,
  };
}
