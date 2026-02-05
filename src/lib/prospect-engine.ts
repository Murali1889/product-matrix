import type { ClientData } from '@/types/client';
import type {
  ProspectCompany,
  OutreachRecommendation,
  APIRecommendation,
} from '@/types/recommendation';

// Industry segments and their typical API needs
const INDUSTRY_API_NEEDS: Record<string, {
  criticalAPIs: string[];
  commonAPIs: string[];
  description: string;
  keywords: string[];
}> = {
  'NBFC': {
    criticalAPIs: ['Aadhaar OKYC with OTP', 'PAN Verification', 'Bank Account Verification', 'CKYC Search & Download'],
    commonAPIs: ['Face Match', 'Selfie Validation', 'AML Search', 'Credit Bureau'],
    description: 'Non-Banking Financial Companies need robust KYC and credit verification',
    keywords: ['nbfc', 'lending', 'loan', 'microfinance', 'credit', 'finance company']
  },
  'Payment Service Provider': {
    criticalAPIs: ['Bank Account Verification', 'Aadhaar OKYC with OTP', 'PAN Verification'],
    commonAPIs: ['Selfie Validation', 'Liveness Check', 'AML Search'],
    description: 'Payment providers need quick onboarding with strong identity verification',
    keywords: ['payment', 'psp', 'wallet', 'upi', 'payment gateway', 'fintech payment']
  },
  'Insurance': {
    criticalAPIs: ['Aadhaar OKYC with OTP', 'PAN Verification', 'Face Match', 'Selfie Validation'],
    commonAPIs: ['Document OCR', 'Bank Account Verification', 'CKYC Search & Download'],
    description: 'Insurers need identity verification and fraud prevention',
    keywords: ['insurance', 'insurer', 'life insurance', 'health insurance', 'general insurance']
  },
  'Brokerage': {
    criticalAPIs: ['PAN Verification', 'Bank Account Verification', 'CKYC Search & Download', 'Aadhaar OKYC with OTP'],
    commonAPIs: ['AML Search', 'Face Match', 'Document OCR'],
    description: 'Brokers need regulatory compliant onboarding',
    keywords: ['brokerage', 'broker', 'stock', 'trading', 'securities', 'demat']
  },
  'Wealth Management': {
    criticalAPIs: ['AML Search', 'PAN Verification', 'Bank Account Verification', 'CKYC Search & Download'],
    commonAPIs: ['Aadhaar OKYC with OTP', 'Face Match', 'Company Verification'],
    description: 'Wealth managers need thorough AML and KYC compliance',
    keywords: ['wealth', 'asset management', 'portfolio', 'investment advisory', 'pms']
  },
  'Gig economy': {
    criticalAPIs: ['Selfie Validation', 'Liveness Check', 'Aadhaar OKYC with OTP'],
    commonAPIs: ['DL Verification', 'RC Verification', 'Bank Account Verification'],
    description: 'Gig platforms need quick worker onboarding with face verification',
    keywords: ['gig', 'delivery', 'ride', 'freelance', 'workforce', 'driver']
  },
  'E-commerce': {
    criticalAPIs: ['Selfie Validation', 'Bank Account Verification', 'GST Verification'],
    commonAPIs: ['Aadhaar OKYC with OTP', 'PAN Verification', 'Address Verification'],
    description: 'E-commerce needs seller verification and fraud prevention',
    keywords: ['ecommerce', 'marketplace', 'online retail', 'seller', 'd2c']
  },
  'Gaming': {
    criticalAPIs: ['Aadhaar OKYC with OTP', 'PAN Verification', 'Bank Account Verification'],
    commonAPIs: ['Selfie Validation', 'Face Match', 'AML Search'],
    description: 'Gaming companies need age verification and withdrawal KYC',
    keywords: ['gaming', 'fantasy', 'esports', 'real money gaming', 'casino']
  },
  'Telecom': {
    criticalAPIs: ['Aadhaar OKYC with OTP', 'Selfie Validation', 'Liveness Check'],
    commonAPIs: ['PAN Verification', 'Document OCR', 'Address Verification'],
    description: 'Telecoms need digital KYC for SIM activation',
    keywords: ['telecom', 'mobile', 'sim', 'connectivity', 'network operator']
  },
  'Healthcare': {
    criticalAPIs: ['Aadhaar OKYC with OTP', 'Face Match', 'Document OCR'],
    commonAPIs: ['PAN Verification', 'Bank Account Verification'],
    description: 'Healthcare needs patient verification and insurance claims',
    keywords: ['healthcare', 'hospital', 'clinic', 'healthtech', 'medical', 'pharma']
  }
};

