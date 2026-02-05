/**
 * SALES INTELLIGENCE ENGINE
 * The $100M Revenue Generator
 *
 * This engine combines:
 * 1. Internal data (what clients actually use)
 * 2. Similar company analysis (collaborative filtering)
 * 3. AI-powered company research
 * 4. Market intelligence signals
 * 5. Prioritized recommendations with revenue estimates
 */

import {
  getUnifiedClientData,
  findSimilarClients,
  getUnusedAPIsForClient,
  loadClientUsage,
  getAPIWithStats,
  type UnifiedClientData,
  type HyperVergeAPI
} from './unified-data-connector';

// ============== TYPES ==============

export interface CompanyIntelligence {
  name: string;
  isExistingClient: boolean;

  // If existing client
  currentData?: {
    totalRevenue: number;
    totalUsage: number;
    apisUsed: { name: string; revenue: number; usage: number }[];
    monthlyAvg: number;
  };

  // Research data (AI + web)
  research: {
    industry: string;
    subIndustry: string;
    description: string;
    businessModel: string;
    fundingStage?: string;
    lastFundingAmount?: string;
    lastFundingDate?: string;
    employeeCount?: string;
    headquarters?: string;
    founded?: string;
    website?: string;
    recentNews?: string[];
    growthSignals: string[];
    painPoints: string[];
  };

  // Similar companies analysis
  similarCompanies: {
    inOurDatabase: {
      name: string;
      similarity: number;
      revenue: number;
      commonAPIs: string[];
      uniqueAPIs: string[]; // APIs they use that target doesn't
    }[];
    notInDatabase: string[]; // Competitors/peers not in our client list
  };

  // Prioritized recommendations
  recommendations: {
    api: string;
    category: string;
    priority: 'must-have' | 'high-value' | 'nice-to-have';
    confidence: number; // 0-100
    reasoning: string;
    dataSource: 'similar-clients' | 'industry-standard' | 'regulatory' | 'ai-analysis';
    estimatedVolume: { low: number; mid: number; high: number };
    estimatedRevenue: { monthly: number; annual: number };
    competitorUsage?: string; // "Used by PhonePe, Razorpay"
  }[];

  // Sales intelligence
  salesIntel: {
    totalOpportunityValue: { monthly: number; annual: number };
    dealPriority: 'hot' | 'warm' | 'cold';
    bestTimeToReach: string;
    buyingSignals: string[];
    objections: { objection: string; response: string }[];
    competitorThreats: string[];
    champions: string[]; // Suggested roles to target
    pitch: string;
    emailTemplate: string;
  };
}

export interface ProspectScore {
  company: string;
  score: number; // 0-100
  factors: {
    industryFit: number;
    sizeFit: number;
    fundingSignal: number;
    growthSignal: number;
    competitorUsage: number;
    regulatoryNeed: number;
  };
  estimatedDealSize: number;
  recommendedAPIs: string[];
}

// ============== INDUSTRY INTELLIGENCE ==============

