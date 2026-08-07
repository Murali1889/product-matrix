/**
 * Metabase API Client (server-only)
 *
 * Uses two Metabase endpoints:
 *   - /api/dataset/json   → raw rows, NO 2000-row cap. Used for products,
 *                           clients, pricing. Returns array of objects keyed
 *                           by display column name.
 *   - /api/dataset        → aggregation queries (sum/group-by). Used for
 *                           usage so 300K+ raw cost rows collapse to ~3K.
 *
 * Why not just paginate /api/dataset? Metabase silently ignores the `offset`
 * parameter on that endpoint, every page returns the same first 2000 rows,
 * which would loop forever.
 *
 * Secrets: METABASE_URL, METABASE_API_KEY, METABASE_DB_ID, required env
 * vars, never NEXT_PUBLIC_, never imported into client components.
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

const TB = {
  PRODUCTS: 20382,
  CLIENTS:  20367,
  PRICING:  20377,
  COSTS:    20370,
  CREDENTIALS: 20365,
  BUSINESS_UNITS: 20364,
} as const;

const FLD = {
  C_STATUS:         1028994, // clients.operational_status
  MC_ENV:           1029071, // module_costs.environment
  MC_BILLING_START: 1029058, // module_costs.billing_month_start_date
  MC_CLIENT_ID:     1029063,
  MC_APP_ID:        1029064, // module_costs.app_id
  MC_MODULE_NAME:   1029072,
  MC_UNIT_NAME:     1029061,
  MC_UNIT:          1029067,
  MC_TOTAL:         1029065,
  MC_BILLABLE:      1029069,
  MC_UNIT_COST:     1029066,
  MC_UNIT_COST_USD: 1029068,
} as const;

// Platform Analytics DB (36) credentials_table (18419): a daily snapshot whose
// MIN(created_at) per app_id is the REAL credential creation date (back to 2022,
// live, self-updating), unlike DB 201 credentials whose created_at is an ETL
// stamp. Field ids in that table:
const PLATFORM_DB_ID = 36;
const CREDS_TABLE = 18419;
const CT_CLIENT_ID  = 891654;
const CT_ENV        = 891653;
const CT_CREATED_AT = 891650;
const CT_APP_ID     = 891651;

// ============== TYPES (Apps-Script-compatible output shapes) ==============

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

// ============== CACHE + SINGLE-FLIGHT ==============
//
// Two-tier cache: in-memory (fast) backed by disk (.cache/metabase/*.json).
// Metabase queries are very slow (a single month of usage aggregates for ~56s),
// so without a persistent cache every server restart / cache expiry re-pays
// minutes of latency and blocks the app. The billing/usage data is effectively
// static once a month closes, so a long TTL is safe. On a miss we fall back to
// disk before hitting Metabase, making warm restarts instant.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

interface CacheEntry<T> { data: T; timestamp: number }
const cache: Record<string, CacheEntry<unknown>> = {};
const inflight: Record<string, Promise<unknown>> = {};
const MEM_TTL = 30 * 60 * 1000;        // 30 min in-memory
const DISK_TTL = 24 * 60 * 60 * 1000;  // 24 h on disk

const CACHE_DIR = path.join(process.cwd(), '.cache', 'metabase');
const diskPath = (key: string) => path.join(CACHE_DIR, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);

function readDisk<T>(key: string): T | null {
  try {
    const p = diskPath(key);
    if (!existsSync(p)) return null;
    const entry = JSON.parse(readFileSync(p, 'utf-8')) as CacheEntry<T>;
    if (Date.now() - entry.timestamp >= DISK_TTL) return null;
    return entry.data;
  } catch { return null; }
}

function writeDisk<T>(key: string, entry: CacheEntry<T>): void {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(diskPath(key), JSON.stringify(entry), 'utf-8');
  } catch (e) {
    console.warn(`[Metabase] disk cache write failed for ${key}:`, (e as Error).message);
  }
}

function getCached<T>(key: string): T | null {
  const e = cache[key];
  if (e && Date.now() - e.timestamp < MEM_TTL) return e.data as T;
  // Fall back to disk (survives restarts / in-memory expiry).
  const disk = readDisk<T>(key);
  if (disk != null) {
    cache[key] = { data: disk, timestamp: Date.now() };
    return disk;
  }
  return null;
}
function setCache<T>(key: string, data: T): void {
  const entry = { data, timestamp: Date.now() };
  cache[key] = entry;
  writeDisk(key, entry);
}

async function singleFlight<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const cached = getCached<T>(key);
  if (cached) return cached;
  const existing = inflight[key];
  if (existing) return existing as Promise<T>;
  const p = loader().finally(() => { delete inflight[key]; });
  inflight[key] = p;
  return p;
}

export function clearCache(): void {
  Object.keys(cache).forEach(k => delete cache[k]);
  console.log('[Metabase] Cache cleared');
}

// ============== LOW-LEVEL FETCH ==============

type MBFilterValue = string | number | MBFilterValue[];
type MBFilter = MBFilterValue[];

interface MBDatasetResponse {
  status?: string;
  error?: string;
  data?: { cols: { name: string }[]; rows: unknown[][] };
}

// Concurrency-limited pool, a fully serial queue meant every cold month of
// usage (~56s each) waited for the previous one, so 10 months = ~9 min of the
// app being unresponsive. A small pool lets a few run at once (cutting cold load
// several-fold) while still capping load on Metabase / undici. Cache +
// single-flight keep us from making redundant calls in the first place.
const MAX_CONCURRENCY = 4;
let active = 0;
const waiters: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) { active++; return; }
  await new Promise<void>(resolve => waiters.push(resolve)); // resumed = slot handed over
}
function release(): void {
  const next = waiters.shift();
  if (next) next();      // hand our slot to a waiter (active unchanged)
  else active--;         // no waiter → free the slot
}

async function mbCall(
  endpoint: '/api/dataset' | '/api/dataset/json',
  payload: unknown,
  asJson: boolean,
): Promise<unknown> {
  const run = async () => {
    requireEnv();
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const headers: Record<string, string> = { 'x-api-key': MB_API_KEY!, Connection: 'close' };
        let body: BodyInit;
        if (asJson) {
          // /api/dataset/json wants form-encoded
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
          body = new URLSearchParams({ query: JSON.stringify(payload) });
        } else {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(payload);
        }
        const res = await fetch(`${MB_URL}${endpoint}`, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(120_000),
        });
        if (res.status === 401) throw new Error('Metabase API key invalid (401)');
        if (!res.ok) throw new Error(`Metabase ${endpoint} failed: ${res.status} ${res.statusText}`);
        const text = await res.text();
        if (!text) throw new Error(`Metabase ${endpoint}: empty body`);
        try { return JSON.parse(text); }
        catch { throw new Error(`Metabase ${endpoint}: malformed JSON (${text.length} bytes)`); }
      } catch (e) {
        lastErr = e;
        if (attempt === 3) throw e;
        const code = (e as { cause?: { code?: string } })?.cause?.code;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[Metabase] ${endpoint} attempt ${attempt} failed (${code || msg}); retrying`);
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
    throw lastErr;
  };
  await acquire();
  try {
    return await run();
  } finally {
    release();
  }
}

/** Fetch every row of a table (no 2000-row cap). Returns objects keyed by
 *  Metabase display column names. */
