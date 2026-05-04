/**
 * Metabase API Client (server-only)
 *
 * Replaces the Google Apps Script middleman by calling Metabase directly with
 * an API key. Public functions return data in the SAME JSON shape that the
 * Apps Script's `?action=*` endpoints used to return, so consumers
 * (client-data-loader, pricing-anomalies) don't need to change.
 *
 * Secrets: METABASE_URL, METABASE_API_KEY, METABASE_DB_ID — required env vars.
 * Never reference these from client components.
 */

import 'server-only';

// ============== ENV ==============

const MB_URL = process.env.METABASE_URL;
const MB_API_KEY = process.env.METABASE_API_KEY;
const MB_DB_ID = process.env.METABASE_DB_ID ? parseInt(process.env.METABASE_DB_ID, 10) : NaN;

function requireEnv() {
  if (!MB_URL) throw new Error('METABASE_URL is not set in environment');
  if (!MB_API_KEY) throw new Error('METABASE_API_KEY is not set in environment');
  if (!Number.isFinite(MB_DB_ID)) throw new Error('METABASE_DB_ID is not set or not a number');
}

// Table IDs in Metabase (DB 201)
const TB = {
  PRODUCTS:  20382,  // standard_module_mapping
  CLIENTS:   20367,  // clients
  PRICING:   20377,  // module_pricing
  COSTS:     20370,  // module_costs
  BUIDS:     20364,  // business_units
  APPIDS:    20381,  // clients_appid
  WORKFLOWS: 20379,  // workflow_information
} as const;

// Field IDs (only those used in filters)
const FLD = {
  C_STATUS:         1028994, // clients.operational_status
  MC_ENV:           1029071, // module_costs.environment
  MC_BILLING_START: 1029058, // module_costs.billing_month_start_date
} as const;

// ============== RESPONSE TYPES (Apps-Script-compatible shape) ==============

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
  'BUID Names': string;
  'App IDs': number;
  'PROD App IDs': number;
  'Workflows': number;
  'Modules Used': number;
  'Latest Month': string;
  'Latest Billable': number;
  'Latest Cost (INR)': number;
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
  'Unit Price': number | '';
  'Computed Cost': number | '';
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

export function clearCache(): void {
  Object.keys(cache).forEach(k => delete cache[k]);
  console.log('[Metabase] Cache cleared');
}

// ============== LOW-LEVEL API ==============

type MBFilterValue = string | number | MBFilterValue[];
type MBFilter = MBFilterValue[];

interface MBDatasetResponse {
  status?: string;
  error?: string;
  data?: {
    cols: { name: string }[];
    rows: unknown[][];
  };
}

