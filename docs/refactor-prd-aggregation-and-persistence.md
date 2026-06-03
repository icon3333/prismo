# PRD — Calculation & Hook Consolidation

## Background

A duplication audit (2026-06-03) found two real cleanup opportunities beyond
the small heatmap/cash-helper fixes already shipped:

1. **Grouping-and-aggregating** is reimplemented across calc files.
2. **Debounced state-persistence** is reimplemented across data hooks.

A second-pass verification narrowed the scope: several call sites the audit
flagged turned out to use different shapes or carry additional concerns that
would force a leaky abstraction. Those are explicitly out of scope below.

## In scope

### Part A — `groupAndAggregate` helper

**New file:** `frontend/src/lib/aggregation-utils.ts`

```ts
export interface AggregateItem {
  name: string;
  value: number;
  percentage: number;
}

/**
 * Group items by a key, sum a numeric field, return entries sorted by value
 * desc with percentages computed from `total`. Caller decides `total` so it
 * can incorporate cash, scope by portfolio, etc.
 */
export function groupAndAggregate<T>(
  items: T[],
  keyFn: (item: T) => string,
  valueFn: (item: T) => number,
  total: number,
): AggregateItem[];
```

**Call sites to migrate (6):**

| File | Function | Notes |
|------|----------|-------|
| `lib/concentrations-calc.ts` | `groupByDimension` (lines ~40-75) | Replace the inner loop + `Object.entries().map()`. Keep the "top 8 + ≥1%, Unknown last" post-processing — caller-specific. |
| `lib/concentrations-calc.ts` | `topHoldings` (lines ~80-111) | Direct replacement of the per-company % loop. The "push Cash, re-sort" step stays. |
| `lib/concentrations-calc.ts` | `portfolioDistribution` (lines ~116-143) | Direct replacement. |
| `lib/overview-calc.ts` | `calculateViolations` — stock block (~43-60) | Helper call + threshold filter. |
| `lib/overview-calc.ts` | `calculateViolations` — sector block (~62-79) | Same. |
| `lib/overview-calc.ts` | `calculateViolations` — country block (~81-98) | Same. |

### Part B — `usePagePersistence` hook

**New file:** `frontend/src/hooks/use-page-persistence.ts`

```ts
/**
 * Debounced (500ms) POST of partial state merges to /state.
 * Returns `persistState(partial)`. Page name is fixed at hook creation;
 * each call merges the partial into an internal ref and schedules a POST
 * of the accumulated state (cancelling any pending POST).
 */
export function usePagePersistence<T extends Record<string, unknown>>(
  page: string,
): (partial: Partial<T>) => void;
```

**Call sites to migrate (2):**

| File | Lines |
|------|-------|
| `hooks/use-performance.ts` | 63-84 (`saveTimerRef`, `stateRef`, `persistState`) |
| `hooks/use-concentrations.ts` | 32-52 (same pattern, `page: "risk_overview"`) |

## Explicitly out of scope (verified during audit)

| Call site | Why excluded |
|-----------|--------------|
| `lib/simulator-calc.ts:283-339` | Raw `Record<string, number>` accumulation with custom key normalization (lowercase + "unknown"/"unassigned"), no percentages computed here. Different shape — would not save code through the helper. |
| `lib/performance-calc.ts:372-419` | 2-D country × dimension matrix with three parallel bookkeeping records (`exposure`, `countryTotals`, `dimensionTotals`, `companyDetails`). Not the same pattern. |
| `hooks/use-builder.ts:79-123` | Uses a strict-typed `pendingRef` (5 named fields), has an `isSaving` UI flag, and POSTs `serializeBuilderState(payload)` rather than a flat `{page, ...state}`. Retrofitting the generic hook here would force a leaky abstraction. |
| Frontend/backend rule-violation logic | Different operations (alarm vs. target-capping), not duplication. |
| "Select all portfolios" pattern | Only one call site (Concentrations); Rebalancer/Performance use single-portfolio selection. |

## Goals

- Net LOC reduction: ~50–70 lines across `lib/` and `hooks/`.
- Zero behavior change. Pages render identically before and after.
- Each helper has one obvious caller pattern. No optional flags or branching
  inside the helper to accommodate edge cases.

## Non-goals

- Touching backend.
- Refactoring calc-file public APIs (only internals change).
- Performance work.

## Verification

- ESLint clean.
- Manual smoke test of each affected page: Performance and Concentrations (load,
  toggle include-cash, change a sort, reload — state restores); Overview
  (rules-violation pill matches pre-refactor); Concentrations (charts match
  pre-refactor pixel-for-pixel on a fixture portfolio).
- Diff the JSON output of each migrated calc function on a known fixture if
  any output looks off.

## Rollout

Single PR. Two commits:

1. **A:** `aggregation-utils.ts` + 6 call-site migrations.
2. **B:** `use-page-persistence.ts` + 2 hook migrations.

Each commit independently lints and reverts cleanly.

## Open questions

- Should `groupAndAggregate` accept a `sort?: "value-desc" | "none"` option?
  Both current call-site patterns want value-desc. Tentative: hard-code
  value-desc; revisit if a future caller needs otherwise.
- Persistence hook: do we expose a `flush()` for unmount? Current code doesn't
  flush either, so leave it unchanged for now.
