/**
 * Client Data Loader
 * Loads and transforms data from Google Sheets API
 * Maps billing data to the matrix format expected by the dashboard
 *
 * DATA SOURCE: Google Sheets API (replaces local JSON files)
 * OVERRIDES: Supabase (client_overrides, client_api_overrides)
 */

import {
  fetchClients,
  fetchProducts,
  fetchUsage,
  getLastCompletedMonth,
  getAvailableMonths,
  formatMonthDisplay,
  type GSClient,
  type GSUsage,
  type GSProduct,
} from './metabase';

// ============== TYPES ==============

// Keep for backward compatibility with existing imports
export interface UsageRow {
  moduleName: string;
  unit: string;
  success: number;
  total: number;
  currency: string;
  cost: number | null;
}

export interface BillingPeriod {
  period: string;
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
      credentialList?: Array<{ type: string; appId: string }>;
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

export interface ClientMasterEntry {
  id: number;
  name: string;
  zohoId: string;
  metabaseIds: string;
  clientId: string;
  actualRevenue?: {
    jan_26: number;
    dec_25: number;
    nov_25: number;
    oct_25: number;
  };
  jan26RecurringRevenue?: number;
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
  environment?: 'production' | 'staging';
  // Prod vs Staging breakdown
  prodTotal: number;
  prodBillable: number;
  prodCostINR: number;
  prodCostUSD: number;
  stagingTotal: number;
  stagingBillable: number;
  stagingCostINR: number;
  stagingCostUSD: number;
}

export interface MonthlyData {
  month: string;          // "Feb 2026"
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
    // New fields from Google Sheets API
    invoice_type?: string;
    trial_expires?: string;
    buid_count?: number;
    app_id_count?: number;
    prod_app_id_count?: number;
  };
  monthly_data: MonthlyData[];
  totalRevenue: number;
  latestRevenue: number;
  latestMonth: string;
  apiRevenues: Record<string, number>;
  // Status flags
  isInMasterList: boolean;   // Client has status 'live' in API
  hasJan2026Data: boolean;   // Has data in the latest fetched month (backward compat field name)
  isActive: boolean;         // isInMasterList AND has latest month data
}

export interface MatrixData {
  clients: TransformedClient[];
  apis: string[];
  months: string[];          // Display format: "Feb 2026", "Jan 2026", ...
  availableMonths: string[]; // All selectable months in YYYY-MM format
  extractedAt: string;
  totalClients: number;
}

// ============== HELPERS ==============

/**
 * Create API name from module + sub-module
 */
function createAPIName(moduleName: string, subModule: string): string {
  if (!subModule || subModule === '-' || subModule === moduleName) {
    return moduleName;
  }
  return `${moduleName} - ${subModule}`;
}

/**
 * Exact mapping for API industry values
 */
const INDUSTRY_TO_SEGMENT: Record<string, string> = {
  'traditional_nbfc': 'NBFC',
  'nbfc': 'NBFC',
  'digital_lender': 'Digital Lender',
  'digitallender': 'Digital Lender',
  'banking': 'Banking',
  'bank': 'Banking',
  'insurance': 'Insurance',
  'securities_and_brokerage': 'Brokerage',
  'securities': 'Brokerage',
  'brokerage': 'Brokerage',
  'wallet': 'Payment Service Provider',
  'payment': 'Payment Service Provider',
  'crypto': 'Crypto/Web3',
  'gaming': 'Gaming',
  'fantasy': 'Gaming',
  'ecommerce': 'E-commerce',
  'retail': 'E-commerce',
  'mutual_funds': 'Wealth Management',
  'wealth': 'Wealth Management',
  'asset': 'Wealth Management',
  'tech': 'Tech',
  'fintech': 'Fintech',
  'government': 'Government',
  'channel_partner': 'Channel Partner',
  'healthcare': 'Healthcare',
  'health': 'Healthcare',
  'medical': 'Healthcare',
  'telecom': 'Telecom',
  'logistics': 'Logistics',
  'delivery': 'Logistics',
  'gig': 'Gig Economy',
  'hr': 'HR/Staffing',
  'staffing': 'HR/Staffing',
  'edtech': 'EdTech',
  'travel': 'Travel',
  'real_estate': 'Real Estate',
};

