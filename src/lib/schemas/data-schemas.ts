/**
 * Flexible Zod Schemas for Sales Intelligence Data
 * Handles varying data structures gracefully
 */

import { z } from 'zod';

// ============================================================================
// Helper Transformers
// ============================================================================

/**
 * Converts string/number to number, handles currency formats
 */
const toNumber = (val: unknown): number => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    // Remove currency symbols, commas, spaces
    const cleaned = val.replace(/[$,\s]/g, '').trim();
    if (!cleaned || cleaned === '-') return 0;
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

/**
 * Converts string/array to string array
 */
const toStringArray = (val: unknown): string[] => {
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === 'string') {
    return val.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
  }
  return [];
};

/**
 * Normalizes company/client names for matching
 */
export const normalizeName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\s*(pvt\.?|private|ltd\.?|limited|inc\.?|llp|llc)\s*/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
};

// ============================================================================
// Core Data Schemas
// ============================================================================

/**
 * Flexible client schema - handles CSV, JSON, and mixed formats
 */
export const FlexibleClientSchema = z.object({
  // Required: name (flexible)
  name: z.union([
    z.string(),
    z.object({ value: z.string() }).transform(o => o.value),
  ]).transform(s => s.trim()),

  // Optional: sector/industry (multiple field names)
  sector: z.string().optional(),
  industry: z.string().optional(),
  vertical: z.string().optional(),

  // Optional: revenue (flexible formats)
  revenue: z.union([z.number(), z.string(), z.null(), z.undefined()])
    .transform(toNumber)
    .optional()
    .default(0),
  totalRevenue: z.union([z.number(), z.string(), z.null(), z.undefined()])
    .transform(toNumber)
    .optional(),
  annualRevenue: z.union([z.number(), z.string(), z.null(), z.undefined()])
    .transform(toNumber)
    .optional(),

  // Optional: APIs (flexible formats)
  apis: z.union([z.array(z.string()), z.string(), z.null(), z.undefined()])
    .transform(toStringArray)
    .optional()
    .default([]),
  apisUsed: z.union([z.array(z.string()), z.string(), z.null(), z.undefined()])
    .transform(toStringArray)
    .optional(),
  products: z.union([z.array(z.string()), z.string(), z.null(), z.undefined()])
    .transform(toStringArray)
    .optional(),

  // Optional: API calls/usage
  apiCalls: z.union([z.number(), z.string(), z.null(), z.undefined()])
    .transform(toNumber)
    .optional()
    .default(0),
  totalCalls: z.union([z.number(), z.string(), z.null(), z.undefined()])
    .transform(toNumber)
    .optional(),

  // Optional: timestamps
  createdAt: z.union([z.string(), z.date(), z.null(), z.undefined()]).optional(),
  updatedAt: z.union([z.string(), z.date(), z.null(), z.undefined()]).optional(),

}).passthrough().transform((data) => {
  // Normalize: pick best available value for each field
  return {
    name: data.name,
    sector: data.sector || data.industry || data.vertical || 'Unknown',
    revenue: data.totalRevenue || data.annualRevenue || data.revenue || 0,
    apis: [...new Set([
      ...(data.apis || []),
      ...(data.apisUsed || []),
      ...(data.products || []),
    ])],
    apiCalls: data.totalCalls || data.apiCalls || 0,
    // Preserve any extra fields
    _raw: data,
  };
});

export type NormalizedClient = z.infer<typeof FlexibleClientSchema>;

/**
 * API Product schema
 */
export const APIProductSchema = z.object({
  name: z.string(),
  category: z.string().optional().default('General'),
  description: z.string().optional().default(''),
  pricing: z.object({
    type: z.enum(['per-call', 'subscription', 'tiered', 'custom']).optional().default('per-call'),
    basePrice: z.number().optional().default(0),
    currency: z.string().optional().default('USD'),
  }).optional().default({ type: 'per-call', basePrice: 0, currency: 'USD' }),
  features: z.array(z.string()).optional().default([]),
  compliance: z.array(z.string()).optional().default([]),
  integrationTime: z.string().optional().default('1-2 weeks'),
}).passthrough();