export const INDUSTRY_API_REQUIREMENTS: Record<string, {
  mustHave: string[];
  recommended: string[];
  regulatory: string[];
  avgDealSize: number;
}> = {
  'NBFC': {
    mustHave: ['Aadhaar OKYC', 'PAN Verification', 'Bank Account Verification', 'CKYC'],
    recommended: ['Face Match', 'Selfie Validation', 'AML Search', 'Credit Score'],
    regulatory: ['CKYC Upload', 'AML Search', 'Aadhaar OKYC'],
    avgDealSize: 150000
  },
  'Fintech': {
    mustHave: ['Aadhaar OKYC', 'PAN Verification', 'Selfie Validation'],
    recommended: ['Face Match', 'Bank Account Verification', 'AML Search'],
    regulatory: ['CKYC', 'AML Search'],
    avgDealSize: 100000
  },
  'Payment': {
    mustHave: ['Aadhaar OKYC', 'PAN Verification', 'Bank Account Verification'],
    recommended: ['Selfie Validation', 'Face Match', 'Merchant Verification'],
    regulatory: ['AML Search', 'CKYC'],
    avgDealSize: 200000
  },
  'Insurance': {
    mustHave: ['Aadhaar OKYC', 'PAN Verification', 'Face Match'],
    recommended: ['Document OCR', 'Selfie Validation', 'CKYC'],
    regulatory: ['CKYC', 'AML Search'],
    avgDealSize: 120000
  },
  'Brokerage': {
    mustHave: ['Aadhaar OKYC', 'PAN Verification', 'CKYC', 'Digilocker'],
    recommended: ['Face Match', 'Bank Account Verification', 'AML Search'],
    regulatory: ['CKYC', 'AML Search', 'Digilocker'],
    avgDealSize: 180000
  },
  'Gig Economy': {
    mustHave: ['Selfie Validation', 'Face Match', 'DL Verification'],
    recommended: ['RC Verification', 'Bank Account Verification', 'Aadhaar OKYC'],
    regulatory: [],
    avgDealSize: 80000
  },
  'Gaming': {
    mustHave: ['Aadhaar OKYC', 'PAN Verification', 'Selfie Validation'],
    recommended: ['Face Match', 'Bank Account Verification'],
    regulatory: ['Aadhaar OKYC'],
    avgDealSize: 60000
  },
  'E-commerce': {
    mustHave: ['GST Verification', 'Bank Account Verification'],
    recommended: ['Selfie Validation', 'Address Verification', 'PAN Verification'],
    regulatory: [],
    avgDealSize: 50000
  },
  'Healthcare': {
    mustHave: ['Aadhaar OKYC', 'Face Match'],
    recommended: ['Document OCR', 'Selfie Validation'],
    regulatory: [],
    avgDealSize: 40000
  },
  'General': {
    mustHave: ['Aadhaar OKYC', 'PAN Verification'],
    recommended: ['Selfie Validation', 'Bank Account Verification', 'Face Match'],
    regulatory: [],
    avgDealSize: 50000
  }
};

// Funding signals that indicate buying readiness
const FUNDING_SIGNALS: Record<string, number> = {
  'Series A': 70,
  'Series B': 85,
  'Series C': 90,
  'Series D+': 95,
  'Pre-Series A': 50,
  'Seed': 30,
  'Bootstrapped': 40
};

// ============== MAIN INTELLIGENCE FUNCTION ==============

/**
 * Get complete sales intelligence for a company
 */
export async function getCompanyIntelligence(
  companyName: string,
  openAIKey?: string
): Promise<CompanyIntelligence> {
  // Step 1: Check if existing client
  const existingData = await getUnifiedClientData(companyName);
  const isExisting = !!existingData;

  // Step 2: Get similar companies from our database
  const similarFromDB = isExisting
    ? await findSimilarClients(companyName, 10)
    : [];

  // Step 3: Get unused APIs for recommendations
  const unusedAPIs = isExisting
    ? await getUnusedAPIsForClient(companyName)
    : [];

  // Step 4: Research company with AI (if API key provided)
  const research = openAIKey
    ? await researchCompanyWithAI(companyName, openAIKey)
    : getDefaultResearch(companyName);

  // Step 5: Build recommendations
  const recommendations = buildRecommendations(
    companyName,
    isExisting,
    existingData,
    similarFromDB,
    unusedAPIs,
    research
  );

  // Step 6: Build sales intelligence
  const salesIntel = buildSalesIntelligence(
    companyName,
    isExisting,
    existingData,
    recommendations,
    research
  );

  return {
    name: companyName,
    isExistingClient: isExisting,
    currentData: existingData ? {
      totalRevenue: existingData.totalRevenue,
      totalUsage: existingData.totalUsage,
      apisUsed: existingData.apis.map(a => ({
        name: a.moduleName,
        revenue: a.totalRevenue,
        usage: a.totalUsage
      })),
      monthlyAvg: existingData.monthlyAvgRevenue
    } : undefined,
    research,
    similarCompanies: {
      inOurDatabase: similarFromDB.map(s => ({
        name: s.client.name,
        similarity: Math.round(s.similarity * 100),
        revenue: s.client.totalRevenue,
        commonAPIs: s.sharedAPIs,
        uniqueAPIs: s.client.apis
          .filter(a => !existingData?.apis.some(ea => ea.moduleName === a.moduleName))
          .map(a => a.moduleName)
      })),
      notInDatabase: research.recentNews?.filter(n => n.includes('competitor')) || []
    },
    recommendations,
    salesIntel
  };
}

/**
 * Research company using AI + web search
 */
