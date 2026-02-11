/**
 * Client Data Loader
 * Loads and transforms data from complete_client_data.json
 * Maps billing data to the matrix format expected by the dashboard
 */

import { promises as fs } from 'fs';
import path from 'path';

// ============== TYPES ==============

export interface UsageRow {
  moduleName: string;
  unit: string;
  success: number;
  total: number;
  currency: string;
  cost: number | null;
}

export interface BillingPeriod {
  period: string; // "Jan 2026", "Dec 2025", etc.
  data: {
    appId: Record<string, { usageRows: UsageRow[]; totalCost: number }>;
    buid: Record<string, Record<string, { usageRows: UsageRow[]; totalCost: number }>>;
  };
}

export interface RawClientData {
  clientName: string;
  clientId: string;
  clientDetails: {
    companyDetails: {
      name: string;
      clientId: string;
      geography?: string[];
      industry?: string[];
      clientType?: string;
      operationalStatus?: string;
      billingType?: string;
      billingCurrency?: string;
      accountOwner?: string;
      domainList?: string[];
      goLiveDate?: string;
      billing?: { type?: string; role?: string; startMonth?: string };
    };
    businessUnits: Record<string, {
      BUID: string;
      name: string;
      zohoId?: string;
      zohoName?: string;
    }>;
    pricingSlabList?: Array<{
      moduleType: string;
      unit: string;
      unitPrice: number;
    }>;
  };
  billing: BillingPeriod[];
}

export interface CompleteClientDataFile {
  extractedAt: string;
  totalClients: number;
  successful: number;
  failed: number;
  data: RawClientData[];
}

// Client master list entry (from clients.json)
export interface ClientMasterEntry {
  id: number;
  name: string;
  zohoId: string;
  metabaseIds: string;
  clientId: string;
}

export interface ClientMasterFile {
  clients: ClientMasterEntry[];
}

// Transformed types for dashboard
export interface APIUsage {
  name: string;           // "Selfie Validation - Liveness Check"
  moduleName: string;     // "Selfie Validation"
  subModule: string;      // "Liveness Check"
  revenue_usd: number;
  usage: number;
  success: number;
  currency: string;
}

export interface MonthlyData {
  month: string;          // "Jan 2026"
  total_revenue_usd: number;
  hv_api_revenue_usd: number;
  other_revenue_usd: number;
  apis: APIUsage[];
}

export interface TransformedClient {
  client_name: string;
  client_id: string;
  profile: {
    legal_name?: string;
    geography: string;
    segment: string;
    industry: string;
    billing_entity?: string;
    payment_model?: string;
    status: string;
    account_owner?: string;
    billing_currency: string;
    client_type?: string;
    billing_type?: string;
    domain_list?: string[];
    go_live_date?: string;
    billing_start_month?: string;
    zoho_name?: string;
    business_units?: string[];
  };
  monthly_data: MonthlyData[];
  // Aggregated data
  totalRevenue: number;
  latestRevenue: number;
  latestMonth: string;
  apiRevenues: Record<string, number>; // API name -> total revenue across all months
  // Status flags
  isInMasterList: boolean;  // Is this client in clients.json?
  hasJan2026Data: boolean;  // Does client have Jan 2026 billing data?
  isActive: boolean;        // In master list AND has Jan 2026 data
}

export interface MatrixData {
  clients: TransformedClient[];
  apis: string[];           // Unique API names found in data
  months: string[];         // Available months
  extractedAt: string;
  totalClients: number;
}

// ============== CONSTANTS ==============

// Keep values in INR (no conversion) - display currency is INR
const INR_TO_USD = 1;

// SINGLE SOURCE OF TRUTH - Primary data files
// Using path.join to work in both dev and production
const DATA_FILE_PATH = path.join(process.cwd(), 'data', 'complete_client_data_1770268082596.json');
const CLIENT_MASTER_PATH = path.join(process.cwd(), 'data', 'clients.json');

// ============== LOADER FUNCTIONS ==============

let cachedData: CompleteClientDataFile | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load raw data from complete_client_data.json
 * SINGLE SOURCE OF TRUTH - uses only one file
 */
