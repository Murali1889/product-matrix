/**
 * AI-Powered Company Analysis and API Recommendation Engine
 * Uses OpenAI to research companies and recommend APIs intelligently
 * UPDATED: Now uses real data from unified-data-connector
 */

import type { ClientData } from '@/types/client';
import type { APIRecommendation, ProspectCompany } from '@/types/recommendation';
import {
  loadAPICatalog,
  getUnifiedClientData,
  findSimilarClients,
  getUnusedAPIsForClient,
  getAPIWithStats,
  type HyperVergeAPI,
  type UnifiedClientData
} from './unified-data-connector';

// Dynamic API catalog loader
async function getAPICatalogForAI(): Promise<{
  name: string;
  category: string;
  description: string;
  subModules: string[];
  clientCount: number;
  totalRevenue: number;
}[]> {
  const apiStats = await getAPIWithStats();

  // API descriptions for AI context
  const descriptions: Record<string, { description: string; useCases: string[]; industries: string[] }> = {
    'Aadhaar OKYC with OTP': {
      description: 'Verify Indian identity using Aadhaar number with OTP-based consent. Essential for KYC compliance.',
      useCases: ['Customer onboarding', 'KYC verification', 'Identity proofing'],
      industries: ['NBFC', 'Banking', 'Insurance', 'Fintech', 'Telecom']
    },
    'PAN Verification': {
      description: 'Verify PAN card details including name matching. Required for financial services.',
      useCases: ['Tax compliance', 'Account opening', 'Loan applications'],
      industries: ['NBFC', 'Banking', 'Brokerage', 'Wealth Management']
    },
    'Bank Account Verification': {
      description: 'Verify bank account ownership via Penny Drop or Pennyless methods.',
      useCases: ['Disbursement verification', 'Salary accounts', 'Refunds'],
      industries: ['NBFC', 'Payment', 'E-commerce', 'HR Tech']
    },
    'Selfie Validation': {
      description: 'AI-powered liveness detection to prevent spoofing. Ensures real person is present.',
      useCases: ['Anti-fraud', 'Remote onboarding', 'Transaction authentication'],
      industries: ['Fintech', 'Gaming', 'Gig Economy', 'Insurance']
    },
    'Face Match': {
      description: 'Compare selfie with ID photo to verify identity match.',
      useCases: ['ID verification', 'Access control', 'Fraud prevention'],
      industries: ['Banking', 'Insurance', 'HR Tech', 'Travel']
    },
    'CKYC Search & Download': {
      description: 'Search and download CKYC records from central registry.',
      useCases: ['Simplified KYC', 'Regulatory compliance', 'Account opening'],
      industries: ['Banking', 'NBFC', 'Insurance', 'Mutual Funds']
    },
    'AML Search': {
      description: 'Screen against global sanctions, PEP, and adverse media lists.',
      useCases: ['Customer screening', 'Ongoing monitoring', 'Risk assessment'],
      industries: ['Banking', 'Wealth Management', 'Crypto', 'Fintech']
    },
    'GST Verification': {
      description: 'Verify GST registration details and compliance status.',
      useCases: ['Vendor onboarding', 'B2B transactions', 'Loan underwriting'],
      industries: ['NBFC', 'E-commerce', 'Supply Chain', 'Lending']
    },
    'ID Card Validation': {
      description: 'Extract and validate ID card information using AI OCR.',
      useCases: ['Document verification', 'Data extraction', 'KYC'],
      industries: ['Banking', 'Insurance', 'Fintech', 'NBFC']
    },
    'Driving License': {
      description: 'Verify driving license details and validity.',
      useCases: ['Driver onboarding', 'Vehicle rental', 'Insurance'],
      industries: ['Gig Economy', 'Insurance', 'Logistics', 'Travel']
    },
    'RC Verification': {
      description: 'Verify vehicle registration certificate details.',
      useCases: ['Vehicle loans', 'Insurance', 'Fleet management'],
      industries: ['NBFC', 'Insurance', 'Logistics', 'Rental']
    }
  };

  // Categorize APIs
  const categorizeAPI = (name: string): string => {
    const categories: Record<string, string[]> = {
      'Identity Verification': ['Aadhaar', 'PAN', 'Passport', 'Voter', 'ID Card', 'CKYC'],
      'Biometric': ['Selfie', 'Face', 'Liveness'],
      'Financial Verification': ['Bank Account', 'GST', 'ITR', 'Credit'],
      'Business Verification': ['Company', 'GSTIN', 'MCA', 'Udyam'],
      'AML & Compliance': ['AML', 'Sanction', 'PEP'],
      'Document Processing': ['OCR', 'Document'],
      'Vehicle': ['RC', 'Driving', 'DL', 'Vehicle']
    };

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(kw => name.toLowerCase().includes(kw.toLowerCase()))) {
        return category;
      }
    }
    return 'Other';
  };

  return apiStats.map(api => {
    const desc = descriptions[api.moduleName] || {
      description: `${api.moduleName} verification service`,
      useCases: ['Verification'],
      industries: ['Fintech']
    };

    return {
      name: api.moduleName,
      category: categorizeAPI(api.moduleName),
      description: desc.description,
      subModules: api.subModules,
      clientCount: api.clientCount,
      totalRevenue: api.totalRevenue
    };
  });
}

