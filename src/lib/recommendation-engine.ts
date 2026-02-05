import type { ClientData, APIUsage } from '@/types/client';
import type {
  SegmentAPIProfile,
  APIRecommendation,
  CompanySimilarity,
  ClientRecommendations,
  RecommendationEngineStats,
} from '@/types/recommendation';

// Master API categories for better recommendations
const API_CATEGORIES: Record<string, string[]> = {
  'Identity Verification': [
    'Aadhaar OKYC with OTP', 'Aadhaar PAN Link Verification', 'PAN Verification',
    'Voter ID Verification', 'Passport Verification', 'Driving License Verification',
    'CKYC Search & Download', 'CKYC Upload', 'CKYC Validate'
  ],
  'Face & Biometric': [
    'Selfie Validation', 'Face Match', 'Liveness Check', 'Face Comparison',
    'Selfie to ID Match', 'Face Recognition'
  ],
  'Bank & Financial': [
    'Bank Account Verification', 'Penny Drop', 'Reverse Penny Drop', 'Pennyless',
    'IFSC Verification', 'Cheque OCR', 'Passbook OCR', 'Bank Statement Analysis'
  ],
  'AML & Compliance': [
    'AML', 'AML Search', 'Ongoing Monitoring', 'Central DB Checks',
    'Court Record Checks', 'Clear Background Analysis'
  ],
  'Document OCR': [
    'Document OCR', 'PAN OCR', 'Aadhaar OCR', 'Passport OCR', 'DL OCR',
    'Invoice OCR', 'Utility Bill OCR', 'Address Extraction'
  ],
  'Business Verification': [
    'Company Verification', 'GST Verification', 'GSTIN Verification',
    'Udyam Verification', 'MCA Data', 'Director Verification'
  ],
  'Credit & Risk': [
    'Credit Bureau', 'CIBIL', 'Experian', 'CRIF', 'Credit Score',
    'Risk Assessment', 'Fraud Detection'
  ],
  'Vehicle & Transport': [
    'RC Verification', 'Vehicle Registration', 'Challan Verification',
    'Fastag Verification', 'Transport Verification'
  ],
};

// Segment to recommended API categories mapping
const SEGMENT_API_PRIORITIES: Record<string, string[]> = {
  'NBFC': ['Identity Verification', 'Bank & Financial', 'Credit & Risk', 'AML & Compliance', 'Document OCR'],
  'Payment Service Provider': ['Identity Verification', 'Bank & Financial', 'Face & Biometric', 'AML & Compliance'],
  'Wealth Management': ['Identity Verification', 'AML & Compliance', 'Bank & Financial', 'Business Verification'],
  'Brokerage': ['Identity Verification', 'Bank & Financial', 'AML & Compliance', 'Document OCR'],
  'Insurance': ['Identity Verification', 'Face & Biometric', 'Document OCR', 'AML & Compliance'],
  'Gig economy': ['Face & Biometric', 'Identity Verification', 'Document OCR', 'Vehicle & Transport'],
  'Fintech': ['Identity Verification', 'Bank & Financial', 'Face & Biometric', 'Credit & Risk'],
  'E-commerce': ['Identity Verification', 'Face & Biometric', 'Bank & Financial'],
  'Gaming': ['Identity Verification', 'Face & Biometric', 'Bank & Financial'],
  'Telecom': ['Identity Verification', 'Face & Biometric', 'Document OCR'],
  'Healthcare': ['Identity Verification', 'Document OCR', 'Face & Biometric'],
  'Logistics': ['Identity Verification', 'Vehicle & Transport', 'Face & Biometric'],
  'Channel Partner': ['Identity Verification', 'Bank & Financial', 'Document OCR', 'AML & Compliance'],
};

export class RecommendationEngine {
  private clients: ClientData[];
  private segmentProfiles: Map<string, SegmentAPIProfile>;
  private apiUsageMatrix: Map<string, Map<string, number>>; // client -> api -> revenue
  private masterAPIs: string[];

