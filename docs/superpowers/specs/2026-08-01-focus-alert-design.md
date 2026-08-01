# Focus Alert (nav badge + banner) — Design Spec

**Date:** 2026-08-01
**Status:** Approved

## Purpose

Surface the Focus counts from anywhere so the user stays aware of what needs
attention without sitting on the Focus tab. Sells on **Solutions** (reduces the
fear of missing a slipping account) + **Feeling** (in control). See
[[product-opportunity-lens]].

## Behaviour

- **Nav badge** — a small red count pill on the **Focus** nav item showing the
  **Watch (at-risk)** count. Always visible. Hidden when count is 0.
- **Banner** — a slim, dismissible strip at the top of the **Dashboard** view:
  `⚠  N to watch · N to grow · N to protect   [Open Focus]  ✕`
  - **Open Focus** → `setView('focus')`.
  - **✕** → dismiss for the session (Home `useState`, resets on reload). Hidden
    when all counts are 0 or already dismissed.

## Architecture

Compute the focus result **once** in `Home` and share it (no duplicate compute):

- `page.tsx` (Home):
  - `const focus = useMemo(() => computeFocus(processedClients, { toUSD: convertToUSD }), [processedClients])`
  - Counts: `focus.watch.length / focus.grow.length / focus.protect.length`.
  - New state `const [focusBannerDismissed, setFocusBannerDismissed] = useState(false)`.
  - Pass `focusCounts={{ protect, grow, watch }}` into `DashboardFrame`.
  - Render `<FocusBanner counts=… onOpen={() => setView('focus')} onDismiss={…} />`
    at the top of the Dashboard view block (only when not dismissed and total > 0).
  - Pass `focus={focus}` into `FocusView` (refactored to accept it).

- `DashboardFrame`: new optional prop `focusCounts?: { protect; grow; watch }`.
  In `navItems.map`, when `item.id === 'focus'` and `focusCounts.watch > 0`,
  render a red count pill after the label.

- **`FocusBanner`** — small component (in page.tsx alongside the other view
  helpers): props `{ counts, onOpen, onDismiss }`. One-line amber/red strip.

- `FocusView`: change to accept `focus: FocusResult` as a prop and use it instead
  of calling `computeFocus` internally; keep the Grow upsell enrichment (memoized
  over the passed-in focus + engine).

## Edge cases

- All counts 0 (or data still loading) → no badge, no banner.
- Dismissed → banner hidden until reload; badge stays (badge isn't dismissible).

## Testing

- `npx tsc --noEmit`, `npm run lint` (own files).
- Browser: badge shows the at-risk count on the Focus nav item; banner shows all
  three counts; **Open Focus** navigates; **✕** hides the banner for the session.

## Out of scope

- Persisting dismissal across reloads (sessionStorage) — v1 uses in-memory state.
- Badges on other nav items.
