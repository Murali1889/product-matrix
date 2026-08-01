# Focus as the "needs attention" hub - Design Spec

**Date:** 2026-08-01
**Status:** Approved

## Purpose

Make Focus the single place that shows everything needing attention, so the user
saves time and does not have to think or hunt across tabs. Sells on Convenience
(one answer, no hunting) and Solutions (nothing important slips). See
[[product-opportunity-lens]].

## Layout

One scrollable, priority-ordered page. Each section is a ranked short list (top 5,
with "show all N"), most time-sensitive first. A top line shows the total load and
per-section counts so it reconciles at a glance.

## Sections (priority order) and sources

1. Watch: at risk, defend. From computeFocus.watch (declining/churned), by dollars at risk.
2. Trial expiring: convert before it lapses. Clients with profile.trial_expires within 30 days (future), soonest first.
3. Ready to go live: unlock stuck revenue. Lifecycle rows with stage 'testing-only', by first_staging_date recency.
4. Big upsell gaps: segment peers already buy this. From segment-intelligence action=all: clients with high-priority apisMissing, by potentialRevenue.
5. Grow: ride momentum. From computeFocus.grow, with top upsell enrichment.
6. Pricing / billing issues: fix leaks. From pricing-anomalies grouped by client, by priceDiff.
7. Protect: stay close. From computeFocus.protect (top grossers).

## Data model

```ts
interface AttentionItem {
  id: string;
  name: string;         // client name (display)
  clientName: string;   // for onOpenClient
  metric: string;       // right-aligned key figure (money, date, or count)
  metricTone: 'red' | 'amber' | 'emerald' | 'slate';
  reason: string;       // one-line context
}
interface AttentionSectionData {
  key: string; title: string; subtitle: string;
  tone: 'red' | 'amber' | 'blue' | 'emerald' | 'slate';
  items: AttentionItem[];
  loading?: boolean;    // for the fetched sections
}
```

## Architecture

- `lib/focus.ts`: keep `computeFocus`. Add pure builders that each return
  `AttentionItem[]`:
  - `trialExpiringItems(clients, { withinDays = 30 }, fmt)`
  - `readyToGoLiveItems(lifecycleRows)`
  - `pricingIssueItems(anomalies)`
  - `upsellGapItems(segmentData, fmt)`
  Also small mappers `watchItems / growItems / protectItems` from FocusResult so
  every section shares the AttentionItem shape.
- `FocusView.tsx`:
  - Props: `focus`, `clients`, `lifecycle` (LifecycleRow[]), `masterAPIs`,
    `formatUSD`, `onOpenClient`.
  - Fetches `/api/segment-intelligence?action=all` and `/api/pricing-anomalies`
    via SWR (both cached server-side; credentials: same-origin).
  - Builds the 7 sections, renders a top summary + `AttentionSection` list.
  - `AttentionSection`: header (icon, title, count, subtitle) + top 5 rows +
    "show all N" toggle. Empty section shows a quiet "all clear" line.
  - `AttentionRow`: name, right metric (toned), reason, click to open.
- `page.tsx`: pass `lifecycle={lifecycleData?.clients ?? []}` into `FocusView`.

## Priority / ranking within sections

Each section ranked by its own most-relevant metric: Watch by at-risk $, Trial by
soonest expiry, Go-live by most recent staging, Upsell by potential $, Grow by
momentum, Pricing by priceDiff, Protect by MRR.

## Edge cases

- Empty section: quiet "all clear", not a gap.
- Fetched sections still loading: small spinner in that section, page not blocked.
- Missing trial_expires or invalid date: excluded.
- Dedupe: a client can legitimately appear in more than one section (e.g. Watch
  and Pricing issues); that is fine, each section is a distinct action lens.

## Testing

- Unit-check the pure builders: trial window (in/out of 30 days), testing-only
  filter, pricing grouping, upsell high-priority filter.
- tsc + lint (own files).
- Browser: sections populate, counts in the top line reconcile, show-all works,
  rows click through to Matrix.

## Out of scope

- Persisting "done today" state per item.
- Configurable trial window / thresholds in the UI.
- Merging duplicate appearances across sections into one row.