/**
 * Infer segment from industry string.
 * Handles exact API values (traditional_NBFC, digital_lender, etc.)
 * and comma-separated multi-values.
 * "any" = unknown (no classification from API).
 */
function inferSegment(industry: string): string {
  if (!industry || industry === 'any') return 'Other';

  // Handle comma-separated (e.g. "wallet,digitalLender,securities")
  const parts = industry.split(',').map(s => s.trim().toLowerCase());

  for (const part of parts) {
    // Exact match first
    const exact = INDUSTRY_TO_SEGMENT[part];
    if (exact) return exact;

    // Fuzzy match
    for (const [key, segment] of Object.entries(INDUSTRY_TO_SEGMENT)) {
      if (part.includes(key) || key.includes(part)) return segment;
    }
  }

  return 'Other';
}

/**
 * Normalize name for matching
 */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

/**
 * Build client profile from GSClient data
 */
function buildProfile(client: GSClient | undefined): TransformedClient['profile'] {
  if (!client) {
    return {
      geography: 'Unknown',
      segment: 'Unknown',
      industry: 'Unknown',
      status: 'unknown',
      billing_currency: 'INR',
    };
  }

  return {
    legal_name: client['Client Name'],
    geography: client['Country'] || 'Unknown',
    segment: inferSegment(client['Industry'] || ''),
    industry: client['Industry'] || 'Unknown',
    status: client['Status'] || 'unknown',
    account_owner: client['Account Owner'],
    billing_currency: client['Currency'] || 'INR',
    client_type: client['Type'],
    billing_type: client['Billing Type'],
    domain_list: client['Domains'] ? client['Domains'].split(',').map(d => d.trim()).filter(Boolean) : [],
    go_live_date: client['Created At'],
    invoice_type: client['Invoice Type'],
    trial_expires: client['Trial Expires'],
    buid_count: client['BUIDs'],
    app_id_count: client['App IDs'],
    prod_app_id_count: client['PROD App IDs'],
  };
}

// ============== CACHING ==============

