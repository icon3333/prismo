# Prismo — Code Review (2026-06-03)

**Lens**: simplicity, elegance, efficiency (speed first).
**Scope**: full backend (Flask, ~18k LOC) + frontend (Next.js, ~18k LOC).
**Confidence**: H = code-verified, M = pattern verified but call sites not all traced, L = inference / needs measurement.

---

## Status — implementation pass (2026-06-03)

**Done from this report**: #01 (5 broken repo methods deleted; see R2-01 for the other 4), #04 (`/profile` deleted), #05 (`app/__init__.py` trimmed), #07 (`Decimal` → `float`), #11 (`PRAGMA mmap_size`), #12 (redundant index dropped), #14 (`init_db` redundant tables removed), #15 (duplicate WAL pragma removed), #22 (`optimizePackageImports: ["lucide-react"]`), #28 (`substr` → `substring`).

**Deferred** (each marked **[DEFER]** / **[NOT DOING]** below):
- #02, #03 — CSV consolidation + deprecated stub deletion (~660 LOC; needs a dedicated pass + golden CSV tests).
- #10 — migrations squash (squashing safely requires knowing the lowest version in the wild; without that data, fresh installs already early-return so the cost is mostly file size).
- #19 — apiFetch blanket cache wipe — **not doing**; the win requires per-callsite migration the codebase doesn't justify. R2-26 below substantially mitigates the practical impact.
- #20, #25 — frontend rewrites that need a real reason (touching the simulator anyway / a Server Components migration plan).

Other items not yet acted on are individually small and labelled inline.

---

## TL;DR — top 5 wins (highest leverage)

