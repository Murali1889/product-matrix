/**
 * Swiggy: per-module usage (Metabase vs billing JSON) + pricing slabs.
 * Run: node scripts/swiggy-breakdown.mjs [YYYY-MM]
 */
import fs from 'node:fs';

const dotenv = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of dotenv.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const URL_MB = process.env.METABASE_URL;
const KEY = process.env.METABASE_API_KEY;
const DB = parseInt(process.env.METABASE_DB_ID, 10);

const FLD = {
  ENV: 1029071, BILL_DATE: 1029058,
  CLIENT: 1029063, MODULE: 1029072, UNIT_NAME: 1029061, UNIT: 1029067,
  TOTAL: 1029065, BILLABLE: 1029069, COST: 1029066, COST_USD: 1029068,
};

async function mbPost(endpoint, payload, asJson = false) {
  const headers = { 'x-api-key': KEY, Connection: 'close' };
  let body;
  if (asJson) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams({ query: JSON.stringify(payload) });
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }
  const r = await fetch(`${URL_MB}${endpoint}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${endpoint}: ${r.status}`);
  return r.json();
}

const month = process.argv[2] || '2026-04';
const [yStr, mStr] = month.split('-');
const y = +yStr, m = +mStr;
const startDate = `${month}-01`;
const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

// ---- Metabase: per-(module, sub-module) usage for swiggy in April ----
console.log(`Querying Metabase for swiggy / ${month}…`);
const usageRes = await mbPost('/api/dataset', {
  type: 'query', database: DB,
  query: {
    'source-table': 20370,
    filter: ['and',
      ['=',  ['field', FLD.ENV], 'PRODUCTION'],
      ['=',  ['field', FLD.CLIENT], 'swiggy'],
      ['>=', ['field', FLD.BILL_DATE], startDate],
      ['<',  ['field', FLD.BILL_DATE], nextMonth],
    ],
    aggregation: [
      ['sum', ['field', FLD.TOTAL]],
      ['sum', ['field', FLD.BILLABLE]],
      ['sum', ['field', FLD.COST]],
    ],
    breakout: [
      ['field', FLD.MODULE],
      ['field', FLD.UNIT_NAME],
      ['field', FLD.UNIT],
    ],
  },
});

const ourUsage = new Map();
for (const row of usageRes.data.rows) {
  const mod = String(row[0] || '');
  const sub = String(row[1] || '');
  const unit = String(row[2] || '');
  const key = `${mod}|${sub}`;
  const cur = ourUsage.get(key) || { mod, sub, unit, total: 0, billable: 0, cost: 0 };
  cur.total += Number(row[3] || 0);
  cur.billable += Number(row[4] || 0);
  cur.cost += Number(row[5] || 0);
  ourUsage.set(key, cur);
}

// ---- Billing JSON: same client, same month ----
const billing = JSON.parse(fs.readFileSync('/Users/muralivvrsn/Downloads/HyperVerge Billing May 5 2026.json', 'utf8'));
const swiggy = billing.results.swiggy;
if (!swiggy) {
  console.error('swiggy not in billing JSON');
  process.exit(1);
}

const refUsage = new Map();
for (const [bid, envs] of Object.entries(swiggy.billing?.buid || {})) {
  if (bid === 'total') continue;
  for (const r of envs.PRODUCTION?.usageRows || []) {
    const mod = String(r.moduleName || '');
    const sub = String(r.unit || '');
    const key = `${mod}|${sub}`;
    const cur = refUsage.get(key) || { mod, sub, total: 0, success: 0, cost: 0 };
    cur.total += Number(r.total || 0);
    cur.success += Number(r.success || 0);
    cur.cost += Number(r.cost || 0);
    refUsage.set(key, cur);
  }
}

// ---- Print usage table ----
const fmt = (n) => Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-';
const pct = (n) => Number.isFinite(n) ? `${n.toFixed(1)}%` : '-';

const allKeys = new Set([...refUsage.keys(), ...ourUsage.keys()]);
const tableRows = [];
for (const key of allKeys) {
  const r = refUsage.get(key) || { mod: key.split('|')[0], sub: key.split('|')[1], total: 0, success: 0, cost: 0 };
  const o = ourUsage.get(key) || { mod: key.split('|')[0], sub: key.split('|')[1], total: 0, billable: 0, cost: 0 };
  tableRows.push({
    mod: r.mod || o.mod,
    sub: r.sub || o.sub,
    refTot: r.total, ourTot: o.total,
    refOK: r.success, ourOK: o.billable,
    refCost: r.cost, ourCost: o.cost,
  });
}
tableRows.sort((a, b) => b.ourOK - a.ourOK);

