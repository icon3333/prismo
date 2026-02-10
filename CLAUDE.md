# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Flask web application for **Parqet portfolio management** - helping users rebalance investment portfolios with smart allocation recommendations. Designed for **single-user homeserver deployment** with emphasis on elegance, simplicity, and robustness.

**Key Philosophy**: 80/20 rule - deliver 80% of the impact with 20% of the effort. Simple, modular, elegant, efficient, and robust.

## Design System

**IMPORTANT**: All UI work must follow the design system documented in [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md).

This document defines:
- **Ocean Depth** color palette (dark mode primary)
- Typography, spacing (8px grid), and border radius standards
- Component patterns: tables, forms, modals, sliders, badges, alerts
- State patterns: error, success, hover states
- Implementation checklist and CSS variable quick reference

**Key design principles**:
- No box shadows - depth through layered backgrounds (#020617 → #0F172A → #1E293B)
- Primary accent: Aqua (#06B6D4)
- Danger/error: Coral (#EF4444)
- Always use CSS variables, never hardcoded colors

## Running the Application

### Development
```bash
# Setup (first time only - auto-creates .env and database)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Run the app (auto-detects environment, port 8065)
python3 run.py --port 8065

# Or with explicit development mode
FLASK_ENV=development python3 run.py --port 8065
```

### Production Deployment
```bash
# Simple deployment (includes git pull, Docker rebuild, restart)
./deploy.sh

# Docker Compose (manual)
docker-compose up -d

# Access at http://localhost:8065 (or your server IP)
```

### Testing
```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest tests/test_allocation_service.py -v
```

## Architecture

**Three-layer architecture** optimized for single-user homeserver deployment:

```
Routes (HTTP handling, request/response)
  ↓
Services (Business logic, pure Python)
  ↓
Repositories (Data access, SQL queries)
  ↓
Database (SQLite with proper indexing)
```

### Key Design Principles

1. **Routes** (`app/routes/`): HTTP handling only, delegate to services
   - Use `@require_auth` decorator for authentication
   - Return JSON for API routes, render templates for pages
   - All routes protected by authentication (except `/health` and index)

2. **Services** (`app/services/`): Pure Python business logic
   - `AllocationService`: Portfolio allocation calculations and rebalancing logic with standardized allocation modes and type constraints
   - `BuilderService`: Investment targets and budget planning
     - `get_investment_targets(account_id)`: Returns budget and portfolio targets
     - `get_portfolio_target(account_id, portfolio_id)`: Single portfolio target
     - `get_investment_progress(account_id, portfolio_id?)`: Investment progress calculation
   - No Flask dependencies - fully testable without app context

3. **Repositories** (`app/repositories/`): Single source of truth for data access
   - `PortfolioRepository`: Portfolio and company data queries
   - `PriceRepository`: Market price operations
   - `AccountRepository`: Account management with cash balance tracking
     - `get_cash(account_id)`, `set_cash(account_id, amount)`: Cash balance operations
   - `SimulationRepository`: Allocation simulator scenario management
     - `get_all(account_id)`: List all simulations
     - `get_by_id(simulation_id, account_id)`: Get simulation with full items
     - `create(account_id, name, scope, items, portfolio_id?)`: Create simulation
     - `update(...)`: Update existing simulation
     - `delete(simulation_id, account_id)`: Delete simulation
     - `exists(name, account_id, exclude_id?)`: Check name uniqueness
   - All methods validate `account_id` for data isolation

4. **Utils** (`app/utils/`): Supporting utilities
   - `csv_processing/`: Modular CSV import (parser, company_processor, share_calculator, etc.)
   - `yfinance_utils.py`: Market data fetching with caching
   - `batch_processing.py`: Smart sync/async execution (sync <20 items, async ≥20)
   - `identifier_normalization.py`: Ticker symbol normalization

## Database Schema

**SQLite** database with 11 core tables:
- `accounts`: User accounts (single-user but multi-account support)
  - `cash REAL`: Cash balance tracking for investment planning
- `portfolios`: Portfolio definitions
- `companies`: Holdings (securities/positions) with:
  - Custom value support (`custom_total_value`, `custom_price_eur`, `is_custom_value`, `custom_value_date`)
  - Investment type classification (`investment_type`: Stock or ETF)
  - Country override capabilities (`override_country`, `country_manually_edited`)
  - Identifier protection (`override_identifier`, `identifier_manually_edited`, `identifier_manual_edit_date`)
  - Total invested tracking (for P&L calculations)
  - Thesis tracking (`thesis TEXT`): Investment rationale per holding
  - Sector classification (`sector`): Renamed from category
- `company_shares`: Share quantities with manual override support and edit tracking
- `market_prices`: Cached market prices (updated via yfinance) - stores both native currency (`price`) and EUR (`price_eur`)
- `exchange_rates`: Daily exchange rates for consistent currency conversion (refreshed every 24h)
- `identifier_mappings`: Custom ticker symbol mappings
- `expanded_state`: UI state persistence
- `background_jobs`: Job status tracking
- `simulations`: Allocation simulator scenarios with:
  - `id`, `account_id`, `name`, `scope` (global/portfolio)
  - `portfolio_id` (optional, for portfolio-scoped simulations)
  - `items` (JSON): Serialized allocation items
  - `created_at`, `updated_at` timestamps
- Schema in `app/schema.sql` (automatically applied on startup)
- **Database migrations** handle schema evolution (13 migrations currently implemented in `db_manager.py`):
  1. User-edited shares tracking columns
  2. Country override columns
  3. Custom value columns
  4. Investment type column
  5. Identifier manual edit tracking columns
  6. Exchange rates table for consistent currency conversion
  7. Simulations table for allocation simulator scenarios
  8. Thesis column in companies table for investment rationale
  9. Category → sector rename in companies table
  10. Cash column in accounts table for cash balance tracking
  11. Source column for tracking manual vs CSV-imported companies
  12. Make identifier and portfolio_id nullable in companies table
  13. Rename page_name values (analyse→performance, build→builder)

## Caching Strategy

**Flask-Caching** with SimpleCache (in-memory, perfect for single-user):
- **15 minutes**: Stock prices (`get_isin_data`, `get_yfinance_info`)
- **1 hour**: Exchange rates (in-memory cache for yfinance API)
- **Expected impact**: 50-90% reduction in API calls
- Cache configured in `app/cache.py` and `app/main.py`

## Currency Handling

**Consistent Daily Exchange Rates** - ensures portfolio values don't diverge from broker reports:

**Architecture:**
- Native currency prices stored in `market_prices.price` (e.g., $150 USD)
- Exchange rates stored in `exchange_rates` table (refreshed every 24h on startup)
- EUR values calculated on-the-fly using consistent daily rates
- All positions use the **same exchange rate** for a given day

**Calculation Priority** (in `value_calculator.py`):
1. Custom value: If `is_custom_value=True`, use `custom_total_value`
2. Native currency: `price * exchange_rate(currency) * shares`
3. Legacy fallback: `price_eur * shares` (for backward compatibility)

**Key Components:**
- `ExchangeRateRepository`: Database access for exchange rates (`app/repositories/exchange_rate_repository.py`)
- `refresh_exchange_rates_if_needed()`: Startup task to refresh stale rates (`app/utils/startup_tasks.py`)
- `calculate_item_value()`: Central value calculation with currency conversion (`app/utils/value_calculator.py`)

**Exchange Rate Refresh:**
- Automatically refreshed on app startup if rates are >24h old
- Common currencies fetched: USD, GBP, CHF, JPY, CAD, AUD, SEK, NOK, DKK, HKD, SGD, NZD
- Additional currencies fetched based on what's in the portfolio
- Rates logged for audit trail

## CSV Processing

**Only Parqet native CSV exports are supported** - the format must match Parqet's export structure.

CSV processing is modular (`app/utils/csv_processing/`):
1. `parser.py`: Parse and validate CSV structure
2. `company_processor.py`: Process company/security data (includes investment type detection)
3. `share_calculator.py`: Calculate share quantities from transactions with timezone-aware comparison fixes
4. `portfolio_handler.py`: Portfolio-level operations
5. `price_updater.py`: Update market prices
6. `transaction_manager.py`: Transaction processing with proper handling of zero-share positions

**Recent Improvements**:
- Timezone-aware date comparison for manual share edits
- Proper handling of zero-share and negative-share positions (auto-removal)
- Investment type (Stock/ETF) detection and tracking
- Protected identifier edits (manual changes preserved across CSV reimports)
- Total invested tracking for P&L calculations

## Authentication Pattern

All routes use the `@require_auth` decorator (`app/decorators/auth.py`):
- Auto-detects JSON vs HTML routes
- Sets `g.account_id` for all authenticated routes
- For HTML routes: also sets `g.account` (pre-loaded account object)
- Returns 401 JSON or redirects with flash message on auth failure

```python
from app.decorators.auth import require_auth

@blueprint.route('/api/data')
@require_auth
def get_data():
    account_id = g.account_id  # Always available
    # ... route logic
```

## Error Handling

Use structured exceptions (`app/exceptions.py`):
- `ValidationError`: Invalid input, missing fields
- `NotFoundError`: Resource not found
- `DatabaseError`: Database operation failed
- `CSVProcessingError`: CSV parsing/processing failed
- `PriceFetchError`: External API failures (yfinance)
- `AuthenticationError`: Auth required or failed
- Return proper HTTP status codes (400, 401, 404, 500)

## Recent Features & Improvements

### Major Features Added
- **P&L Tracking**: Profit & loss calculations displayed in Performance page
  - Absolute P&L: `current_value - total_invested`
  - Percentage P&L: `(pnl_absolute / total_invested) * 100`
  - Calculated in `portfolio_api.py` for all positions with `total_invested > 0`

- **Editable Desired Positions**: Builder page allows direct editing of target position counts
  - Input validation with min/max constraints
  - Real-time visual warnings for values below minimum
  - Saves to `expanded_state` table for persistence

- **Protected Identifier Edits**: Manual identifier changes preserved across CSV reimports
  - New columns: `override_identifier`, `identifier_manually_edited`, `identifier_manual_edit_date`
  - CSV import checks for manual edits and skips overwriting protected identifiers
  - Tracking counter shows how many identifiers were protected during import

- **Portfolio Rename**: Fixed bug preventing portfolio renaming functionality

- **Enhanced UI**: Improved table scrollbars and visual polish across all pages

- **Allocation Simulator**: Save and load simulation scenarios with custom allocations
  - Supports global and portfolio-scoped simulations
  - Persists to database via `SimulationRepository`
  - Full CRUD operations with name uniqueness validation

- **Cash Balance Tracking**: Track cash reserves alongside investments
  - Stored in accounts table (`cash` column)
  - Accessible via `AccountRepository.get_cash()` and `set_cash()`
  - Integrated into investment progress calculations

- **Thesis Tracking**: Investment rationale per holding
  - `thesis` column in companies table
  - Bulk edit support for efficient management
  - Helps document investment decisions

- **Investment Targets**: Budget goals and portfolio allocation targets
  - `BuilderService` handles target calculations
  - Progress tracking against defined goals
  - Supports both global budget and per-portfolio targets

### Performance Optimizations
- Pre-fetching company data with JOIN queries to avoid N+1 problems
- Smart batch processing with sync/async thresholds
- Composite database indexes for common query patterns

## Configuration

Environment variables via `.env` file (auto-generated on first run):
- `SECRET_KEY`: Flask session secret (auto-generated)
- `FLASK_ENV`: development/production
- `APP_DATA_DIR`: Data directory (default: `instance/`)
- `DATABASE_URL`: Override for advanced users (default: SQLite in APP_DATA_DIR)
- `CACHE_DEFAULT_TIMEOUT`: Cache timeout in seconds
- `PRICE_UPDATE_INTERVAL_HOURS`: Auto price update interval (default: 24)
- `BACKUP_INTERVAL_HOURS`: Database backup interval (default: 6)
- `SESSION_LIFETIME_DAYS`: Session lifetime in days (default: 1)
- `DB_BACKUP_DIR`: Backup directory path
- `MAX_BACKUP_FILES`: Max backup files to keep (default: 10)
- `BATCH_SIZE`: Ticker batch size for price fetching (default: 5)
- `MAX_CONTENT_LENGTH`: Max upload size (default: 16MB)
- `UPLOAD_FOLDER`: Upload directory
- `PER_PAGE`: Pagination default (default: 20)

See `config.py` for all configuration options.

## Key Utilities

### Batch Processing (`app/utils/batch_processing.py`)
Smart sync/async threshold:
- **<20 items**: Synchronous execution (faster, no thread overhead)
- **≥20 items**: Asynchronous parallel processing
- Optimized for typical homeserver use cases

### Identifier Normalization (`app/utils/identifier_normalization.py`)
Normalizes ticker symbols across formats (ISIN, ticker, etc.) for consistent lookups.

### yfinance Integration (`app/utils/yfinance_utils.py`)
- `get_isin_data(identifier)`: Get price data (15-min cache)
- `get_yfinance_info(identifier)`: Get detailed info (15-min cache)
- Handles currency conversion to EUR

## Testing Strategy

Pragmatic test coverage (50-60% on critical paths):
- Service layer tests (allocation, portfolio logic)
- Repository layer tests (data access)
- CSV processing tests (parser, processors)
- Use `pytest` with fixtures for database setup
- Mock external APIs (yfinance) in tests

## Important Notes

1. **Single-user optimization**: Architecture assumes single concurrent user
2. **Parqet CSV only**: Only native Parqet export format is supported
3. **SQLite limitations**: Consider PostgreSQL for multi-user scenarios
4. **yfinance dependency**: Price updates require internet and working yfinance API
5. **Database backups**: Auto-backup every 6 hours to `instance/backups/`
6. **No authentication system**: Session-based account selection (no passwords)
7. **Custom values**: Enrich page allows setting custom total values for positions not available via yfinance
8. **Position types**: Holdings are classified as Stock or ETF for allocation constraint purposes
9. **P&L tracking**: Automatically calculated from `total_invested` and current value for each position
10. **Protected edits**: Manual edits to identifiers, shares, and countries are preserved across CSV reimports
11. **Editable positions**: Build page allows direct editing of desired position counts with min/max validation
12. **Debug mode**: Controlled via `FLASK_ENV` environment variable (development/production)
13. **Allocation simulator**: Save/load simulation scenarios for what-if allocation planning
14. **Cash tracking**: Track available cash for investment alongside portfolio positions
15. **Thesis tracking**: Document investment rationale per holding with bulk edit support
16. **Investment targets**: Set budget goals and portfolio allocation targets via BuilderService

## Common Tasks

### Adding a new route
1. Add route function to appropriate blueprint in `app/routes/`
2. Use `@require_auth` decorator
3. Delegate business logic to service layer
4. Return JSON for API, render template for pages

### Adding new business logic
1. Add method to appropriate service in `app/services/`
2. Keep services pure Python (no Flask dependencies)
3. Add tests in `tests/test_<service_name>.py`

### Adding database queries
1. Add method to appropriate repository in `app/repositories/`
2. Always validate `account_id` for data isolation
3. Use parameterized queries (no string interpolation)

### Modifying CSV processing
1. Update appropriate module in `app/utils/csv_processing/`
2. Test with actual Parqet CSV exports
3. Add tests to verify changes

## File Structure Summary

```
app/
├── main.py                  # Flask app factory
├── db_manager.py           # Database connections and migrations
├── schema.sql              # Database schema (auto-applied)
├── cache.py                # Cache instance (prevents circular imports)
├── validation.py           # Input validation utilities
├── exceptions.py           # Structured error types
├── decorators/
│   └── auth.py            # @require_auth decorator
├── routes/                 # HTTP request handlers
├── services/               # Business logic (pure Python)
├── repositories/           # Data access layer
└── utils/                  # Supporting utilities
    └── csv_processing/     # Modular CSV import logic

config.py                   # Environment-based configuration
run.py                      # Application entry point
deploy.sh                   # Production deployment script
docker-compose.yml          # Docker deployment config
requirements.txt            # Python dependencies
```

## Development Workflow

1. **Make changes** to code
2. **Run tests** to verify: `pytest`
3. **Test manually** in browser: `python3 run.py --port 8065`
4. **Commit changes** (conventional commit style preferred)
5. **Deploy** to production: `./deploy.sh` (if applicable)

## Security Considerations

- Session cookies: HttpOnly, SameSite=Lax
- No plaintext secrets in code (use `.env`)
- `.env` and `instance/` are gitignored
- Database backups exclude from git tracking
- Input validation on all user inputs
- Parameterized SQL queries (no injection risk)

## Contact & Support

See README.md for contribution guidelines and support channels. This is an experimental, hobby-level project - open to feedback and improvements!
