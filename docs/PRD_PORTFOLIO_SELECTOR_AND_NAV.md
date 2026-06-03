# PRD: Single Portfolio Selector + Cleaner Top Bar

## Problem Statement

Two adjacent discrepancies in the Masthead and the page bodies. Same fix surface, bundled here.

### 1. Redundant "select portfolio" surfaces

The Masthead's `PortfolioPicker` (top bar, Row 1) is documented in code as *"the single source of truth for what portfolio is currently in focus"* — it sets `?portfolio=<id>` and is read by every per-portfolio page hook (`use-enrich`, `use-performance`, `use-rebalancer`, `use-builder`, `use-concentrations`).

Despite that, four of the five per-portfolio pages **also render a portfolio selector inside their own body**:

| Page              | Second selector lives in                                | Selector style       |
| ----------------- | ------------------------------------------------------- | -------------------- |
| **Enrich**        | `enrich/summary-bar.tsx` (`selectedPortfolio` dropdown) | Single-select        |
| **Performance**   | `performance/summary-panel.tsx` (`onSelectPortfolio`)   | Single-select        |
| **Rebalancer**    | `rebalancer/detailed-overview.tsx` (`selectedPortfolio`)| Single-select        |
| **Concentrations**| `concentrations/portfolio-filter.tsx` (chip filter)     | **Multi-select**     |
| Builder           | n/a (page lists all portfolios as content)              | —                    |

What the user sees:
- Two "pick a portfolio" controls visible at once. Unclear which one is authoritative.
- They **desync** — top picker and in-page picker can show different active portfolios because each page-level component keeps its own state alongside the URL param.
- Concentrations' chip row is genuinely different (multi-select aggregate filter), but reads as a competing picker.
- "Not working properly" is the user-visible symptom: changing one doesn't always reflect in the other.

### 2. Redundant page name in the top-left

Row 1 of the Masthead currently renders:

```
[■] PRISMO  │  ENRICH  ·  Portfolio Name ▾  │  …  │ ANON │ LIGHT │ ACCT · nico │ ⋮
            └───────┘
              page name (duplicates the active tab in Row 2)
```

Row 2 directly below is the tab bar. The active tab already conveys which page is open — currently with a 2px cyan underline on white text. The "ENRICH" breadcrumb in Row 1 duplicates that information.

The active tab is also visually too subtle: the underline is easy to miss, and the active label uses `text-ink` (near-white), only one shade brighter than inactive `text-ink-2`.

---

## Goal

1. **One portfolio selector, anchored on the page title row.** Pull `PortfolioPicker` out of the Masthead entirely. Place it inside each per-portfolio page, on the **same row as the page `<h1>`, at a consistent position across pages**, so the user always finds it in the same spot. In-page duplicates get removed (Enrich `SummaryBar`, Performance `SummaryPanel`, Rebalancer `DetailedOverview`). Concentrations' multi-select filter chips stay where they are (they're a different concept).
2. **Cleaner top bar.** Drop the page-name breadcrumb. Strengthen the active tab in Row 2 by switching it from white text to **Prismo cyan** (`text-cyan`), so the active surface is unmistakable without redundant labelling.

---

## Design Approach

### Before / after — Row 1 of the Masthead

```
BEFORE
┌──────────────────────────────────────────────────────────────────────────────┐
│ ■ PRISMO │ ENRICH · Portfolio Name ▾ │  ……  │ ANON │ LIGHT │ ACCT · nico │ ⋮ │
└──────────────────────────────────────────────────────────────────────────────┘

AFTER
┌──────────────────────────────────────────────────────────────────────────────┐
│ ■ PRISMO │                              NAV — │ LIVE · EUR · 13:42 │ ANON … │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Page name removed.** The `· ` separator goes with it.
- **`PortfolioPicker` removed from the Masthead entirely.** It moves into the page body (next section).
- Brand cell, NAV, LIVE, ANON, LIGHT, ACCT, kebab — all unchanged.

### NEW — Per-page header row (same position on every per-portfolio page)

The picker lives **at the level of the page title**, inline on the `<h1>` row, **right-aligned**, separated by `gap-4`. Same exact layout on Enrich, Performance, Rebalancer, Builder, and Overview. Stable position → the user's eye always lands on the same place.

```
┌────────────────────────────────────────────────────────────┐
│  Enrich                            [Portfolio Name ▾]      │
└────────────────────────────────────────────────────────────┘
│
│  …page content…
```

Layout pattern (shared shell):

```tsx
<div className="flex items-baseline justify-between gap-4">
  <h1 className="text-2xl font-bold">Enrich</h1>
  <PortfolioPicker />
