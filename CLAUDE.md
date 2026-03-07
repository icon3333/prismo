# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Prismo** — a Flask web application for Parqet portfolio management. Helps users rebalance investment portfolios with smart allocation recommendations. Designed for **single-user homeserver deployment**.

**Philosophy**: 80/20 rule — simple, modular, elegant, efficient, and robust.

## Commands

```bash
# Development
python3 run.py --port 8065                    # Run app (auto-creates .env + DB on first run)
FLASK_ENV=development python3 run.py --port 8065  # Explicit dev mode

# Testing
pytest                                         # Run all tests
pytest tests/test_allocation_service.py -v     # Single test file
pytest --cov=app --cov-report=html             # With coverage

# Production
./deploy.sh                                    # Git pull + Docker rebuild + restart
docker-compose up -d                           # Manual Docker
```

## Architecture

Three-layer architecture with strict separation:

```
Routes (app/routes/)  →  HTTP handling, @require_auth, delegate to services
    ↓
Services (app/services/)  →  Pure Python business logic, no Flask deps
    ↓
Repositories (app/repositories/)  →  Data access, parameterized SQL, account_id validation
    ↓
SQLite (app/schema.sql + migrations in app/db_manager.py)
```

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
- `app/utils/batch_processing.py`: Sync (<20 items) / async (≥20 items) execution

## Pages & Frontend

Each page has a route, template, JS file, and CSS file:

| Page | Route | Template | JS |
|------|-------|----------|----|
| Performance | `/portfolio/performance` | `pages/performance.html` | — |
| Rebalancer | `/portfolio/rebalancer` | `pages/rebalancer.html` | `rebalancer.js` (PortfolioAllocator) |
| Simulator | `/portfolio/simulator` | `pages/simulator.html` | `simulation-scenarios.js` (AllocationSimulator) |
| Builder | `/portfolio/builder` | `pages/builder.html` | `builder.js` |
| Enrich | `/portfolio/enrich` | `pages/enrich.html` | `enrich.js` |
| Concentrations | `/portfolio/concentrations` | `pages/concentrations.html` | — |

Templates are in `templates/` (top-level, not `app/templates/`). Static files in `static/`.

Old URLs (`/analyse`, `/allocate`, `/build`) have 301 redirects.

## Design System

**All UI work must follow [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md)** (Ocean Depth theme):
- Dark mode: layered backgrounds (#020617 → #0F172A → #1E293B), no box shadows
- Primary accent: Aqua (#06B6D4), Danger: Coral (#EF4444)
- Always use CSS variables, never hardcoded colors
- 8px spacing grid

## Database

**SQLite** with schema in `app/schema.sql` (auto-applied on startup). Migrations in `app/db_manager.py` (currently 23 migrations).

Key tables and notable columns:
- `companies`: Holdings with `investment_type` (Stock/ETF/Crypto), `source` (parqet/ibkr/manual), `thesis`, `sector`, nullable `identifier` and `portfolio_id`, custom value support, identifier protection columns, `first_bought_date`
- `company_shares`: Share quantities with manual override and edit tracking
- `market_prices`: Native currency `price` + `price_eur` (legacy)
- `exchange_rates`: Daily rates, refreshed on startup if >24h old
- `simulations`: Allocation scenarios with `type` (overlay/portfolio), `scope` (global/portfolio), JSON `items`
- `expanded_state`: UI state persistence (page_name values: `performance`, `builder`, `enrich`, `risk_overview`)
- `accounts`: Has `cash` column for cash balance tracking

UNIQUE constraint on `(account_id, name)` in companies — prevents duplicate positions.

## CSV Import

Supports two formats, auto-detected by `detect_csv_format()` in `parser.py`:
- **Parqet** (semicolon-delimited): Transaction-based with buy/sell calculations
- **IBKR Flex Query** (comma-delimited): Snapshot mode, uses `process_companies_snapshot()`

Broker-scoped deletion: each import only removes positions from its own `source` type. Manual positions (`source='manual'`) are never deleted by imports. Protected identifier edits are preserved across reimports.

## Authentication

All routes use `@require_auth` decorator (`app/decorators/auth.py`):
- Sets `g.account_id` (always) and `g.account` (HTML routes only)
- No password system — session-based account selection

## Error Handling

Structured exceptions in `app/exceptions.py`: `ValidationError`, `NotFoundError`, `DatabaseError`, `CSVProcessingError`, `PriceFetchError`, `AuthenticationError`.

## Simulator Modes

Two modes toggled in the header:
- **Overlay**: Baseline portfolio overlay with delta indicators, investment progress
- **Portfolio** (Sandbox): Standalone simulated portfolio, no baseline
- Mode persisted in `localStorage` via `simulator_state.mode`
- Clone feature creates portfolio-type simulation from real portfolio
- Sandbox supports EUR/% global value mode with `total_amount` as denominator

## Configuration

Environment variables via `.env` (auto-generated on first run). See `config.py` for all options. Key settings: `FLASK_ENV`, `APP_DATA_DIR` (default: `instance/`), `PRICE_UPDATE_INTERVAL_HOURS` (24), `BACKUP_INTERVAL_HOURS` (6).

## Caching

Flask-Caching with SimpleCache (in-memory): 15-min for stock prices, 1-hour for exchange rates. Configured in `app/cache.py`.

<!-- gitnexus:start -->
# GitNexus MCP

This project is indexed by GitNexus as **portfolio_rebalancing_flask** (1197 symbols, 3365 relationships, 92 execution flows).

## Always Start Here

1. **Read `gitnexus://repo/{name}/context`** — codebase overview + check index freshness
2. **Match your task to a skill below** and **read that skill file**
3. **Follow the skill's workflow and checklist**

> If step 1 warns the index is stale, run `npx gitnexus analyze` in the terminal first.

## Skills

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
