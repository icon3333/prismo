# Prismo — Code Review, Round 2 (2026-06-03)

**Lens**: speed and efficiency first, simplicity / elegance as enablers.
**Scope**: deeper read of files Round 1 missed — `allocation_service.py`, `batch_processing.py`, `db_utils.py`, the rest of `portfolio_repository.py`, `exchange_rate_repository.py`, `performance-calc.ts`, `auth.py`, `config.py`.
**Companion to**: `CODE_REVIEW_2026-06-03.md` (Round 1). Findings labelled **R2-NN** to keep ordering distinct. Items here do **not** repeat Round 1 (1–32); they extend it.

**Confidence**: H = code-verified, M = pattern verified but not all call sites traced, L = inference / needs measurement.

---

## Status — implementation pass (2026-06-03)

**Done from this report**: R2-01 (4 broken methods deleted), R2-02 (`db_utils.get_portfolios` deleted), R2-03 (3 unused config items deleted), R2-04 (preliminary check queries dropped), R2-05 (exchange-rate caches collapsed — `ExchangeRateRepository` no longer caches, `value_calculator._exchange_rates_cache` is the single reader-side cache, yfinance HTTP source still cached separately), R2-09 (foreground `update_price_in_db` unified to single `INSERT OR REPLACE`), R2-12 (per-CSV `backup_database` calls removed; 6h scheduled backup is the safety net), R2-13 (`ASYNC_THRESHOLD` 20→5, pool 5→10 workers, persistent module-level executor), R2-15 (`targets_by_name` dict in AllocationService), R2-21 (`last_price_update` now ONE bulk UPDATE per batch via new `bulk_update_accounts_last_price_update` helper, called from `_run_batch_sync` and `_run_batch_async`), R2-30 (auth WARN demoted to INFO).

**Deferred** (each marked **[DEFER]** below):
- R2-08, R2-14 — yfinance call placement / caching (auto_categorize already cached via `get_yfinance_info`; benefit smaller than originally estimated — re-evaluate).
- R2-22, R2-23, R2-24, R2-25 — frontend perf wins, measurement-gated.
- R2-28 — replace inline `get_or_create_portfolio` in `_apply_company_update` (transaction semantics risk).
- R2-29 — `AllocationService` static-methods → module functions (style only).

**Latest pass adds**: R2-10 (thread-local SQLite for BG helpers — `_bg_local`, `_get_thread_conn`, `_reset_thread_conn_on_error`, `close_thread_conn` in `db_utils.py`; batch workers in the persistent pool now keep one connection each, main batch thread closes its connection on completion) and R2-26 (`@app.after_request` hook in `main.py` adds `ETag` + `Cache-Control: private, max-age=30` to GET JSON responses and returns 304 via `Response.make_conditional`).

---

## TL;DR — top 6 efficiency wins from this round

| # | Win | Effort | Why it matters | Status |
|---|---|---|---|---|
| R2-01 | **4 more broken `PortfolioRepository` methods** (Round 1 found 5; the real count is 9) | trivial | ~50% of the repo's surface is dead/landmines. See list below. | **DONE** |
| R2-02 | **3 layers of caching for ~10 exchange rates** — collapse to one module-level dict | small | Lock contention per item; 3 places to invalidate; module just begs for one read-only dict. | **DONE** (R2-05) |
| R2-04 | **`load_portfolio_data` runs 3 preliminary check queries before the real query** | trivial | 4 round-trips → 1. Hot path on most pages. | **DONE** |
| R2-08 | **`update_price_in_db_background` makes a *new* yfinance HTTP call inside the DB-write path** (`auto_categorize_investment_type`) | small | Batch price update silently doubles its network work. Cache or move out of write path. | DEFER — re-checked: `auto_categorize_investment_type` calls `get_yfinance_info` which is already `@cache.memoize`-cached, so the network cost on repeats is zero. The Python-side dispatch overhead remains but is small. |
| R2-10 | **`_update_job_progress_background` opens+closes a new SQLite connection on every progress tick** | small | Throttled to every 2s during batch, but each tick is an open/PRAGMA/close cycle. | **DONE** |
| R2-15 | **`AllocationService` does linear `next(...)` lookups inside O(portfolios) loops** | trivial | Pre-build a name→target dict once; ~quadratic → linear on the rebalancer page. | **DONE** |

