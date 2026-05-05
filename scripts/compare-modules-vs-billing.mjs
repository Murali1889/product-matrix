/**
 * Compare our Metabase-aggregated usage vs a HyperVerge billing dump.
 *
 * Usage:
 *   node scripts/compare-modules-vs-billing.mjs <billing.json> [YYYY-MM]
 *
 * Defaults to April 2026 (the last complete month before today, 2026-05).
 *
 * Produces a per-Module-Name accuracy table:
 *   - reference (from billing JSON): sum(success), sum(cost INR)
 *   - ours (from Metabase aggregation): sum(billable), sum(unit_cost INR)
 *   - delta + % accuracy
 */

import fs from 'node:fs';
import path from 'node:path';

const dotenv = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of dotenv.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const MB_URL = process.env.METABASE_URL;
const MB_KEY = process.env.METABASE_API_KEY;
const DB_ID = parseInt(process.env.METABASE_DB_ID, 10);
if (!MB_URL || !MB_KEY || !Number.isFinite(DB_ID)) {
  console.error('Missing METABASE_URL / METABASE_API_KEY / METABASE_DB_ID in .env.local');
  process.exit(1);
}

const FLD = {
  ENV: 1029071, BILL_DATE: 1029058,
  CLIENT_ID: 1029063, MODULE_NAME: 1029072, UNIT_NAME: 1029061, UNIT: 1029067,
  TOTAL: 1029065, BILLABLE: 1029069, COST: 1029066,
};

async function mbAggregate(month) {
  const [yStr, mStr] = month.split('-');
  const y = +yStr, m = +mStr;
  const startDate = `${month}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

  const payload = {
    type: 'query', database: DB_ID,
    query: {
      'source-table': 20370,
      filter: ['and',
        ['=',  ['field', FLD.ENV], 'PRODUCTION'],
        ['>=', ['field', FLD.BILL_DATE], startDate],
        ['<',  ['field', FLD.BILL_DATE], nextMonth],
      ],
      aggregation: [
        ['sum', ['field', FLD.TOTAL]],
        ['sum', ['field', FLD.BILLABLE]],
        ['sum', ['field', FLD.COST]],
      ],
      breakout: [
        ['field', FLD.MODULE_NAME],
        ['field', FLD.UNIT_NAME],
      ],
    },
  };

  const res = await fetch(`${MB_URL}/api/dataset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': MB_KEY, Connection: 'close' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Metabase ${res.status} ${res.statusText}`);
  const j = await res.json();
  if (j.status && j.status !== 'completed') throw new Error(`MB query: ${j.error || j.status}`);

  const cols = j.data.cols.map(c => c.name);
  const i = (n) => cols.indexOf(n);
  const sumCols = cols.filter(c => c === 'sum' || /^sum_\d+$/.test(c));

  const byModule = new Map();
  for (const row of j.data.rows) {
    const moduleName = String(row[i('module_name')] || '').trim();
    if (!moduleName) continue;
    const total = Number(row[cols.indexOf(sumCols[0])] || 0);
    const billable = Number(row[cols.indexOf(sumCols[1])] || 0);
    const cost = Number(row[cols.indexOf(sumCols[2])] || 0);
    const cur = byModule.get(moduleName) || { total: 0, billable: 0, cost: 0 };
    cur.total += total; cur.billable += billable; cur.cost += cost;
    byModule.set(moduleName, cur);
  }
  return byModule;
}

function aggregateBilling(billingPath) {
  const j = JSON.parse(fs.readFileSync(billingPath, 'utf8'));
  const byModule = new Map();
  let nClients = 0, nRows = 0;

  for (const [, client] of Object.entries(j.results || {})) {
    nClients++;
    const buids = client.billing?.buid || {};
    for (const [bid, envs] of Object.entries(buids)) {
      if (bid === 'total') continue; // 'total' duplicates per-buid sums
      const prod = envs.PRODUCTION;
      if (!prod?.usageRows) continue;
      for (const row of prod.usageRows) {
        nRows++;
        const moduleName = String(row.moduleName || '').trim();
        if (!moduleName) continue;
        const cur = byModule.get(moduleName) || { total: 0, success: 0, cost: 0 };
        cur.total += Number(row.total || 0);
        cur.success += Number(row.success || 0);
        cur.cost += Number(row.cost || 0);
        byModule.set(moduleName, cur);
      }
    }
  }
  return { byModule, nClients, nRows };
}