async function fetchAllRows(tableId: number, filter?: MBFilter): Promise<Record<string, unknown>[]> {
  const t0 = Date.now();
  const query: Record<string, unknown> = { 'source-table': tableId };
  if (filter) query.filter = filter;
  const payload = { type: 'query', database: MB_DB_ID, query };
  const data = await mbCall('/api/dataset/json', payload, true);
  if (!Array.isArray(data)) {
    throw new Error(`Metabase /api/dataset/json returned non-array for table ${tableId}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  console.log(`[Metabase] table=${tableId} fetched ${data.length} rows in ${Date.now() - t0}ms`);
  return data as Record<string, unknown>[];
}

/** Run an MBQL aggregation query, returns standard {cols,rows} shape. */
async function runAggregation(payload: unknown): Promise<MBDatasetResponse> {
  const res = (await mbCall('/api/dataset', payload, false)) as MBDatasetResponse;
  if (res.status && res.status !== 'completed') {
    throw new Error(`Metabase aggregation failed: ${res.error || res.status}`);
  }
  return res;
}

// ============== HELPERS ==============

const str = (v: unknown): string => (v == null ? '' : String(v));
const num = (v: unknown): number => {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ============== PUBLIC: PRODUCTS ==============

export async function fetchProducts(): Promise<GSProduct[]> {
  return singleFlight('products', async () => {
    const start = Date.now();
    const rows = await fetchAllRows(TB.PRODUCTS);
    const out: GSProduct[] = rows.map(r => ({
      'Module Name': str(r['Module Name']),
      'Sub-Module': str(r['Unit Name']) || '-',
      'Unit (Billing Key)': str(r['Unit']),
      'Module Type': str(r['Module Type']),
      'Description': str(r['Description']),
      'Internal Mapping': str(r['Internal Module Mapping']),
      'Billable Status Codes': str(r['Billable Status Codes']),
      'Added By': str(r['Added By']),
    }));
    console.log(`[Metabase] Loaded ${out.length} products in ${Date.now() - start}ms`);
    setCache('products', out);
    return out;
  });
}

// ============== PUBLIC: CLIENTS ==============

function mapClientRow(r: Record<string, unknown>): GSClient {
  return {
    'Client ID': str(r['Client ID']),
    'Client Name': str(r['Client Name']),
    'Status': str(r['Operational Status']),
    'Type': str(r['Client Type']),
    'Country': str(r['Client Country']),
    'Industry': str(r['Client Industry']),
    'Account Owner': str(r['Account Owner']),
    'Currency': str(r['Billing Currency']) || 'INR',
    'Billing Type': str(r['Billing Type']),
    'Invoice Type': str(r['Invoice Type']),
    'Domains': str(r['Domain List']),
    'Created At': str(r['Created At']).slice(0, 10),
    'Trial Expires': str(r['Trial Expire At']).slice(0, 10),
    // The Apps Script aggregated these from BUIDS/APPIDS/WORKFLOWS/COSTS
    // tables (500K+ rows each), none of which the matrix UI actually reads
    // in a load-blocking way. Left as 0 to keep refresh fast.
    'BUIDs': 0,
    'BUID Names': '',
    'App IDs': 0,
    'PROD App IDs': 0,
    'Workflows': 0,
    'Modules Used': 0,
    'Latest Month': '',
    'Latest Billable': 0,
    'Latest Cost (INR)': 0,
  };
}

export async function fetchClients(status: string = 'live'): Promise<GSClient[]> {
  const cacheKey = `clients_${status}`;
  return singleFlight(cacheKey, async () => {
    const start = Date.now();
    const filter: MBFilter | undefined =
      status === 'all' ? undefined : ['=', ['field', FLD.C_STATUS], status];
    const rows = await fetchAllRows(TB.CLIENTS, filter);
    const out = rows.map(mapClientRow);

    const statusOrder: Record<string, number> = { live: 1, active: 2, trial: 3 };
    out.sort((a, b) => {
      const oa = statusOrder[a.Status] || 4;
      const ob = statusOrder[b.Status] || 4;
      if (oa !== ob) return oa - ob;
      return a['Client Name'].localeCompare(b['Client Name']);
    });

    console.log(`[Metabase] Loaded ${out.length} clients (status=${status}) in ${Date.now() - start}ms`);
    setCache(cacheKey, out);
    return out;
  });
}

// ============== PUBLIC: CREDENTIALS ==============

export interface GSCredential {
  appId: string;
  clientId: string;
  environment: string; // PRODUCTION | STAGING | TESTING
}

/**
 * All credential rows: app_id → client_id → environment (table 20365).
 * NOTE: this table's `created_at` is an ETL load timestamp (not the real
 * credential creation date), so it is intentionally NOT returned here, the
 * real dates come from data/credentials-report.csv. This fetch exists purely
 * to map appId → client_id for the lifecycle join.
 */
export async function fetchCredentials(): Promise<GSCredential[]> {
  return singleFlight('credentials', async () => {
    const start = Date.now();
    const rows = await fetchAllRows(TB.CREDENTIALS);
    const out: GSCredential[] = rows.map(r => ({
      appId: str(r['App ID']),
      clientId: str(r['Client ID']),
      environment: str(r['Environment']),
    }));
    console.log(`[Metabase] Loaded ${out.length} credentials in ${Date.now() - start}ms`);
    setCache('credentials', out);
    return out;
  });
}

// ============== PUBLIC: BUSINESS UNITS (zoho_id) ==============

export interface GSBusinessUnit {
  clientId: string;
  zohoId: string;
}

/** Business units → client_id + zoho_id (table 20364). One client may have
 *  several BUIDs; consumers pick the first non-empty zoho_id per client. */
export async function fetchBusinessUnits(): Promise<GSBusinessUnit[]> {
  return singleFlight('business_units', async () => {
    const start = Date.now();
    const rows = await fetchAllRows(TB.BUSINESS_UNITS);
    const out: GSBusinessUnit[] = rows.map(r => ({
      clientId: str(r['Client ID']),
      zohoId: str(r['Zoho ID']).trim(),
    }));
    console.log(`[Metabase] Loaded ${out.length} business units in ${Date.now() - start}ms`);
    setCache('business_units', out);
    return out;
  });
}

// ============== PUBLIC: CLIENT REVENUE (for MRR estimate) ==============

/**
 * Total PRODUCTION cost (USD) per client for a given month, a lean aggregation
 * used to estimate an MRR bucket. This is usage-based cost, NOT contracted MRR.
 * Returns Map<client_id, usd>.
 */
export async function fetchClientRevenue(month: string): Promise<Map<string, number>> {
  return singleFlight(`client_revenue_${month}`, async () => {
    const startDate = `${month}-01`;
    const [yStr, mStr] = month.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const payload = {
      type: 'query',
      database: MB_DB_ID,
      query: {
        'source-table': TB.COSTS,
        filter: ['and',
          ['=',  ['field', FLD.MC_ENV], 'PRODUCTION'],
          ['>=', ['field', FLD.MC_BILLING_START], startDate],
          ['<',  ['field', FLD.MC_BILLING_START], nextMonth],
        ],
        aggregation: [['sum', ['field', FLD.MC_UNIT_COST_USD]]],
        breakout: [['field', FLD.MC_CLIENT_ID]],
      },
    };
    const res = await runAggregation(payload);
    const cols = (res.data?.cols ?? []).map(c => c.name);
    const iClient = cols.indexOf('client_id');
    const iSum = cols.findIndex(c => c === 'sum');
    const map = new Map<string, number>();
    for (const row of res.data?.rows ?? []) {
      map.set(str(row[iClient]), num(row[iSum]));
    }
    return map;
  });
}

// ============== PUBLIC: CREDENTIAL DATES (live, real) ==============

export interface CredentialDates {
  prodFirst: string | null;    // YYYY-MM-DD (UTC) earliest PRODUCTION credential
  stagingFirst: string | null; // earliest STAGING/TESTING credential
  prodCount: number;           // distinct production appIds
  stagingCount: number;        // distinct staging/testing appIds
}

const toUtcDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? s.slice(0, 10) : new Date(t).toISOString().slice(0, 10);
};

/**
 * Real credential creation dates per client from DB36 credentials_table (a daily
 * snapshot: MIN(created_at) per app = true creation date). One grouped query
 * gives earliest prod + staging date and distinct app counts for every client.
 * Replaces the static credentials CSV; live and self-updating for new clients.
 */
export async function fetchCredentialDates(): Promise<Map<string, CredentialDates>> {
  return singleFlight('credential_dates', async () => {
    const start = Date.now();
    const payload = {
      type: 'query',
      database: PLATFORM_DB_ID,
      query: {
        'source-table': CREDS_TABLE,
        breakout: [['field', CT_CLIENT_ID, null], ['field', CT_ENV, null]],
        aggregation: [['min', ['field', CT_CREATED_AT, null]], ['distinct', ['field', CT_APP_ID, null]]],
      },
    };
    const rows = (await mbCall('/api/dataset/json', payload, true)) as Record<string, unknown>[];
    const map = new Map<string, CredentialDates>();
    for (const r of Array.isArray(rows) ? rows : []) {
      const cid = str(r['Client ID']);
      if (!cid) continue;
      const env = str(r['Environment']).toUpperCase();
      const first = toUtcDate(r['Min of Created At']);
      const count = num(r['Distinct values of App ID']);
      const e = map.get(cid) ?? { prodFirst: null, stagingFirst: null, prodCount: 0, stagingCount: 0 };
      if (env === 'PRODUCTION') {
        e.prodFirst = e.prodFirst && first ? (e.prodFirst < first ? e.prodFirst : first) : (first ?? e.prodFirst);
        e.prodCount += count;
      } else { // STAGING or TESTING
        e.stagingFirst = e.stagingFirst && first ? (e.stagingFirst < first ? e.stagingFirst : first) : (first ?? e.stagingFirst);
        e.stagingCount += count;
      }
      map.set(cid, e);
    }
    console.log(`[Metabase] Loaded credential dates for ${map.size} clients in ${Date.now() - start}ms`);
    setCache('credential_dates', map);
    return map;
  });
}

/**
 * Distinct PRODUCTION appIds with billing activity in the last `months` months,
 * per client. Used as the live "active production" signal (better than a static
 * disabled flag). Returns Map<client_id, activeProdAppCount>.
 */
export async function fetchActiveProdCounts(sinceMonthStart: string): Promise<Map<string, number>> {
  return singleFlight(`active_prod_${sinceMonthStart}`, async () => {
    const payload = {
      type: 'query',
      database: MB_DB_ID,
      query: {
        'source-table': TB.COSTS,
        filter: ['and',
          ['=',  ['field', FLD.MC_ENV], 'PRODUCTION'],
          ['>=', ['field', FLD.MC_BILLING_START], sinceMonthStart],
        ],
        breakout: [['field', FLD.MC_CLIENT_ID]],
        aggregation: [['distinct', ['field', FLD.MC_APP_ID]]],
      },
    };
    const rows = (await mbCall('/api/dataset/json', payload, true)) as Record<string, unknown>[];
    const map = new Map<string, number>();
    for (const r of Array.isArray(rows) ? rows : []) {
      const cid = str(r['Client ID']);
      if (cid) map.set(cid, num(r['Distinct values of App ID']));
    }
    return map;
  });
}

// ============== PUBLIC: PRICING ==============

export async function fetchPricing(): Promise<GSPricing[]> {
  return singleFlight('pricing', async () => {
    const start = Date.now();
    const [pricingRows, clientRows, productRows] = await Promise.all([
      fetchAllRows(TB.PRICING),
      fetchClients('all'),
      fetchProducts(),
    ]);

    const clientMap = new Map<string, GSClient>();
    clientRows.forEach(c => clientMap.set(str(c['Client ID']), c));
    const productMap = new Map<string, GSProduct>();
    productRows.forEach(p => productMap.set(str(p['Unit (Billing Key)']), p));

    pricingRows.sort((a, b) => {
      const c = str(a['Client ID']).localeCompare(str(b['Client ID']));
      if (c !== 0) return c;
      const u = str(a['Unit']).localeCompare(str(b['Unit']));
      if (u !== 0) return u;
      return num(a['Slab Start']) - num(b['Slab Start']);
    });

    const out: GSPricing[] = pricingRows.map(r => {
      const cid = str(r['Client ID']);
      const unit = str(r['Unit']);
      const client = clientMap.get(cid);
      const product = productMap.get(unit);
      return {
        'Client ID': cid,
        'Client Name': client ? str(client['Client Name']) : '',
        'Status': client ? str(client['Status']) : '',
        'Unit': unit,
        'Module Type': str(r['Module Type']),
        'Module Name': product ? str(product['Module Name']) : '',
        'Sub-Module': product ? str(product['Sub-Module']) : '',
        'Slab Start': num(r['Slab Start']),
        'Slab End': num(r['Slab End']),
        'Unit Price': num(r['Unit Price']),
        'Valid From': str(r['Valid From']).slice(0, 10),
      };
    });

    console.log(`[Metabase] Loaded ${out.length} pricing rows in ${Date.now() - start}ms`);
    setCache('pricing', out);
    return out;
  });
}

// ============== PUBLIC: USAGE (aggregated) ==============

/**
 * Usage for a month, aggregated server-side at Metabase.
 *
 * Raw module_costs has 300K+ rows for one month, paginating all of them
 * would take 10+ minutes (and is impossible anyway, since /api/dataset
 * silently ignores `offset`). Instead we GROUP BY client+module+unit and
 * SUM, collapsing to ~3K rows in ~5s. BUID / App ID / Workflow ID
 * dimensions are dropped (consumers don't read them). Staging is filtered
 * out at query level.
 */
export async function fetchUsage(month: string, noCache: boolean = false): Promise<GSUsage[]> {
  const cacheKey = `usage_${month}`;
  if (noCache) delete cache[cacheKey];
  return singleFlight(cacheKey, async () => {
    const start = Date.now();
    const startDate = `${month}-01`;
    const [yStr, mStr] = month.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const aggPayload = {
      type: 'query',
      database: MB_DB_ID,
      query: {
        'source-table': TB.COSTS,
        filter: ['and',
          ['=',  ['field', FLD.MC_ENV], 'PRODUCTION'],
          ['>=', ['field', FLD.MC_BILLING_START], startDate],
          ['<',  ['field', FLD.MC_BILLING_START], nextMonth],
        ],
        aggregation: [
          ['sum', ['field', FLD.MC_TOTAL]],
          ['sum', ['field', FLD.MC_BILLABLE]],
          ['sum', ['field', FLD.MC_UNIT_COST]],
          ['sum', ['field', FLD.MC_UNIT_COST_USD]],
        ],
        breakout: [
          ['field', FLD.MC_CLIENT_ID],
          ['field', FLD.MC_MODULE_NAME],
          ['field', FLD.MC_UNIT_NAME],
          ['field', FLD.MC_UNIT],
        ],
      },
    };

    const res = await runAggregation(aggPayload);
    const cols = (res.data?.cols ?? []).map(c => c.name);
    const i = (n: string) => cols.indexOf(n);
    const iClient = i('client_id');
    const iModule = i('module_name');
    const iUnitName = i('unit_name');
    const iUnit = i('unit');
    // Aggregations come back as 'sum', 'sum_2', 'sum_3', 'sum_4' in input order
    const sumCols = cols.filter(c => c === 'sum' || /^sum_\d+$/.test(c));
    const [iTotal, iBillable, iCost, iCostUsd] = sumCols.map(n => cols.indexOf(n));

    const [pricing, clients] = await Promise.all([
      fetchPricing(),
      fetchClients('all'),
    ]);

    const priceMap = new Map<string, number>();
    for (const p of pricing) {
      const k = `${p['Client ID']}|${p['Unit']}`;
      if (!priceMap.has(k)) priceMap.set(k, p['Unit Price']);
    }
    const clientMap = new Map<string, GSClient>();
    clients.forEach(c => clientMap.set(str(c['Client ID']), c));

    // Synthetic label for rows whose module isn't mapped in
    // standard_module_mapping (e.g. unit=`platform`). Surfacing them lets
    // the UI show platform/infra usage as a separate, dimmed entry instead
    // of silently dropping them like the HyperVerge billing JSON does.
    const PLATFORM_MODULE = 'Platform & Other';
    let unmappedCount = 0;
    const out: GSUsage[] = (res.data?.rows ?? []).map(row => {
      const clientId = str(row[iClient]);
      const rawModule = str(row[iModule]);
      const unitName = str(row[iUnitName]);
      const unit = str(row[iUnit]);
      let moduleName = rawModule;
      if (!moduleName) { moduleName = PLATFORM_MODULE; unmappedCount++; }
      const totalCount = num(row[iTotal]);
      const billable = num(row[iBillable]);
      const cost = num(row[iCost]);
      const costUsd = num(row[iCostUsd]);
      const unitPrice = priceMap.get(`${clientId}|${unit}`);
      const client = clientMap.get(clientId);
      const computed: number | '' = (unitPrice != null && unitPrice !== 0)
        ? billable * unitPrice
        : (unitPrice === 0 ? 0 : '');
      const effective = cost > 0 ? cost : (typeof computed === 'number' ? computed : 0);
      return {
        'Client ID': clientId,
        'Client Name': client ? str(client['Client Name']) : '',
        'Status': client ? str(client['Status']) : '',
        'Account Owner': client ? str(client['Account Owner']) : '',
        'BUID': '', 'App ID': '', 'Workflow ID': '',
        'Module Name': moduleName,
        'Sub-Module': unitName,
        'Unit': unit,
        'Total Count': totalCount,
        'Billable Count': billable,
        'Actual Cost (INR)': cost,
        'Actual Cost (USD)': costUsd,
        'Unit Price': unitPrice ?? '',
        'Computed Cost': computed,
        'Effective Cost': effective,
        'Prod Total': totalCount,
        'Prod Billable': billable,
        'Prod Cost (INR)': cost,
        'Prod Cost (USD)': costUsd,
        'Staging Total': 0, 'Staging Billable': 0,
        'Staging Cost (INR)': 0, 'Staging Cost (USD)': 0,
      };
    });

    out.sort((a, b) => {
      const c = a['Client ID'].localeCompare(b['Client ID']);
      return c !== 0 ? c : b['Actual Cost (INR)'] - a['Actual Cost (INR)'];
    });

    const tail = unmappedCount > 0 ? ` (${unmappedCount} as Platform & Other)` : '';
    console.log(`[Metabase] Loaded ${out.length} usage rows for ${month}${tail} in ${Date.now() - start}ms`);
    setCache(cacheKey, out);
    return out;
  });
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