---

## 1. Backend — dead / broken code (Round 1 #01 extended)

### R2-01 — 4 additional `PortfolioRepository` methods reference non-existent columns **[DONE]**
- **Location**: `app/repositories/portfolio_repository.py`
- **Impact**: simplicity, correctness — every method here is a crash waiting to happen.
- **Confidence**: **HIGH**. Verified against `app/schema.sql`.

| Method | Lines | Broken column(s) |
|---|---|---|
| `get_all_holdings` (Round 1) | 22–60 | `c.isin`, `c.country`, `cs.purchase_price`, `cs.purchase_date` |
| `get_holding_by_id` (Round 1) | 62–90 | `c.country`, `cs.purchase_price` (via `c.*` + explicit) |
| `create_holding` (Round 1) | 114–148 | `INSERT … isin, country` |
| `update_holding` (Round 1) | 150–184 | allowed_fields includes `isin`, `country` |
| `delete_holding` (Round 1) | 186–200 | shallow — would work, but unused |
| **`get_holdings_by_portfolio` (NEW)** | 226–256 | `cs.purchase_price` |
| **`get_portfolio_allocation_data` (NEW)** | 366–422 | `c.isin`, `c.country`, `cs.purchase_price`, `cs.purchase_date` |
| **`get_detailed_portfolio_summary` (NEW)** | 424–514 | `c.country` |
| **`update_shares` (NEW)** | 315–364 | `purchase_price`, `purchase_date` in INSERT/UPDATE |

- **Recommendation**: delete all nine. The only methods on `PortfolioRepository` that are both used and correct: `get_portfolio_data_with_enrichment`, `company_exists`, `get_portfolios_list`, `get_or_create_portfolio`, `get_portfolio_summary`, `get_holdings_without_prices`, `get_all_identifiers`, `find_duplicate_company`, `create_company_manual`, `delete_manual_company`, `get_manual_company_ids`, `rename_portfolio`, `delete_portfolio`. Anything else is dead.

### R2-02 — `db_utils.get_portfolios` duplicates `PortfolioRepository.get_portfolios_list` **[DONE]**
- **Location**: `app/utils/db_utils.py:287-303` vs `app/repositories/portfolio_repository.py:517-539`
- **Impact**: simplicity.
- **Confidence**: **HIGH**.
- **Recommendation**: delete `db_utils.get_portfolios`; update any callers to use the repository.

### R2-03 — `config.py`: 3 settings declared but unused **[DONE]**
- **Location**: `config.py:54 BATCH_SIZE`, `:58 UPLOAD_FOLDER`, `:62 PER_PAGE`
- **Impact**: simplicity.
- **Confidence**: M — no callers found; verify with `grep`.
- **Recommendation**: delete. `MAX_CONTENT_LENGTH` covers upload sizing; CSV upload uses in-memory `request.files[...].read()` so `UPLOAD_FOLDER` does nothing.

---

## 2. Backend — caching / speed wins

### R2-04 — `load_portfolio_data` does 3 preliminary queries before the real query **[DONE]**
- **Location**: `app/utils/db_utils.py:306-419`
- **Impact**: **speed** — every page that calls `load_portfolio_data` pays 4 round-trips instead of 1.
- **Confidence**: **HIGH**. Lines 326-361: SELECT id FROM accounts, SELECT id FROM portfolios, SELECT COUNT(*) FROM companies — all to log warnings.
- **Recommendation**: drop the three checks. The main query handles missing data by returning `[]`. Net change: -50 lines, -3 queries per call.

### R2-05 — Three layers of caching for ~10 exchange rates **[DONE]**
- **Location**:
  - `@cache.memoize(timeout=3600)` in `app/utils/yfinance_utils.py:32` (`get_exchange_rate`)
  - `_rates_cache: Dict[str, float]` with `_cache_lock` in `app/repositories/exchange_rate_repository.py:21-23`
  - `_exchange_rates_cache: Optional[Dict[str, float]]` in `app/utils/value_calculator.py:28`
