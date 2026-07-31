/**
 * Client Lifecycle / Go-Live loader.
 *
 * Computes, per client, when they went to PRODUCTION and when they started
 * STAGING/TESTING — the real dates. Metabase's `created_at` columns are ETL
 * load timestamps (useless), so the real per-credential dates come from
 * data/credentials-report.csv (appId, type, createdDate). We map appId →
 * client_id via Metabase `credentials` (fetchCredentials) and enrich with
 * client name/operational_status via fetchClients.
 *
 * Caching: the join is expensive (fetches ~7.6K credential rows + client list
 * from Metabase). We cache the RESULT both in-memory and on disk
 * (.cache/client-lifecycle.json). On request we serve whatever is cached
 * IMMEDIATELY and refresh in the background when stale — so the UI loads
 * instantly and never blocks on Metabase.
 */

import 'server-only';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fetchCredentials, fetchClients } from './metabase';

export type LifecycleStage = 'production' | 'testing-only' | 'none';

export interface LifecycleRow {
  client_id: string;
  client_name: string;
  operational_status: string;             // live | active | trial | inactive | ''
  stage: LifecycleStage;
  first_staging_date: string | null;      // YYYY-MM-DD
  went_to_production_date: string | null; // YYYY-MM-DD — earliest prod cred (incl. disabled): true first go-live
  days_to_go_live: number | null;         // staging → prod, when both known
  prod_app_count: number;                 // total prod credentials (enabled + disabled)
  active_prod_app_count: number;          // prod credentials NOT disabled
  currently_in_production: boolean;        // has >=1 enabled prod credential
  staging_app_count: number;
}

export interface LifecycleSummary {
  total: number;
  production: number;          // ever went to production (has any prod cred)
  currentlyInProduction: number; // has >=1 enabled prod cred
  testingOnly: number;
}

export interface LifecycleResult {
  clients: LifecycleRow[];
  summary: LifecycleSummary;
  dataAsOf: string;    // max createdDate in the CSV (YYYY-MM-DD)
  computedAt: string;  // ISO timestamp of last compute
}

const CSV_PATH = path.join(process.cwd(), 'data', 'credentials-report.csv');
const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'client-lifecycle.json');
const TTL = 6 * 60 * 60 * 1000; // 6h — CSV is static, mapping changes rarely

interface MemEntry { data: LifecycleResult; ts: number }
let memory: MemEntry | null = null;
let refreshing: Promise<LifecycleResult> | null = null;

// ---------- CSV ----------

interface CsvCred { appId: string; type: string; createdDate: string; disabled: boolean }

function parseCsv(): CsvCred[] {
  const text = readFileSync(CSV_PATH, 'utf-8');
  const lines = text.split(/\r?\n/);
  const out: CsvCred[] = [];
  // header: appId,type,createdDate,disabled
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const [appId, type, createdDate, disabled] = line.split(',');
    if (!appId) continue;
    out.push({
      appId: appId.trim(),
      type: (type || '').trim(),
      createdDate: (createdDate || '').trim(),
      disabled: (disabled || '').trim().toLowerCase() === 'yes',
    });
  }
  return out;
}

// ---------- compute ----------

async function compute(): Promise<LifecycleResult> {
  const [creds, clients] = await Promise.all([
    fetchCredentials(),
    fetchClients('all'),
  ]);

  const app2client = new Map<string, string>();
  for (const c of creds) if (c.appId) app2client.set(c.appId, c.clientId);

  const cinfo = new Map<string, { name: string; status: string }>();
  for (const c of clients) {
    cinfo.set(String(c['Client ID']), { name: String(c['Client Name'] || ''), status: String(c['Status'] || '') });
  }

  const prod = new Map<string, string[]>();       // client_id → prod createdDates (all, incl. disabled)
  const activeProd = new Map<string, number>();   // client_id → count of ENABLED prod creds
  const staging = new Map<string, string[]>();    // client_id → staging/testing createdDates
  let dataAsOf = '';

  for (const row of parseCsv()) {
    const cid = app2client.get(row.appId);
    if (!cid) continue;
    const d = row.createdDate.slice(0, 10);
    if (d && d > dataAsOf) dataAsOf = d;
    if (row.type === 'PRODUCTION') {
      // Include disabled creds in the DATE: the earliest prod cred (even if now
      // disabled/rotated) is when the client first went to production.
      (prod.get(cid) ?? prod.set(cid, []).get(cid)!).push(d);
      if (!row.disabled) activeProd.set(cid, (activeProd.get(cid) ?? 0) + 1);
    } else {
      // STAGING or TESTING → both count as "testing"
      (staging.get(cid) ?? staging.set(cid, []).get(cid)!).push(d);
    }
  }

  const clientIds = new Set<string>([...prod.keys(), ...staging.keys()]);
  const rows: LifecycleRow[] = [];

  for (const cid of clientIds) {
    const p = (prod.get(cid) ?? []).filter(Boolean).sort();
    const s = (staging.get(cid) ?? []).filter(Boolean).sort();
    const wentToProd = p.length ? p[0] : null;
    const firstStaging = s.length ? s[0] : null;

    let days: number | null = null;
    if (wentToProd && firstStaging) {
      const diff = (Date.parse(wentToProd) - Date.parse(firstStaging)) / 86_400_000;
      days = Math.max(0, Math.round(diff));
    }

    const info = cinfo.get(cid);
    const stage: LifecycleStage = p.length ? 'production' : (s.length ? 'testing-only' : 'none');
    const activeCount = activeProd.get(cid) ?? 0;

    rows.push({
      client_id: cid,
      client_name: info?.name || cid,
      operational_status: info?.status || '',
      stage,
      first_staging_date: firstStaging,
      went_to_production_date: wentToProd,
      days_to_go_live: days,
      prod_app_count: p.length,
      active_prod_app_count: activeCount,
      currently_in_production: activeCount > 0,
      staging_app_count: s.length,
    });
  }

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
  };

  return { clients: rows, summary, dataAsOf, computedAt: new Date().toISOString() };
}

// ---------- disk cache ----------

function readDisk(): LifecycleResult | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as LifecycleResult;
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
