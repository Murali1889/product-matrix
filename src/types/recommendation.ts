// API Recommendation System Types

export interface SegmentAPIProfile {
  segment: string;
  apis: {
    name: string;
    adoptionRate: number;  // % of companies in segment using this API
    avgRevenue: number;    // Average revenue per company
    importance: 'critical' | 'common' | 'optional';
  }[];
  totalCompanies: number;
  totalRevenue: number;
}

export interface APIRecommendation {
  apiName: string;
  subModule?: string;
  score: number;           // 0-100 recommendation score
  confidence: number;      // 0-1 confidence level
  reason: string;
  category: 'segment_match' | 'similar_company' | 'upsell' | 'cross_sell' | 'trending';
  potentialRevenue: number;
  adoptedBy: string[];     // Similar companies using this API
}

export interface CompanySimilarity {
  clientName: string;
  similarityScore: number;
  segment: string;
  sharedAPIs: string[];
  uniqueAPIs: string[];    // APIs they have that target doesn't
  revenue: number;
}

export interface ClientRecommendations {
  clientName: string;
  segment: string;
  currentAPIs: string[];
  recommendations: APIRecommendation[];
  similarCompanies: CompanySimilarity[];
  potentialUpsell: number;  // Total potential additional revenue
}

export interface ProspectCompany {
  name: string;
  website?: string;
  segment: string;
  geography: string;
  estimatedSize: 'small' | 'medium' | 'large' | 'enterprise';
  recommendedAPIs: APIRecommendation[];
  estimatedAnnualValue: number;
  fitScore: number;        // How well they match ideal customer profile
  source: string;          // Where the lead came from
}

export interface OutreachRecommendation {
  segment: string;
  geography: string;
  targetCompanies: ProspectCompany[];
  marketPotential: number;
  bestAPIs: string[];      // APIs to lead with for this segment
  salesPitch: string;      // Generated pitch points
}

export interface RecommendationEngineStats {
  totalClientsAnalyzed: number;
  totalAPIsTracked: number;
  segmentsIdentified: string[];
  avgRecommendationsPerClient: number;
  topRecommendedAPIs: { name: string; count: number }[];
}
