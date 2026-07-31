# Client Lifecycle / Go-Live Tracking — Design

**Date:** 2026-07-31
**Status:** Approved

## Problem

We want to know, per client, **when they went to production** (go-live date) and
when they started **testing/staging**. The Metabase warehouse has the stage
information (`environment` = PRODUCTION / STAGING / TESTING on the `credentials`
and `module_costs` tables), but **every `created_at` field in the warehouse is an
ETL load timestamp** (all rows = the warehouse load time), so the real creation
dates are not available from Metabase.

The real per-credential creation dates exist only in an exported CSV
(`credentials-report.csv`): columns `appId, type, createdDate, disabled`, with
real dates spanning 2022-01-03 → 2026-06-30.

### Cross-check result (why appId is the join key)

- 7,437 / 7,437 CSV `appId`s exist in Metabase `credentials` (100%).
- All 3,076 PRODUCTION `appId`s map to a `client_id` in Metabase.
- The app already sources its client list from Metabase (`fetchClients` in
  `client-data-loader.ts`), so the app's `client_id` matches the credentials
  join key exactly.

## Definitions

- **Went-to-production date** = earliest `createdDate` among a client's
  `PRODUCTION` appIds.
- **First-staging date** = earliest `createdDate` among a client's `STAGING`
  appIds (proxy for when integration/testing began).
- **Stage:**
  - `production` — client has ≥1 PRODUCTION appId.
  - `testing-only` — client has STAGING/TESTING appIds but no PRODUCTION.
  - `none` — client id has no credentials in the report.

### Counts (from current export)

- 1,977 clients with a production date.
- 1,885 clients testing-only (never went to production).
- 3,862 total clients in the report.

## Caveat

The CSV is a snapshot ending 2026-06-30. Metabase has 215 newer `appId`s not in
the CSV (created after the export). Anyone who went live in July 2026 won't have
a date until the CSV is refreshed. The loader reads whatever CSV sits in
`data/credentials-report.csv`, so refreshing = replace the file. The UI shows a
"data as of `<max createdDate>`" note.

## Architecture

### Data flow

```
data/credentials-report.csv  (appId, type, createdDate, disabled)
        │
        ├── Metabase credentials (appId → client_id)   [new fetchCredentials()]
        │
        └── Metabase clients (client_id → name, operational_status)
                │
                ▼
        lib/client-lifecycle.ts   (join → per-client lifecycle, cached 5 min)
                │
                ▼
        /api/lifecycle  →  { clients: LifecycleRow[], summary }
                │
                ▼
        page.tsx: fetch once (SWR), build client_id → LifecycleRow lookup
                ├── LifecycleView (new tab)
                ├── ClientDetailsPanel (Overview rows)
                └── MatrixView (column + filter)
```

### Components / files

1. **`lib/metabase.ts`** — add `fetchCredentials()`: returns
   `{ appId, clientId, environment }[]` from table 20365
   (`/api/dataset/json`, no row cap), cached + single-flight like the others.

2. **`lib/client-lifecycle.ts`** (new)
   - `parseCredentialsCsv()` — read `data/credentials-report.csv` via `fs`,
     parse `appId, type, createdDate, disabled`.
   - `getClientLifecycle()` — join CSV + `fetchCredentials()` +
     `fetchClients('all')`; return:
     ```ts
     interface LifecycleRow {
       client_id: string;
       client_name: string;
       operational_status: string;      // live | active | trial | inactive | ''
       stage: 'production' | 'testing-only' | 'none';
       first_staging_date: string | null;      // YYYY-MM-DD
       went_to_production_date: string | null;  // YYYY-MM-DD
       days_to_go_live: number | null;          // staging → prod, if both known
       prod_app_count: number;
       staging_app_count: number;
     }
     ```
   - Returns `{ clients: LifecycleRow[], summary, dataAsOf }` where
     `summary = { total, production, testingOnly }` and `dataAsOf` = max
     `createdDate` in the CSV.
   - Cached in-memory (5-min TTL).

3. **`src/app/api/lifecycle/route.ts`** (new) — GET → `getClientLifecycle()`
   result. `export const dynamic = 'force-dynamic'`.

4. **`src/app/page.tsx`**
   - Add `'lifecycle'` to `DashboardView`.
   - Add nav item `{ id: 'lifecycle', label: 'Lifecycle', icon: Rocket,
     description: 'Go-live dates' }`.
   - Fetch `/api/lifecycle` once via SWR at the page level; build a
     `Map<client_id, LifecycleRow>` lookup.
   - Render `<LifecycleView />` when `view === 'lifecycle'`.

5. **`LifecycleView`** (new component, in page.tsx alongside the others)
   - Summary header ("1,977 live in production · 1,885 testing-only · data as of …").
   - Sortable table: **Client · Status · Stage · Testing since · Live since ·
     Days to go-live · Prod apps**.
   - Filters: **Stage**, **Operational status**, **Went-live year/range**,
     **Text search** (id/name).

6. **`ClientDetailsPanel`** — Overview gets two rows: "Live in production since"
   and "Testing since", read from the lifecycle lookup by `client.client_id`
   (falls back to "—").

7. **`MatrixView`** — add a "Live since" column and a filter (stage / go-live
   year), merged by `client_id`; unmatched → "—".

## Styling

Follow the existing 60-30-10 palette. Stage badges: emerald = production,
amber = testing-only, slate = none. Reuse the existing table/card and filter
chrome from MatrixView so it feels native.

## Testing / verification

- `npm run build` passes (types + lint).
- `/api/lifecycle` returns ~3,862 rows with correct summary counts.
- Spot-check known clients: `groww → 2022-02-21`, `slicepay → 2022-02-22`,
  `vietcombank → 2026-06-29`.
- Lifecycle tab renders, filters and sort work; ClientDetailsPanel and Matrix
  show the dates for matched clients and "—" otherwise.

## Out of scope

- Getting real `created_at` loaded into the warehouse (permanent fix, separate).
- BUID/App-ID-level (per-app) lifecycle breakdown — can add later.