async function researchCompanyWithAI(
  companyName: string,
  apiKey: string
): Promise<CompanyIntelligence['research']> {
  const prompt = `Research the company "${companyName}" and provide detailed information in JSON format:
{
  "industry": "primary industry (NBFC/Fintech/Payment/Insurance/Brokerage/Gig Economy/Gaming/E-commerce/Healthcare)",
  "subIndustry": "specific vertical",
  "description": "2-3 sentence description",
  "businessModel": "B2B/B2C/B2B2C",
  "fundingStage": "Seed/Series A/B/C/D+",
  "lastFundingAmount": "amount if known",
  "lastFundingDate": "date if known",
  "employeeCount": "approximate number",
  "headquarters": "city, country",
  "founded": "year",
  "website": "URL",
  "recentNews": ["headline 1", "headline 2"],
  "growthSignals": ["signal 1", "signal 2"],
  "painPoints": ["pain point 1", "pain point 2"]
}

Focus on Indian market context. Be specific about their KYC/verification needs.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a business intelligence analyst specializing in Indian fintech and technology companies.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) {
    console.error('AI research failed:', error);
    return getDefaultResearch(companyName);
  }
}

function getDefaultResearch(companyName: string): CompanyIntelligence['research'] {
  return {
    industry: 'Fintech',
    subIndustry: 'Unknown',
    description: `${companyName} - pending detailed research`,
    businessModel: 'Unknown',
    growthSignals: [],
    painPoints: ['KYC compliance', 'Fraud prevention', 'User onboarding speed']
  };
}

/**
 * Build prioritized recommendations
 */
function buildRecommendations(
  companyName: string,
  isExisting: boolean,
  existingData: UnifiedClientData | null,
  similarClients: { client: UnifiedClientData; similarity: number; sharedAPIs: string[] }[],
  unusedAPIs: HyperVergeAPI[],
  research: CompanyIntelligence['research']
): CompanyIntelligence['recommendations'] {
  const recommendations: CompanyIntelligence['recommendations'] = [];
  const industryReqs = INDUSTRY_API_REQUIREMENTS[research.industry] || INDUSTRY_API_REQUIREMENTS['Fintech'];

  // Get APIs used by this client
  const usedAPIs = new Set(existingData?.apis.map(a => a.moduleName.toLowerCase()) || []);

  // 1. Regulatory must-haves (highest priority)
  for (const api of industryReqs.regulatory) {
    if (!usedAPIs.has(api.toLowerCase())) {
      recommendations.push({
        api,
        category: 'Compliance',
        priority: 'must-have',
        confidence: 95,
        reasoning: `Regulatory requirement for ${research.industry} companies in India`,
        dataSource: 'regulatory',
        estimatedVolume: { low: 5000, mid: 15000, high: 50000 },
        estimatedRevenue: { monthly: 3000, annual: 36000 }
      });
    }
  }

  // 2. APIs from similar clients (high confidence)
  const apiScores = new Map<string, { count: number; clients: string[] }>();

  for (const sim of similarClients) {
    for (const api of sim.client.apis) {
      if (!usedAPIs.has(api.moduleName.toLowerCase())) {
        const existing = apiScores.get(api.moduleName) || { count: 0, clients: [] };
        existing.count++;
        existing.clients.push(sim.client.name);
        apiScores.set(api.moduleName, existing);
      }
    }
  }

  // Sort by frequency across similar clients
  const sortedAPIs = Array.from(apiScores.entries())
    .sort((a, b) => b[1].count - a[1].count);

  for (const [api, data] of sortedAPIs.slice(0, 5)) {
    const confidence = Math.min(90, 50 + data.count * 10);

    recommendations.push({
      api,
      category: 'Recommended',
      priority: data.count >= 3 ? 'high-value' : 'nice-to-have',
      confidence,
      reasoning: `Used by ${data.count} similar companies: ${data.clients.slice(0, 3).join(', ')}`,
      dataSource: 'similar-clients',
      estimatedVolume: { low: 2000, mid: 10000, high: 30000 },
      estimatedRevenue: { monthly: 2000, annual: 24000 },
      competitorUsage: `Used by ${data.clients.slice(0, 3).join(', ')}`
    });
  }

  // 3. Industry standard APIs
  for (const api of industryReqs.mustHave) {
    if (!usedAPIs.has(api.toLowerCase()) && !recommendations.find(r => r.api === api)) {
      recommendations.push({
        api,
        category: 'Industry Standard',
        priority: 'high-value',
        confidence: 80,
        reasoning: `Standard requirement for ${research.industry} companies`,
        dataSource: 'industry-standard',
        estimatedVolume: { low: 3000, mid: 12000, high: 40000 },
        estimatedRevenue: { monthly: 2500, annual: 30000 }
      });
    }
  }

  // Sort by priority and confidence
  const priorityOrder = { 'must-have': 0, 'high-value': 1, 'nice-to-have': 2 };
  recommendations.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.confidence - a.confidence;
  });

  return recommendations.slice(0, 10);
}

/**
 * Build sales intelligence
 */
function buildSalesIntelligence(
  companyName: string,
  isExisting: boolean,
  existingData: UnifiedClientData | null,
  recommendations: CompanyIntelligence['recommendations'],
  research: CompanyIntelligence['research']
): CompanyIntelligence['salesIntel'] {
  const totalMonthly = recommendations.reduce((sum, r) => sum + r.estimatedRevenue.monthly, 0);
  const totalAnnual = recommendations.reduce((sum, r) => sum + r.estimatedRevenue.annual, 0);

  // Determine deal priority
  const fundingScore = FUNDING_SIGNALS[research.fundingStage || ''] || 50;
  const hasGrowthSignals = (research.growthSignals?.length || 0) > 0;
  const hasRegulatoryNeeds = recommendations.some(r => r.dataSource === 'regulatory');

  let dealPriority: 'hot' | 'warm' | 'cold' = 'warm';
  if (fundingScore >= 80 || hasRegulatoryNeeds || (isExisting && totalAnnual > 50000)) {
    dealPriority = 'hot';
  } else if (fundingScore < 40 && !hasGrowthSignals) {
    dealPriority = 'cold';
  }

  // Build pitch
  const topAPIs = recommendations.slice(0, 3).map(r => r.api).join(', ');
  const pitch = isExisting
    ? `Based on your current usage patterns and what similar companies like ${recommendations[0]?.competitorUsage?.split('Used by ')[1] || 'your peers'} are doing, we recommend adding ${topAPIs} to enhance your verification stack.`
    : `Companies in the ${research.industry} space typically need ${topAPIs} for compliance and fraud prevention. We're already working with similar companies and can help you get started quickly.`;

  return {
    totalOpportunityValue: { monthly: totalMonthly, annual: totalAnnual },
    dealPriority,
    bestTimeToReach: 'Tuesday-Thursday, 10 AM - 12 PM IST',
    buyingSignals: [
      ...(research.growthSignals || []),
      ...(hasRegulatoryNeeds ? ['Regulatory compliance needed'] : []),
      ...(isExisting ? ['Existing customer - expansion opportunity'] : [])
    ],
    objections: [
      { objection: 'Too expensive', response: 'Our pricing is usage-based with no minimums. Most clients see 3-5x ROI through reduced manual verification.' },
      { objection: 'Already have a vendor', response: 'Many clients use us alongside existing vendors for specific APIs. Happy to do a pilot comparison.' },
      { objection: 'Want to build in-house', response: 'Building verification in-house typically costs 10x more and takes 6+ months. We can get you live in days.' }
    ],
    competitorThreats: ['IDfy', 'Signzy', 'Onfido'],
    champions: ['VP Engineering', 'Head of Product', 'CISO', 'Head of Compliance'],
    pitch,
    emailTemplate: generateEmailTemplate(companyName, isExisting, recommendations, research)
  };
}