async function mbFetch(endpoint: string, payload?: unknown): Promise<MBDatasetResponse> {
  requireEnv();
  const url = `${MB_URL}${endpoint}`;
  const res = await fetch(url, {
    method: payload ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': MB_API_KEY!,
    },
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 401) throw new Error('Metabase API key invalid (401)');
  if (!res.ok) throw new Error(`Metabase ${endpoint} failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<MBDatasetResponse>;
}

/**
 * Paginated table fetch using Metabase's query builder API. Mirrors the
 * Apps Script's queryTable_ helper exactly.
 */
async function queryTable<T>(
  tableId: number,
  filter?: MBFilter,
): Promise<{ columns: string[]; rows: T[] }> {
  const PAGE_SIZE = 2000;
  const allRows: T[] = [];
  let columns: string[] | null = null;

  for (let offset = 0; offset < 500_000; offset += PAGE_SIZE) {
    const query: Record<string, unknown> = { 'source-table': tableId, limit: PAGE_SIZE, offset };
    if (filter) query.filter = filter;

    const res = await mbFetch('/api/dataset', { database: MB_DB_ID, type: 'query', query });

    if (res.status && res.status !== 'completed') {
      throw new Error(`Metabase query failed: ${res.error || res.status}`);
    }
    if (!res.data || !res.data.rows) {
      throw new Error('Metabase returned no data');
    }

    const cols = res.data.cols.map(c => c.name);
    if (!columns) columns = cols;

    for (const row of res.data.rows) {
      const obj: Record<string, unknown> = {};
      for (let j = 0; j < cols.length; j++) obj[cols[j]] = row[j];
      allRows.push(obj as T);
    }

    if (res.data.rows.length < PAGE_SIZE) break;
  }

  return { columns: columns ?? [], rows: allRows };
}

function groupBy<T>(rows: T[], keyField: keyof T): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const r of rows) {
    const key = String(r[keyField] ?? '');
    if (!map[key]) map[key] = [];
    map[key].push(r);
  }
  return map;
}

// ============== PUBLIC: PRODUCTS ==============

interface ProductRow {
  module_name?: string;
  unit_name?: string;
  unit?: string;
  module_type?: string;
  description?: string;
  internal_module_mapping?: string;
  billable_status_codes?: string;
  added_by?: string;
}

export async function fetchProducts(): Promise<GSProduct[]> {
  const cacheKey = 'products';
  const cached = getCached<GSProduct[]>(cacheKey);
  if (cached) return cached;

  const start = Date.now();
  const { rows } = await queryTable<ProductRow>(TB.PRODUCTS);
  const out: GSProduct[] = rows.map(r => ({
    'Module Name': r.module_name || '',
    'Sub-Module': r.unit_name || '—',
    'Unit (Billing Key)': r.unit || '',
    'Module Type': r.module_type || '',
    'Description': r.description || '',
    'Internal Mapping': r.internal_module_mapping || '',
    'Billable Status Codes': r.billable_status_codes || '',
    'Added By': r.added_by || '',
  }));
  console.log(`[Metabase] Loaded ${out.length} products in ${Date.now() - start}ms`);
  setCache(cacheKey, out);
  return out;
}

// ============== PUBLIC: CLIENTS ==============

interface ClientRow {
  client_id?: string;
  client_name?: string;
  operational_status?: string;
  client_type?: string;
  client_country?: string;
  client_industry?: string;
  account_owner?: string;
  billing_currency?: string;
  billing_type?: string;
  invoice_type?: string;
  domain_list?: string;
  created_at?: string;
  trial_expire_at?: string;
}

interface BUIDRow {
  client_id?: string;
  buid?: string;
  name?: string;
}

interface AppIdRow {
  client_id?: string;
  appid?: string;
}

interface WorkflowRow {
  client_id?: string;
  workflow_id?: string;
}

interface CostRow {
  client_id?: string;
  unit?: string;
  unit_name?: string;
  module_name?: string;
  module_type?: string;
  environment?: string;
  total_count?: number;
  billable_count?: number;
  unit_cost?: number;
  unit_cost_usd?: number;
  billing_month_start_date?: string;
  buid?: string;
  app_id?: string;
  workflow_id?: string;
}

export async function fetchClients(status: string = 'live'): Promise<GSClient[]> {
  const cacheKey = `clients_${status}`;
  const cached = getCached<GSClient[]>(cacheKey);
  if (cached) return cached;

  const start = Date.now();
  const filter: MBFilter | undefined =
    status === 'all' ? undefined : ['=', ['field', FLD.C_STATUS], status];

  // Parallel fetch of all auxiliary tables; matches Apps Script semantics.
  const [clientsRes, buidsRes, appsRes, wfRes, costsRes] = await Promise.all([
    queryTable<ClientRow>(TB.CLIENTS, filter),
    queryTable<BUIDRow>(TB.BUIDS),
    queryTable<AppIdRow>(TB.APPIDS),
    queryTable<WorkflowRow>(TB.WORKFLOWS),
    queryTable<CostRow>(TB.COSTS, ['=', ['field', FLD.MC_ENV], 'PRODUCTION']),
  ]);

  // BUID counts + names per client_id
  const buidGrouped = groupBy(buidsRes.rows, 'client_id');
  const buidMap: Record<string, { buid_count: number; buid_names: string }> = {};
  for (const cid in buidGrouped) {
    const seen = new Set<string>();
    const names: string[] = [];
    let count = 0;
    for (const b of buidGrouped[cid]) {
      const key = String(b.buid || '');
      if (!seen.has(key)) {
        seen.add(key);
        names.push(b.name || '');
        count++;
      }
    }
    buidMap[cid] = { buid_count: count, buid_names: names.join(', ') };
  }

  // App ID counts per client_id
  const appGrouped = groupBy(appsRes.rows, 'client_id');
  const appMap: Record<string, number> = {};
  for (const cid in appGrouped) {
    const seen = new Set<string>();
    for (const a of appGrouped[cid]) if (a.appid) seen.add(String(a.appid));
    appMap[cid] = seen.size;
  }

  // Workflow counts per client_id
  const wfGrouped = groupBy(wfRes.rows, 'client_id');
  const wfMap: Record<string, number> = {};
  for (const cid in wfGrouped) {
    const seen = new Set<string>();
    for (const w of wfGrouped[cid]) if (w.workflow_id) seen.add(String(w.workflow_id));
    wfMap[cid] = seen.size;
  }

  // Latest month + module set, from PRODUCTION costs
  let latestMonth = '';
  for (const r of costsRes.rows) {
    const d = String(r.billing_month_start_date || '').slice(0, 10);
    if (d > latestMonth) latestMonth = d;
  }
  const costMap: Record<string, { latest_month_cost: number; latest_month_billable: number; latest_month: string }> = {};
  const modMap: Record<string, Set<string>> = {};
  for (const r of costsRes.rows) {
    const cid = String(r.client_id || '');
    if (String(r.billing_month_start_date || '').slice(0, 10) === latestMonth) {
      if (!costMap[cid]) costMap[cid] = { latest_month_cost: 0, latest_month_billable: 0, latest_month: latestMonth };
      costMap[cid].latest_month_cost += (r.unit_cost || 0);
      costMap[cid].latest_month_billable += (r.billable_count || 0);
    }
    if (!modMap[cid]) modMap[cid] = new Set();
    if (r.module_name) modMap[cid].add(r.module_name);
  }

  // Sort: live > active > trial > others, then by name
  const statusOrder: Record<string, number> = { live: 1, active: 2, trial: 3 };
  clientsRes.rows.sort((a, b) => {
    const oa = statusOrder[String(a.operational_status || '')] || 4;
    const ob = statusOrder[String(b.operational_status || '')] || 4;
    if (oa !== ob) return oa - ob;
    return (a.client_name || '').localeCompare(b.client_name || '');
  });

  const out: GSClient[] = clientsRes.rows.map(r => {
    const cid = r.client_id || '';
    const buids = buidMap[cid] || { buid_count: 0, buid_names: '' };
    const apps = appMap[cid] || 0;
    const wfs = wfMap[cid] || 0;
    const costs = costMap[cid];
    const mods = modMap[cid] ? modMap[cid].size : 0;
    return {
      'Client ID': cid,
      'Client Name': r.client_name || '',
      'Status': r.operational_status || '',
      'Type': r.client_type || '',
      'Country': r.client_country || '',
      'Industry': r.client_industry || '',
      'Account Owner': r.account_owner || '',
      'Currency': r.billing_currency || '',
      'Billing Type': r.billing_type || '',
      'Invoice Type': r.invoice_type || '',
      'Domains': r.domain_list || '',
      'Created At': r.created_at ? String(r.created_at).slice(0, 10) : '',
      'Trial Expires': r.trial_expire_at ? String(r.trial_expire_at).slice(0, 10) : '',
      'BUIDs': buids.buid_count,
      'BUID Names': buids.buid_names,
      'App IDs': apps,
      'PROD App IDs': apps, // Apps Script never exposed this; mirror App IDs.
      'Workflows': wfs,
      'Modules Used': mods,
      'Latest Month': costs?.latest_month ? costs.latest_month.slice(0, 10) : '',
      'Latest Billable': costs?.latest_month_billable || 0,
      'Latest Cost (INR)': costs?.latest_month_cost || 0,
    };
  });

  console.log(`[Metabase] Loaded ${out.length} clients (status=${status}) in ${Date.now() - start}ms`);
  setCache(cacheKey, out);
  return out;
}

// ============== PUBLIC: PRICING ==============

interface PricingRow {
  client_id?: string;
  unit?: string;
  module_type?: string;
  slab_start?: number;
  slab_end?: number;
  unit_price?: number;
  valid_from?: string;
}

export async function fetchPricing(): Promise<GSPricing[]> {
  const cacheKey = 'pricing';
  const cached = getCached<GSPricing[]>(cacheKey);
  if (cached) return cached;

  const start = Date.now();
  const [pricingRes, clientsRes, productsRes] = await Promise.all([
    queryTable<PricingRow>(TB.PRICING),
    queryTable<ClientRow>(TB.CLIENTS),
    queryTable<ProductRow>(TB.PRODUCTS),
  ]);

  const clientMap = new Map<string, ClientRow>();
  clientsRes.rows.forEach(c => { if (c.client_id) clientMap.set(c.client_id, c); });
  const productMap = new Map<string, ProductRow>();
  productsRes.rows.forEach(p => { if (p.unit) productMap.set(p.unit, p); });

  pricingRes.rows.sort((a, b) => {
    const c = String(a.client_id || '').localeCompare(String(b.client_id || ''));
    if (c !== 0) return c;
    const u = String(a.unit || '').localeCompare(String(b.unit || ''));
    if (u !== 0) return u;
    return (a.slab_start || 0) - (b.slab_start || 0);
  });

  const out: GSPricing[] = pricingRes.rows.map(r => {
    const client = clientMap.get(r.client_id || '');
    const product = productMap.get(r.unit || '');
    return {
      'Client ID': r.client_id || '',
      'Client Name': client?.client_name || '',
      'Status': client?.operational_status || '',
      'Unit': r.unit || '',
      'Module Type': r.module_type || '',
      'Module Name': product?.module_name || '',
      'Sub-Module': product?.unit_name || '',
      'Slab Start': r.slab_start ?? 0,
      'Slab End': r.slab_end ?? 0,
      'Unit Price': r.unit_price ?? 0,
      'Valid From': r.valid_from ? String(r.valid_from).slice(0, 10) : '',
    };
  });

  console.log(`[Metabase] Loaded ${out.length} pricing rows in ${Date.now() - start}ms`);
  setCache(cacheKey, out);
  return out;
}

// ============== PUBLIC: USAGE ==============

export async function fetchUsage(month: string, noCache: boolean = false): Promise<GSUsage[]> {
  const cacheKey = `usage_${month}`;
  if (!noCache) {
    const cached = getCached<GSUsage[]>(cacheKey);
    if (cached) return cached;
  }

  const start = Date.now();
  const startDate = `${month}-01`;
  const [yStr, mStr] = month.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const nextMonth = m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, '0')}-01`;

  const monthFilter: MBFilter = ['and',
    ['>=', ['field', FLD.MC_BILLING_START], startDate],
    ['<',  ['field', FLD.MC_BILLING_START], nextMonth],
  ];

  // Need pricing to compute Computed Cost (priced by client_id|unit, first slab)
  const [allCosts, pricing, clients] = await Promise.all([
    queryTable<CostRow>(TB.COSTS, monthFilter),
    fetchPricing(),
    queryTable<ClientRow>(TB.CLIENTS),
  ]);

  const priceMap = new Map<string, number>();
  for (const p of pricing) {
    const key = `${p['Client ID']}|${p['Unit']}`;
    if (!priceMap.has(key)) priceMap.set(key, p['Unit Price']);
  }

  const clientMap = new Map<string, ClientRow>();
  clients.rows.forEach(c => { if (c.client_id) clientMap.set(c.client_id, c); });

  // Split rows by environment and aggregate STAGING by (client_id|unit)
  const prodRows: CostRow[] = [];
  const stagingMap = new Map<string, { total: number; billable: number; costInr: number; costUsd: number }>();
  for (const r of allCosts.rows) {
    if (r.environment === 'PRODUCTION') {
      prodRows.push(r);
    } else if (r.environment === 'STAGING') {
      const key = `${r.client_id}|${r.unit}`;
      const cur = stagingMap.get(key) || { total: 0, billable: 0, costInr: 0, costUsd: 0 };
      cur.total += r.total_count || 0;
      cur.billable += r.billable_count || 0;
      cur.costInr += r.unit_cost || 0;
      cur.costUsd += r.unit_cost_usd || 0;
      stagingMap.set(key, cur);
    }
  }

  // Sort: client_id asc, then unit_cost desc (matches Apps Script)
  prodRows.sort((a, b) => {
    const c = String(a.client_id || '').localeCompare(String(b.client_id || ''));
    return c !== 0 ? c : (b.unit_cost || 0) - (a.unit_cost || 0);
  });

  const out: GSUsage[] = prodRows.map(r => {
    const prodCost = r.unit_cost || 0;
    const prodBillable = r.billable_count || 0;
    const prodTotal = r.total_count || 0;
    const prodCostUsd = r.unit_cost_usd || 0;
    const key = `${r.client_id}|${r.unit}`;
    const unitPrice = priceMap.get(key);
    const client = clientMap.get(r.client_id || '');
    const stg = stagingMap.get(key) || { total: 0, billable: 0, costInr: 0, costUsd: 0 };

    const totalCount = prodTotal + stg.total;
    const billableCount = prodBillable + stg.billable;
    const actualCost = prodCost + stg.costInr;
    const actualCostUsd = prodCostUsd + stg.costUsd;
    const computedCost: number | '' = (unitPrice != null && unitPrice !== 0) ? billableCount * unitPrice : (unitPrice === 0 ? 0 : '');
    const effectiveCost = actualCost > 0 ? actualCost : (typeof computedCost === 'number' ? computedCost : 0);

    return {
      'Client ID': r.client_id || '',
      'Client Name': client?.client_name || '',
      'Status': client?.operational_status || '',
      'Account Owner': client?.account_owner || '',
      'BUID': r.buid || '',
      'App ID': r.app_id || '',
      'Workflow ID': r.workflow_id || '',
      'Module Name': r.module_name || '',
      'Sub-Module': r.unit_name || '',
      'Unit': r.unit || '',
      'Total Count': totalCount,
      'Billable Count': billableCount,
      'Actual Cost (INR)': actualCost,
      'Actual Cost (USD)': actualCostUsd,
      'Unit Price': unitPrice ?? '',
      'Computed Cost': computedCost,
      'Effective Cost': effectiveCost,
      'Prod Total': prodTotal,
      'Prod Billable': prodBillable,
      'Prod Cost (INR)': prodCost,
      'Prod Cost (USD)': prodCostUsd,
      'Staging Total': stg.total,
      'Staging Billable': stg.billable,
      'Staging Cost (INR)': stg.costInr,
      'Staging Cost (USD)': stg.costUsd,
    };
  });

  console.log(`[Metabase] Loaded ${out.length} usage rows for ${month} in ${Date.now() - start}ms`);
  setCache(cacheKey, out);
  return out;
}

// ============== MONTH UTILITIES ==============

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function getLastCompletedMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function getAvailableMonths(count: number = 10): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 1; i <= count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

export function formatMonthDisplay(yyyyMM: string): string {
  const [year, month] = yyyyMM.split('-');
  return `${MONTH_NAMES[parseInt(month, 10) - 1]} ${year}`;
}

export function parseMonthDisplay(display: string): string {
  const [monthStr, year] = display.split(' ');
  const monthIdx = MONTH_NAMES.indexOf(monthStr);
  if (monthIdx === -1) return display;
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
}