  constructor(clients: ClientData[], masterAPIs: string[]) {
    this.clients = clients;
    this.masterAPIs = masterAPIs;
    this.segmentProfiles = new Map();
    this.apiUsageMatrix = new Map();
    this.buildProfiles();
  }

  private buildProfiles(): void {
    // Build API usage matrix
    for (const client of this.clients) {
      const clientAPIs = new Map<string, number>();

      // Aggregate all API usage across months
      client.monthly_data?.forEach(month => {
        month.apis?.forEach(api => {
          if (api.name) {
            const current = clientAPIs.get(api.name) || 0;
            clientAPIs.set(api.name, current + (api.revenue_usd || 0));
          }
        });
      });

      this.apiUsageMatrix.set(client.client_name, clientAPIs);
    }

    // Build segment profiles
    const segmentData: Map<string, {
      clients: ClientData[];
      apiCounts: Map<string, { count: number; revenue: number }>;
    }> = new Map();

    for (const client of this.clients) {
      const segment = client.profile?.segment || 'Unknown';

      if (!segmentData.has(segment)) {
        segmentData.set(segment, { clients: [], apiCounts: new Map() });
      }

      const data = segmentData.get(segment)!;
      data.clients.push(client);

      // Count API usage in this segment
      const clientAPIs = this.apiUsageMatrix.get(client.client_name);
      clientAPIs?.forEach((revenue, apiName) => {
        const current = data.apiCounts.get(apiName) || { count: 0, revenue: 0 };
        data.apiCounts.set(apiName, {
          count: current.count + 1,
          revenue: current.revenue + revenue
        });
      });
    }

    // Convert to segment profiles
    segmentData.forEach((data, segment) => {
      const totalCompanies = data.clients.length;
      const totalRevenue = data.clients.reduce((sum, c) =>
        sum + (c.monthly_data?.reduce((s, m) => s + (m.total_revenue_usd || 0), 0) || 0), 0
      );

      const apis = Array.from(data.apiCounts.entries())
        .map(([name, stats]) => ({
          name,
          adoptionRate: (stats.count / totalCompanies) * 100,
          avgRevenue: stats.revenue / stats.count,
          importance: this.classifyImportance(stats.count / totalCompanies)
        }))
        .sort((a, b) => b.adoptionRate - a.adoptionRate);

      this.segmentProfiles.set(segment, {
        segment,
        apis,
        totalCompanies,
        totalRevenue
      });
    });
  }

  private classifyImportance(adoptionRate: number): 'critical' | 'common' | 'optional' {
    if (adoptionRate >= 0.5) return 'critical';
    if (adoptionRate >= 0.2) return 'common';
    return 'optional';
  }

