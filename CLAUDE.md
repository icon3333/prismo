# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Prismo** — a portfolio management app for Parqet and IBKR users. Flask JSON backend + Next.js frontend. Designed for **single-user homeserver deployment**.

**Philosophy**: 80/20 rule — simple, modular, elegant, efficient, robust.

## Commands

```bash
# Dev (both backend + frontend together — preferred)
./dev.sh                                       # Flask on :8065, Next.js on :3000

# Backend only
python3 run.py --port 8065                     # Auto-creates .env + DB on first run
FLASK_ENV=development python3 run.py --port 8065

# Frontend only
cd frontend && npm run dev                     # Next.js on :3000, proxies /api → :8065

# Testing
./test.sh                                      # Full suite: pytest + tsc + vitest
venv/bin/python -m pip install --upgrade "pip>=26.1.2"
venv/bin/python -m pip install -r requirements-dev.txt
venv/bin/python -m pytest tests/ -q            # Backend only (in-memory SQLite)
cd frontend && npm run typecheck               # tsc --noEmit — catches renames vitest can't
cd frontend && npm test                        # Frontend only — vitest on src/lib/*-calc pure modules
cd frontend && npm run lint                    # ESLint for Next.js

# Scripts (see AGENTS.md)
python3 scripts/smoke.py                       # boot against a COPY of the real DB, and a fresh one
python3 scripts/deadcode.py                    # unused symbols/files/deps + routes the frontend never calls
```

Run `scripts/smoke.py` after touching `db_manager.py`, `main.py`, or `schema.sql`. The unit tests only ever build a database from `schema.sql`, so they exercise the fresh-install path alone — `smoke.py` is what proves the app still starts on an *existing* database.

**`instance/portfolio.db` is live financial data and is gitignored.** Never point migrations or experiments at it; copy it to a temp dir first, as `smoke.py` does.

**Renaming or removing a symbol**: `rg` for call sites, then `./test.sh`. `tsc --noEmit` reads the whole type graph, so it catches frontend breakage vitest misses — vitest transpiles without type-checking, so a changed interface passes every test and fails the build. On the Python side, imports are often function-local (`from app.utils.batch_processing import …` inside a function body), so grep for the bare symbol name, not just the import line — and note that patching such a symbol on the *importing* module in a test is a silent no-op.

`dev.sh` is a thin wrapper that execs `start.py` (the real dev launcher: bootstraps venv + deps, then runs Flask + Next.js). `start.py` auto-prefers Homebrew's `node@22` because Next 16 / Turbopack panics on Node 25. If you see Turbopack crashes, install `node@22` or point `NODE_BIN` in `start.py`.

## Architecture

**Backend** (Flask): pure JSON API — no server-rendered HTML anymore. Three-layer separation:

```
Routes (app/routes/)        → HTTP handling, @require_auth, delegate to services
    ↓
Services (app/services/)    → Pure Python business logic, no Flask deps
    ↓
Repositories (app/repositories/) → Data access, parameterized SQL, account_id validation
    ↓
SQLite (app/schema.sql + migrations in app/db_manager.py)
```

**Frontend** (Next.js 16, React 19, shadcn/ui, Tailwind): lives entirely in `frontend/`. Calls the Flask JSON API. App Router structure under `frontend/src/app/(dashboard)/` — one folder per page (performance, plan, simulator, enrich, concentrations, account). The former Builder and Rebalancer pages are merged into `/plan` (targets on top, server-computed rebalance plan below); `/builder` and `/rebalancer` 301 to it. Client-side calc in `frontend/src/lib/*-calc.ts` is display shaping — the capital-mode rebalancing engine lives server-side in `app/services/rebalance_service.py` (exposed via `/simulator/portfolio-data?mode=&amount=`, parity-tested in `tests/test_rebalance_service.py`).

The old Jinja `templates/` and `static/` directories were deleted in commit `4889844`. Don't look for them.

### Services
Modules of plain functions, not classes. Import the module (`from app.services import allocation_service`) — the package `__init__` re-exports nothing.

- `allocation_service`: allocation targets, Stock/ETF/Crypto type constraints, recursive cap redistribution. Golden-fixture regression suite in `tests/test_allocation_parity.py`.
- `rebalance_service`: the three capital modes (existing-only, new-only, new-with-sells)
- `builder_service`: investment targets, budget planning, progress tracking
- `company_service`: manual stock addition, identifier validation (yfinance), deletion
- `monthly_review_service`: monthly review persistence and workflow; `monthly_review_snapshot`: pure snapshot identity, comparison, reconciliation, and recommendations (selected functions re-exported from the service for existing callers)