export async function loadRawClientData(): Promise<CompleteClientDataFile> {
  const now = Date.now();

  // Return cached data if fresh
  if (cachedData && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedData;
  }

  try {
    const content = await fs.readFile(DATA_FILE_PATH, 'utf-8');
    const data = JSON.parse(content) as CompleteClientDataFile;
    console.log(`[ClientDataLoader] Loaded ${data.totalClients} clients from: ${DATA_FILE_PATH}`);

    cachedData = data;
    cacheTimestamp = now;
    return data;
  } catch (e) {
    console.error(`[ClientDataLoader] Failed to load data from: ${DATA_FILE_PATH}`, e);
    throw new Error(`Could not load client data from ${DATA_FILE_PATH}`);
  }
}

// Cache for client master list
let cachedClientMaster: ClientMasterFile | null = null;
let clientMasterCacheTimestamp: number = 0;

/**
 * Load client master list from clients.json
 * This defines the canonical list of all clients and their order
 */
export async function loadClientMaster(): Promise<ClientMasterFile> {
  const now = Date.now();

  // Return cached data if fresh
  if (cachedClientMaster && (now - clientMasterCacheTimestamp) < CACHE_TTL) {
    return cachedClientMaster;
  }

  try {
    const content = await fs.readFile(CLIENT_MASTER_PATH, 'utf-8');
    const data = JSON.parse(content) as ClientMasterFile;
    console.log(`[ClientDataLoader] Loaded ${data.clients.length} clients from master: ${CLIENT_MASTER_PATH}`);

    cachedClientMaster = data;
    clientMasterCacheTimestamp = now;
    return data;
  } catch (e) {
    console.warn(`[ClientDataLoader] Could not load client master from ${CLIENT_MASTER_PATH}:`, e);
    return { clients: [] };
  }
}

/**
 * Consolidate usage rows from all appIds and BUIDs for a billing period
 */
function consolidateUsageRows(billingData: BillingPeriod['data'] | undefined): UsageRow[] {
  if (!billingData) return [];

  const consolidated: Map<string, UsageRow> = new Map();

  // Process all appId usage
  if (billingData.appId) {
    Object.values(billingData.appId).forEach(app => {
      app?.usageRows?.forEach(row => {
        const key = `${row.moduleName}|${row.unit}`;
        const existing = consolidated.get(key);
        if (existing) {
          existing.success += row.success || 0;
          existing.total += row.total || 0;
          existing.cost = (existing.cost || 0) + (row.cost || 0);
        } else {
          consolidated.set(key, { ...row, cost: row.cost || 0 });
        }
      });
    });
  }

  return Array.from(consolidated.values());
}

/**
 * Convert currency to USD
 */
function toUSD(amount: number | null, currency: string): number {
  if (amount === null || amount === undefined) return 0;
  if (currency === 'USD') return amount;
  if (currency === 'INR') return amount * INR_TO_USD;
  return amount; // Default to assuming USD
}

/**
 * Create API name from module + unit
 */
function createAPIName(moduleName: string, unit: string): string {
  if (!unit || unit === '-' || unit === moduleName) {
    return moduleName;
  }
  return `${moduleName} - ${unit}`;
}

/**
 * Infer segment from industry
 */
function inferSegment(industry: string[]): string {
  if (!industry || industry.length === 0) return 'Unknown';

  const ind = industry[0].toLowerCase();

  if (ind.includes('nbfc') || ind.includes('lending')) return 'NBFC';
  if (ind.includes('bank')) return 'Banking';
  if (ind.includes('insurance')) return 'Insurance';
  if (ind.includes('broker') || ind.includes('stock') || ind.includes('trading')) return 'Brokerage';
  if (ind.includes('payment') || ind.includes('wallet')) return 'Payment Service Provider';
  if (ind.includes('gig') || ind.includes('delivery') || ind.includes('logistics')) return 'Gig Economy';
  if (ind.includes('gaming') || ind.includes('fantasy')) return 'Gaming';
  if (ind.includes('ecommerce') || ind.includes('retail')) return 'E-commerce';
  if (ind.includes('wealth') || ind.includes('asset')) return 'Wealth Management';
  if (ind.includes('health') || ind.includes('medical')) return 'Healthcare';
  if (ind.includes('telecom')) return 'Telecom';
  if (ind === 'any' || ind === 'fintech') return 'Fintech';

  return 'Other';
}

/**
 * Get the authoritative total from buid.total.total.totalCost
 */