  // Calculate Jaccard similarity between two clients based on API usage
  private calculateSimilarity(client1: string, client2: string): number {
    const apis1 = this.apiUsageMatrix.get(client1);
    const apis2 = this.apiUsageMatrix.get(client2);

    if (!apis1 || !apis2) return 0;

    const set1 = new Set(apis1.keys());
    const set2 = new Set(apis2.keys());

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  // Get recommendations for a specific client
  getClientRecommendations(clientName: string): ClientRecommendations | null {
    const client = this.clients.find(c => c.client_name === clientName);
    if (!client) return null;

    const segment = client.profile?.segment || 'Unknown';
    const currentAPIs = Array.from(this.apiUsageMatrix.get(clientName)?.keys() || []);
    const recommendations: APIRecommendation[] = [];

    // 1. Segment-based recommendations
    const segmentProfile = this.segmentProfiles.get(segment);
    if (segmentProfile) {
      segmentProfile.apis
        .filter(api => !currentAPIs.includes(api.name))
        .slice(0, 10)
        .forEach(api => {
          recommendations.push({
            apiName: api.name,
            score: Math.round(api.adoptionRate),
            confidence: api.adoptionRate / 100,
            reason: `${Math.round(api.adoptionRate)}% of ${segment} companies use this API`,
            category: 'segment_match',
            potentialRevenue: api.avgRevenue,
            adoptedBy: this.getAdopters(api.name, segment).slice(0, 5)
          });
        });
    }

    // 2. Similar company recommendations
    const similarCompanies = this.findSimilarCompanies(clientName, 10);
    const similarCompanyAPIs: Map<string, { count: number; companies: string[] }> = new Map();

    similarCompanies.forEach(similar => {
      similar.uniqueAPIs.forEach(api => {
        const current = similarCompanyAPIs.get(api) || { count: 0, companies: [] };
        similarCompanyAPIs.set(api, {
          count: current.count + 1,
          companies: [...current.companies, similar.clientName]
        });
      });
    });

    similarCompanyAPIs.forEach((data, apiName) => {
      if (!currentAPIs.includes(apiName) && !recommendations.find(r => r.apiName === apiName)) {
        recommendations.push({
          apiName,
          score: Math.round((data.count / similarCompanies.length) * 100),
          confidence: data.count / similarCompanies.length,
          reason: `Used by ${data.count} similar companies`,
          category: 'similar_company',
          potentialRevenue: this.getAvgAPIRevenue(apiName),
          adoptedBy: data.companies.slice(0, 5)
        });
      }
    });

    // 3. Category-based cross-sell
    const usedCategories = new Set<string>();
    currentAPIs.forEach(api => {
      Object.entries(API_CATEGORIES).forEach(([category, apis]) => {
        if (apis.some(a => api.toLowerCase().includes(a.toLowerCase()))) {
          usedCategories.add(category);
        }
      });
    });

    // Recommend APIs from priority categories they're not using
    const priorityCategories = SEGMENT_API_PRIORITIES[segment] || [];
    priorityCategories.forEach(category => {
      if (!usedCategories.has(category)) {
        const categoryAPIs = API_CATEGORIES[category] || [];
        categoryAPIs.slice(0, 2).forEach(apiName => {
          if (!currentAPIs.includes(apiName) && !recommendations.find(r => r.apiName === apiName)) {
            recommendations.push({
              apiName,
              score: 70,
              confidence: 0.7,
              reason: `${category} is essential for ${segment} - you're missing this capability`,
              category: 'cross_sell',
              potentialRevenue: this.getAvgAPIRevenue(apiName),
              adoptedBy: this.getAdopters(apiName, segment).slice(0, 5)
            });
          }
        });
      }
    });

    // Sort by score
    recommendations.sort((a, b) => b.score - a.score);

    const potentialUpsell = recommendations
      .slice(0, 5)
      .reduce((sum, r) => sum + r.potentialRevenue, 0);

    return {
      clientName,
      segment,
      currentAPIs,
      recommendations: recommendations.slice(0, 15),
      similarCompanies,
      potentialUpsell
    };
  }

  // Find similar companies
  findSimilarCompanies(clientName: string, limit: number = 10): CompanySimilarity[] {
    const targetClient = this.clients.find(c => c.client_name === clientName);
    if (!targetClient) return [];

    const targetAPIs = new Set(this.apiUsageMatrix.get(clientName)?.keys() || []);
    const targetSegment = targetClient.profile?.segment || '';

    const similarities: CompanySimilarity[] = [];

    for (const client of this.clients) {
      if (client.client_name === clientName) continue;

      const clientAPIs = new Set(this.apiUsageMatrix.get(client.client_name)?.keys() || []);
      const similarity = this.calculateSimilarity(clientName, client.client_name);

      if (similarity > 0) {
        const sharedAPIs = [...targetAPIs].filter(api => clientAPIs.has(api));
        const uniqueAPIs = [...clientAPIs].filter(api => !targetAPIs.has(api));

        const totalRevenue = client.monthly_data?.reduce(
          (sum, m) => sum + (m.total_revenue_usd || 0), 0
        ) || 0;

        similarities.push({
          clientName: client.client_name,
          similarityScore: similarity,
          segment: client.profile?.segment || 'Unknown',
          sharedAPIs,
          uniqueAPIs,
          revenue: totalRevenue
        });
      }
    }

    // Boost score for same segment
    similarities.forEach(s => {
      if (s.segment === targetSegment) {
        s.similarityScore = Math.min(1, s.similarityScore * 1.3);
      }
    });

    return similarities
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, limit);
  }