function generateEmailTemplate(
  companyName: string,
  isExisting: boolean,
  recommendations: CompanyIntelligence['recommendations'],
  research: CompanyIntelligence['research']
): string {
  const topRecs = recommendations.slice(0, 2);

  if (isExisting) {
    return `Hi,

I noticed ${companyName} has been growing rapidly, and I wanted to share a quick insight.

Looking at companies similar to yours, I noticed many are seeing great results with ${topRecs.map(r => r.api).join(' and ')}. Given your current stack, these could help you:

${topRecs.map(r => `• ${r.api}: ${r.reasoning}`).join('\n')}

Would you be open to a quick 15-minute call to discuss? I can share specific benchmarks from similar companies.

Best,
[Your name]`;
  }

  return `Hi,

I'm reaching out because ${companyName} caught my attention in the ${research.industry} space.

We work with several companies in your industry, helping them streamline KYC and verification. Based on what I know about ${research.industry} requirements, you'd likely benefit from:

${topRecs.map(r => `• ${r.api}: ${r.reasoning}`).join('\n')}

Would you be open to a brief conversation? I'd love to share how similar companies have implemented these solutions.

Best,
[Your name]`;
}

// ============== PROSPECT SCORING ==============

/**
 * Score and rank prospects for prioritization
 */
