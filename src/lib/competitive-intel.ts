/**
 * Competitive Intelligence
 * Shows why HyperVerge is better than competitors
 *
 * Key differentiators:
 * - Price (₹0.50/call vs competitors at ₹2-5/call)
 * - Security (ISO 27001, SOC2, GDPR compliant)
 * - Accuracy (99.9% accuracy, <500ms response)
 * - Local presence (India-first, local support)
 */

// ============================================================================
// Competitor Data
// ============================================================================

export interface CompetitorInfo {
  name: string;
  pricePerCall: number; // in INR
  marketFocus: string;
  weaknesses: string[];
}

export const COMPETITORS: Record<string, CompetitorInfo> = {
  'Onfido': {
    name: 'Onfido',
    pricePerCall: 3.50,
    marketFocus: 'Global/Enterprise',
    weaknesses: ['Expensive', 'Slow India support', 'Limited local compliance'],
  },
  'Jumio': {
    name: 'Jumio',
    pricePerCall: 4.00,
    marketFocus: 'Global/Enterprise',
    weaknesses: ['Very expensive', 'No India datacenter', 'Overkill for most use cases'],
  },
  'IDfy': {
    name: 'IDfy',
    pricePerCall: 1.20,
    marketFocus: 'India/SMB',
    weaknesses: ['Limited API coverage', 'Slower response times', 'Basic dashboard'],
  },
  'Signzy': {
    name: 'Signzy',
    pricePerCall: 1.50,
    marketFocus: 'India/Banking',
    weaknesses: ['Banking-focused only', 'Complex integration', 'Legacy architecture'],
  },
  'Digio': {
    name: 'Digio',
    pricePerCall: 0.80,
    marketFocus: 'India/eSign',
    weaknesses: ['Primarily eSign', 'Limited KYC depth', 'Smaller API catalog'],
  },
};

// ============================================================================
// HyperVerge Advantages
// ============================================================================

export const HYPERVERGE_PRICING_INR = 0.50;

export const HYPERVERGE_ADVANTAGES = {
  pricing: {
    headline: 'Up to 85% cheaper',
    detail: `₹${HYPERVERGE_PRICING_INR}/call vs industry avg ₹2-4/call`,
  },
  security: {
    headline: 'Bank-grade security',
    certifications: ['ISO 27001', 'SOC2 Type II', 'GDPR', 'RBI compliant'],
  },
  performance: {
    headline: '99.9% accuracy',
    details: ['<500ms average response', '99.99% uptime SLA', 'Real-time fraud detection'],
  },
  coverage: {
    headline: '50+ APIs',
    details: ['Identity', 'Financial', 'Background', 'Biometric', 'Document'],
  },
  support: {
    headline: 'India-first',
    details: ['24/7 local support', 'Bangalore HQ', 'Dedicated account manager'],
  },
};

// ============================================================================
// Comparison Functions
// ============================================================================

export interface CompetitorComparison {
  competitor: string;
  hypervergePrice: number;
  competitorPrice: number;
  savingsPercent: number;
  monthlySavings: number;
  annualSavings: number;
  weaknesses: string[];
}

/**
 * Calculate savings vs a competitor
 */
export function compareWithCompetitor(
  competitorName: string,
  estimatedMonthlyVolume: number
): CompetitorComparison | null {
  const competitor = COMPETITORS[competitorName];
  if (!competitor) return null;

  const hypervergeMonthly = estimatedMonthlyVolume * HYPERVERGE_PRICING_INR;
  const competitorMonthly = estimatedMonthlyVolume * competitor.pricePerCall;
  const monthlySavings = competitorMonthly - hypervergeMonthly;
  const savingsPercent = ((monthlySavings / competitorMonthly) * 100);

  return {
    competitor: competitorName,
    hypervergePrice: HYPERVERGE_PRICING_INR,
    competitorPrice: competitor.pricePerCall,
    savingsPercent: Math.round(savingsPercent),
    monthlySavings: Math.round(monthlySavings),
    annualSavings: Math.round(monthlySavings * 12),
    weaknesses: competitor.weaknesses,
  };
}

/**
 * Get best competitor comparison for sales pitch
 */
export function getBestComparison(estimatedMonthlyVolume: number): CompetitorComparison {
  // Default to Onfido as the "premium" competitor to compare against
  const comparison = compareWithCompetitor('Onfido', estimatedMonthlyVolume);
  return comparison || {
    competitor: 'Industry Average',
    hypervergePrice: HYPERVERGE_PRICING_INR,
    competitorPrice: 2.50,
    savingsPercent: 80,
    monthlySavings: Math.round(estimatedMonthlyVolume * 2.0),
    annualSavings: Math.round(estimatedMonthlyVolume * 2.0 * 12),
    weaknesses: ['Higher costs', 'Limited local support'],
  };
}

/**
 * Generate competitive pitch points
 */
export function getCompetitivePitchPoints(estimatedMonthlyVolume: number): string[] {
  const comparison = getBestComparison(estimatedMonthlyVolume);

  return [
    `Save ₹${comparison.annualSavings.toLocaleString()}/year vs ${comparison.competitor}`,
    `${comparison.savingsPercent}% lower cost at ₹${HYPERVERGE_PRICING_INR}/call`,
    'ISO 27001 & SOC2 certified - same security as global players',
    '99.9% accuracy with <500ms response time',
    'India-based support team, no timezone issues',
  ];
}

/**
 * API category to likely competitor mapping
 */
export const API_TO_COMPETITOR_MAP: Record<string, string[]> = {
  'Face Match': ['Onfido', 'Jumio'],
  'Selfie Validation': ['Onfido', 'Jumio', 'IDfy'],
  'Liveness': ['Onfido', 'Jumio'],
  'Aadhaar': ['IDfy', 'Signzy', 'Digio'],
  'PAN': ['IDfy', 'Signzy'],
  'Bank Account': ['Signzy', 'IDfy'],
  'AML': ['Onfido', 'Signzy'],
  'CKYC': ['IDfy', 'Signzy'],
  'Document OCR': ['Onfido', 'IDfy'],
  'eSign': ['Digio', 'Signzy'],
};

/**
 * Get likely competitors for an API
 */
export function getLikelyCompetitors(apiName: string): string[] {
  for (const [key, competitors] of Object.entries(API_TO_COMPETITOR_MAP)) {
    if (apiName.toLowerCase().includes(key.toLowerCase())) {
      return competitors;
    }
  }
  return ['IDfy', 'Signzy']; // Default Indian competitors
}
