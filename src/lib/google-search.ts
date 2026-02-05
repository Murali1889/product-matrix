/**
 * Google Custom Search Integration
 * Real-time company research with rate limiting and caching
 *
 * Free tier: 100 queries/day
 * Caching: 24 hours to minimize API calls
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface SearchResult {
  title: string;
  snippet: string;
  link: string;
  source: 'news' | 'company' | 'linkedin' | 'crunchbase' | 'other';
  displayLink: string;
}

export interface CompanyResearchResult {
  company: string;
  searchedAt: string;
  results: {
    general: SearchResult[];
    news: SearchResult[];
    funding: SearchResult[];
    linkedin: SearchResult[];
  };
  extracted: {
    description?: string;
    headquarters?: string;
    employeeCount?: string;
    fundingInfo?: string;
    industry?: string;
    website?: string;
    recentNews: string[];
  };
  cached: boolean;
  quotaUsed: number;
}

// ============================================================================
// Rate Limiting & Caching
// ============================================================================

interface CacheEntry {
  data: CompanyResearchResult;
  expiresAt: number;
}

interface QuotaTracker {
  date: string;
  used: number;
  limit: number;
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const DAILY_QUOTA = 100;

const CACHE_DIR = path.join(process.cwd(), '.cache/google-search');
const QUOTA_FILE = path.join(CACHE_DIR, 'quota.json');

// In-memory cache for faster reads
const memoryCache = new Map<string, CacheEntry>();

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

/**
 * Get cache file path for a company
 */
function getCacheFilePath(company: string): string {
  const normalized = company.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return path.join(CACHE_DIR, `${normalized}.json`);
}

/**
 * Get cached result for a company
 */
async function getCachedResult(company: string): Promise<CompanyResearchResult | null> {
  const normalized = company.toLowerCase();

  // Check memory cache first
  const memEntry = memoryCache.get(normalized);
  if (memEntry && memEntry.expiresAt > Date.now()) {
    return { ...memEntry.data, cached: true };
  }

  // Check file cache
  try {
    const filePath = getCacheFilePath(company);
    const content = await readFile(filePath, 'utf-8');
    const entry: CacheEntry = JSON.parse(content);

    if (entry.expiresAt > Date.now()) {
      // Store in memory for faster subsequent access
      memoryCache.set(normalized, entry);
      return { ...entry.data, cached: true };
    }
  } catch {
    // Cache miss
  }

  return null;
}

/**
 * Save result to cache
 */
async function cacheResult(company: string, data: CompanyResearchResult): Promise<void> {
  const normalized = company.toLowerCase();
  const entry: CacheEntry = {
    data,
    expiresAt: Date.now() + CACHE_TTL,
  };

  // Memory cache
  memoryCache.set(normalized, entry);

  // File cache
  try {
    await ensureCacheDir();
    const filePath = getCacheFilePath(company);
    await writeFile(filePath, JSON.stringify(entry, null, 2));
  } catch (error) {
    console.warn('Failed to write cache file:', error);
  }
}

/**
 * Check and update quota
 */
async function checkQuota(): Promise<{ allowed: boolean; remaining: number }> {
  const today = new Date().toISOString().split('T')[0];

  try {
    await ensureCacheDir();
    const content = await readFile(QUOTA_FILE, 'utf-8');
    const quota: QuotaTracker = JSON.parse(content);

    if (quota.date === today) {
      if (quota.used >= DAILY_QUOTA) {
        return { allowed: false, remaining: 0 };
      }
      return { allowed: true, remaining: DAILY_QUOTA - quota.used };
    }

    // New day, reset quota
    return { allowed: true, remaining: DAILY_QUOTA };
  } catch {
    // No quota file, fresh start
    return { allowed: true, remaining: DAILY_QUOTA };
  }
}

/**
 * Increment quota usage
 */
async function incrementQuota(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  let quota: QuotaTracker = { date: today, used: 0, limit: DAILY_QUOTA };

  try {
    const content = await readFile(QUOTA_FILE, 'utf-8');
    quota = JSON.parse(content);

    if (quota.date !== today) {
      quota = { date: today, used: 0, limit: DAILY_QUOTA };
    }
  } catch {
    // Fresh start
  }

  quota.used++;

  try {
    await ensureCacheDir();
    await writeFile(QUOTA_FILE, JSON.stringify(quota, null, 2));
  } catch (error) {
    console.warn('Failed to update quota file:', error);
  }
}

// ============================================================================
// Google Search API
// ============================================================================

/**
 * Make a Google Custom Search API call
 */
