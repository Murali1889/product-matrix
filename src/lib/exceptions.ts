/**
 * Production-access exceptions loader.
 *
 * Source of truth is the Exceptions Google Sheet, served as JSON by a deployed
 * Apps Script web app (see scripts/exceptions-doGet.gs). We fetch that URL
 * server-side (no CORS, cacheable), normalize the rows, and resolve Slack user
 * ids in "Raised by" / "Approved by" to real names via the Slack API.
 *
 * Fail-soft: if EXCEPTIONS_GS_URL is unset or the fetch fails, we return an
 * empty list so the UI just shows blanks instead of breaking.
 */

import 'server-only';

const GS_URL = process.env.EXCEPTIONS_GS_URL;
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;

export interface ExceptionRecord {
  requestType: string;
  clientName: string;
  clientId: string;
  businessUnit: string;
  reason: string;
  raisedBy: string;    // resolved to a name when it was a Slack id
  approvedBy: string;
  time: string;        // ISO or sheet value
  threadLink: string;  // Slack permalink to the request thread
}

export interface ExceptionsResult {
  exceptions: ExceptionRecord[];
  byClientId: Record<string, ExceptionRecord>;   // normalized client id -> latest exception
  byClientName: Record<string, ExceptionRecord>; // normalized client name -> latest exception
  updatedAt: string;
}

const EMPTY: ExceptionsResult = { exceptions: [], byClientId: {}, byClientName: {}, updatedAt: '' };

// ---- caches ----
const TTL = 10 * 60 * 1000;
let cache: { data: ExceptionsResult; ts: number } | null = null;
let inflight: Promise<ExceptionsResult> | null = null;

// Slack id -> name, resolved lazily and kept for the process lifetime (names
// change rarely). Also negatively caches ids we cannot resolve.
const slackNameCache = new Map<string, string>();

const norm = (s: string) => (s || '').trim().toLowerCase();
const SLACK_ID = /^<?@?(U[A-Z0-9]{6,})>?$/;

async function resolveSlackName(raw: string): Promise<string> {
  const v = (raw || '').trim();
  const m = v.match(SLACK_ID);
  if (!m) return v;                 // already a name or empty
  const id = m[1];
  if (slackNameCache.has(id)) return slackNameCache.get(id)!;
  if (!SLACK_TOKEN) return v;       // no token, leave the id
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${id}`, {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    const name =
      data?.user?.profile?.real_name_normalized ||
      data?.user?.real_name ||
      data?.user?.profile?.display_name ||
      data?.user?.name ||
      '';
    const resolved = name || v;
    slackNameCache.set(id, resolved);
    return resolved;
  } catch {
    return v;
  }
}

interface RawRow { [k: string]: string }

function pick(row: RawRow, ...keys: string[]): string {
  for (const k of keys) {
    const hit = Object.keys(row).find(h => h.trim().toLowerCase() === k.toLowerCase());
    if (hit && String(row[hit]).trim()) return String(row[hit]).trim();
  }
  return '';
}

async function compute(): Promise<ExceptionsResult> {
  if (!GS_URL) return EMPTY;
  let rows: RawRow[] = [];
  try {
    const res = await fetch(GS_URL, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
    const data = await res.json();
    rows = Array.isArray(data?.rows) ? data.rows : (Array.isArray(data) ? data : []);
  } catch (e) {
    console.warn('[exceptions] fetch failed:', (e as Error).message);
    return EMPTY;
  }

  const exceptions: ExceptionRecord[] = [];
  for (const row of rows) {
    const clientId = pick(row, 'Client ID', 'clientId', 'client_id');
    const clientName = pick(row, 'Client Name', 'clientName', 'client_name');
    if (!clientId && !clientName) continue;
    const [raisedBy, approvedBy] = await Promise.all([
      resolveSlackName(pick(row, 'Raised by', 'Rasied by', 'raisedBy')),
      resolveSlackName(pick(row, 'Approved by', 'approvedBy')),
    ]);
    exceptions.push({
      requestType: pick(row, 'Request Type', 'requestType'),
      clientName,
      clientId,
      businessUnit: pick(row, 'Business Unit', 'BU', 'businessUnit'),
      reason: pick(row, 'Reason for the request', 'Reason', 'reason'),
      raisedBy,
      approvedBy,
      time: pick(row, 'Time', 'time', 'date_utc'),
      // Normalize app.slack.com deep links to the workspace domain so they open
      // directly in hyperverge.slack.com.
      threadLink: pick(row, 'Thread link', 'Thread Link', 'threadLink', 'message_link', 'Message link')
        .replace('://app.slack.com/', '://hyperverge.slack.com/'),
    });
  }

  // Latest exception per client (by time desc) for the join maps.
  const sorted = [...exceptions].sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  const byClientId: Record<string, ExceptionRecord> = {};
  const byClientName: Record<string, ExceptionRecord> = {};
  for (const e of sorted) {
    if (e.clientId && !byClientId[norm(e.clientId)]) byClientId[norm(e.clientId)] = e;
    if (e.clientName && !byClientName[norm(e.clientName)]) byClientName[norm(e.clientName)] = e;
  }

  return { exceptions: sorted, byClientId, byClientName, updatedAt: new Date().toISOString() };
}

export async function getExceptions(noCache = false): Promise<ExceptionsResult> {
  const now = Date.now();
  if (!noCache && cache && now - cache.ts < TTL) return cache.data;
  if (inflight) return inflight;
  inflight = compute()
    .then(data => { cache = { data, ts: Date.now() }; return data; })
    .catch(() => EMPTY)
    .finally(() => { inflight = null; }) as Promise<ExceptionsResult>;
  return inflight;
}
