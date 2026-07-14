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
./test.sh                                      # Full suite: backend pytest + frontend vitest
python3 -m pytest tests/ -q                    # Backend only — value calc, allocation, CSV import (in-memory SQLite, no network)
cd frontend && npm test                        # Frontend only — vitest on src/lib/*-calc pure modules
cd frontend && npm run lint                    # ESLint for Next.js

# Production
./deployment/deploy.sh                         # Git pull + Docker rebuild + restart
cd deployment && docker-compose up -d          # Manual Docker
```

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
- `AllocationService`: Portfolio allocation calculations, rebalancing logic, type constraints (Stock/ETF/Crypto)
- `BuilderService`: Investment targets, budget planning, progress tracking
- `CompanyService`: Manual stock addition, identifier validation (yfinance), deletion

### Repositories
- `PortfolioRepository`: Portfolio and company data queries
- `PriceRepository`: Market price operations
- `AccountRepository`: Account management, cash balance tracking
- `SimulationRepository`: Allocation simulator CRUD with name uniqueness
- `ExchangeRateRepository`: Daily exchange rates for currency conversion

### Key Utils
- `app/utils/csv_processing/`: Modular CSV import (parser → company_processor → share_calculator → portfolio_handler)
- `app/utils/value_calculator.py`: Central value calculation — priority: custom value → native currency × exchange rate → legacy price_eur
- `app/utils/yfinance_utils.py`: Market data with 15-min cache
- `app/utils/batch_processing.py`: Sync (<5 items) / async (≥5 items) execution via a persistent thread pool
- `app/utils/startup_tasks.py`: Refreshes exchange rates + auto-updates prices (at boot, then re-checked hourly via `run_refresh_cycle` — the refreshers gate on their own 24h intervals), schedules backups — runs in a background thread started once per process: in dev via `create_app`, in production via the gunicorn `when_ready` hook (master process; `PRISMO_DEFER_STARTUP_TASKS=1` keeps workers from double-starting them)

## Routes

All routes live under blueprints registered in `app/main.py`:
- `main_bp` (`/`): account selection/switching API (`/api/accounts`, `/api/select_account/<id>`)
- `account_bp` (`/account`): account management
- `portfolio_bp` (`/portfolio`): portfolio + simulator + builder + enrich API under `/portfolio/api/*`, plus 301 redirects for old URLs (`/analyse` → `/performance`, `/allocate` → `/plan`, `/build` → `/plan`, `/risk_overview` → `/concentrations`)
- `admin_bp`: admin endpoints

Portfolio API implementations are split by domain and wired centrally in `portfolio_api_routes.py` (plain view functions + `add_url_rule`): `portfolio_data_api.py` (cached reads + `invalidate_portfolio_cache`), `portfolio_company_api.py` (company/portfolio writes), `portfolio_state_api.py` (UI state), plus `portfolio_account_api.py`, `portfolio_simulator_api.py`, `portfolio_builder_api.py`, `portfolio_manual_api.py`, `simple_upload.py` (CSV import), and `portfolio_updates.py` (price fetches). Most expensive reads are wrapped in `@cache.memoize(timeout=…)`; a `portfolio_bp.after_request` hook invalidates the account's memoized reads on every successful write, so write endpoints don't call `invalidate_portfolio_cache()` themselves — except mid-request before re-reading, and in background jobs that outlive the request.

## Frontend → Backend

Next.js dev server on `:3000` proxies API calls to Flask on `:8065` (see `frontend/next.config.ts`). In production, both are behind the Docker setup in `deployment/`. Client code calls into `frontend/src/lib/api.ts`; pure calc logic stays in `frontend/src/lib/*-calc.ts` so it's unit-testable without the network.

Design tokens and components live in `frontend/src/components/ui/` (shadcn) and `frontend/src/app/theme/`. No CSS variables in the Flask side anymore — the Next.js app uses Tailwind classes and shadcn defaults.

## Database

**SQLite** with schema in `app/schema.sql` (auto-applied on startup). Migrations in `app/db_manager.py` (currently 23 migrations, runs on every boot).

Key tables and notable columns:
- `companies`: Holdings with `investment_type` (Stock/ETF/Crypto), `source` (parqet/ibkr/manual), `thesis`, `sector`, nullable `identifier` and `portfolio_id`, custom value support, identifier protection columns, `first_bought_date`
- `company_shares`: Share quantities with manual override and edit tracking
- `market_prices`: Native currency `price` + `price_eur` (legacy)
- `exchange_rates`: Daily rates, refreshed on startup if >24h old
- `simulations`: Allocation scenarios with `type` (overlay/portfolio), `scope` (global/portfolio), JSON `items`
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

Structured exceptions in `app/exceptions.py`: `ValidationError`, `NotFoundError`, `DatabaseError`, `CSVProcessingError`, `PriceFetchError`, `AuthenticationError`.

Global JSON error handlers in `app/errors.py` (registered in `create_app`) map typed exceptions to status codes (400/401/403/404/409/502) and return JSON for everything, including 404/405 and unexpected 500s. Routes should raise typed exceptions and let them propagate instead of wrapping handlers in try/except boilerplate.

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **prismo** (1707 symbols, 4877 relationships, 134 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/prismo/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/prismo/context` | Codebase overview, check index freshness |
| `gitnexus://repo/prismo/clusters` | All functional areas |
| `gitnexus://repo/prismo/processes` | All execution flows |
| `gitnexus://repo/prismo/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## CLI

- Re-index: `npx gitnexus analyze`
- Check freshness: `npx gitnexus status`
- Generate docs: `npx gitnexus wiki`

<!-- gitnexus:end -->