export async function scoreProspects(
  companies: string[],
  openAIKey?: string
): Promise<ProspectScore[]> {
  const scores: ProspectScore[] = [];

  for (const company of companies) {
    const intel = await getCompanyIntelligence(company, openAIKey);

    const industryFit = INDUSTRY_API_REQUIREMENTS[intel.research.industry] ? 80 : 40;
    const fundingSignal = FUNDING_SIGNALS[intel.research.fundingStage || ''] || 50;
    const growthSignal = (intel.research.growthSignals?.length || 0) * 15;
    const similarityBonus = intel.similarCompanies.inOurDatabase.length * 10;
    const regulatoryNeed = intel.recommendations.filter(r => r.dataSource === 'regulatory').length * 20;

    const totalScore = Math.min(100, (
      industryFit * 0.25 +
      fundingSignal * 0.25 +
      growthSignal * 0.15 +
      similarityBonus * 0.15 +
      regulatoryNeed * 0.20
    ));

    scores.push({
      company,
      score: Math.round(totalScore),
      factors: {
        industryFit,
        sizeFit: 70, // Default
        fundingSignal,
        growthSignal: Math.min(100, growthSignal),
        competitorUsage: Math.min(100, similarityBonus),
        regulatoryNeed: Math.min(100, regulatoryNeed)
      },
      estimatedDealSize: intel.salesIntel.totalOpportunityValue.annual,
      recommendedAPIs: intel.recommendations.slice(0, 5).map(r => r.api)
    });
  }

  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Find high-potential prospects in an industry
 */
export async function findHighPotentialProspects(
  industry: string,
  openAIKey: string,
  count: number = 20
): Promise<string[]> {
  const prompt = `List ${count} real companies in India in the ${industry} industry that would likely need KYC, identity verification, or compliance APIs.

Focus on:
- Well-funded startups (Series A+)
- Growing companies expanding operations
- Companies in regulated sectors
- Companies with digital onboarding needs

Return ONLY a JSON array of company names:
["Company 1", "Company 2", ...]`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAIKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.5,
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    return Array.isArray(parsed) ? parsed : parsed.companies || [];
  } catch {
    return [];
  }
}

/**
 * Get recommendations for a specific client (simplified version)
 */
export async function getRecommendationsForClient(clientName: string): Promise<{
  api: string;
  priority: string;
  reason: string;
  category?: string;
}[]> {
  try {
    const intelligence = await getCompanyIntelligence(clientName);
    return intelligence.recommendations.map(r => ({
      api: r.api,
      priority: r.priority,
      reason: r.reasoning,
      category: r.category,
    }));
  } catch {
    // Fallback to default recommendations
    return getDefaultRecommendations();
  }
}

/**
 * Get default API recommendations for new prospects
 */
export async function getDefaultRecommendations(): Promise<{
  api: string;
  priority: string;
  reason: string;
  category?: string;
}[]> {
  return [
    { api: 'Aadhaar OKYC', priority: 'must-have', reason: 'Essential for digital onboarding in India', category: 'Identity' },
    { api: 'PAN Verification', priority: 'must-have', reason: 'Required for financial compliance', category: 'Identity' },
    { api: 'Selfie Validation', priority: 'high', reason: 'Prevents fraud with liveness detection', category: 'Biometric' },
    { api: 'Face Match', priority: 'high', reason: 'Matches ID photo to live selfie', category: 'Biometric' },
    { api: 'Bank Account Verification', priority: 'medium', reason: 'Validates bank details for payments', category: 'Financial' },
    { api: 'AML Check', priority: 'medium', reason: 'Regulatory compliance for financial services', category: 'Compliance' },
    { api: 'CKYC Search', priority: 'medium', reason: 'Central KYC registry lookup', category: 'Compliance' },
  ];
}