- **Impact**: simplicity, speed (lock contention — see R2-06).
- **Confidence**: **HIGH**.
- **Recommendation**: one module-level dict in `value_calculator`, populated by `refresh_exchange_rates_if_needed` at startup. The DB still stores rates; the cache is read-mostly with one writer (startup task). Delete the Flask-Cache decorator and the locked dict.

### R2-06 — Thread lock acquired per row in the value-calc inner loop **[DONE via R2-05]**
- **Location**: `app/repositories/exchange_rate_repository.py:_get_cached_rate:309-325` invoked transitively from `value_calculator.calculate_item_value` for every portfolio item
- **Impact**: speed — measurable lock overhead per row, useless on a single-user homeserver.
- **Confidence**: M.
- **Recommendation**: rolled into R2-05. A read-only dict has no locking concerns.

### R2-07 — `db_utils.process_portfolio_dataframe` uses `df.apply(lambda)` for arithmetic
- **Location**: `app/utils/db_utils.py:422-468`
- **Impact**: speed — `df.apply` with a Python lambda is the slowest pandas idiom. ~50–100× slower than vectorized.
- **Confidence**: **HIGH**.
- **Recommendation**:
  ```python
  df['value_eur'] = (df['quantity'].fillna(0) * df['price_eur'].fillna(0))
  df['value']     = (df['quantity'].fillna(0) * df['price'].fillna(0))
  ```
  Or, given the small data size, drop pandas entirely here.

### R2-08 — `update_price_in_db_background` triggers a *second* yfinance fetch inside the DB-write path
- **Location**: `app/utils/db_utils.py:163-178` — calls `auto_categorize_investment_type(identifier)`
- **Impact**: **speed** — batch update of 100 prices = 100 extra HTTP calls (one categorization per identifier), serialized inside the per-identifier code path.
- **Confidence**: **HIGH**.
- **Recommendation**:
  1. Categorize once at first sight (`WHERE investment_type IS NULL`) — the existing `WHERE investment_type IS NULL` clause already does this guard, but the *network call* still happens. Move the network call before the SQL guard, *or* check the guard first:
     ```python
     needs_cat = cursor.execute(
         "SELECT 1 FROM companies WHERE identifier = ? AND investment_type IS NULL LIMIT 1",
         [identifier]
     ).fetchone()
     if needs_cat:
         investment_type = auto_categorize_investment_type(identifier)
         ...
     ```
  2. Or move categorization out of the update path entirely into a separate sweep that runs once after all prices are fetched.

### R2-09 — Foreground `update_price_in_db` is slower than the background variant **[DONE]**
- **Location**: `app/utils/db_utils.py:198-284` (FG) vs `:93-195` (BG)
- **Impact**: speed, elegance.
- **Confidence**: **HIGH**. FG does SELECT-then-UPDATE/INSERT (2 statements); BG does `INSERT OR REPLACE` (1 statement).
- **Recommendation**: delete the FG variant; have all callers use the BG-style upsert. With a request-scoped connection, `INSERT OR REPLACE` is just as safe.

### R2-10 — Background DB ops open + close a SQLite connection on every call **[DONE]**
- **Location**: `app/utils/db_utils.py:10-90` (`query_background_db`, `execute_background_db`)
- **Impact**: **speed** — every progress tick during a batch (and every helper called from a worker thread) pays connection open + `_configure_connection` PRAGMA executescript + close.
- **Confidence**: **HIGH**. `get_background_db` returns a new `sqlite3.connect(...)`, and the wrappers `try/finally db.close()`.
- **Recommendation**: thread-local connection (you already have `_thread_local_db` in `portfolio_processing.py:17` for this exact reason). Reuse it across helpers, close once at worker shutdown.

