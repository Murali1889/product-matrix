/**
 * Client Lifecycle / Go-Live loader.
 *
 * Computes, per client, when they went to PRODUCTION and when they started
 * STAGING/TESTING, live from Metabase (no static CSV):
 *   - real dates from DB36 credentials_table MIN(created_at) per client+env
 *     (a daily snapshot, so MIN = true creation date, back to 2022, and it
 *     self-updates as new clients/appIds appear). Validated 99% exact vs the
 *     old CSV, and it fixes the CSV's bulk-migration-stamp errors.
 *   - active production from module_costs recent production appIds.
 *   - geo / KAM / zoho / MRR / status from clients / business_units / usage.
 *
 * Caching: the RESULT is cached in-memory and on disk (.cache/client-lifecycle
 * .json). On request we serve whatever is cached IMMEDIATELY and refresh in the
 * background when stale, so the UI loads instantly and never blocks on Metabase.
 */

import 'server-only';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import { fetchClients, fetchBusinessUnits, fetchClientRevenue, fetchCredentialDates, fetchActiveProdCounts, getLastCompletedMonth } from './metabase';

export type LifecycleStage = 'production' | 'testing-only' | 'none';

export interface LifecycleRow {
  client_id: string;
  client_name: string;
  operational_status: string;             // live | active | trial | inactive | ''
  stage: LifecycleStage;
  first_staging_date: string | null;      // YYYY-MM-DD
  went_to_production_date: string | null; // YYYY-MM-DD, earliest prod cred (incl. disabled): true first go-live
  go_live_approximate: boolean;            // true when the go-live date is a bulk-migration stamp (real date is ON OR BEFORE it)
  days_to_go_live: number | null;         // staging → prod, when both real & staging precedes prod
  prod_app_count: number;                 // total prod credentials (enabled + disabled)
  active_prod_app_count: number;          // prod credentials NOT disabled
  currently_in_production: boolean;        // has >=1 enabled prod credential
  staging_app_count: number;
  // Enrichment (best-effort from our data, see caveats):
  geography: string;                      // region (India / ASEAN / …) derived from country code
  country: string;                        // raw country code
  kam: string;                            // KAM/CSM display name, derived from account_owner email
  account_owner: string;                  // raw account_owner email (same source the matrix page shows)
  zoho_id: string;                        // from business_units (blank for many clients)
  mrr_usd: number;                        // last completed month PRODUCTION cost (USD), usage-based
  mrr_bucket: string;                     // 'More than 50K' | '10K to 50K' | 'Under 10K' | ''
}

export interface LifecycleSummary {
  total: number;
  production: number;          // ever went to production (has any prod cred)
  currentlyInProduction: number; // has >=1 enabled prod cred
  testingOnly: number;
  approxGoLive: number;        // clients whose go-live date is a migration stamp (approximate)
}

export interface LifecycleResult {
  version: number;     // schema version, disk caches with a different version are ignored
  clients: LifecycleRow[];
  summary: LifecycleSummary;
  migrationDates: string[]; // bulk-import dates auto-detected in the CSV (not real creation dates)
  dataAsOf: string;    // max createdDate in the CSV (YYYY-MM-DD)
  computedAt: string;  // ISO timestamp of last compute
}

// Bump whenever LifecycleRow / LifecycleSummary shape changes, so a stale
// disk cache written by an older build is discarded instead of served.
const CACHE_VERSION = 7;

// Country code → sales region. Fallback: the raw country value.
const REGION_BY_COUNTRY: Record<string, string> = {
  IND: 'India',
  VNM: 'ASEAN', IDN: 'ASEAN', SGP: 'ASEAN', THA: 'ASEAN', PHL: 'ASEAN', MYS: 'ASEAN', KHM: 'ASEAN', LAO: 'ASEAN', MMR: 'ASEAN', BRN: 'ASEAN',
  NGA: 'Africa', KEN: 'Africa', ZAF: 'Africa', GHA: 'Africa', EGY: 'Africa', TZA: 'Africa', UGA: 'Africa', RWA: 'Africa',
  USA: 'North America', CAN: 'North America', MEX: 'North America',
  GBR: 'Europe', DEU: 'Europe', FRA: 'Europe', NLD: 'Europe', ESP: 'Europe',
  ARE: 'Middle East', SAU: 'Middle East', QAT: 'Middle East', KWT: 'Middle East', BHR: 'Middle East',
  AUS: 'ANZ', NZL: 'ANZ',
  BRA: 'LATAM', ARG: 'LATAM', COL: 'LATAM',
};

