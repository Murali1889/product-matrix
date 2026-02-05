/**
 * AI Recommendation Cache
 * Stores AI analysis results to avoid repeated API calls
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), '../extractor/output/ai-cache');

export interface CachedAnalysis {
  companyName: string;
  normalizedName: string;
  isExistingClient: boolean;
  clientData?: {
    segment: string;
    geography: string;
    currentAPIs: { name: string; revenue: number }[];
    totalRevenue: number;
    monthlyAvg: number;
  };
  aiAnalysis: {
    description: string;
    industry: string;
    businessModel: string;
    recommendations: {
      api: string;
      priority: string;
      reason: string;
      potentialRevenue: { monthly: number; annual: number };
    }[];
    salesStrategy: {
      primaryPitch: string;
      keyValueProps: string[];
    };
    outreach: {
      emailSubject: string;
      openingLine: string;
    };
    totalPotentialValue: { monthly: number; annual: number };
  };
  cachedAt: string;
  expiresAt: string;
}

// Normalize company name for cache key
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// Get cache file path
function getCacheFilePath(companyName: string): string {
  return path.join(CACHE_DIR, `${normalizeCompanyName(companyName)}.json`);
}

// Check if cache exists and is valid
export async function getCachedAnalysis(companyName: string): Promise<CachedAnalysis | null> {
  try {
    const filePath = getCacheFilePath(companyName);
    const content = await readFile(filePath, 'utf-8');
    const cached = JSON.parse(content) as CachedAnalysis;

    // Check if expired (default 7 days)
    const expiresAt = new Date(cached.expiresAt);
    if (expiresAt < new Date()) {
      return null; // Expired
    }

    return cached;
  } catch {
    return null; // No cache or error
  }
}

// Save analysis to cache
export async function cacheAnalysis(analysis: CachedAnalysis): Promise<void> {
  try {
    // Ensure cache directory exists
    await mkdir(CACHE_DIR, { recursive: true });

    const filePath = getCacheFilePath(analysis.companyName);
    await writeFile(filePath, JSON.stringify(analysis, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to cache analysis:', error);
  }
}

// Clear cache for a company (force refresh)
export async function clearCache(companyName: string): Promise<void> {
  try {
    const { unlink } = await import('fs/promises');
    const filePath = getCacheFilePath(companyName);
    await unlink(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
}

// Get all cached analyses
export async function getAllCachedAnalyses(): Promise<CachedAnalysis[]> {
  try {
    const { readdir } = await import('fs/promises');
    const files = await readdir(CACHE_DIR);
    const analyses: CachedAnalysis[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await readFile(path.join(CACHE_DIR, file), 'utf-8');
          analyses.push(JSON.parse(content));
        } catch {
          // Skip invalid files
        }
      }
    }

    return analyses;
  } catch {
    return [];
  }
}