// Industry-specific compliance requirements
const INDUSTRY_REQUIREMENTS: Record<string, string[]> = {
  'NBFC': [
    'RBI KYC guidelines mandate Aadhaar-based verification',
    'CKYC compliance required for loan disbursement',
    'AML screening mandatory for all customers',
    'Bank account verification for disbursement'
  ],
  'Payment Service Provider': [
    'RBI PPI guidelines require full KYC for wallets > 10k',
    'Bank account verification for merchant onboarding',
    'Liveness check prevents account takeover'
  ],
  'Insurance': [
    'IRDAI guidelines require identity verification',
    'Face match for claim settlement',
    'Document OCR for policy processing'
  ],
  'Brokerage': [
    'SEBI mandates e-KYC with Aadhaar/PAN',
    'CKYC interoperability required',
    'AML screening for all investors'
  ],
  'Gig Economy': [
    'Worker verification for platform safety',
    'DL/RC verification for driver onboarding',
    'Face match for continuous authentication'
  ],
  'Gaming': [
    'Age verification mandatory for real money gaming',
    'KYC required for withdrawals > 10k',
    'Anti-fraud measures for tournament integrity'
  ],
  'E-commerce': [
    'Seller verification for marketplace trust',
    'GST verification for B2B transactions',
    'Address verification for delivery'
  ]
};

export interface CompanyAnalysis {
  companyName: string;
  description: string;
  industry: string;
  subIndustry?: string;
  businessModel: string;
  keyProducts: string[];
  targetCustomers: string;
  geography: string;
  companySize: 'startup' | 'small' | 'medium' | 'large' | 'enterprise';
  fundingStage?: string;
  estimatedEmployees?: string;
  website?: string;
  linkedIn?: string;
}

export interface AIRecommendation {
  api: string;
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  useCase: string;
  regulatoryNeed?: string;
  estimatedVolume: string;
  estimatedRevenue: { monthly: number; annual: number };
  competitorUsage?: string[];
}

export interface CompanyResearchResult {
  analysis: CompanyAnalysis;
  recommendations: AIRecommendation[];
  salesStrategy: {
    primaryPitch: string;
    keyValueProps: string[];
    objectionHandlers: Record<string, string>;
    competitorComparison?: string;
  };
  outreachSuggestions: {
    emailSubject: string;
    openingLine: string;
    callToAction: string;
    bestTimeToContact?: string;
  };
  totalEstimatedValue: {
    monthly: number;
    annual: number;
  };
}

export class AIRecommendationEngine {
  private apiKey: string;
  private existingClients: ClientData[];
  private model: string = 'gpt-4o-mini';

  constructor(apiKey: string, existingClients: ClientData[]) {
    this.apiKey = apiKey;
    this.existingClients = existingClients;
  }

