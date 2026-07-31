# Account Brief — Design Spec

**Date:** 2026-07-31
**Status:** Approved

## Purpose

A per-account "Brief" — the at-a-glance summary a KAM/CSM opens right before a
client call. Sells on **Convenience** (one glance instead of digging across
tabs/tools) and **Solutions** (surfaces the upsell and the risk). See
[[product-opportunity-lens]].

## Placement

A new **"Brief" tab in `ClientDetailsPanel`, shown FIRST (default tab)** when a
client is opened from the matrix. The existing tabs (Overview / APIs / Filters /
Notes / Revenue) remain, unchanged, behind it.

## The four cards + a context strip

**Context strip** (top row): client name · KAM/CSM · geography · MRR bucket ·
operational status. Sourced from `lifecycle` + `client.profile`.

1. **Lifecycle** — from the `lifecycle` prop (already passed into the panel):
   - "Live since `<date>`" (prefix `≤` when `go_live_approximate`)
   - active-creds status (`active (3/4 creds)` when `currently_in_production`)
   - "Testing since `<date>`"
   - Testing-only clients show "Not in production yet".

2. **Revenue trend** — from `client.monthly_data`:
   - 8-month sparkline of `total_revenue_usd` (oldest→newest)
   - latest MRR (`monthly_data[0].total_revenue_usd`)
   - MoM % change with up/down color (green up, red down)
   - <2 months of data → "Not enough history".

3. **Top upsell** — from `RecommendationEngine.getClientRecommendations(client.client_name)`:
   - `recommendations[0]`: API name, score (0–100), `~$<potentialRevenue>/mo`, reason
   - none → "No upsell suggestion right now".

4. **Risk** — derived from `monthly_data[0]` vs `[1]`:
   - **Churned**: `latest === 0 && previous > 0` → red, "$<previous> at risk"
   - **Declining**: `(latest-previous)/previous < -0.1 && previous > 100` → amber, "−N% MoM, $<delta> at risk"
   - **Growing**: `growth > 10%` → green, "▲ +N% MoM"
   - else **Stable** → slate
   - testing-only / no revenue → "Not in production yet".

## Architecture

Keep `page.tsx` (already ~5,600 lines) from growing: put logic in `lib`, UI in a
new component.

- **`src/lib/account-brief.ts`** (new, pure & unit-tested)
  ```ts
  export interface RevenueTrend {
    points: number[];        // oldest→newest monthly total_revenue_usd (≤8)
    latest: number;
    previous: number | null;
    momPct: number | null;   // null when <2 months
    hasHistory: boolean;
  }
  export interface RiskSignal {
    kind: 'churned' | 'declining' | 'growing' | 'stable' | 'not-in-prod';
    momPct: number | null;
    atRisk: number;          // USD in danger (0 when not at risk)
    label: string;
  }
  export function computeRevenueTrend(client: ProcessedClient): RevenueTrend;
  export function computeRiskSignal(client: ProcessedClient, lifecycle?: LifecycleRow | null): RiskSignal;
  ```
  These take only the client (+lifecycle for the not-in-prod case) and read
  `client.monthly_data`. No React, no fetching.

- **`src/components/AccountBrief.tsx`** (new)
  - Props: `{ client: ProcessedClient; lifecycle: LifecycleRow | null; topRecommendation: APIRecommendation | null; formatUSD: (n:number)=>string }`
  - Renders the context strip + 2×2 card grid. Calls the two `account-brief.ts`
    helpers. A tiny inline SVG/`<div>` sparkline (no new dependency).
  - No data fetching; pure presentation from props.

- **`MatrixView`** (in `page.tsx`)
  - `const briefEngine = useMemo(() => new RecommendationEngine(clients, masterAPIs), [clients, masterAPIs])`
  - `const briefRec = useMemo(() => selectedClient ? (briefEngine.getClientRecommendations(selectedClient.client_name)?.recommendations?.[0] ?? null) : null, [briefEngine, selectedClient])`
  - Pass `topRecommendation={briefRec}` into `ClientDetailsPanel`.

- **`ClientDetailsPanel`** (in `page.tsx`)
  - Add `'brief'` to the `activeTab` union; initialise `activeTab` to `'brief'`.
  - Add a "Brief" tab button (first) in the tab bar.
  - Render `<AccountBrief client={client} lifecycle={lifecycle} topRecommendation={topRecommendation} formatUSD={formatUSD} />` when `activeTab === 'brief'`.
  - New prop `topRecommendation?: APIRecommendation | null`.

## Data flow

```
clients + masterAPIs ──▶ RecommendationEngine (memoized in MatrixView)
selectedClient ────────▶ briefRec (top recommendation, memoized)
                                     │
lifecycleMap.get(client_id) ─────────┼──▶ ClientDetailsPanel ──▶ AccountBrief
client.monthly_data ─────────────────┘        (default 'brief' tab)
                                                     │
                              account-brief.ts: computeRevenueTrend / computeRiskSignal
```

## Error handling / edge cases

- `monthly_data` missing or length <2 → trend `hasHistory:false`; risk `stable`
  with no MoM. Cards render graceful "Not enough history".
- Recommendation null (unknown client / no gaps) → "No upsell suggestion".
- `lifecycle` null → lifecycle card shows "—" / testing states.
- Division by zero guarded (`previous > 0` before computing pct).

## Testing

- **Unit** (`account-brief.ts`): growing, declining, churned, single-month,
  empty — assert `momPct`, `kind`, `atRisk`.
- **Manual**: open a growing, a declining, a churned, and a testing-only client;
  verify all four cards + strip. Confirm Brief is the default tab.
- `npx tsc --noEmit` and `npm run lint` clean.

## Out of scope (later)

- Multi-account "Briefs" landing page.
- Persisting/tracking whether a recommendation was acted on (the Solutions test
  metric) — separate feature.
- Pulling true contracted MRR / Zoho fields (needs the Zoho CSV).