### R2-11 — Startup rate-freshness check fires 3 DB queries
- **Location**: `app/utils/startup_tasks.py:29-66`
- **Impact**: speed (boot, marginal — but it's measurable).
- **Confidence**: **HIGH**. `is_refresh_needed` (1 query), then `get_last_update_time` (1 query) only on fresh path, then `preload_cache` (1 query) which selects all rates.
- **Recommendation**: `is_refresh_needed` already does the count+stale check in one query. Skip the separate `get_last_update_time` log call. Combine `preload_cache` data into the same `is_refresh_needed` query (or just call `get_all_rates` once and infer staleness from the rows you got).

### R2-12 — `backup_database()` is called *every* CSV import **[DONE]**
- **Location**: `app/utils/portfolio_processing.py:99-100` (and the equivalent in the modular `csv_processing/`)
- **Impact**: **speed** — `backup_database` is `shutil.copy(db_path, backup_filename)`. On a portfolio DB of 50–500 MB, that's a multi-second blocking copy *before* import begins.
- **Confidence**: **HIGH**.
- **Recommendation**: rotate-into-place backups belong in the 6-hour scheduler, not the import path. The user already has a 10-backup retention. If you really want a pre-import snapshot, use SQLite's online backup API (`db.backup(other)`) which is faster and concurrent-safe.

### R2-13 — `ASYNC_THRESHOLD = 20`, 5 workers, single-shot ThreadPoolExecutor **[DONE]**
- **Location**: `app/utils/batch_processing.py:22, 387`
- **Impact**: speed.
- **Confidence**: M.
- **Recommendation**:
  - For 19-position portfolios (just under threshold), serial mode means up to ~30 s of wall time. Drop the threshold to `5` or just always use the pool.
  - yfinance is HTTP-bound — `max_workers=10` or `12` is reasonable and won't hit Yahoo's anti-abuse heuristics for a single-user homeserver.
  - Cache the pool at module level so price-refresh sweeps don't pay pool startup each time.

### R2-14 — `auto_categorize_investment_type` is uncached
- **Location**: `app/utils/yfinance_utils.py` (function name; see R2-08 caller)
- **Impact**: speed (compounds with R2-08).
- **Confidence**: M — needs `grep` of the function body, but the call site at db_utils.py:166 has no obvious cache.
- **Recommendation**: cache by identifier in the same way `get_isin_data` is cached (`@cache.memoize(timeout=…)`), or persist directly into `companies.investment_type` once and skip re-categorization.

---

## 3. Backend — algorithm hot paths

### R2-15 — `AllocationService` uses `next(p for p in target_allocations if p['name']==name)` inside a per-portfolio loop **[DONE]**
- **Location**: `app/services/allocation_service.py:629` (and similar in `calculate_allocation_targets_with_type_constraints`)
- **Impact**: speed — O(portfolios²) on the rebalancer page.
- **Confidence**: **HIGH**.
- **Recommendation**: one line at the top of `calculate_allocation_targets`:
  ```python
  targets_by_name = {p['name']: p for p in target_allocations if p.get('name')}
  ```
  Then `target_portfolio = targets_by_name.get(portfolio_name)`.

### R2-16 — `get_portfolio_positions` iterates `portfolio_data` three times
- **Location**: `app/services/allocation_service.py:436-596`
- **Impact**: speed — modest (3 passes over ~200 items), elegance.
- **Confidence**: **HIGH**. Pass 1 builds `company_investment_types`; pass 2 builds `position_target_weights` from target_allocations; pass 3 builds `portfolio_map`.
- **Recommendation**: combine into one pass. `company_investment_types` can come from a dict comprehension; `position_target_weights` doesn't need the data pass at all.

### R2-17 — `_apply_type_constraints_recursive` does up to 100 recursive scans
- **Location**: `app/services/allocation_service.py:18-179`
- **Impact**: speed — typical convergence in <5 iterations; pathological in 100. Each iteration is O(positions). Each call also rebuilds `capped_positions` and `uncapped_positions` lists.
- **Confidence**: M — no bug, but allocate-once-and-mutate is cheaper.
- **Recommendation**: convert recursion to a `while` loop; reuse the position list, just mutate `is_capped` flags.

### R2-18 — `Decimal(target_pct / 100)` is a Python float divided then converted
- **Location**: `app/services/allocation_service.py:273, 325, …`
- **Impact**: speed (and arithmetic correctness — `Decimal(0.1)` is `Decimal('0.1000000000…0005551…')`).
- **Confidence**: **HIGH**.
- **Recommendation**: rebalancing is display math; use `float` everywhere in this service. If you keep `Decimal`, use `Decimal(target_pct) / Decimal(100)`, never `Decimal(float / int)`.

---

## 4. Database — additional

### R2-19 — `companies` has no `ON DELETE CASCADE` for `account_id` / `portfolio_id`
- **Location**: `app/schema.sql:41-42`
- **Impact**: correctness (orphan rows on account delete); not a perf issue per se.
- **Confidence**: **HIGH**.
- **Recommendation**: for a single-user app, this is probably intentional safety. If account-delete is exposed in the UI, add explicit cleanup or `ON DELETE CASCADE`.

### R2-20 — String comparisons on `name` / `identifier` are case-sensitive by default
- **Location**: `app/schema.sql:19-44`, queries throughout
- **Impact**: correctness (search misses), minor speed (`LOWER(c.name) = LOWER(?)` patterns can't use indexes).
- **Confidence**: M.
- **Recommendation**: add `COLLATE NOCASE` to `companies.name` and `companies.identifier`, plus matching indexes. `find_duplicate_company` (line 803) currently does `LOWER(c.name) = LOWER(?)` which forfeits the index.

### R2-21 — `accounts.last_price_update` updated per identifier **[DONE]**
- **Location**: `app/utils/db_utils.py:148-156` and `:267-275`
- **Impact**: speed — during a batch update of 100 identifiers, this UPDATE fires 100 times. Each fires with a subquery `SELECT DISTINCT account_id FROM companies WHERE identifier = ?`. Index on `companies.identifier` helps, but it's still 100 UPDATEs that write to the same row.
- **Confidence**: **HIGH**.
- **Recommendation**: update `accounts.last_price_update` once at the *end* of the batch job, not per identifier.

---

## 5. Frontend — additional speed

### R2-22 — `performance-calc.calculateExposureData` does 5+ passes
- **Location**: `frontend/src/lib/performance-calc.ts:328-475`
- **Impact**: speed — render-time cost grows with portfolio size; heatmap re-runs on filter changes.
- **Confidence**: **HIGH**. Sequence: build `allCompanies` via spread (line 343), `reduce` for total, main aggregation loop, percentage-conversion double-loop, two more loops for sortedCountries/sortedDimensions, finally a `z` matrix build.
- **Recommendation**: combine the first three loops into one (total + aggregation + per-company details). Skip the spread allocation by reading fields directly. Memoize at the call site with `useMemo`.

### R2-23 — Detail-mode chart series push raw daily points without downsampling
- **Location**: `frontend/src/lib/performance-calc.ts:185-187`
- **Impact**: speed — 5-year daily, 10 positions = ~12,500 points. ApexCharts renders all of them. Slows interactions.
- **Confidence**: L — depends on what ranges users actually pick.
- **Recommendation**: when the series exceeds N (say 2 000) points, downsample with LTTB or pick-by-stride. ApexCharts supports `chart.dataPointSelection` lazy modes too.

### R2-24 — Spread allocation per row in calc files
- **Location**: `performance-calc.ts:343-348` (`.map((c) => ({ ...c, …computed }))`)
- **Impact**: speed (GC pressure on large portfolios).
- **Confidence**: M.
- **Recommendation**: when only a few fields are read after, just read them directly inside the aggregation loop — skip the intermediate allocation.

### R2-25 — `portfolio-state.ts` round-trips through the API for a single-user UI selection
- **Location**: `frontend/src/lib/portfolio-state.ts:1-33`
- **Impact**: speed — every page change to a different portfolio loads a remote round-trip.
- **Confidence**: M — the persistence is server-side via `expanded_state`, which is correct for cross-device. But for a homeserver, localStorage is faster and survives the same way.
- **Recommendation**: localStorage with an async background sync to the server (fire-and-forget POST).

### R2-26 — Flask responses don't set `Cache-Control` / `ETag` **[DONE]**
- **Location**: all routes return raw `jsonify(...)`; no `make_conditional`/`add_etag` middleware
- **Impact**: speed — browser refetches identical JSON on every navigation, defeating the `apiFetch` cache after page refresh.
- **Confidence**: **HIGH**.
- **Recommendation**: for read endpoints, add a small `@etag_json` decorator that:
  - hashes the JSON body
  - returns 304 if `If-None-Match` matches
  - sets `Cache-Control: private, max-age=30`
  Pairs naturally with the existing `@cache.memoize` decorators.

### R2-27 — Dashboard `<Masthead />` and `<AccountPicker />` mount in the root layout
- **Location**: `frontend/src/app/(dashboard)/layout.tsx`
- **Impact**: speed — they re-fetch every route nav unless internally memoized.
- **Confidence**: L — need to read those components to confirm.
- **Recommendation**: check that both use `apiFetch` with the cache (so the second nav is free) and use `React.memo` if they take stable props.

---

## 6. Architecture / process

### R2-28 — `_apply_company_update` in `portfolio_api.py` re-implements `get_or_create_portfolio`
- **Location**: `app/routes/portfolio_api.py:70-99` vs `app/repositories/portfolio_repository.py:542-604`
- **Impact**: simplicity, correctness (the repo version normalizes via `normalize_portfolio`; the inline version doesn't).
- **Confidence**: **HIGH**.
- **Recommendation**: replace the inline blocks with `PortfolioRepository.get_or_create_portfolio(account_id, portfolio_name)`.

### R2-29 — `AllocationService` is mostly `@staticmethod` — not really a service
- **Location**: `app/services/allocation_service.py:203`
- **Impact**: elegance.
- **Confidence**: **HIGH**.
- **Recommendation**: convert the static methods to module-level functions. Keep the small instance method `calculate_rebalancing` that uses `self.rules` if needed, or drop the class entirely and pass `AllocationRule` explicitly.

### R2-30 — `auth.py` logs every anon access as WARN **[DONE]**
- **Location**: `app/decorators/auth.py:33-35`
- **Impact**: speed (log volume from health checks, scrapers), simplicity.
- **Confidence**: **HIGH**.
- **Recommendation**: demote to `info` or skip logging for OPTIONS / HEAD / `/health` / `/api/accounts`.

---

## 7. Cross-cutting — what to do *first* this round

Building on the Round 1 ordering:

1. **R2-01** (delete the 4 newly identified broken methods) — costs nothing, removes landmines.
2. **R2-04** (drop the 3 prelim checks in `load_portfolio_data`) — instant 4× speedup on its callers.
3. **R2-09 + R2-10** (collapse FG/BG `update_price_in_db`, give the background path a thread-local connection) — single biggest backend write-path win.
4. **R2-15** (the linear `next(...)` lookups in `AllocationService`) — one-line dict, kills the only quadratic in the rebalancer.
5. **R2-08 + R2-14 + R2-21** (the three "hidden" yfinance/SQL costs in price-update batches) — together, a multi-second reduction on the price refresh path.
6. **R2-05** (collapse the three exchange-rate caches) — clarity win; eliminates a class of "why is X stale" bugs.
7. **R2-26** (`Cache-Control` / `ETag` on read endpoints) — biggest frontend perceived-perf win without touching frontend code.

After those: tackle Round 1's #02 (CSV consolidation) and #20 (`useReducer` for `use-simulator.ts`). Those remain the biggest single LOC and re-render wins.

---

## 8. Where this report could be wrong

- I did not run the code. The "broken" methods (R2-01) could be reachable through some dynamic path I missed; a 30-second `grep` per method confirms safety before deleting.
- The yfinance call counts in R2-08 / R2-14 assume `auto_categorize_investment_type` is uncached. If it has its own `@cache.memoize`, the impact is smaller — verify by reading that function.
- The connection-per-call cost (R2-10) only matters during high-frequency background loops. For one-shot helpers it's negligible.
- HTTP `ETag` (R2-26) only helps if the JSON is byte-stable — your responses include timestamps (`last_updated`), which change. Hash the *data* portion, not the wall-clock timestamp.

---

## 9. What I still didn't read

- `app/routes/portfolio_simulator_api.py` (840 lines) — likely has more N+1 patterns analogous to the route file already covered.
- The remainder of `portfolio_api.py` past line ~300 — caching/invalidation patterns may have surprises.
- `frontend/src/hooks/use-enrich.ts`, `use-builder.ts` — likely the same `useState`-fan-out shape as `use-simulator.ts` (Round 1 #20).
- `frontend/src/components/ptsim/Masthead.tsx`, `account-picker.tsx` — to confirm R2-27.

Pick these up before the next pass if any of the above estimates needs nailing down.