export type APIProduct = z.infer<typeof APIProductSchema>;

/**
 * Company Research Result schema (from Google Search)
 */
export const CompanyResearchSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  headquarters: z.string().optional(),
  employeeCount: z.union([z.number(), z.string()]).optional(),
  funding: z.object({
    total: z.string().optional(),
    lastRound: z.string().optional(),
    investors: z.array(z.string()).optional(),
  }).optional(),
  recentNews: z.array(z.object({
    title: z.string(),
    snippet: z.string(),
    link: z.string(),
    date: z.string().optional(),
  })).optional().default([]),
  socialLinks: z.object({
    linkedin: z.string().optional(),
    twitter: z.string().optional(),
    website: z.string().optional(),
  }).optional(),
  fetchedAt: z.string().optional(),
});

export type CompanyResearch = z.infer<typeof CompanyResearchSchema>;

/**
 * Sales Intelligence Result schema
 */
export const SalesIntelSchema = z.object({
  company: z.string(),
  isExistingClient: z.boolean(),
  source: z.enum(['database', 'google', 'ai', 'combined']),

  // Current state (for existing clients)
  currentData: z.object({
    revenue: z.number(),
    apis: z.array(z.string()),
    apiCalls: z.number(),
    sector: z.string(),
  }).optional(),

  // Recommendations
  recommendations: z.array(z.object({
    api: z.string(),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    reasoning: z.string(),
    estimatedRevenue: z.number().optional(),
    similarClients: z.array(z.string()).optional(),
  })),

  // Sales data
  opportunityValue: z.object({
    monthly: z.number(),
    annual: z.number(),
    confidence: z.number(), // 0-1
  }),

  dealPriority: z.enum(['hot', 'warm', 'cold']),

  pitch: z.object({
    headline: z.string(),
    talkingPoints: z.array(z.string()),
    objectionHandling: z.array(z.object({
      objection: z.string(),
      response: z.string(),
    })).optional(),
  }),

  // Metadata
  generatedAt: z.string(),
  aiUsed: z.boolean(),
  searchUsed: z.boolean(),
});

export type SalesIntel = z.infer<typeof SalesIntelSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Safely parse client data with fallback
 */
export function parseClient(data: unknown): NormalizedClient | null {
  try {
    return FlexibleClientSchema.parse(data);
  } catch (error) {
    console.warn('Failed to parse client data:', error);
    return null;
  }
}

/**
 * Parse array of clients, filtering out failures
 */
export function parseClients(data: unknown[]): NormalizedClient[] {
  return data.map(parseClient).filter((c): c is NormalizedClient => c !== null);
}

/**
 * Validate and return with errors (for debugging)
 */
export function validateClient(data: unknown): {
  success: boolean;
  data?: NormalizedClient;
  errors?: z.ZodError
} {
  const result = FlexibleClientSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

// ============================================================================
// Data Freshness Tracking
// ============================================================================

export interface DataFreshness {
  source: string;
  loadedAt: Date;
  recordCount: number;
  validCount: number;
  invalidCount: number;
  staleness: 'fresh' | 'stale' | 'expired';
}

const FRESHNESS_THRESHOLDS = {
  fresh: 5 * 60 * 1000,      // 5 minutes
  stale: 30 * 60 * 1000,     // 30 minutes
  expired: 60 * 60 * 1000,   // 1 hour
};

export function checkFreshness(loadedAt: Date): DataFreshness['staleness'] {
  const age = Date.now() - loadedAt.getTime();
  if (age < FRESHNESS_THRESHOLDS.fresh) return 'fresh';
  if (age < FRESHNESS_THRESHOLDS.stale) return 'stale';
  return 'expired';
}