async function googleSearch(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    console.warn('Google Search API credentials not configured');
    return [];
  }

  // Check quota before making request
  const quota = await checkQuota();
  if (!quota.allowed) {
    console.warn('Google Search API daily quota exceeded');
    return [];
  }

  try {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', searchEngineId);
    url.searchParams.set('q', query);
    url.searchParams.set('num', '10');

    const response = await fetch(url.toString());

    if (!response.ok) {
      console.error('Google Search API error:', response.status, await response.text());
      return [];
    }

    await incrementQuota();

    const data = await response.json();

    if (!data.items || !Array.isArray(data.items)) {
      return [];
    }

    return data.items.map((item: {
      title?: string;
      snippet?: string;
      link?: string;
      displayLink?: string;
    }) => {
      const link = item.link || '';
      let source: SearchResult['source'] = 'other';

      if (link.includes('linkedin.com')) source = 'linkedin';
      else if (link.includes('crunchbase.com')) source = 'crunchbase';
      else if (link.includes('news') || link.includes('times') || link.includes('economic')) source = 'news';
      else if (link.includes(item.displayLink || '')) source = 'company';

      return {
        title: item.title || '',
        snippet: item.snippet || '',
        link,
        source,
        displayLink: item.displayLink || '',
      };
    });
  } catch (error) {
    console.error('Google Search API error:', error);
    return [];
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Search for company information
 * Combines multiple searches for comprehensive data
 */
export async function searchCompanyInfo(companyName: string): Promise<CompanyResearchResult> {
  // Check cache first
  const cached = await getCachedResult(companyName);
  if (cached) {
    return cached;
  }

  let quotaUsed = 0;
  const results = {
    general: [] as SearchResult[],
    news: [] as SearchResult[],
    funding: [] as SearchResult[],
    linkedin: [] as SearchResult[],
  };

  // General company info
  results.general = await googleSearch(`${companyName} company India`);
  quotaUsed++;

  // Recent news (only if we have quota)
  const quota1 = await checkQuota();
  if (quota1.remaining > 1) {
    results.news = await googleSearch(`${companyName} news funding 2024`);
    quotaUsed++;
  }

  // Extract useful information
  const extracted = extractCompanyInfo(companyName, [...results.general, ...results.news]);

  const result: CompanyResearchResult = {
    company: companyName,
    searchedAt: new Date().toISOString(),
    results,
    extracted,
    cached: false,
    quotaUsed,
  };

  // Cache the result
  await cacheResult(companyName, result);

  return result;
}

/**
 * Quick search - just one query
 */
export async function quickSearch(companyName: string): Promise<SearchResult[]> {
  const cached = await getCachedResult(companyName);
  if (cached) {
    return cached.results.general;
  }

  return googleSearch(`${companyName} company`);
}

/**
 * Get current quota status
 */
export async function getQuotaStatus(): Promise<QuotaTracker> {
  const today = new Date().toISOString().split('T')[0];

  try {
    const content = await readFile(QUOTA_FILE, 'utf-8');
    const quota: QuotaTracker = JSON.parse(content);

    if (quota.date === today) {
      return quota;
    }
  } catch {
    // No quota file
  }

  return { date: today, used: 0, limit: DAILY_QUOTA };
}

// ============================================================================
// Info Extraction
// ============================================================================

/**
 * Extract structured company info from search results
 */
function extractCompanyInfo(
  companyName: string,
  results: SearchResult[]
): CompanyResearchResult['extracted'] {
  const extracted: CompanyResearchResult['extracted'] = {
    recentNews: [],
  };

  const allText = results.map(r => `${r.title} ${r.snippet}`).join(' ').toLowerCase();

  // Try to extract employee count
  const employeeMatch = allText.match(/(\d+(?:,\d+)?)\+?\s*employees/i);
  if (employeeMatch) {
    extracted.employeeCount = employeeMatch[1].replace(',', '') + '+';
  }

  // Try to extract funding info
  const fundingPatterns = [
    /raised?\s*\$?([\d.]+)\s*(million|billion|mn|bn|m|b|cr|crore)/i,
    /funding\s*(?:of|round)?\s*\$?([\d.]+)\s*(million|billion|mn|bn|m|b|cr|crore)/i,
    /series\s*[a-e]\s*(?:of|round)?\s*\$?([\d.]+)\s*(million|billion|mn|bn|m|b|cr|crore)/i,
  ];

  for (const pattern of fundingPatterns) {
    const match = allText.match(pattern);
    if (match) {
      extracted.fundingInfo = `$${match[1]} ${match[2]}`;
      break;
    }
  }

  // Extract headquarters
  const hqPatterns = [
    /headquartered?\s+in\s+([a-z\s,]+)/i,
    /based\s+(?:in|out\s+of)\s+([a-z\s,]+)/i,
  ];

  for (const pattern of hqPatterns) {
    const match = allText.match(pattern);
    if (match) {
      extracted.headquarters = match[1].trim().split(/[,.]/)  [0].trim();
      break;
    }
  }

  // Extract recent news
  const newsResults = results.filter(r => r.source === 'news');
  extracted.recentNews = newsResults.slice(0, 5).map(r => r.title);

  // Get description from first non-news result
  const companyResult = results.find(r => r.source !== 'news' && r.snippet.length > 50);
  if (companyResult) {
    extracted.description = companyResult.snippet;
  }

  // Try to find website
  const companyDomain = results.find(r =>
    r.displayLink.includes(companyName.toLowerCase().replace(/\s/g, ''))
  );
  if (companyDomain) {
    extracted.website = `https://${companyDomain.displayLink}`;
  }

  return extracted;
}

/**
 * Mock search for when API is not configured
 * Returns reasonable placeholder data based on company name
 */
export function getMockSearchResult(companyName: string): CompanyResearchResult {
  return {
    company: companyName,
    searchedAt: new Date().toISOString(),
    results: {
      general: [],
      news: [],
      funding: [],
      linkedin: [],
    },
    extracted: {
      description: `${companyName} is a company operating in India.`,
      recentNews: ['No news available - configure Google Search API for real data'],
    },
    cached: false,
    quotaUsed: 0,
  };
}