// Estimated company sizes and their API spending
const SIZE_REVENUE_ESTIMATES: Record<string, { min: number; max: number }> = {
  'small': { min: 500, max: 5000 },       // $500-5k/month
  'medium': { min: 5000, max: 25000 },    // $5k-25k/month
  'large': { min: 25000, max: 100000 },   // $25k-100k/month
  'enterprise': { min: 100000, max: 500000 } // $100k-500k/month
};

export class ProspectEngine {
  private clients: ClientData[];
  private segmentStats: Map<string, {
    avgRevenue: number;
    topAPIs: string[];
    companyCount: number;
  }>;

  constructor(clients: ClientData[]) {
    this.clients = clients;
    this.segmentStats = new Map();
    this.buildSegmentStats();
  }

  private buildSegmentStats(): void {
    const segmentData: Map<string, {
      totalRevenue: number;
      companies: number;
      apiCounts: Map<string, number>;
    }> = new Map();

    for (const client of this.clients) {
      const segment = client.profile?.segment || 'Unknown';

      if (!segmentData.has(segment)) {
        segmentData.set(segment, { totalRevenue: 0, companies: 0, apiCounts: new Map() });
      }

      const data = segmentData.get(segment)!;
      data.companies++;

      // Sum revenue
      const totalRev = client.monthly_data?.reduce((sum, m) => sum + (m.total_revenue_usd || 0), 0) || 0;
      data.totalRevenue += totalRev;

      // Count APIs
      client.monthly_data?.forEach(month => {
        month.apis?.forEach(api => {
          if (api.name) {
            const count = data.apiCounts.get(api.name) || 0;
            data.apiCounts.set(api.name, count + 1);
          }
        });
      });
    }

    // Convert to stats
    segmentData.forEach((data, segment) => {
      const topAPIs = Array.from(data.apiCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name);

      this.segmentStats.set(segment, {
        avgRevenue: data.totalRevenue / data.companies,
        topAPIs,
        companyCount: data.companies
      });
    });
  }

  // Identify segment from company description/keywords
  identifySegment(description: string): string {
    const lowerDesc = description.toLowerCase();

    for (const [segment, data] of Object.entries(INDUSTRY_API_NEEDS)) {
      if (data.keywords.some(keyword => lowerDesc.includes(keyword))) {
        return segment;
      }
    }

    return 'Fintech'; // Default for unknown
  }

  // Generate recommendations for a prospect company
  generateProspectRecommendations(
    companyName: string,
    segment: string,
    size: 'small' | 'medium' | 'large' | 'enterprise',
    geography: string = 'India'
  ): ProspectCompany {
    const segmentNeeds = INDUSTRY_API_NEEDS[segment] || INDUSTRY_API_NEEDS['Fintech'];
    const sizeEstimate = SIZE_REVENUE_ESTIMATES[size];
    const segmentStatsData = this.segmentStats.get(segment);

    const recommendations: APIRecommendation[] = [];

    // Add critical APIs with high scores
    segmentNeeds.criticalAPIs.forEach((apiName, index) => {
      recommendations.push({
        apiName,
        score: 95 - (index * 5),
        confidence: 0.95,
        reason: `Critical for ${segment} operations`,
        category: 'segment_match',
        potentialRevenue: this.estimateAPIRevenue(apiName, size),
        adoptedBy: this.getTopAdopters(apiName, segment)
      });
    });

    // Add common APIs with medium scores
    segmentNeeds.commonAPIs.forEach((apiName, index) => {
      recommendations.push({
        apiName,
        score: 75 - (index * 5),
        confidence: 0.8,
        reason: `Commonly used by ${segment} companies`,
        category: 'segment_match',
        potentialRevenue: this.estimateAPIRevenue(apiName, size),
        adoptedBy: this.getTopAdopters(apiName, segment)
      });
    });

    const estimatedMonthly = (sizeEstimate.min + sizeEstimate.max) / 2;
    const estimatedAnnual = estimatedMonthly * 12;

    const fitScore = this.calculateFitScore(segment, size, geography);

    return {
      name: companyName,
      segment,
      geography,
      estimatedSize: size,
      recommendedAPIs: recommendations,
      estimatedAnnualValue: estimatedAnnual,
      fitScore,
      source: 'manual_entry'
    };
  }

  private estimateAPIRevenue(
    apiName: string,
    size: 'small' | 'medium' | 'large' | 'enterprise'
  ): number {
    const sizeMultipliers = {
      'small': 0.2,
      'medium': 0.5,
      'large': 1.0,
      'enterprise': 2.5
    };

    // Base estimates per API type
    const baseEstimates: Record<string, number> = {
      'Selfie Validation': 5000,
      'Liveness Check': 3000,
      'Aadhaar OKYC with OTP': 4000,
      'PAN Verification': 2000,
      'Bank Account Verification': 3500,
      'Face Match': 2500,
      'AML Search': 1500,
      'CKYC Search & Download': 2000,
      'Document OCR': 1800,
    };

    const base = baseEstimates[apiName] || 2000;
    return Math.round(base * sizeMultipliers[size]);
  }