  // Analyze a company using AI - NOW USES REAL DATA
  async analyzeCompany(
    companyName: string,
    additionalContext?: string
  ): Promise<CompanyResearchResult> {
    // Get real API catalog
    const apiCatalog = await getAPICatalogForAI();

    // Check if this is an existing client using unified data
    const existingClientData = await getUnifiedClientData(companyName);

    // Get similar clients for collaborative filtering
    const similarClients = existingClientData
      ? await findSimilarClients(companyName, 5)
      : [];

    // Get APIs they DON'T use yet (for upsell)
    const unusedAPIs = existingClientData
      ? await getUnusedAPIsForClient(companyName)
      : [];

    // Build enhanced context
    let realDataContext = '';
    if (existingClientData) {
      realDataContext = `
IMPORTANT: This is an EXISTING CLIENT. Here is their REAL usage data:

Client Name: ${existingClientData.name}
Total Revenue: $${existingClientData.totalRevenue.toFixed(2)}
Total API Usage: ${existingClientData.totalUsage.toLocaleString()} calls
APIs Currently Using (${existingClientData.apiCount} total):
${existingClientData.apis.map(a => `  - ${a.moduleName} (${a.subModuleName}): ${a.totalUsage.toLocaleString()} calls, $${a.totalRevenue.toFixed(2)} revenue`).join('\n')}

Similar Clients (for collaborative filtering):
${similarClients.map(s => `  - ${s.client.name}: ${Math.round(s.similarity * 100)}% similar, using: ${s.client.apis.map(a => a.moduleName).slice(0, 5).join(', ')}`).join('\n')}

APIs they're NOT using yet (${unusedAPIs.length} potential upsells):
${unusedAPIs.slice(0, 15).map(a => `  - ${a.moduleName} (${a.category})`).join('\n')}

FOCUS YOUR RECOMMENDATIONS on APIs from the "not using yet" list that similar clients ARE using.
`;
    }

    // Build context about similar clients from existing data
    const similarClientContext = this.buildSimilarClientContext(companyName);

    const systemPrompt = `You are an expert sales intelligence analyst for HyperVerge, a company that provides identity verification, biometric, and compliance APIs.

Your task is to analyze a potential customer and recommend the most relevant APIs based on their business model, industry requirements, and regulatory needs.

REAL API Catalog from HyperVerge (with actual client counts):
${JSON.stringify(apiCatalog.slice(0, 30), null, 2)}

Industry Compliance Requirements:
${JSON.stringify(INDUSTRY_REQUIREMENTS, null, 2)}

Our existing client base context:
${similarClientContext}

${realDataContext}

Respond in JSON format only.`;

    const userPrompt = `Analyze this company and provide API recommendations:

Company: ${companyName}
${additionalContext ? `Additional context: ${additionalContext}` : ''}

Research the company and provide a comprehensive analysis including:
1. Company profile (industry, business model, size, geography)
2. Top API recommendations with priority, use cases, and estimated revenue
3. Sales strategy (pitch, value props, objection handlers)
4. Outreach suggestions (email subject, opening, CTA)

Respond with this exact JSON structure:
{
  "analysis": {
    "companyName": "string",
    "description": "2-3 sentence company description",
    "industry": "primary industry",
    "subIndustry": "specific vertical",
    "businessModel": "B2B/B2C/B2B2C etc",
    "keyProducts": ["product1", "product2"],
    "targetCustomers": "description of their customers",
    "geography": "India/ASEAN/Global",
    "companySize": "startup|small|medium|large|enterprise",
    "fundingStage": "Series A/B/C etc if known",
    "website": "URL if known"
  },
  "recommendations": [
    {
      "api": "API name from catalog",
      "category": "API category",
      "priority": "critical|high|medium|low",
      "reason": "Why this API is needed",
      "useCase": "Specific use case",
      "regulatoryNeed": "Regulatory requirement if any",
      "estimatedVolume": "X per month",
      "estimatedRevenue": { "monthly": number, "annual": number }
    }
  ],
  "salesStrategy": {
    "primaryPitch": "Main value proposition in 1-2 sentences",
    "keyValueProps": ["prop1", "prop2", "prop3"],
    "objectionHandlers": {
      "price": "Response to price objection",
      "existing_vendor": "Response if they have existing vendor",
      "build_vs_buy": "Response if they want to build in-house"
    }
  },
  "outreachSuggestions": {
    "emailSubject": "Compelling subject line",
    "openingLine": "Personalized opening",
    "callToAction": "Clear next step"
  },
  "totalEstimatedValue": {
    "monthly": number,
    "annual": number
  }
}`;

    try {
      const response = await this.callOpenAI(systemPrompt, userPrompt);
      return JSON.parse(response);
    } catch (error) {
      console.error('AI analysis failed:', error);
      // Return fallback based on rules
      return this.getFallbackRecommendations(companyName);
    }
  }