function getAuthoritativeTotal(billingData: BillingPeriod['data'] | undefined): number {
  if (!billingData?.buid?.total?.total?.totalCost) return 0;
  return billingData.buid.total.total.totalCost || 0;
}

/**
 * Transform raw client data to dashboard format
 */
export function transformClientData(raw: RawClientData): TransformedClient {
  const { clientName, clientId, clientDetails, billing } = raw;
  const company = clientDetails.companyDetails;

  // Transform monthly data
  const monthlyData: MonthlyData[] = billing.map(period => {
    const usageRows = consolidateUsageRows(period.data);
    const billingCurrency = company.billingCurrency || 'INR';

    // Transform usage rows to API usage
    // Include rows that have either cost OR usage (to show "No cost" for APIs with usage but no revenue)
    const apis: APIUsage[] = usageRows
      .filter(row => (row.cost !== null && row.cost > 0) || row.total > 0 || row.success > 0)
      .map(row => ({
        name: createAPIName(row.moduleName, row.unit),
        moduleName: row.moduleName,
        subModule: row.unit === '-' ? '' : row.unit,
        revenue_usd: toUSD(row.cost, billingCurrency),
        usage: row.total,
        success: row.success,
        currency: billingCurrency,
      }));

    // Use authoritative total from buid.total.total.totalCost (NOT sum of APIs)
    const authoritativeTotal = getAuthoritativeTotal(period.data);
    const total_revenue_usd = toUSD(authoritativeTotal, billingCurrency);

    return {
      month: period.period,
      total_revenue_usd,
      hv_api_revenue_usd: total_revenue_usd, // All is HV API revenue in this data
      other_revenue_usd: 0,
      apis,
    };
  });

  // Calculate aggregates
  const totalRevenue = monthlyData.reduce((sum, m) => sum + m.total_revenue_usd, 0);
  const latestMonth = monthlyData[0]?.month || '';
  const latestRevenue = monthlyData[0]?.total_revenue_usd || 0;

  // Calculate API totals across all months
  const apiRevenues: Record<string, number> = {};
  monthlyData.forEach(m => {
    m.apis.forEach(api => {
      apiRevenues[api.name] = (apiRevenues[api.name] || 0) + api.revenue_usd;
    });
  });

  // Check if has Jan 2026 data
  const hasJan2026Data = monthlyData.some(m => m.month === 'Jan 2026');

  return {
    client_name: clientName,
    client_id: clientId,
    profile: {
      legal_name: company.name,
      geography: (company.geography || ['Unknown'])[0],
      segment: inferSegment(company.industry || []),
      industry: (company.industry || ['Unknown'])[0],
      status: company.operationalStatus || 'unknown',
      account_owner: company.accountOwner,
      billing_currency: company.billingCurrency || 'INR',
      client_type: company.clientType,
      billing_type: company.billingType,
      domain_list: company.domainList,
      go_live_date: company.goLiveDate || company.billing?.startMonth,
      billing_start_month: company.billing?.startMonth,
      zoho_name: Object.values(clientDetails.businessUnits || {})[0]?.zohoName,
      business_units: Object.values(clientDetails.businessUnits || {}).map(bu => bu.name).filter(Boolean),
    },
    monthly_data: monthlyData,
    totalRevenue,
    latestRevenue,
    latestMonth,
    apiRevenues,
    // Default values - will be set properly in loadMatrixData
    isInMasterList: false,
    hasJan2026Data,
    isActive: false,
  };
}

/**
 * Normalize name for matching (lowercase, remove punctuation, trim)
 */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

/**
 * Load and transform all client data for the matrix view
 * Merges billing data with client master list to show all clients
 */