### Repositories
- `PortfolioRepository`: Portfolio and company data queries
- `PriceRepository`: Market price operations
- `AccountRepository`: Account management, cash balance tracking
- `SimulationRepository`: Allocation simulator CRUD with name uniqueness
- `ExchangeRateRepository`: Daily exchange rates for currency conversion
- `MonthlyReviewRepository`: Monthly review persistence (draft → completed, versioned)

### Key Utils
- `app/utils/csv_processing/`: Modular CSV import (parser → company_processor → share_calculator → portfolio_handler)
- `app/utils/value_calculator.py`: Central value calculation — priority: custom value → native currency × exchange rate → legacy price_eur
- `app/utils/yfinance_utils.py`: Market data with 15-min cache
- `app/utils/batch_processing.py`: Sync (<5 items) / async (≥5 items) execution via a persistent thread pool
- `app/utils/startup_tasks.py`: **one** daemon thread per process (started from `create_app` once the main process is identified). Boot pass — clear interrupted CSV jobs, then `run_refresh_cycle` — followed by a single maintenance loop that ticks hourly and, on each tick, runs `run_refresh_cycle` (the FX/price refreshers gate on their own 24h intervals) and `run_backup` when `BACKUP_INTERVAL_HOURS` has elapsed. The tick shrinks to match a sub-hourly backup interval; elapsed time uses `time.monotonic()` so DST/NTP shifts can't skip or double-fire a backup. No backup at boot. Cadence pinned by `TestMaintenanceLoop` in `tests/test_freshness.py`.

## Routes

All routes live under blueprints registered in `app/main.py`:
- `main_bp` (`/`): account selection/switching API (`/api/accounts`, `/api/select_account/<id>`)
- `account_bp` (`/account`): account management
- `portfolio_bp` (`/portfolio`): portfolio + simulator + builder + enrich + monthly-review API under `/portfolio/api/*`

Flask serves JSON only. Page URLs belong to Next.js — old-URL redirects live in `frontend/next.config.ts` (`/builder`, `/rebalancer` → `/plan`), not in Flask, which never sees a page request.

Portfolio API implementations are split by domain and wired centrally in the grouped route tables of `portfolio_api_routes.py` (plain view functions + one `add_url_rule` registration loop). `tests/test_portfolio_route_contract.py` pins the complete route map. Implementations include `portfolio_data_api.py` (cached reads + `invalidate_portfolio_cache`), `portfolio_company_api.py` (company/portfolio writes), `portfolio_state_api.py` (UI state), `portfolio_simulator_api.py` (lookup and allocations), `simulator_crud.py` (saved simulation lifecycle and cloning), plus `portfolio_account_api.py`, `portfolio_builder_api.py`, `portfolio_manual_api.py`, `simple_upload.py` (CSV import), and `portfolio_updates.py` (price fetches). Most expensive reads are wrapped in `@cache.memoize(timeout=…)`; a `portfolio_bp.after_request` hook invalidates the account's memoized reads on every successful write, so write endpoints don't call `invalidate_portfolio_cache()` themselves — except mid-request before re-reading, and in background jobs that outlive the request.

## Frontend → Backend

Next.js dev server on `:3000` proxies API calls to Flask on `:8065` (see `frontend/next.config.ts`). Client code calls into `frontend/src/lib/api.ts`; pure calc logic stays in `frontend/src/lib/*-calc.ts` so it's unit-testable without the network.

Design tokens and components live in `frontend/src/components/ui/` (shadcn) and `frontend/src/app/theme/`. No CSS variables in the Flask side anymore — the Next.js app uses Tailwind classes and shadcn defaults.

## Database

**SQLite**. `init_db()` in `app/db_manager.py` runs three steps at every boot, **in this order**:

1. Bootstrap `schema_version`. A brand-new file is stamped straight at `LATEST_SCHEMA_VERSION` — it is built from the current `app/schema.sql` and needs no migration replay. An existing pre-versioning database starts at 0.
2. `migrate_database()` — the numbered migration chain. Only ever runs for a database that predates the current schema; a fresh one skips it entirely. It starts at migration 24: 1–23 were deleted as unreachable (this is a single-user app, and the live database and every backup were already at 23). A database below `MIN_MIGRATABLE_VERSION` is refused with a message naming commit `4226f05`, which still carries the full chain — boot once against that commit to upgrade, then come back.
3. `app/schema.sql` — every statement is `CREATE ... IF NOT EXISTS`, so this creates whatever is still missing and is a no-op once current.