  // Batch analyze multiple companies
  async batchAnalyze(companies: string[]): Promise<Map<string, CompanyResearchResult>> {
    const results = new Map<string, CompanyResearchResult>();

    // Process in parallel with rate limiting
    const batchSize = 3;
    for (let i = 0; i < companies.length; i += batchSize) {
      const batch = companies.slice(i, i + batchSize);
      const promises = batch.map(company => this.analyzeCompany(company));
      const batchResults = await Promise.all(promises);

      batch.forEach((company, idx) => {
        results.set(company, batchResults[idx]);
      });

      // Rate limiting
      if (i + batchSize < companies.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  // Find companies similar to successful clients
  async findProspects(
    industry: string,
    geography: string = 'India',
    count: number = 10
  ): Promise<string[]> {
    const systemPrompt = `You are a sales research assistant. Generate a list of real companies that would be good prospects for identity verification and KYC APIs.`;

    const userPrompt = `Generate a list of ${count} real companies in the ${industry} industry in ${geography} that would likely need identity verification, KYC, or biometric APIs.

Focus on:
- Growing companies that are scaling operations
- Companies with digital onboarding needs
- Companies in regulated industries
- Well-funded startups

Return ONLY a JSON array of company names:
["Company 1", "Company 2", ...]`;

    try {
      const response = await this.callOpenAI(systemPrompt, userPrompt);
      return JSON.parse(response);
    } catch {
      return [];
    }
  }

  // Generate personalized outreach for a company
  async generateOutreach(
    analysis: CompanyResearchResult,
    senderName: string,
    senderRole: string
  ): Promise<{
    email: string;
    linkedInMessage: string;
    followUp: string;
  }> {
    const systemPrompt = `You are a sales copywriter specializing in B2B SaaS outreach. Write compelling, personalized messages that focus on value, not features.`;

    const userPrompt = `Generate outreach messages for this prospect:

Company Analysis:
${JSON.stringify(analysis.analysis, null, 2)}

Top Recommended APIs:
${analysis.recommendations.slice(0, 3).map(r => `- ${r.api}: ${r.reason}`).join('\n')}

Sales Strategy:
${analysis.salesStrategy.primaryPitch}

Sender: ${senderName}, ${senderRole} at HyperVerge

Generate:
1. Cold email (150-200 words, professional but personalized)
2. LinkedIn connection message (50 words max, casual professional)
3. Follow-up email after 1 week (100 words, reference original)

Return as JSON:
{
  "email": "Full email text",
  "linkedInMessage": "Short LinkedIn message",
  "followUp": "Follow-up email text"
}`;

    try {
      const response = await this.callOpenAI(systemPrompt, userPrompt);
      return JSON.parse(response);
    } catch {
      return {
        email: '',
        linkedInMessage: '',
        followUp: ''
      };
    }
  }

  private buildSimilarClientContext(companyName: string): string {
    // Find clients in similar industries
    const industries = new Map<string, { clients: string[]; topAPIs: string[] }>();

    this.existingClients.forEach(client => {
      const segment = client.profile?.segment || 'Unknown';
      if (!industries.has(segment)) {
        industries.set(segment, { clients: [], topAPIs: [] });
      }
      industries.get(segment)!.clients.push(client.client_name);
    });

    const context: string[] = ['Our existing clients by industry:'];
    industries.forEach((data, industry) => {
      if (data.clients.length > 0) {
        context.push(`- ${industry}: ${data.clients.slice(0, 5).join(', ')}${data.clients.length > 5 ? ` (+${data.clients.length - 5} more)` : ''}`);
      }
    });

    return context.join('\n');
  }

  private async callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  private getFallbackRecommendations(companyName: string): CompanyResearchResult {
    // Rule-based fallback when AI fails
    return {
      analysis: {
        companyName,
        description: 'Company analysis pending - using rule-based recommendations',
        industry: 'Fintech',
        businessModel: 'Unknown',
        keyProducts: [],
        targetCustomers: 'Unknown',
        geography: 'India',
        companySize: 'medium'
      },
      recommendations: [
        {
          api: 'Aadhaar OKYC with OTP',
          category: 'Identity Verification',
          priority: 'critical',
          reason: 'Essential for any fintech KYC',
          useCase: 'Customer onboarding',
          estimatedVolume: '1000-5000/month',
          estimatedRevenue: { monthly: 2000, annual: 24000 }
        },
        {
          api: 'PAN Verification',
          category: 'Identity Verification',
          priority: 'high',
          reason: 'Required for financial services',
          useCase: 'Account verification',
          estimatedVolume: '1000-5000/month',
          estimatedRevenue: { monthly: 1500, annual: 18000 }
        },
        {
          api: 'Selfie Validation',
          category: 'Biometric',
          priority: 'high',
          reason: 'Fraud prevention',
          useCase: 'Remote onboarding',
          estimatedVolume: '1000-5000/month',
          estimatedRevenue: { monthly: 3000, annual: 36000 }
        }
      ],
      salesStrategy: {
        primaryPitch: 'Streamline your KYC process with 95%+ auto-approval rates',
        keyValueProps: [
          'Reduce KYC time from days to minutes',
          'Regulatory compliant out of the box',
          'Pay-per-use pricing with no minimums'
        ],
        objectionHandlers: {
          'price': 'Our customers see 3-5x ROI through reduced manual verification',
          'existing_vendor': 'Happy to do a pilot to show performance comparison',
          'build_vs_buy': 'Building in-house costs 10x more and takes 6+ months'
        }
      },
      outreachSuggestions: {
        emailSubject: `Quick question about ${companyName}'s KYC process`,
        openingLine: `I noticed ${companyName} is growing rapidly and wanted to share how we help similar companies scale their verification.`,
        callToAction: 'Would you be open to a 15-minute call this week?'
      },
      totalEstimatedValue: {
        monthly: 6500,
        annual: 78000
      }
    };
  }
}

// Export factory function
export function createAIRecommendationEngine(
  apiKey: string,
  existingClients: ClientData[]
): AIRecommendationEngine {
  return new AIRecommendationEngine(apiKey, existingClients);
}