</div>
```

- **Right-aligned** on the title row (does not shift based on title length).
- `items-baseline` keeps the picker visually aligned to the title's text baseline.
- Picker's existing dropdown UI is unchanged — same labels, same `?portfolio=` mutation. It just lives in a new parent.
- The picker's typography stays as-is (`font-mono text-[11px] uppercase tracking-[0.06em]`). It reads as a chrome control sitting next to a content title — that contrast is intentional.

Per-page placement:

| Page              | Title row content                                                             |
| ----------------- | ----------------------------------------------------------------------------- |
| **Overview** (`/`)| `Overview` ⟂ `PortfolioPicker` (label: `ALL PORTFOLIOS`, opens dropdown)       |
| **Enrich**        | `Enrich` ⟂ `PortfolioPicker`                                                  |
| **Performance**   | `Performance` ⟂ `PortfolioPicker`                                             |
| **Rebalancer**    | `Rebalancer` ⟂ `PortfolioPicker`                                              |
| **Builder**       | `Builder` ⟂ `PortfolioPicker`                                                 |
| **Concentrations**| `Concentrations` only. No picker in the title row. (See exception below.)     |
| **Simulator**     | Unchanged — has its own `simulator-header.tsx`. Not part of this refactor.    |
| **Account**       | Unchanged.                                                                    |

### Concentrations — exception

Concentrations is an **aggregate view** — it intentionally allows including/excluding multiple portfolios at once (the donut, the heatmap, and the bar charts aggregate across the selection). A single-select picker would break that.

Two options considered:

- **Option A (chosen for this PRD):** No picker in the Concentrations title row. The existing multi-select chip row in `portfolio-filter.tsx` stays where it is (below the title), but its label is renamed `"Portfolios"` → `"Filter portfolios"` so its different role is explicit. Minimal change. Preserves existing behaviour.
- **Option B (deferred):** Promote the moved-into-page picker to support multi-select on Concentrations only. Requires comma-separated `?portfolio=` and reworked picker UI. Defer.

Acceptable trade-off of Option A: the "constant position" rule has one exception. The cost is small — Concentrations users already know it's the aggregate view.

### Before / after — Row 2 (tab nav)

```
BEFORE   Overview │ Enrich  Concentrations  Performance │ Builder  Rebalancer  Simulator
                    ────────                                                         (white text + 2px cyan underline)

AFTER    Overview │ ENRICH  Concentrations  Performance │ Builder  Rebalancer  Simulator
                    ━━━━━━                                                            (cyan text + 2px cyan underline)
```

- Active tab text → `text-cyan` instead of `text-ink`.
- Underline stays — reinforces the active state and keeps existing 32px row metrics.
- Inactive tabs unchanged (`text-ink-2`, hover `text-ink`).

### Per-page selector resolution (what gets removed)

| Page              | Action                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| **Enrich**        | Remove `selectedPortfolio` dropdown from `summary-bar.tsx`. URL `?portfolio=` is read directly.   |
| **Performance**   | Remove `onSelectPortfolio` dropdown from `summary-panel.tsx`. URL `?portfolio=` is read directly. |
| **Rebalancer**    | Remove `selectedPortfolio` dropdown from `detailed-overview.tsx`. URL `?portfolio=` is read directly. |
| **Concentrations**| Keep `portfolio-filter.tsx`. Rename label to `"Filter portfolios"`. Otherwise untouched.          |
| **Builder**       | Unchanged.                                                                                        |

---

## Implementation

> All changes are frontend-only. No backend, schema, or migration impact.

### 1. Masthead — `frontend/src/components/ptsim/Masthead.tsx`

- Remove the Breadcrumb block (~lines 115–123) — the `<div>` containing `{pageName}`, the `·` separator, and `<PortfolioPicker />`. The whole cell goes away.
- Delete `PAGE_NAMES`, `pageNameFor()`, and the `pageName` / `navLabel` derivations if `navLabel` was the only other user (it is — keep `navLabel`, just inline it). Verify no other callers (none expected; both are file-local).
- Delete the `import { PortfolioPicker } from "./PortfolioPicker"` — it's no longer referenced here.
- In `ROW2_GROUPS.map(...)`, update the active-tab class:
  ```tsx
  active
    ? "text-cyan border-b-2 border-cyan -mb-px"   // was: text-ink
    : "text-ink-2 hover:text-ink"
  ```

### 2. New shared header — `frontend/src/components/shell/page-header.tsx` (new file)

To enforce "same position on every page," extract a small component:

```tsx
// frontend/src/components/shell/page-header.tsx
import { PortfolioPicker } from "@/components/ptsim/PortfolioPicker";