| # | Win | Effort | Why it matters | Status |
|---|---|---|---|---|
| 1 | **Delete dead `PortfolioRepository` methods that reference non-existent columns** | trivial | Removes broken API that would crash on call; clarifies the real repository surface (#01). | **DONE** (combined w/ R2-01) |
| 2 | **Squash the 23 migrations into one canonical `schema.sql`** | small | Fresh installs become instant; removes ~500 LOC of historical baggage (#10). | DEFER |
| 3 | **Collapse three coexisting CSV pipelines into one** (`csv_processing/` only) | medium | Deletes ~2000 LOC, removes deprecated stubs polluting imports (#02, #03). | DEFER |
| 4 | **Replace `useState`-explosion in `use-simulator.ts` (20+ states) with `useReducer`** | medium | Halves re-renders on simulator edits; one source of truth for related state (#20). | DEFER |
| 5 | **Fix `apiFetch` blanket cache wipe on every non-GET** | trivial | Today one POST evicts all GETs; a targeted invalidation keeps dashboards warm (#19). | DEFER |

---

## 1. Backend — Critical / dead code

### #01 — `PortfolioRepository` has 5 broken methods (would crash on call) **[DONE]**
- **Location**: `app/repositories/portfolio_repository.py:22-200`
- **Impact**: simplicity, correctness — these are landmines.
- **Confidence**: **HIGH**. Verified the SELECT columns against `app/schema.sql`. The queries reference `c.isin`, `c.country`, `cs.purchase_price`, `cs.purchase_date` — none exist on `companies`/`company_shares`. `grep` confirms zero call sites for `get_all_holdings`, `get_holding_by_id`, `create_holding`, `update_holding`, `delete_holding`.
- **Recommendation**: delete all five methods. The actually-used surface is `get_portfolio_data_with_enrichment`, `company_exists`, `find_duplicate_company`, `create_company_manual`, `delete_manual_company`, `get_portfolios_list`. Removing dead code makes the repository's true API obvious.

### #02 — Three coexisting CSV import implementations **[DEFER]**
- **Location**: `app/utils/portfolio_processing.py` (1084 lines, deprecated stubs), `app/utils/csv_processing/` (the modular replacement), `app/utils/csv_import_simple.py` (896 lines, "legacy fallback")
- **Impact**: simplicity (~2000 LOC removable), debuggability.
- **Confidence**: **HIGH**. `portfolio_processing.py:1046` literally logs `"Using legacy CSV processing (csv_import_simple)"` — there's a runtime fork choosing between two implementations.
- **Recommendation**: pick `csv_processing/` (the one CLAUDE.md actually documents). Delete `csv_import_simple.py` and the deprecated section of `portfolio_processing.py`. Keep only the small helpers genuinely re-used.

### #03 — Deprecated `process_csv_data` / `update_csv_progress` still imported **[DEFER]**
- **Location**: `app/utils/portfolio_processing.py:64-86`, imported at `app/utils/portfolio_utils.py:6` and `app/routes/portfolio_api.py:12`
- **Impact**: simplicity — the function is a no-op stub that warns and a deprecated implementation that imports pandas etc.
- **Confidence**: **HIGH**.
- **Recommendation**: delete the two functions and their import paths. Confirm nothing in routes calls them (the `import` line in `portfolio_api.py` brings `process_csv_data` into namespace but I see no call — verify with one grep).

### #04 — Unprotected `/profile` endpoint registered inline in `create_app` **[DONE]**
- **Location**: `app/main.py:200-215`
- **Impact**: elegance, security (mild — homeserver), dead code likely.
- **Confidence**: **HIGH** — no `@require_auth`, no frontend reference. The functional `lookup` endpoint exists elsewhere.
- **Recommendation**: delete it, or move to the admin blueprint behind `@require_auth` if you want a debug tool.

### #05 — `app/__init__.py` re-exports everything from sub-modules **[DONE]**
- **Location**: `app/__init__.py:1-15`
- **Impact**: simplicity (cleaner imports), startup cost (negligible).
- **Confidence**: M — public API of the package, not auditable end-to-end.
- **Recommendation**: trim to `from app.main import create_app` only. Direct imports from the actual modules elsewhere are clearer.

### #06 — `run.py` carries two redundant `setup_environment*` paths including PostgreSQL menu
- **Location**: `run.py:19-138`
- **Impact**: simplicity.
- **Confidence**: **HIGH**. The interactive flow offers PostgreSQL, but the app only supports SQLite per CLAUDE.md.
- **Recommendation**: keep `setup_environment` (~30 lines), drop the interactive path and PostgreSQL prompt. Total file shrinks from 240 → ~80 lines.

---

## 2. Backend — Speed

### #07 — `Decimal` in the hot value-calculation path **[DONE]**
- **Location**: `app/utils/value_calculator.py:105-195` (`calculate_item_value`, `calculate_portfolio_total`)
- **Impact**: **speed** — every portfolio summary, sector aggregate, allocation calc. 3-10× slowdown vs float, called per-position.
- **Confidence**: M — speedup is well-known; magnitude depends on call frequency.
- **Recommendation**: use `float` for aggregates (display only, no banking-grade rounding needs). Keep `Decimal` only if you ever persist computed values back. The `Decimal(str(...))` wrapping is the most expensive part.

### #08 — Repeated `_get_exchange_rate` lookups via dict.get for every item
- **Location**: `app/utils/value_calculator.py:50-90` called from `calculate_item_value` on every row
- **Impact**: speed (minor) — cache is already module-level, but the function is called n times per portfolio aggregate.
- **Confidence**: M.
- **Recommendation**: pre-resolve rate once per `calculate_portfolio_total` call, pass rate-by-currency map down. Or skip — combined with #07 the gain is significant.

### #09 — Inline `_apply_company_update` is 250+ lines in a route file
- **Location**: `app/routes/portfolio_api.py:41-350` (approx)
- **Impact**: speed (N+1 if ever called in bulk), maintainability.
- **Confidence**: M.
- **Recommendation**: move to `app/services/company_service.py`, factor out `get_or_create_portfolio(account_id, name)` (it appears twice inside the function), and accept a list to enable single-transaction bulk updates.

### #10 — 23 idempotent migrations rebuild `companies` table 3 times on first boot
- **Location**: `app/db_manager.py:436-957`
- **Impact**: **speed** on fresh installs (which `start.py` first-run hits); also bloats `db_manager.py` by ~500 LOC.
- **Confidence**: **HIGH**. Migrations 12, 16, 23 each `CREATE TABLE companies_new; INSERT INTO companies_new SELECT … FROM companies; DROP TABLE companies; RENAME`. For fresh DBs all three run sequentially. Migrations 17 & 18 each loop every row for Title Case normalization.
- **Recommendation**: single-user homeserver — squash. The current `schema.sql` is already the post-23 shape. Replace the chain with one bootstrap step that stamps `schema_version=23` on a freshly-created DB and only runs incremental migrations for legacy users. Or commit to keeping migrations and remove the 3 rebuilds + 17/18 normalization loops since `schema.sql` reflects the final shape.

### #11 — Missing `PRAGMA mmap_size` and periodic `PRAGMA optimize` **[PARTIAL — mmap_size added; PRAGMA optimize still TODO]**
- **Location**: `app/db_manager.py:20-47` `_configure_connection`
- **Impact**: **speed** on reads. mmap_size enables memory-mapped reads on warm DB.
- **Confidence**: **HIGH** — SQLite-specific best practice.
- **Recommendation**: add `PRAGMA mmap_size = 268435456;` (256 MB) to `_configure_connection`. Add `PRAGMA optimize;` to a startup task once a day (or on close).

### #12 — Redundant index on `market_prices.identifier` **[DONE]**
- **Location**: `app/schema.sql:57, 132`
- **Impact**: speed (writes), space — minor.
- **Confidence**: **HIGH**. `identifier` is `PRIMARY KEY` (implicit unique index), then `idx_market_prices_identifier` is created on the same column.
- **Recommendation**: drop the explicit index.

### #13 — Single-column low-cardinality indexes
- **Location**: `app/schema.sql:147 (idx_companies_investment_type), :149 (idx_companies_source)`
- **Impact**: speed (writes, planner noise) — small.
- **Confidence**: M. Each column has 3 possible values; SQLite is unlikely to choose them. If real queries are `WHERE account_id=? AND source=?`, the composite would be useful, not the single column.
- **Recommendation**: drop both, replace with `(account_id, investment_type)` and `(account_id, source)` only if you confirm at least one query actually filters by those.

### #14 — `init_db` re-creates tables already in `schema.sql` **[DONE]**
- **Location**: `app/db_manager.py:181-224`
- **Impact**: speed (negligible), simplicity.
- **Confidence**: **HIGH**. `identifier_mappings` and `background_jobs` are in `schema.sql` and re-created with `CREATE TABLE IF NOT EXISTS` here. The `DROP TRIGGER IF EXISTS update_background_jobs_timestamp` runs on every boot even though the trigger has been removed from `schema.sql`.
- **Recommendation**: delete those lines; rely on `schema.sql` as the single source of truth.

### #15 — `WAL` set both at connection-init and again per thread-local conn **[DONE]**
- **Location**: `app/db_manager.py:35`, `app/utils/portfolio_processing.py:24`
- **Impact**: speed (negligible), elegance.
- **Confidence**: **HIGH**. `journal_mode` is database-wide; setting it per-connection re-issues the same `PRAGMA`.
- **Recommendation**: only set in `_configure_connection`. Remove from `portfolio_processing.py`.

### #16 — `cache.clear()` after writes in `app/__init__.py` is *not* explicit, but invalidations are scattered
- **Location**: `app/routes/portfolio_api.py:511` `cache.delete_memoized(PortfolioRepository.get_portfolio_data_with_enrichment, account_id)` and other spots.
- **Impact**: speed (over/under-invalidation), correctness.
- **Confidence**: M — requires tracing every mutating endpoint.
- **Recommendation**: centralize as `invalidate_portfolio_cache(account_id)` that wraps every memoized read of portfolio data; call it from every write path. CLAUDE.md already references this helper — check it's actually used everywhere.

---

## 3. Database — Other

### #17 — `verify_schema` runs `PRAGMA table_info` for every required table on every boot
- **Location**: `app/db_manager.py:261-299`
- **Impact**: speed (startup, ms-scale), elegance.
- **Confidence**: M.
- **Recommendation**: gate behind `if app.debug` or drop entirely once #10 makes migrations crisper.

### #18 — `migrate_database` early-returns when version current
- **Location**: `app/db_manager.py:455`
- **Impact**: ✅ already correct; no action.
- **Confidence**: H.

---

## 4. Frontend — Speed

### #19 — `apiFetch` clears the **entire** GET cache on any non-GET **[NOT DOING]**

The pure win here (preserve cache across writes) requires per-call invalidation hints on every mutating endpoint. Without migrating callsites the API change buys nothing. After implementing R2-26 (ETag/Cache-Control), the practical cost of the blanket clear is much smaller: the apiFetch JS cache evicts, the next request runs the cached server handler (fast), the browser revalidates against the ETag and gets a small 304. Revisit only if profiling shows write→read paths are still slow.

#### Original finding (kept for context)
- **Location**: `frontend/src/lib/api.ts:42-44`
- **Impact**: **speed** — every POST/PUT/DELETE blows away every cached page's data, causing a refetch storm on next navigation.
- **Confidence**: **HIGH**.
- **Recommendation**: pass an invalidation hint per write, e.g. `apiFetch("/positions/123", { method: "POST", invalidate: ["/portfolios", "/positions"] })`, then delete only matching URL prefixes from the cache map. Or adopt SWR / TanStack Query (one dependency, lots of code deleted in `use-*` hooks). The current 30-second cache is mostly cleared in practice.

### #20 — `use-simulator.ts` declares 20+ `useState` calls for related state
- **Location**: `frontend/src/hooks/use-simulator.ts:50-83`
- **Impact**: speed (each setter triggers a re-render — React batches inside one handler but cross-handler updates fragment), simplicity.
- **Confidence**: **HIGH**.
- **Recommendation**: collapse into one `useReducer<SimulatorState, SimulatorAction>`. Same for `use-enrich.ts` (703 lines) and `use-builder.ts` (677 lines). This is the single biggest elegance win on the frontend.

### #21 — `Object.freeze(data)` on every cached response
- **Location**: `frontend/src/lib/api.ts:62`
- **Impact**: speed (small), elegance.
- **Confidence**: M — it's shallow freeze, so it's cheap, but it makes the data unusable for any consumer that immutably extends it.
- **Recommendation**: remove the freeze; rely on TypeScript `readonly`.

### #22 — Default `next build` doesn't optimize package imports (lucide-react is huge) **[DONE]**
- **Location**: `frontend/next.config.ts`
- **Impact**: speed (bundle size, page TTFB).
- **Confidence**: M — needs bundle analysis to size.
- **Recommendation**: add `experimental: { optimizePackageImports: ["lucide-react"] }` to next config. Also consider code-splitting `apexcharts` / `jspdf` since they're only used in 1-2 pages.

### #23 — `getBaselineForItem` does linear `.find()` on sectors/theses/countries per simulator item
- **Location**: `frontend/src/lib/simulator-calc.ts:56-98`
- **Impact**: speed (n × m where n = items, m = portfolio categories).
- **Confidence**: M — only matters when item count grows.
- **Recommendation**: build lookup `Map<string, number>` once per render in the calling hook, pass it in.

### #24 — Calc files re-run on every render (no module-level memo)
- **Location**: `frontend/src/lib/*-calc.ts` invoked inside hooks without `useMemo`
- **Impact**: speed (depending on call site).
- **Confidence**: L — depends per hook.
- **Recommendation**: spot-check each hook for missing `useMemo` around the heaviest aggregation calls.

### #25 — All dashboard pages are client components; no Server Components for static shells
- **Location**: `frontend/src/app/(dashboard)/.../page.tsx` all start `"use client"`
- **Impact**: speed (initial paint, JS bundle).
- **Confidence**: M — Next 16 supports Server Components naturally; partial hydration is the point.
- **Recommendation**: keep the calc-heavy children as client components, but wrap them in server-component pages that send initial data via the App Router's server fetch + RSC payload. Less JS, faster first paint. Bigger lift but a real win.

---

## 5. Frontend — Simplicity

### #26 — Overlapping micro-libraries for portfolio value & cash
- **Location**: `frontend/src/lib/position-value.ts`, `cash-inclusion.ts`, `aggregation-utils.ts`, `portfolio-state.ts`
- **Impact**: simplicity, elegance.
- **Confidence**: M.
- **Recommendation**: consolidate the math under one `frontend/src/lib/portfolio-math.ts`. `portfolio-state.ts` is a tiny 2-method wrapper over `apiFetch("/state")` — fold into `api.ts` or a hook.

### #27 — Two persistence files for simulator/builder
- **Location**: `frontend/src/lib/simulator-persistence.ts`, `builder-persistence.ts`
- **Impact**: simplicity.
- **Confidence**: M.
- **Recommendation**: one generic `usePersistedState<T>(key, defaults)` hook. Removes both files.

### #28 — `generateItemId` uses deprecated `String.prototype.substr` **[DONE]**
- **Location**: `frontend/src/lib/simulator-calc.ts:18`
- **Impact**: elegance (nit), future-proofing.
- **Confidence**: **HIGH**.
- **Recommendation**: `Math.random().toString(36).substring(2, 11)` or use `crypto.randomUUID()`.

### #29 — `apiFetch` doesn't surface revalidation hooks for the UI
- **Location**: `frontend/src/lib/api.ts`
- **Impact**: simplicity, elegance.
- **Confidence**: L — depends on UX goal.
- **Recommendation**: adopt **TanStack Query** (~14 KB gzipped). You delete cache map, in-flight map, dedup logic; you gain background revalidation, optimistic updates, error retry. ~50–100 LOC net deletion across hooks.

---

## 6. Architecture / cross-cutting

### #30 — Route file count and naming are confusing
- **Location**: `app/routes/`: `portfolio_api.py` (2656), `portfolio_api_routes.py`, `portfolio_routes.py`, plus 6 more
- **Impact**: simplicity.
- **Confidence**: M.
- **Recommendation**: the natural split for a single-user app is by domain (portfolio, simulator, builder, enrich, account). The current `portfolio_api.py` god-object should be split into those, and the duplicative `_routes.py` files merged or deleted.

### #31 — `pytest` configured but no test suite (`tests/` exists but minimal)
- **Location**: `tests/`
- **Impact**: speed (confidence to refactor), elegance.
- **Confidence**: H — CLAUDE.md states "no tests/ directory exists yet"; one does, but it's mostly empty.
- **Recommendation**: write 5 high-value snapshot tests against `PortfolioRepository.get_portfolio_data_with_enrichment` and `calculate_portfolio_total`. Before tackling #02 / #07 / #20, this is what makes the refactors safe.

### #32 — Dev vs prod entry points: `run.py`, `start.py`, `dev.sh`, `deployment/deploy.sh`
- **Location**: project root + `deployment/`
- **Impact**: simplicity (cognitive load).
- **Confidence**: L — likely each has a real reason.
- **Recommendation**: keep `dev.sh` (it does the Node version dance) and `deployment/deploy.sh`. Fold `start.py` into `run.py` if their logic overlaps.

---

## Suggested execution order

1. **Safety net first** — write the 5 snapshot tests (#31). ~1 hour.
2. **Dead-code sweep** (#01, #03, #04, #14, #15, #28) — pure deletions, no behavior change. ~1 hour.
3. **CSV consolidation** (#02) — biggest LOC win. ~½ day.
4. **Migrations squash + PRAGMA tweaks** (#10, #11, #12, #13, #17). ~½ day.
5. **API cache invalidation** (#19) and Decimal → float (#07). ~1 hour.
6. **Hooks → useReducer** (#20). ~½ day per hook; pick one to validate the pattern.
7. **Server components + bundle tweaks** (#22, #25). Only after measuring.

---

## What I did *not* check

- Actual runtime profiling — all "speed" claims here are based on code patterns, not flame graphs. The biggest measurable wins (#10, #19, #20, #25) deserve a before/after timing.
- Frontend re-render counts (React DevTools profiler) — recommend after #20.
- Bundle size — recommend `@next/bundle-analyzer` once #22 is on the table.
- Security beyond noting the unprotected `/profile` endpoint.