function toRegion(country: string): string {
  const c = (country || '').trim().toUpperCase();
  if (!c) return '';
  return REGION_BY_COUNTRY[c] || country;
}

// account_owner is an email like "sai.prasaanth@hyperverge.co" → "Sai Prasaanth".
function ownerToName(email: string): string {
  const local = (email || '').split('@')[0];
  if (!local) return '';
  return local.split(/[._]/).filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function mrrBucket(usd: number): string {
  if (usd > 50_000) return 'More than 50K';
  if (usd >= 10_000) return '10K to 50K';
  if (usd > 0) return 'Under 10K';
  return '';
}

// A go-live date shared by at least this many clients is a bulk/backfill day,
// not organic creation, so it is flagged approximate. With the live source this
// is rarely hit, but it protects against any residual bulk dates.
const MIGRATION_DAY_THRESHOLD = 100;

const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'client-lifecycle.json');
const TTL = 6 * 60 * 60 * 1000; // 6h

interface MemEntry { data: LifecycleResult; ts: number }
let memory: MemEntry | null = null;
let refreshing: Promise<LifecycleResult> | null = null;

// ---------- compute ----------

async function compute(): Promise<LifecycleResult> {
  const mrrMonth = getLastCompletedMonth();
  // "active production" window: production usage in the last 2 completed months.
  const [y, m] = mrrMonth.split('-').map(Number);
  const activeSince = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;

  const [clients, businessUnits, revenue, credDates, activeProd] = await Promise.all([
    fetchClients('all'),
    fetchBusinessUnits().catch(() => []),
    fetchClientRevenue(mrrMonth).catch(() => new Map<string, number>()),
    fetchCredentialDates(),
    fetchActiveProdCounts(activeSince).catch(() => new Map<string, number>()),
  ]);

  // client_id → first non-empty zoho_id
  const zohoByClient = new Map<string, string>();
  for (const b of businessUnits) {
    if (b.zohoId && !zohoByClient.has(b.clientId)) zohoByClient.set(b.clientId, b.zohoId);
  }

  const cinfo = new Map<string, { name: string; status: string; country: string; owner: string }>();
  for (const c of clients) {
    cinfo.set(String(c['Client ID']), {
      name: String(c['Client Name'] || ''),
      status: String(c['Status'] || ''),
      country: String(c['Country'] || ''),
      owner: String(c['Account Owner'] || ''),
    });
  }

  // Flag any go-live date shared by an outsized number of clients (a backfill),
  // so it renders as approximate rather than a false precise date.
  const dayCounts = new Map<string, number>();
  for (const [, cd] of credDates) {
    if (cd.prodFirst) dayCounts.set(cd.prodFirst, (dayCounts.get(cd.prodFirst) ?? 0) + 1);
  }
  const migrationDates = new Set<string>(
    [...dayCounts.entries()].filter(([, n]) => n >= MIGRATION_DAY_THRESHOLD).map(([d]) => d),
  );

  const rows: LifecycleRow[] = [];
  for (const [cid, cd] of credDates) {
    const wentToProd = cd.prodFirst;
    const firstStaging = cd.stagingFirst;
    const goLiveApprox = wentToProd != null && migrationDates.has(wentToProd);
    const stagingApprox = firstStaging != null && migrationDates.has(firstStaging);

    let days: number | null = null;
    if (wentToProd && firstStaging && firstStaging < wentToProd && !goLiveApprox && !stagingApprox) {
      days = Math.round((Date.parse(wentToProd) - Date.parse(firstStaging)) / 86_400_000);
    }

    const info = cinfo.get(cid);
    const stage: LifecycleStage = cd.prodCount > 0 ? 'production' : (cd.stagingCount > 0 ? 'testing-only' : 'none');
    const activeCount = activeProd.get(cid) ?? 0;
    const country = info?.country || '';
    const mrr = revenue.get(cid) ?? 0;

    rows.push({
      client_id: cid,
      client_name: info?.name || cid,
      operational_status: info?.status || '',
      stage,
      first_staging_date: firstStaging,
      went_to_production_date: wentToProd,
      go_live_approximate: goLiveApprox,
      days_to_go_live: days,
      prod_app_count: cd.prodCount,
      active_prod_app_count: activeCount,          // prod appIds with usage in the last 2 months
      currently_in_production: activeCount > 0,
      staging_app_count: cd.stagingCount,
      geography: toRegion(country),
      country,
      kam: ownerToName(info?.owner || ''),
      account_owner: info?.owner || '',
      zoho_id: zohoByClient.get(cid) || '',
      mrr_usd: Math.round(mrr),
      mrr_bucket: mrrBucket(mrr),
    });
  }

  const dataAsOf = new Date().toISOString().slice(0, 10); // live source

  // Sort: production clients first (by earliest go-live), then testing-only by name.
  rows.sort((a, b) => {
    if (a.stage !== b.stage) return a.stage === 'production' ? -1 : 1;
    if (a.went_to_production_date && b.went_to_production_date) {
      return a.went_to_production_date.localeCompare(b.went_to_production_date);
    }
    return a.client_name.localeCompare(b.client_name);
  });

  const summary: LifecycleSummary = {
    total: rows.length,
    production: rows.filter(r => r.stage === 'production').length,
    currentlyInProduction: rows.filter(r => r.currently_in_production).length,
    testingOnly: rows.filter(r => r.stage === 'testing-only').length,
    approxGoLive: rows.filter(r => r.go_live_approximate).length,
  };

  return {
    version: CACHE_VERSION,
    clients: rows,
    summary,
    migrationDates: [...migrationDates].sort(),
    dataAsOf,
    computedAt: new Date().toISOString(),
  };
}

