# Focus View — Design Spec

**Date:** 2026-08-01
**Status:** Approved

## Purpose

A daily-driver view that answers, at a glance: **which accounts do I focus on,
which do I stay close to, and which do I defend** — ranked by a blend of value ×
momentum × risk. Sells on **Convenience** (the prioritized answer, not the raw
ingredients) + **Solutions** (surfaces the protect/grow/defend decisions).
See [[product-opportunity-lens]].

## Placement

New top-level **"Focus"** nav view (daily driver). The Dashboard stays the exec
overview. Nav item after Dashboard/Revenue Intel.

## Buckets (mutually exclusive; assigned in this priority order)

1. **Watch** (act now) — churned (`latest 0, prev > 0`) or declining
   (`MoM < -10%`, `prev > 100`). Ranked by **$ at risk (USD)** desc.
2. **Protect** (stay close) — top **N (default 15)** by current MRR (USD) not in
   Watch. Ranked by **MRR** desc. Flag `slipping: true` when `momPct < 0`.
3. **Grow** (ride momentum) — up-movers (`MoM > +10%` and `mrrUSD >= floor`, floor
   = $500) not in Watch/Protect. Ranked by **momentum** (momPct, MRR tiebreak).
   Enriched with the account's **top upsell** (recommendation engine, only for
   this short list).

Everything ranked in **USD** (convert before comparing) so cross-currency is
correct — avoids the raw-INR bug fixed in the Brief.

## Data shapes

```ts
export interface FocusAccount {
  client_id: string;
  client_name: string;
  segment: string;
  mrrUSD: number;
  prevUSD: number | null;
  momPct: number | null;
  bucket: 'protect' | 'grow' | 'watch';
  riskKind: 'churned' | 'declining' | 'growing' | 'stable' | 'not-in-prod';
  atRiskUSD: number;      // Watch only (else 0)
  slipping: boolean;      // Protect flag: momPct < 0
  reason: string;         // "stay close" / "+22% — expand now" / "declining -38%, $8K at risk"
  topUpsell?: string;     // Grow enrichment
}
export interface FocusResult {
  protect: FocusAccount[];
  grow: FocusAccount[];
  watch: FocusAccount[];
}
```

## Architecture

- **`src/lib/focus.ts`** (new, pure, dependency-injected — testable):
  ```ts
  export function computeFocus(
    clients: ClientData[],
    opts: { toUSD: (amount: number, currency?: string | null) => number; topN?: number },
  ): FocusResult;
  ```
  `convertToUSD`/`fmtUSD` live inside `page.tsx` (not exported), so `toUSD` is
  injected rather than imported — keeps `focus.ts` free of page/React coupling.
  Reuses `computeRevenueTrend` / `computeRiskSignal` from `account-brief.ts` for
  per-client momentum & risk (converting their billing-currency outputs to USD).
  Builds `reason` strings. Does NOT do upsell enrichment (that needs the engine).

- **`src/components/FocusView.tsx`** (new):
  - Props: `{ clients: ClientData[]; masterAPIs: string[]; toUSD; formatUSD; onOpenClient: (clientName: string) => void }`
  - `const focus = useMemo(() => computeFocus(clients, { toUSD }), [clients, toUSD])`
  - Memoizes one `RecommendationEngine(clients, masterAPIs)`; enriches each Grow
    row with `getClientRecommendations(name)?.recommendations?.[0]?.apiName`.
  - Renders three columns (Protect / Grow / Watch), each a ranked list of compact
    cards: name · MRR · MoM ▲▼ · reason · (Grow: upsell). Card click →
    `onOpenClient(name)`. Empty buckets show a friendly state. 60-30-10 palette;
    emerald = grow, amber/red = watch, slate/emerald = protect.

- **`page.tsx`**:
  - Add `'focus'` to `DashboardView`.
  - Nav item `{ id: 'focus', label: 'Focus', icon: Crosshair, description: 'Who to work today' }`.
  - Render `<FocusView clients={processedClients} masterAPIs={allAPIs} toUSD={convertToUSD} formatUSD={formatUSD} onOpenClient={name => { setSearchTerm(name); setView('matrix'); }} />`.

## Edge cases

- <2 months history → `momPct` null → not eligible for Grow/Watch; still eligible
  for Protect by MRR.
- Empty bucket → "Nothing to protect/grow/watch right now".
- `mrrUSD` 0 with no history → excluded from Protect ranking.

## Testing

- Sanity-check `computeFocus` on synthetic clients: a churned whale (→ Watch top),
  a stable top grosser (→ Protect), a small fast grower (→ Grow), a low-history
  account (→ excluded / Protect only). Assert bucket + order.
- `npx tsc --noEmit`, `npm run lint` (own files), verify in-browser.

## Out of scope (later)

- Opening the Brief panel directly from a Focus card (v1 jumps to Matrix + search).
- Configurable topN / thresholds in the UI.
- Persisting "worked today" state.