export async function loadMatrixData(): Promise<MatrixData> {
  const [raw, clientMaster] = await Promise.all([
    loadRawClientData(),
    loadClientMaster()
  ]);

  // Transform all clients from billing data
  const billingClients = raw.data.map(transformClientData);

  // Create a map of normalized names to billing clients for matching
  const billingClientMap = new Map<string, TransformedClient>();
  billingClients.forEach(c => {
    billingClientMap.set(normalizeName(c.client_name), c);
    // Also add by client_id for better matching
    if (c.client_id) {
      billingClientMap.set(normalizeName(c.client_id), c);
    }
  });

  // Create client order map from master list
  const masterClientOrder = new Map<string, number>();
  clientMaster.clients.forEach((c, idx) => {
    masterClientOrder.set(normalizeName(c.name), idx);
    masterClientOrder.set(normalizeName(c.clientId), idx);
  });

  // Helper to check if client has Jan 2026 data
  const hasJan2026 = (client: TransformedClient): boolean => {
    return client.monthly_data.some(m => m.month === 'Jan 2026');
  };

  // Merge: use master list as base, enrich with billing data
  const mergedClients: TransformedClient[] = [];
  const addedClientIds = new Set<string>();

  // First, add all clients from master list (preserving order)
  clientMaster.clients.forEach(masterClient => {
    const normalizedName = normalizeName(masterClient.name);
    const normalizedId = normalizeName(masterClient.clientId);

    // Try to find matching billing client
    const billingClient = billingClientMap.get(normalizedName) || billingClientMap.get(normalizedId);

    if (billingClient) {
      // Client has billing data - use enriched version
      const hasJan26 = hasJan2026(billingClient);
      mergedClients.push({
        ...billingClient,
        client_name: masterClient.name, // Use master list name for consistency
        isInMasterList: true,
        hasJan2026Data: hasJan26,
        isActive: hasJan26, // Active = in master list AND has Jan 2026 data
      });
      addedClientIds.add(normalizeName(billingClient.client_name));
      if (billingClient.client_id) {
        addedClientIds.add(normalizeName(billingClient.client_id));
      }
    } else {
      // Client in master list but no billing data - add empty entry
      mergedClients.push({
        client_name: masterClient.name,
        client_id: masterClient.clientId,
        profile: {
          geography: 'Unknown',
          segment: 'Unknown',
          industry: 'Unknown',
          status: 'unknown',
          billing_currency: 'INR',
        },
        monthly_data: [],
        totalRevenue: 0,
        latestRevenue: 0,
        latestMonth: '',
        apiRevenues: {},
        isInMasterList: true,
        hasJan2026Data: false,
        isActive: false,
      });
    }
  });

  // Then add any billing clients not in master list
  billingClients.forEach(c => {
    const normalizedName = normalizeName(c.client_name);
    const normalizedId = c.client_id ? normalizeName(c.client_id) : '';
    if (!addedClientIds.has(normalizedName) && !addedClientIds.has(normalizedId)) {
      const hasJan26 = hasJan2026(c);
      mergedClients.push({
        ...c,
        isInMasterList: false,
        hasJan2026Data: hasJan26,
        isActive: false, // Not in master list = not active
      });
    }
  });

  // Sort clients by priority:
  // 1. Active (in master list + has Jan 2026 data) - sorted by name
  // 2. In master list but no Jan 2026 data - sorted by name
  // 3. Not in master list but has Jan 2026 data - sorted by revenue
  mergedClients.sort((a, b) => {
    // Priority 1: Active clients first
    if (a.isActive && !b.isActive) return -1;
    if (!a.isActive && b.isActive) return 1;

    // Priority 2: In master list
    if (a.isInMasterList && !b.isInMasterList) return -1;
    if (!a.isInMasterList && b.isInMasterList) return 1;

    // Within same category: sort by name for master list clients, by revenue for others
    if (a.isInMasterList && b.isInMasterList) {
      return a.client_name.localeCompare(b.client_name);
    }

    // Non-master list clients: sort by revenue (descending)
    return b.totalRevenue - a.totalRevenue;
  });

  // Count stats
  const activeCount = mergedClients.filter(c => c.isActive).length;
  const masterOnlyCount = mergedClients.filter(c => c.isInMasterList && !c.isActive).length;
  const otherCount = mergedClients.filter(c => !c.isInMasterList).length;

  console.log(`[ClientDataLoader] Sorted: ${mergedClients.length} total (${activeCount} active, ${masterOnlyCount} master-only, ${otherCount} others)`);

  // Extract unique APIs across all clients
  const apiSet = new Set<string>();
  mergedClients.forEach(c => {
    c.monthly_data.forEach(m => {
      m.apis.forEach(api => {
        apiSet.add(api.name);
      });
    });
  });

  // Sort APIs by total revenue
  const apiRevenueTotals: Record<string, number> = {};
  mergedClients.forEach(c => {
    Object.entries(c.apiRevenues).forEach(([api, rev]) => {
      apiRevenueTotals[api] = (apiRevenueTotals[api] || 0) + rev;
    });
  });

  const apis = Array.from(apiSet).sort((a, b) =>
    (apiRevenueTotals[b] || 0) - (apiRevenueTotals[a] || 0)
  );

  // Get unique months
  const monthSet = new Set<string>();
  mergedClients.forEach(c => {
    c.monthly_data.forEach(m => {
      monthSet.add(m.month);
    });
  });

  // Sort months chronologically (newest first)
  const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const months = Array.from(monthSet).sort((a, b) => {
    const [aMonth, aYear] = a.split(' ');
    const [bMonth, bYear] = b.split(' ');
    if (aYear !== bYear) return parseInt(bYear) - parseInt(aYear);
    return monthOrder.indexOf(bMonth) - monthOrder.indexOf(aMonth);
  });

  return {
    clients: mergedClients,
    apis,
    months,
    extractedAt: raw.extractedAt,
    totalClients: mergedClients.length,
  };
}

