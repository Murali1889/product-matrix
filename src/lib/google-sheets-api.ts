/**
 * Google Sheets API Client
 * Fetches data from the Product Matrix Google Sheets API
 * Replaces local JSON file reads (complete_client_data.json, clients.json, api.json)
 */

const BASE_URL =
  'https://script.google.com/macros/s/AKfycby6zInCBCBhtVsftn-Mzn3fsaq7G0ceEXdJX4RPppiCrF9NnTGuzkVFiKx7M2xv9yti/exec';

// ============== API RESPONSE TYPES ==============

export interface GSProduct {
  'Module Name': string;
  'Sub-Module': string;
  'Unit (Billing Key)': string;
  'Module Type': string;
  'Description': string;
  'Internal Mapping': string;
  'Billable Status Codes': string;
  'Added By': string;
}

export interface GSClient {
  'Client ID': string;
  'Client Name': string;
  'Status': string;
  'Type': string;
  'Country': string;
  'Industry': string;
  'Account Owner': string;
  'Currency': string;
  'Billing Type': string;
  'Invoice Type': string;
  'Domains': string;
  'Created At': string;
  'Trial Expires': string;
  'BUIDs': number;
  'App IDs': number;
  'PROD App IDs': number;
}

export interface GSPricing {
  'Client ID': string;
  'Client Name': string;
  'Status': string;
  'Unit': string;
  'Module Type': string;
  'Module Name': string;
  'Sub-Module': string;
  'Slab Start': number;
  'Slab End': number;
  'Unit Price': number;
  'Valid From': string;
}

export interface GSUsage {
  'Client ID': string;
  'Client Name': string;
  'Status': string;
  'Account Owner': string;
  'BUID': string;
  'App ID': string;
  'Workflow ID': string;
  'Module Name': string;
  'Sub-Module': string;
  'Unit': string;
  'Total Count': number;
  'Billable Count': number;
  'Actual Cost (INR)': number;
  'Actual Cost (USD)': number;
  'Unit Price': number;
  'Computed Cost': number;
  'Effective Cost': number;
  'Prod Total': number;
  'Prod Billable': number;
  'Prod Cost (INR)': number;
  'Prod Cost (USD)': number;
  'Staging Total': number;
  'Staging Billable': number;
  'Staging Cost (INR)': number;
  'Staging Cost (USD)': number;
}

// ============== CACHING ==============

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache: Record<string, CacheEntry<unknown>> = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache[key];
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data as T;
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache[key] = { data, timestamp: Date.now() };
}

// ============== API FETCH ==============

async function fetchAPI<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(BASE_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  console.log(`[GoogleSheetsAPI] Fetching: ?${url.searchParams.toString()}`);
  const start = Date.now();

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(120_000), // 2 minute timeout for large datasets
  });

  if (!response.ok) {
    throw new Error(`Google Sheets API error: ${response.status} ${response.statusText}`);
  }

  // Google Apps Script returns HTML error pages on failure (e.g. session expired)
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!contentType.includes('application/json') && text.trimStart().startsWith('<')) {
    // Extract error message from HTML if possible
    const match = text.match(/<div[^>]*style="text-align:center[^"]*"[^>]*>(.*?)<\/div>/);
    const errorMsg = match ? match[1].replace(/&quot;/g, '"') : 'Non-JSON response from Google Sheets API';
    console.error(`[GoogleSheetsAPI] HTML error for ?${url.searchParams.toString()}: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from Google Sheets API: ${text.slice(0, 200)}`);
  }

  const elapsed = Date.now() - start;
  console.log(`[GoogleSheetsAPI] Fetched ?${url.searchParams.toString()} in ${elapsed}ms`);
  return data;
}

// ============== PUBLIC API FUNCTIONS ==============

/**
 * Fetch product catalog (257 products)
 * Replaces data/api.json
 */
export async function fetchProducts(): Promise<GSProduct[]> {
  const cacheKey = 'products';
  const cached = getCached<GSProduct[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchAPI<GSProduct[]>({ action: 'products' });
  if (!Array.isArray(data)) throw new Error(`Expected products array, got: ${typeof data}`);
  console.log(`[GoogleSheetsAPI] Loaded ${data.length} products`);
  setCache(cacheKey, data);
  return data;
}

/**
 * Fetch client list filtered by status
 * Replaces data/clients.json + profile data from complete_client_data.json
 */
export async function fetchClients(status: string = 'live'): Promise<GSClient[]> {
  const cacheKey = `clients_${status}`;
  const cached = getCached<GSClient[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchAPI<GSClient[]>({ action: 'clients', status });
  if (!Array.isArray(data)) throw new Error(`Expected clients array, got: ${typeof data}`);
  console.log(`[GoogleSheetsAPI] Loaded ${data.length} clients (status=${status})`);
  setCache(cacheKey, data);
  return data;
}

/**
 * Fetch per-client module pricing slabs (14,647 rows)
 */
export async function fetchPricing(): Promise<GSPricing[]> {
  const cacheKey = 'pricing';
  const cached = getCached<GSPricing[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchAPI<GSPricing[]>({ action: 'pricing' });
  if (!Array.isArray(data)) throw new Error(`Expected pricing array, got: ${typeof data}`);
  console.log(`[GoogleSheetsAPI] Loaded ${data.length} pricing rows`);
  setCache(cacheKey, data);
  return data;
}

/**
 * Fetch monthly usage data for a specific month
 * PRODUCTION-only module costs
 * @param month Format: YYYY-MM (e.g., "2026-02")
 * @param noCache Force refresh from Metabase
 */
export async function fetchUsage(month: string, noCache: boolean = false): Promise<GSUsage[]> {
  const cacheKey = `usage_${month}`;
  if (!noCache) {
    const cached = getCached<GSUsage[]>(cacheKey);
    if (cached) return cached;
  }

  const params: Record<string, string> = { action: 'usage', month };
  if (noCache) params.noCache = 'true';

  const data = await fetchAPI<GSUsage[]>(params);
  if (!Array.isArray(data)) {
    console.warn(`[GoogleSheetsAPI] Usage for ${month} returned non-array (${typeof data}), returning empty`);
    return [];
  }
  console.log(`[GoogleSheetsAPI] Loaded ${data.length} usage rows for ${month}`);
  setCache(cacheKey, data);
  return data;
}

// ============== MONTH UTILITIES ==============

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Get the last completed month in YYYY-MM format
 * (current month is incomplete, so we use the previous one)
 */
export function getLastCompletedMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get available months: completed months only (excludes current incomplete month)
 * @param count Number of previous months (default 10)
 * @returns Array of YYYY-MM strings, newest first
 */
export function getAvailableMonths(count: number = 10): string[] {
  const months: string[] = [];
  const now = new Date();

  // Start from 1 to skip current incomplete month
  for (let i = 1; i <= count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${yyyy}-${mm}`);
  }

  return months;
}

/**
 * Convert YYYY-MM to display format "Feb 2026"
 */
export function formatMonthDisplay(yyyyMM: string): string {
  const [year, month] = yyyyMM.split('-');
  return `${MONTH_NAMES[parseInt(month) - 1]} ${year}`;
}

/**
 * Convert display format "Feb 2026" to YYYY-MM
 */
export function parseMonthDisplay(display: string): string {
  const [monthStr, year] = display.split(' ');
  const monthIdx = MONTH_NAMES.indexOf(monthStr);
  if (monthIdx === -1) return display;
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
}

/**
 * Clear all cached data
 */
export function clearCache(): void {
  Object.keys(cache).forEach(key => delete cache[key]);
  console.log('[GoogleSheetsAPI] Cache cleared');
}
