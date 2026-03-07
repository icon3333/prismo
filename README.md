# Prismo

A portfolio management app for [Parqet](https://parqet.com) and [IBKR](https://www.interactivebrokers.com/) users who want better control over rebalancing, allocation, and what-if planning. Built by a vibecoder who doesn't fully know what he's doing — but it works, and it's genuinely useful.

Feedback, issues, and PRs are very welcome. This is how I learn.

## Use Cases

- **You use Parqet or IBKR** and want smart rebalancing recommendations instead of spreadsheet math
- **You manage multiple portfolios** and need a unified view of allocation, concentration, and risk
- **You want to simulate** "what if I shift 5% from ETFs to crypto?" without touching real money
- **You track investment theses** and want P&L visibility per position with your rationale attached
- **You run a homeserver** and want a self-hosted portfolio tool that just works

## Quick Start

```bash
git clone https://github.com/your-username/prismo.git
cd prismo

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

python3 run.py --port 8065
```

That's it. The app auto-creates `.env` and the SQLite database on first run. Visit `http://localhost:8065`.

## Features

- **CSV Import** — Parqet exports (semicolon-delimited) and IBKR Flex Queries (comma-delimited), auto-detected
- **Manual Positions** — Add stocks, ETFs, or crypto without any CSV, with optional yfinance identifier lookup
- **Rebalancer** — Buy/sell recommendations across multiple allocation modes with per-type constraints (Stock/ETF/Crypto)
- **Allocation Simulator** — Save/load what-if scenarios in two modes: Overlay (delta on real portfolio) and Sandbox (standalone)
- **Performance Tracking** — P&L per position (absolute + percentage), portfolio-level metrics
- **Concentrations** — Global allocation heatmap and exposure analysis across portfolios
- **Builder** — Set budget goals, target allocations, and track investment progress
- **Enrichment** — Fetch real-time prices via yfinance, set custom values for unlisted holdings, edit identifiers with reimport protection
- **Thesis Tracking** — Document investment rationale per holding with bulk edit
- **Cash Balance** — Track available cash alongside investments, toggle it into allocation percentages
- **Multi-Currency** — Exchange rate conversion with daily refresh

## How It Works

1. **Import your data** — Upload a Parqet CSV or IBKR Flex Query export, or add positions manually
2. **Enrich** — The app fetches current market prices via yfinance and converts currencies using daily exchange rates
3. **Set targets** — Define your desired allocation per position, sector, or thesis — the app calculates how much to buy or sell to get there
4. **Simulate** — Clone your portfolio into a sandbox to test allocation changes before committing real money
5. **Monitor** — Track P&L, concentration risk, and whether your actual allocation drifts from targets

Prices are cached (15 min for stocks, 1 hour for exchange rates) to avoid hammering Yahoo Finance. The database auto-backs up every 6 hours.

## Architecture

| Layer | What | Where |
|-------|------|-------|
| Routes | HTTP handling, auth | `app/routes/` |
| Services | Business logic (pure Python) | `app/services/` |
| Repositories | Data access, parameterized SQL | `app/repositories/` |
| Database | SQLite | `instance/portfolio.db` |
| Frontend (legacy) | Jinja2 templates + vanilla JS | `templates/`, `static/` |
| Frontend (new) | Next.js 16, React 19, shadcn/ui | `frontend/` |

The new Next.js frontend is being migrated page-by-page. It proxies API calls to the Flask backend on port 8065.

For deep architecture details, see [`CLAUDE.md`](CLAUDE.md).

## Configuration

Copy `env.example` to `.env` and set your `SECRET_KEY`. Everything else has sensible defaults:

| Variable | Default | What it does |
|----------|---------|-------------|
| `SECRET_KEY` | *required* | Session encryption key |
| `FLASK_ENV` | `development` | `development` / `production` |
| `APP_DATA_DIR` | `instance` | Where the DB and backups live |
| `PRICE_UPDATE_INTERVAL_HOURS` | `24` | How often to refresh prices |
| `BACKUP_INTERVAL_HOURS` | `6` | Auto-backup frequency |
| `MAX_BACKUP_FILES` | `10` | Backup retention count |

Or just run `python3 run.py` — it generates `.env` automatically on first launch.

## Development

```bash
# Backend
python3 run.py --port 8065                        # Dev server with auto-reload
pytest                                             # Run tests
pytest tests/test_allocation_service.py -v         # Single test file
pytest --cov=app --cov-report=html                 # Coverage report

# Frontend (Next.js)
cd frontend
npm install
npm run dev                                        # Dev server on :3000, proxies API to :8065
```

## Deployment

```bash
# Docker (from deployment/ directory)
cd deployment
docker-compose up -d

# Or use the deploy script (git pull + rebuild + restart)
./deployment/deploy.sh
```

Data persists in `./instance`. Designed for single-user homeserver deployment — there's session-based auth but no password system.

## Security Notes

- Session-based auth with HttpOnly + SameSite cookies — no password system (homeserver assumption)
- All SQL queries are parameterized
- User inputs validated, structured exceptions throughout
- `.env` is gitignored, secrets auto-generated

This is hobby code for a homeserver. Review before exposing to the internet.

## Feedback & Contributing

This project started as a weekend experiment and grew into something I actually rely on daily. I'm not a professional developer — I learn by building and by getting feedback from people who know more than me.

If you spot something broken, dumb, or improvable:

- **Open an issue** — even small ones help
- **Submit a PR** — I'll learn from your code
- **Suggest features** — I'm genuinely curious what other portfolio nerds want

No contribution is too small and no question is too basic. We're all vibecoders here.

## License

[MIT](LICENSE) — do whatever you want with it.

---

*Built with curiosity, caffeine, and an mass amounts of Claude. Happy rebalancing.*