// Master API list path
const MASTER_API_PATH = path.join(process.cwd(), 'data', 'api.json');

/**
 * Load master API list from api.json
 */
export async function loadMasterAPIs(): Promise<{ moduleName: string; subModuleName: string; billingUnit: string; moduleOwner?: string }[]> {
  try {
    const content = await fs.readFile(MASTER_API_PATH, 'utf-8');
    const data = JSON.parse(content);
    console.log(`[ClientDataLoader] Loaded ${data.length} master APIs from: ${MASTER_API_PATH}`);
    return data;
  } catch (e) {
    console.warn(`[ClientDataLoader] Could not load api.json from ${MASTER_API_PATH}:`, e);
    return [];
  }
}

/**
 * Get client data by name
 */
export async function getClientByName(clientName: string): Promise<TransformedClient | null> {
  const raw = await loadRawClientData();
  const client = raw.data.find(c =>
    c.clientName.toLowerCase() === clientName.toLowerCase() ||
    c.clientId.toLowerCase() === clientName.toLowerCase()
  );

  if (!client) return null;
  return transformClientData(client);
}

/**
 * Search clients by name
 */
export async function searchClients(query: string, limit = 20): Promise<TransformedClient[]> {
  const raw = await loadRawClientData();
  const lowerQuery = query.toLowerCase();

  const matches = raw.data
    .filter(c =>
      c.clientName.toLowerCase().includes(lowerQuery) ||
      c.clientId.toLowerCase().includes(lowerQuery)
    )
    .slice(0, limit)
    .map(transformClientData);

  return matches;
}

/**
 * Get summary statistics
 */
export async function getDataSummary(): Promise<{
  totalClients: number;
  clientsWithRevenue: number;
  totalRevenue: number;
  topAPIs: { name: string; revenue: number; clientCount: number }[];
  months: string[];
  segments: { name: string; count: number; revenue: number }[];
}> {
  const { clients, months } = await loadMatrixData();

  // Calculate API stats
  const apiStats: Record<string, { revenue: number; clients: Set<string> }> = {};
  clients.forEach(c => {
    Object.entries(c.apiRevenues).forEach(([api, rev]) => {
      if (!apiStats[api]) {
        apiStats[api] = { revenue: 0, clients: new Set() };
      }
      apiStats[api].revenue += rev;
      apiStats[api].clients.add(c.client_name);
    });
  });

  const topAPIs = Object.entries(apiStats)
    .map(([name, stats]) => ({
      name,
      revenue: stats.revenue,
      clientCount: stats.clients.size,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20);

  // Calculate segment stats
  const segmentStats: Record<string, { count: number; revenue: number }> = {};
  clients.forEach(c => {
    const seg = c.profile.segment;
    if (!segmentStats[seg]) {
      segmentStats[seg] = { count: 0, revenue: 0 };
    }
    segmentStats[seg].count++;
    segmentStats[seg].revenue += c.totalRevenue;
  });

  const segments = Object.entries(segmentStats)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    totalClients: clients.length,
    clientsWithRevenue: clients.filter(c => c.totalRevenue > 0).length,
    totalRevenue: clients.reduce((sum, c) => sum + c.totalRevenue, 0),
    topAPIs,
    months,
    segments,
  };
}