  private getTopAdopters(apiName: string, segment: string): string[] {
    return this.clients
      .filter(c => {
        const hasAPI = c.monthly_data?.some(m =>
          m.apis?.some(a => a.name === apiName)
        );
        return hasAPI && c.profile?.segment === segment;
      })
      .slice(0, 5)
      .map(c => c.client_name);
  }

  private calculateFitScore(
    segment: string,
    size: 'small' | 'medium' | 'large' | 'enterprise',
    geography: string
  ): number {
    let score = 50;

    // Segment fit - do we serve this segment well?
    const segmentStats = this.segmentStats.get(segment);
    if (segmentStats && segmentStats.companyCount > 10) {
      score += 20;
    } else if (segmentStats && segmentStats.companyCount > 5) {
      score += 10;
    }

    // Size fit
    if (size === 'medium' || size === 'large') {
      score += 15; // Sweet spot
    } else if (size === 'enterprise') {
      score += 10;
    } else {
      score += 5;
    }

    // Geography fit
    if (geography === 'India') {
      score += 15;
    } else if (['ASEAN', 'SEA', 'Vietnam', 'Indonesia'].includes(geography)) {
      score += 10;
    } else {
      score += 5;
    }

    return Math.min(100, score);
  }

  // Generate outreach recommendations for a segment
  generateOutreachPlan(segment: string, geography: string = 'India'): OutreachRecommendation {
    const segmentNeeds = INDUSTRY_API_NEEDS[segment] || INDUSTRY_API_NEEDS['Fintech'];
    const segmentStatsData = this.segmentStats.get(segment);

    // Sample existing clients in segment for context
    const existingClients = this.clients
      .filter(c => c.profile?.segment === segment)
      .slice(0, 10)
      .map(c => ({
        name: c.client_name,
        revenue: c.monthly_data?.reduce((sum, m) => sum + (m.total_revenue_usd || 0), 0) || 0
      }));

    const marketPotential = (segmentStatsData?.avgRevenue || 10000) * 50; // Assume 50 potential clients

    // Build sales pitch
    const salesPitch = this.generateSalesPitch(segment, segmentNeeds);

    return {
      segment,
      geography,
      targetCompanies: [], // Would be populated by company search
      marketPotential,
      bestAPIs: segmentNeeds.criticalAPIs,
      salesPitch
    };
  }

  private generateSalesPitch(
    segment: string,
    needs: { criticalAPIs: string[]; description: string }
  ): string {
    const stats = this.segmentStats.get(segment);
    const clientCount = stats?.companyCount || 0;

    return `${needs.description}. ` +
      `We already serve ${clientCount}+ ${segment} companies. ` +
      `Key solutions: ${needs.criticalAPIs.slice(0, 3).join(', ')}. ` +
      `Average client sees 40% faster onboarding and 60% fraud reduction.`;
  }

  // Get all segment options for prospecting
  getSegmentOptions(): { segment: string; description: string; clientCount: number }[] {
    return Object.entries(INDUSTRY_API_NEEDS).map(([segment, data]) => ({
      segment,
      description: data.description,
      clientCount: this.segmentStats.get(segment)?.companyCount || 0
    }));
  }

  // Find prospects similar to best clients
  getIdealCustomerProfile(segment: string): {
    avgMonthlyRevenue: number;
    topAPIs: string[];
    geography: string;
    exampleClients: string[];
  } {
    const segmentClients = this.clients
      .filter(c => c.profile?.segment === segment)
      .map(c => ({
        name: c.client_name,
        geography: c.profile?.geography || 'Unknown',
        revenue: c.monthly_data?.reduce((sum, m) => sum + (m.total_revenue_usd || 0), 0) || 0,
        apiCount: new Set(c.monthly_data?.flatMap(m => m.apis?.map(a => a.name) || [])).size
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const topClients = segmentClients.slice(0, 10);
    const avgRevenue = topClients.reduce((sum, c) => sum + c.revenue, 0) / topClients.length / 12;

    const geographyCounts = new Map<string, number>();
    topClients.forEach(c => {
      geographyCounts.set(c.geography, (geographyCounts.get(c.geography) || 0) + 1);
    });
    const topGeography = Array.from(geographyCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'India';

    const stats = this.segmentStats.get(segment);

    return {
      avgMonthlyRevenue: avgRevenue,
      topAPIs: stats?.topAPIs || [],
      geography: topGeography,
      exampleClients: topClients.slice(0, 5).map(c => c.name)
    };
  }
}

export function createProspectEngine(clients: ClientData[]): ProspectEngine {
  return new ProspectEngine(clients);
}