const matrixCache = new Map<string, { data: MatrixData; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ============== MAIN DATA LOADER ==============

/**
 * Load and transform all client data for the matrix view
 *
 * @param month Single month in YYYY-MM format (e.g., '2026-02').
 *   Defaults to last completed month.
 */
export async function loadMatrixData(month?: string): Promise<MatrixData> {
  const selectedMonth = month || getLastCompletedMonth();
  const months = [selectedMonth];
  const cacheKey = selectedMonth;

  // Check cache
  const cached = matrixCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[ClientDataLoader] Cache hit for months: ${cacheKey}`);
    return cached.data;
  }

  console.log(`[ClientDataLoader] Loading data for months: ${months.join(', ')}`);

  // Sequential — Metabase is serialized at the client layer anyway.
  const liveClients = await fetchClients('live');
  const usageByMonth: Awaited<ReturnType<typeof fetchUsage>>[] = [];
  for (const m of months) {
    usageByMonth.push(await fetchUsage(m));
  }

  // Build client lookup from live clients (deduplicate, exclude internal)
  const clientMap = new Map<string, GSClient>();
  liveClients.forEach(c => {
    if (c['Client ID'] && !clientMap.has(c['Client ID']) && c['Type'] !== 'internal') {
      clientMap.set(c['Client ID'], c);
    }
  });
  console.log(`[ClientDataLoader] ${liveClients.length} raw clients → ${clientMap.size} unique clients`);

  // Determine the latest month for "active" status
  const latestMonthYYYYMM = [...months].sort().reverse()[0];
  const latestMonthDisplay = formatMonthDisplay(latestMonthYYYYMM);

  // Group usage by Client ID → month → rows
  const usageByClientMonth = new Map<string, Map<string, GSUsage[]>>();

  months.forEach((month, idx) => {
    const displayMonth = formatMonthDisplay(month);
    const usageRows = usageByMonth[idx];

    if (!usageRows || !Array.isArray(usageRows)) {
      console.warn(`[ClientDataLoader] No usage data for ${month}`);
      return;
    }

    usageRows.forEach(row => {
      const clientId = row['Client ID'];
      if (!clientId) return;

      if (!usageByClientMonth.has(clientId)) {
        usageByClientMonth.set(clientId, new Map());
      }
      const monthMap = usageByClientMonth.get(clientId)!;
      if (!monthMap.has(displayMonth)) {
        monthMap.set(displayMonth, []);
      }
      monthMap.get(displayMonth)!.push(row);
    });
  });

  // Build TransformedClient for each client
  const transformedClients: TransformedClient[] = [];
  const allAPIs = new Set<string>();
  const processedClientIds = new Set<string>();

  // Process clients that have usage data
  usageByClientMonth.forEach((monthMap, clientId) => {
    processedClientIds.add(clientId);
    const clientInfo = clientMap.get(clientId);
    const isLive = clientInfo !== undefined;

    // Also check the usage row for client info if not in live list
    let clientName = clientInfo?.['Client Name'] || clientId;
    let currency = clientInfo?.['Currency'] || 'INR';

    // Build monthly data
    const monthlyData: MonthlyData[] = [];
    const apiRevenues: Record<string, number> = {};

    // Sort months newest first
    const sortedDisplayMonths = Array.from(monthMap.keys()).sort((a, b) => {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const parseM = (m: string) => {
        const [mon, year] = m.split(' ');
        return parseInt(year) * 12 + monthNames.indexOf(mon);
      };
      return parseM(b) - parseM(a);
    });

    sortedDisplayMonths.forEach(month => {
      const rows = monthMap.get(month)!;

      // Get client name from usage rows if needed
      if (!clientInfo && rows.length > 0) {
        clientName = rows[0]['Client Name'] || clientId;
        currency = 'INR'; // Default for non-live clients
      }

      // Consolidate rows by Module Name + Sub-Module
      const consolidated = new Map<string, {
        usage: number;
        billable: number;
        cost: number;
        unitPrice: number;
        moduleName: string;
        subModule: string;
        prodTotal: number;
        prodBillable: number;
        prodCostINR: number;
        prodCostUSD: number;
        stagingTotal: number;
        stagingBillable: number;
        stagingCostINR: number;
        stagingCostUSD: number;
      }>();

      rows.forEach(row => {
        const modName = row['Module Name'] || '';
        const subMod = row['Sub-Module'] || '';
        const key = `${modName}|${subMod}`;
        const existing = consolidated.get(key);

        if (existing) {
          existing.usage += row['Total Count'] || 0;
          existing.billable += row['Billable Count'] || 0;
          existing.cost += row['Effective Cost'] || 0;
          existing.prodTotal += row['Prod Total'] || 0;
          existing.prodBillable += row['Prod Billable'] || 0;
          existing.prodCostINR += row['Prod Cost (INR)'] || 0;
          existing.prodCostUSD += row['Prod Cost (USD)'] || 0;
          existing.stagingTotal += row['Staging Total'] || 0;
          existing.stagingBillable += row['Staging Billable'] || 0;
          existing.stagingCostINR += row['Staging Cost (INR)'] || 0;
          existing.stagingCostUSD += row['Staging Cost (USD)'] || 0;
        } else {
          consolidated.set(key, {
            usage: row['Total Count'] || 0,
            billable: row['Billable Count'] || 0,
            cost: row['Effective Cost'] || 0,
            unitPrice: row['Unit Price'] || 0,
            moduleName: modName,
            subModule: subMod,
            prodTotal: row['Prod Total'] || 0,
            prodBillable: row['Prod Billable'] || 0,
            prodCostINR: row['Prod Cost (INR)'] || 0,
            prodCostUSD: row['Prod Cost (USD)'] || 0,
            stagingTotal: row['Staging Total'] || 0,
            stagingBillable: row['Staging Billable'] || 0,
            stagingCostINR: row['Staging Cost (INR)'] || 0,
            stagingCostUSD: row['Staging Cost (USD)'] || 0,
          });
        }
      });

      // Build API usage list
      const apis: APIUsage[] = [];
      consolidated.forEach((data) => {
        if (data.cost <= 0 && data.usage <= 0 && data.billable <= 0) return;

        const apiName = createAPIName(data.moduleName, data.subModule);
        allAPIs.add(apiName);

        apis.push({
          name: apiName,
          moduleName: data.moduleName,
          subModule: data.subModule === '-' ? '' : data.subModule,
          revenue_usd: data.cost,
          usage: data.usage,
          success: data.billable,
          currency,
          environment: 'production',
          prodTotal: data.prodTotal,
          prodBillable: data.prodBillable,
          prodCostINR: data.prodCostINR,
          prodCostUSD: data.prodCostUSD,
          stagingTotal: data.stagingTotal,
          stagingBillable: data.stagingBillable,
          stagingCostINR: data.stagingCostINR,
          stagingCostUSD: data.stagingCostUSD,
        });

        apiRevenues[apiName] = (apiRevenues[apiName] || 0) + data.cost;
      });

      const totalRevenue = apis.reduce((sum, a) => sum + a.revenue_usd, 0);

      monthlyData.push({
        month,
        total_revenue_usd: totalRevenue,
        hv_api_revenue_usd: totalRevenue,
        other_revenue_usd: 0,
        apis,
      });
    });

    const totalRevenue = monthlyData.reduce((sum, m) => sum + m.total_revenue_usd, 0);
    const hasLatestMonth = monthlyData.some(m => m.month === latestMonthDisplay && m.total_revenue_usd > 0);

    transformedClients.push({
      client_name: clientName,
      client_id: clientId,
      profile: buildProfile(clientInfo),
      monthly_data: monthlyData,
      totalRevenue,
      latestRevenue: monthlyData[0]?.total_revenue_usd || 0,
      latestMonth: monthlyData[0]?.month || '',
      apiRevenues,
      isInMasterList: isLive,
      hasJan2026Data: hasLatestMonth, // Backward compat: "has latest month data"
      isActive: isLive && hasLatestMonth,
    });
  });

  // Add live clients without usage data (0 revenue placeholders)
  liveClients.forEach(c => {
    const clientId = c['Client ID'];
    if (!processedClientIds.has(clientId)) {
      transformedClients.push({
        client_name: c['Client Name'],
        client_id: clientId,
        profile: buildProfile(c),
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

  // Sort: active first (by name), then live without data (by name), then others (by revenue)
  transformedClients.sort((a, b) => {
    if (a.isActive && !b.isActive) return -1;
    if (!a.isActive && b.isActive) return 1;

    if (a.isInMasterList && !b.isInMasterList) return -1;
    if (!a.isInMasterList && b.isInMasterList) return 1;

    if (a.isInMasterList && b.isInMasterList) {
      return a.client_name.localeCompare(b.client_name);
    }

    return b.totalRevenue - a.totalRevenue;
  });

  // Stats
  const activeCount = transformedClients.filter(c => c.isActive).length;
  const liveOnlyCount = transformedClients.filter(c => c.isInMasterList && !c.isActive).length;
  const otherCount = transformedClients.filter(c => !c.isInMasterList).length;
  console.log(`[ClientDataLoader] ${transformedClients.length} clients (${activeCount} active, ${liveOnlyCount} live-only, ${otherCount} others)`);

  // Sort APIs by total revenue
  const apiRevenueTotals: Record<string, number> = {};
  transformedClients.forEach(c => {
    Object.entries(c.apiRevenues).forEach(([api, rev]) => {
      apiRevenueTotals[api] = (apiRevenueTotals[api] || 0) + rev;
    });
  });

  const apis = Array.from(allAPIs).sort((a, b) =>
    (apiRevenueTotals[b] || 0) - (apiRevenueTotals[a] || 0)
  );

  // Display months (newest first)
  const displayMonths = months.map(formatMonthDisplay);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  displayMonths.sort((a, b) => {
    const [aMonth, aYear] = a.split(' ');
    const [bMonth, bYear] = b.split(' ');
    if (aYear !== bYear) return parseInt(bYear) - parseInt(aYear);
    return monthNames.indexOf(bMonth) - monthNames.indexOf(aMonth);
  });

  const result: MatrixData = {
    clients: transformedClients,
    apis,
    months: displayMonths,
    availableMonths: getAvailableMonths(10),
    extractedAt: new Date().toISOString(),
    totalClients: transformedClients.length,
  };

  // Cache
  matrixCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

// ============== MASTER API CATALOG ==============

let masterAPIsCache: { moduleName: string; subModuleName: string; billingUnit: string; moduleOwner?: string }[] | null = null;
let masterAPIsCacheTimestamp = 0;

/**
 * Load master API list from Google Sheets API products endpoint
 * Replaces data/api.json
 */
export async function loadMasterAPIs(): Promise<{ moduleName: string; subModuleName: string; billingUnit: string; moduleOwner?: string }[]> {
  const now = Date.now();
  if (masterAPIsCache && now - masterAPIsCacheTimestamp < CACHE_TTL) {
    return masterAPIsCache;
  }

  try {
    const products = await fetchProducts();
    console.log(`[ClientDataLoader] Loaded ${products.length} products from API`);

    masterAPIsCache = products.map(p => ({
      moduleName: p['Module Name'] || '',
      subModuleName: p['Sub-Module'] || '',
      billingUnit: p['Unit (Billing Key)'] || '',
      moduleOwner: p['Added By'] || undefined,
    }));
    masterAPIsCacheTimestamp = now;
    return masterAPIsCache;
  } catch (e) {
    console.error('[ClientDataLoader] Failed to load products from API:', e);
    return masterAPIsCache || [];
  }
}

// ============== CLIENT LOOKUP ==============

/**
 * Get client data by name or ID
 * Searches from the matrix data (uses latest month)
 */
export async function getClientByName(clientName: string): Promise<TransformedClient | null> {
  const matrixData = await loadMatrixData();
  const lower = clientName.toLowerCase();
  const normalized = normalizeName(clientName);

  return matrixData.clients.find(c =>
    c.client_name.toLowerCase() === lower ||
    c.client_id.toLowerCase() === lower ||
    normalizeName(c.client_name) === normalized ||
    normalizeName(c.client_id) === normalized
  ) || null;
}

/**
 * Search clients by name
 */
export async function searchClients(query: string, limit = 20): Promise<TransformedClient[]> {
  const matrixData = await loadMatrixData();
  const lowerQuery = query.toLowerCase();

  return matrixData.clients
    .filter(c =>
      c.client_name.toLowerCase().includes(lowerQuery) ||
      c.client_id.toLowerCase().includes(lowerQuery)
    )
    .slice(0, limit);
}

/**
 * Get summary statistics
 */
export async function getDataSummary(month?: string): Promise<{
  totalClients: number;
  clientsWithRevenue: number;
  totalRevenue: number;
  topAPIs: { name: string; revenue: number; clientCount: number }[];
  months: string[];
  segments: { name: string; count: number; revenue: number }[];
}> {
  const { clients, months } = await loadMatrixData(month);

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

// ============== BACKWARD COMPAT ==============

/**
 * @deprecated No longer loads from file. Returns empty structure.
 * Use loadMatrixData() instead.
 */
export async function loadRawClientData(): Promise<CompleteClientDataFile> {
  console.warn('[ClientDataLoader] loadRawClientData() is deprecated. Use loadMatrixData() instead.');
  return {
    extractedAt: new Date().toISOString(),
    totalClients: 0,
    successful: 0,
    failed: 0,
    data: [],
  };
}

/**
 * @deprecated No longer loads from file. Returns empty structure.
 * Client list now comes from Google Sheets API.
 */
export async function loadClientMaster(): Promise<ClientMasterFile> {
  console.warn('[ClientDataLoader] loadClientMaster() is deprecated. Client data comes from API.');
  return { clients: [] };
}