export function PageHeader({
  title,
  showPortfolioPicker = true,
}: {
  title: string;
  showPortfolioPicker?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      {showPortfolioPicker && <PortfolioPicker />}
    </div>
  );
}
```

Why a component, not a literal `<div>` in each page: forces the layout to stay identical. If we later want to bump spacing, change typography, or add a secondary chrome line (e.g. last-updated timestamp), there's one place to change it.

`PortfolioPicker` itself is **not modified**. Its existing label rules (`ALL PORTFOLIOS`, `SELECT PORTFOLIO`, portfolio name) still work; they read `usePathname()` to decide what to render, which is correct in either parent.

### 3. Pages — replace `<h1>` blocks with `<PageHeader>`

In each file below, replace the existing `<h1 className="text-2xl font-bold">…</h1>` line with `<PageHeader title="…" />`. The error / loading branches that render their own `<h1>` should also be updated (or the `<PageHeader>` should be lifted above the conditional return) so the header position is stable while data loads.

- `frontend/src/app/(dashboard)/page.tsx` — Overview. `<PageHeader title="Overview" />`.
- `frontend/src/app/(dashboard)/enrich/page.tsx` — `<PageHeader title="Enrich" />`. Also drop the `selectedPortfolio` / `setSelectedPortfolio` / `portfolioOptions` props passed into `<SummaryBar>` (and remove them from the `SummaryBar` signature in `summary-bar.tsx`).
- `frontend/src/app/(dashboard)/performance/page.tsx` — `<PageHeader title="Performance" />`. Drop the same props from `<SummaryPanel>`.
- `frontend/src/app/(dashboard)/rebalancer/page.tsx` — `<PageHeader title="Rebalancer" />`. Drop the same props from `<DetailedOverview>` (and remove from its signature in `detailed-overview.tsx`).
- `frontend/src/app/(dashboard)/builder/page.tsx` — `<PageHeader title="Builder" />`.
- `frontend/src/app/(dashboard)/concentrations/page.tsx` — `<PageHeader title="Concentrations" showPortfolioPicker={false} />`. The chip filter row below stays.

### 4. Concentrations chip filter — `concentrations/portfolio-filter.tsx`

- Rename the leading label from `"Portfolios"` → `"Filter portfolios"`.
- Keep the multi-select chip behaviour and `Include cash` toggle.
- Stays independent of `?portfolio=` (it's an aggregate view).

### 5. Hooks — read URL, drop local portfolio state

- `use-enrich.ts`, `use-performance.ts`, `use-rebalancer.ts`: replace any local `selectedPortfolio*` state with `useSearchParams().get("portfolio")`. Setter helpers (if anything outside the picker mutated them) become `router.push("/<route>?portfolio=<id>")`.
- `use-concentrations.ts`: unchanged.
- `use-builder.ts`: confirm it already follows the URL param. If not, align.
- `lib/portfolio-state.ts`: confirm it's the single read/write helper. If both the picker and per-page hooks go through it, that's the right shape.

### 6. Impact checklist (run before commit)

Per `CLAUDE.md`'s GitNexus rules:

- `gitnexus_impact({target: "PortfolioPicker", direction: "upstream"})`
- `gitnexus_impact({target: "Masthead", direction: "upstream"})`
- `gitnexus_impact({target: "SummaryBar", direction: "upstream"})` (Enrich)
- `gitnexus_impact({target: "SummaryPanel", direction: "upstream"})` (Performance)
- `gitnexus_impact({target: "DetailedOverview", direction: "upstream"})` (Rebalancer)
- `gitnexus_detect_changes()` after edits, before commit.

Anything at HIGH/CRITICAL risk: stop and flag.

---

## Out of Scope

- Multi-select picker on Concentrations (Option B). Deferred unless explicitly requested.
- Sandbox / Simulator surface — has its own header (`simulator-header.tsx`) with bespoke label rules. Untouched.
- Account picker (`account-picker.tsx`) — different surface (account, not portfolio).
- Color-token changes — `text-cyan` is already the Prismo blue token in the theme.

---

## Acceptance Criteria

1. **Masthead Row 1** no longer contains the page name or the `PortfolioPicker`. Brand cell, NAV, LIVE, ANON, LIGHT, ACCT, kebab — unchanged.
2. **Every per-portfolio page** (Overview, Enrich, Performance, Rebalancer, Builder) renders a `<PageHeader>` with the picker right-aligned on the title row, at the same horizontal position across pages.
3. **Concentrations** title row has no picker. The chip filter below is renamed `"Filter portfolios"`.
4. **Only one portfolio selector** is visible per page (zero on Concentrations title row — its chip filter row is preserved).
5. **No desync.** URL `?portfolio=` is authoritative; refreshing restores the same active portfolio. Switching the picker re-renders the page in place.
6. **Active tab in Row 2** uses `text-cyan` text + the existing 2px cyan underline.
7. `npm run lint` passes; no TypeScript errors.
8. `gitnexus_detect_changes()` after the work shows only the expected files affected.

---

## Risks & Notes

- Hooks that currently hold their own `selectedPortfolio` state may have implicit re-render assumptions. Reading from `useSearchParams()` re-renders on URL change — verify data fetchers re-run when the param flips.
- `?portfolio=` may currently be missing on first navigation from `/` (Overview) into a per-portfolio page. The picker's `targetRouteForPortfolio()` already injects it; verify direct-link / refresh cases still work.
- `PortfolioPicker` was designed for a 40px-tall chrome row. Inline next to an `text-2xl` `<h1>` it sits noticeably lower than the title — `items-baseline` aligns it nicely. If it ends up reading too quiet, bump the trigger to `text-[12px]` only on the page-header parent. Decide visually, not up-front.
- `<PageHeader>` is a small new shared component — keep it terse. No props bloat. If a page needs special content on the right (e.g. an action button), pass it as `right={…}` instead of forking the component. Not needed for v1.