console.log(`\n========== SWIGGY USAGE — ${month} (PRODUCTION) ==========\n`);
console.log(
  'Module / Sub-Module'.padEnd(50),
  'ref billable'.padStart(14),
  'ours billable'.padStart(14),
  'Δ'.padStart(8),
  'acc'.padStart(8),
  'ref ₹'.padStart(13),
  'ours ₹'.padStart(13),
);
console.log('-'.repeat(125));
for (const r of tableRows) {
  const label = `${r.mod} – ${r.sub || '(none)'}`.slice(0, 49);
  const diff = r.ourOK - r.refOK;
  const acc = r.refOK > 0 ? (r.ourOK / r.refOK) * 100 : (r.ourOK > 0 ? Infinity : 100);
  const flag = !Number.isFinite(acc) ? '⚠' : (Math.abs(acc - 100) < 0.1 ? '✓' : Math.abs(acc - 100) < 1 ? '~' : '✗');
  console.log(
    label.padEnd(50),
    fmt(r.refOK).padStart(14),
    fmt(r.ourOK).padStart(14),
    fmt(diff).padStart(8),
    pct(acc).padStart(7), flag,
    fmt(r.refCost).padStart(12),
    fmt(r.ourCost).padStart(12),
  );
}

const totals = tableRows.reduce((a, r) => ({
  refOK: a.refOK + r.refOK, ourOK: a.ourOK + r.ourOK,
  refCost: a.refCost + r.refCost, ourCost: a.ourCost + r.ourCost,
}), { refOK: 0, ourOK: 0, refCost: 0, ourCost: 0 });
console.log('-'.repeat(125));
console.log(
  'TOTAL'.padEnd(50),
  fmt(totals.refOK).padStart(14),
  fmt(totals.ourOK).padStart(14),
  fmt(totals.ourOK - totals.refOK).padStart(8),
  pct(totals.refOK > 0 ? totals.ourOK / totals.refOK * 100 : 0).padStart(8),
  fmt(totals.refCost).padStart(12),
  fmt(totals.ourCost).padStart(12),
);

// ---- Pricing slabs for swiggy ----
console.log(`\n\n========== SWIGGY PRICING SLABS (Metabase) ==========\n`);
const allPricing = await mbPost('/api/dataset/json', {
  type: 'query', database: DB, query: { 'source-table': 20377 },
}, true);
const pricing = Array.isArray(allPricing) ? allPricing.filter(r => r['Client ID'] === 'swiggy') : [];
console.log(`pricing rows for swiggy: ${pricing.length}\n`);

// Enrich with module names from products table
const products = await mbPost('/api/dataset/json', {
  type: 'query', database: DB, query: { 'source-table': 20382 },
}, true);
const prodMap = new Map();
for (const p of products) prodMap.set(p['Unit'], p);

// Sort by Module Name then Slab Start
pricing.sort((a, b) => {
  const am = (prodMap.get(a['Unit'])?.['Module Name'] || a['Module Type'] || '').localeCompare(prodMap.get(b['Unit'])?.['Module Name'] || b['Module Type'] || '');
  if (am !== 0) return am;
  return Number(a['Slab Start'] || 0) - Number(b['Slab Start'] || 0);
});

console.log(
  'Module / Sub-Module'.padEnd(50),
  'Unit'.padEnd(35),
  'Slab Start'.padStart(12),
  'Slab End'.padStart(14),
  'Price ₹'.padStart(10),
);
console.log('-'.repeat(125));
for (const p of pricing) {
  const product = prodMap.get(p['Unit']);
  const label = product
    ? `${product['Module Name']} – ${product['Unit Name'] || ''}`.slice(0, 49)
    : `${p['Module Type'] || '?'} (unmapped)`.slice(0, 49);
  const slabEnd = Number(p['Slab End'] || 0);
  const slabEndStr = slabEnd >= 2147483647 ? '∞' : fmt(slabEnd);
  console.log(
    label.padEnd(50),
    String(p['Unit'] || '').slice(0, 34).padEnd(35),
    fmt(p['Slab Start']).padStart(12),
    slabEndStr.padStart(14),
    Number(p['Unit Price']).toFixed(2).padStart(10),
  );
}