**Migrations must run before `schema.sql`.** `schema.sql` can only CREATE, never add a column to an existing table, so applying it first makes a new index reference a column an older database does not have yet — which is exactly how migration 24's `background_jobs.account_id` index broke startup on a v23 database. `tests/test_db_migrations.py` boots `init_db()` on a synthetic v23 database to pin this.

When adding a migration: add it to `migrate_database()`, mirror the end state in `schema.sql`, and bump `LATEST_SCHEMA_VERSION`. Then run `python3 scripts/smoke.py` — the unit tests only prove the fresh path.

Key tables and notable columns:
- `companies`: Holdings with `investment_type` (Stock/ETF/Crypto), `source` (parqet/ibkr/manual), `thesis`, `sector`, nullable `identifier` and `portfolio_id`, custom value support, identifier protection columns, `first_bought_date`
- `company_shares`: Share quantities with manual override and edit tracking
- `market_prices`: Native currency `price` + `price_eur` (legacy)
- `exchange_rates`: Daily rates, refreshed on startup if >24h old
- `simulations`: Allocation scenarios with `type` (overlay/portfolio), `scope` (global/portfolio), JSON `items`. The live DB still carries five `deploy_*` columns from a DCA feature that was never built; nothing reads or writes them any more.
- `monthly_reviews`: One versioned JSON `payload` per review, `draft` → `completed`, chained via `previous_review_id`
- `expanded_state`: UI state persistence (page_name values: `performance`, `builder` (Plan targets), `plan` (capital mode/amount), `enrich`, `risk_overview`, `simulator`)
- `accounts`: Has `cash` column for cash balance tracking

UNIQUE constraint on `(account_id, name)` in `companies` — prevents duplicate positions.

## CSV Import

Two formats, auto-detected by `detect_csv_format()` in `parser.py`:
- **Parqet** (semicolon-delimited): Transaction-based with buy/sell calculations
- **IBKR Flex Query** (comma-delimited): Snapshot mode, uses `process_companies_snapshot()`

Broker-scoped deletion: each import only removes positions from its own `source` type. Manual positions (`source='manual'`) are never deleted by imports. Protected identifier edits are preserved across reimports.

## Authentication

All routes use `@require_auth` decorator (`app/decorators/auth.py`):
- Sets `g.account_id` (always) and `g.account`
- No password system — session-based account selection

## Error Handling

Structured exceptions in `app/exceptions.py`: `ValidationError`, `NotFoundError`, `DatabaseError`, `DataIntegrityError`, `CSVProcessingError`, `PriceFetchError`, `ExternalAPIError`, `AuthenticationError`. Only classes something actually raises live there — don't add speculative ones.

Global JSON error handlers in `app/errors.py` (registered in `create_app`) map typed exceptions to status codes (400/401/404/409/502) and return JSON for everything, including 404/405 and unexpected 500s. Routes should raise typed exceptions and let them propagate instead of wrapping handlers in try/except boilerplate.

## Position Valuation

The backend is the single source of truth: every holdings item from `/portfolio_data` carries `current_value` and `value_source` (`custom`/`market`/`none`), computed in `app/utils/value_calculator.py`. `POST /update_portfolio/<id>` returns the recomputed item as `data.item` (null if the position dropped out of holdings). The frontend (`frontend/src/lib/position-value.ts`) reads these fields; it only derives values locally for rows without a server value (e.g. simulator sandbox items).

## Simulator Modes

Two modes toggled in the header:
- **Overlay**: Baseline portfolio overlay with delta indicators, investment progress
- **Portfolio** (Sandbox): Standalone simulated portfolio, no baseline
- Mode persisted in `localStorage` via `simulator_state.mode`
- Clone feature creates portfolio-type simulation from real portfolio
- Sandbox supports EUR/% global value mode with `total_amount` as denominator

## Configuration

Environment variables via `.env` (auto-generated on first run). See `config.py`. Key settings: `FLASK_ENV`, `APP_DATA_DIR` (default: `instance/`), `PRICE_UPDATE_INTERVAL_HOURS` (24), `BACKUP_INTERVAL_HOURS` (6), `SECRET_KEY` (auto-generated).

## Caching

Two caching layers:
- **Flask-Caching (SimpleCache, in-memory)** — 15-min for stock prices, 1-hour for exchange rates (`app/cache.py`)
- **`@cache.memoize`** on hot portfolio-data endpoints (30–60s) — invalidated automatically by the `portfolio_bp.after_request` hook on every successful write (see Routes section)