const billingPath = process.argv[2];
const month = process.argv[3] || '2026-04';
if (!billingPath) {
  console.error('Usage: node scripts/compare-modules-vs-billing.mjs <billing.json> [YYYY-MM]');
  process.exit(1);
}

console.log(`Comparing billing file: ${path.basename(billingPath)}`);
console.log(`Metabase month:         ${month}\n`);

const ref = aggregateBilling(billingPath);
console.log(`Reference: ${ref.nClients} clients, ${ref.nRows} usage rows, ${ref.byModule.size} modules`);

console.log('Querying Metabase…');
const ours = await mbAggregate(month);
console.log(`Metabase:  ${ours.size} modules\n`);

// Build union of modules and compare
const allModules = new Set([...ref.byModule.keys(), ...ours.keys()]);
const rows = [];
for (const mod of allModules) {
  const r = ref.byModule.get(mod) || { total: 0, success: 0, cost: 0 };
  const o = ours.get(mod) || { total: 0, billable: 0, cost: 0 };

  // Compare success (ref) vs billable (ours) — both = "what was charged for"
  const sDiff = o.billable - r.success;
  const sPct = r.success > 0 ? (o.billable / r.success) * 100 : (o.billable > 0 ? Infinity : 100);
  const cDiff = o.cost - r.cost;
  const cPct = r.cost > 0 ? (o.cost / r.cost) * 100 : (o.cost > 0 ? Infinity : 100);

  rows.push({
    module: mod,
    refSuccess: r.success, ourBillable: o.billable, sDiff, sPct,
    refCost: r.cost, ourCost: o.cost, cDiff, cPct,
  });
}
rows.sort((a, b) => Math.max(b.refSuccess, b.ourBillable) - Math.max(a.refSuccess, a.ourBillable));

const fmt = (n) => Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-';
const pct = (n) => Number.isFinite(n) ? `${n.toFixed(1)}%` : '∞';

console.log('Module Name'.padEnd(40),
  'ref billable'.padStart(14),
  'ours billable'.padStart(14),
  'Δ count'.padStart(11),
  'count acc'.padStart(10),
  'ref cost'.padStart(12),
  'ours cost'.padStart(12),
  'cost acc'.padStart(10));
console.log('-'.repeat(125));
for (const r of rows) {
  const acc = r.sPct > 100 ? 200 - r.sPct : r.sPct;
  const flag = !Number.isFinite(r.sPct) ? '⚠' : (acc >= 95 ? '✓' : acc >= 80 ? '~' : '✗');
  console.log(
    r.module.slice(0, 39).padEnd(40),
    fmt(r.refSuccess).padStart(14),
    fmt(r.ourBillable).padStart(14),
    fmt(r.sDiff).padStart(11),
    pct(r.sPct).padStart(9), flag,
    fmt(r.refCost).padStart(11),
    fmt(r.ourCost).padStart(11),
    pct(r.cPct).padStart(9),
  );
}

// Totals
const tot = rows.reduce((a, r) => ({
  refS: a.refS + r.refSuccess, ourB: a.ourB + r.ourBillable,
  refC: a.refC + r.refCost, ourC: a.ourC + r.ourCost,
}), { refS: 0, ourB: 0, refC: 0, ourC: 0 });
console.log('-'.repeat(125));
console.log('TOTAL'.padEnd(40),
  fmt(tot.refS).padStart(14),
  fmt(tot.ourB).padStart(14),
  fmt(tot.ourB - tot.refS).padStart(11),
  pct(tot.refS > 0 ? (tot.ourB / tot.refS) * 100 : 0).padStart(10),
  fmt(tot.refC).padStart(11),
  fmt(tot.ourC).padStart(11),
  pct(tot.refC > 0 ? (tot.ourC / tot.refC) * 100 : 0).padStart(10),
);