  private getAdopters(apiName: string, preferSegment?: string): string[] {
    const adopters: { name: string; segment: string; revenue: number }[] = [];

    this.apiUsageMatrix.forEach((apis, clientName) => {
      if (apis.has(apiName)) {
        const client = this.clients.find(c => c.client_name === clientName);
        adopters.push({
          name: clientName,
          segment: client?.profile?.segment || '',
          revenue: apis.get(apiName) || 0
        });
      }
    });

    // Sort by segment match, then revenue
    adopters.sort((a, b) => {
      if (preferSegment) {
        if (a.segment === preferSegment && b.segment !== preferSegment) return -1;
        if (b.segment === preferSegment && a.segment !== preferSegment) return 1;
      }
      return b.revenue - a.revenue;
    });

    return adopters.map(a => a.name);
  }

  private getAvgAPIRevenue(apiName: string): number {
    let totalRevenue = 0;
    let count = 0;

    this.apiUsageMatrix.forEach(apis => {
      const revenue = apis.get(apiName);
      if (revenue) {
        totalRevenue += revenue;
        count++;
      }
    });

    return count > 0 ? totalRevenue / count : 0;
  }

  // Get all segment profiles
  getSegmentProfiles(): SegmentAPIProfile[] {
    return Array.from(this.segmentProfiles.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  // Get engine statistics
  getStats(): RecommendationEngineStats {
    const apiRecommendationCounts: Map<string, number> = new Map();

    // Sample recommendations for stats
    const sampleClients = this.clients.slice(0, 100);
    sampleClients.forEach(client => {
      const recs = this.getClientRecommendations(client.client_name);
      recs?.recommendations.forEach(rec => {
        const count = apiRecommendationCounts.get(rec.apiName) || 0;
        apiRecommendationCounts.set(rec.apiName, count + 1);
      });
    });

    const topRecommendedAPIs = Array.from(apiRecommendationCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalClientsAnalyzed: this.clients.length,
      totalAPIsTracked: this.masterAPIs.length,
      segmentsIdentified: Array.from(this.segmentProfiles.keys()),
      avgRecommendationsPerClient: 10,
      topRecommendedAPIs
    };
  }

  // Get recommendations for a specific segment (for prospecting)
  getSegmentRecommendations(segment: string): {
    mustHaveAPIs: string[];
    commonAPIs: string[];
    topCompanies: { name: string; revenue: number }[];
    avgRevenue: number;
  } {
    const profile = this.segmentProfiles.get(segment);
    if (!profile) {
      return { mustHaveAPIs: [], commonAPIs: [], topCompanies: [], avgRevenue: 0 };
    }

    const mustHaveAPIs = profile.apis
      .filter(a => a.importance === 'critical')
      .map(a => a.name);

    const commonAPIs = profile.apis
      .filter(a => a.importance === 'common')
      .map(a => a.name);

    const segmentClients = this.clients
      .filter(c => c.profile?.segment === segment)
      .map(c => ({
        name: c.client_name,
        revenue: c.monthly_data?.reduce((sum, m) => sum + (m.total_revenue_usd || 0), 0) || 0
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return {
      mustHaveAPIs,
      commonAPIs,
      topCompanies: segmentClients,
      avgRevenue: profile.totalRevenue / profile.totalCompanies
    };
  }
}

// Utility function to create recommendation engine from API response
export function createRecommendationEngine(
  clients: ClientData[],
  masterAPIs: { moduleName: string; subModules: string[] }[]
): RecommendationEngine {
  const apiNames = masterAPIs.map(api => api.moduleName);
  return new RecommendationEngine(clients, apiNames);
}