// ---------- disk cache ----------

function readDisk(): LifecycleResult | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as LifecycleResult;
    // Ignore caches written by an older schema version.
    if (parsed?.version !== CACHE_VERSION) return null;
    return parsed;
  } catch { return null; }
}

function writeDisk(data: LifecycleResult): void {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8');
  } catch (e) {
    console.warn('[Lifecycle] disk cache write failed:', (e as Error).message);
  }
}

function refreshInBackground(): void {
  if (refreshing) return;
  refreshing = compute()
    .then(data => { memory = { data, ts: Date.now() }; writeDisk(data); return data; })
    .catch(e => { console.warn('[Lifecycle] background refresh failed:', (e as Error).message); throw e; })
    .finally(() => { refreshing = null; }) as Promise<LifecycleResult>;
}

/**
 * Get client lifecycle. Serves cached data instantly (memory → disk) and
 * refreshes in the background when stale. Only blocks on the very first
 * compute when nothing is cached anywhere.
 */
export async function getClientLifecycle(): Promise<LifecycleResult> {
  const now = Date.now();

  // 1. Fresh in memory → instant.
  if (memory && now - memory.ts < TTL) return memory.data;

  // 2. Warm memory from disk if empty.
  if (!memory) {
    const disk = readDisk();
    if (disk) memory = { data: disk, ts: Date.parse(disk.computedAt) || 0 };
  }

  // 3. Have something cached (even if stale) → serve it, refresh behind.
  if (memory) {
    if (now - memory.ts >= TTL) refreshInBackground();
    return memory.data;
  }

  // 4. Nothing anywhere → must compute synchronously (first ever load).
  if (refreshing) return refreshing;
  refreshing = compute()
    .then(data => { memory = { data, ts: Date.now() }; writeDisk(data); return data; })
    .finally(() => { refreshing = null; }) as Promise<LifecycleResult>;
  return refreshing;
}

/** Force a rebuild (ignores cache). Used by ?refresh=1. */
export async function rebuildClientLifecycle(): Promise<LifecycleResult> {
  const data = await compute();
  memory = { data, ts: Date.now() };
  writeDisk(data);
  return data;
}
