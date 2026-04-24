# Prismo

**The portfolio tool [Parqet](https://parqet.com) and [IBKR](https://www.interactivebrokers.com/) don't give you.**

Import your positions, set your targets, and get actual answers to the questions that matter: *What do I buy next? Am I over-concentrated? What if I shifted 5% into crypto?*

Self-hosted. Single-user. No subscriptions, no trackers, no fluff.

---

## Why you'd want this

You already have a broker. What you don't have is a fast way to answer:

- **"Where should this €1,000 go?"** — Prismo tells you, across all your accounts, respecting your type constraints (Stock / ETF / Crypto).
- **"Am I accidentally 40% in one sector?"** — Concentration heatmaps across portfolios, not just per account.
- **"What if I sell this and buy that?"** — Sandbox simulator. Clone your portfolio, mess with it, compare deltas. Nothing touches the real numbers.
- **"How is this thesis actually doing?"** — P&L per position with your written rationale attached. Stop rediscovering why you bought the dip in 2023.
- **"What do I still need to build?"** — Budget-goal Builder tracks progress toward your target allocations.

## What it does

- **One-click import** — Parqet CSVs and IBKR Flex Queries, auto-detected. Reimport anytime without losing manual edits.
- **Manual positions** — Add anything: unlisted stocks, pre-IPO, crypto you hold off-exchange. Optional yfinance lookup.
- **Rebalancer** — Buy/sell recommendations across multiple allocation strategies, per-type.
- **Simulator** — Two modes: Overlay (see deltas on your real portfolio) and Sandbox (standalone what-if).
- **Performance** — Absolute + % P&L per position, portfolio-wide metrics.
- **Concentrations** — Global allocation heatmap across all portfolios.
- **Builder** — Investment targets, budget planning, progress tracking.
- **Enrichment** — Live prices, custom values for the unlisted stuff, multi-currency with daily FX refresh.
- **Thesis tracking** — Write *why* you bought it. Edit in bulk. Never forget.
- **Cash balance** — Track uninvested cash, toggle it in/out of allocation math.

## Quick start

```bash
git clone https://github.com/your-username/prismo.git
cd prismo
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
./dev.sh
```

Backend on `:8065`, Next.js frontend on `:3000`. The app auto-creates `.env` and the SQLite DB on first run.

---

## Under the hood

Flask JSON API (Python) + Next.js 16 frontend (React 19, Tailwind, shadcn/ui). SQLite database. Prices via yfinance, cached 15 min. FX rates cached 1 hour. Auto-backup every 6 hours.

### Architecture

| Layer | Where |
|-------|-------|
| Routes (HTTP + auth) | `app/routes/` |
| Services (business logic) | `app/services/` |
| Repositories (data access) | `app/repositories/` |
| Database | `instance/portfolio.db` |
| Frontend | `frontend/` (Next.js) |

Deeper notes in [`CLAUDE.md`](CLAUDE.md).

### Configuration

Everything has sensible defaults — just run `python3 run.py` and it generates `.env` for you. Override via env vars:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SECRET_KEY` | auto-generated | Session encryption |
| `FLASK_ENV` | `development` | `development` / `production` |
| `APP_DATA_DIR` | `instance` | DB + backup location |
| `PRICE_UPDATE_INTERVAL_HOURS` | `24` | Price refresh cadence |
| `BACKUP_INTERVAL_HOURS` | `6` | Auto-backup cadence |
| `MAX_BACKUP_FILES` | `10` | Backup retention |

### Deployment

```bash
cd deployment
docker-compose up -d
# or: ./deployment/deploy.sh   (git pull + rebuild + restart)
```

Data persists in `./instance`. Session-based auth, no passwords — this assumes a homeserver, not the open internet. Review before exposing publicly.

### Security

- Parameterized SQL everywhere
- Session cookies are HttpOnly + SameSite
- Inputs validated, structured exceptions throughout
- `.env` gitignored, secrets auto-generated

---

## Feedback & contributing

I'm not a professional developer — this started as a weekend experiment and turned into something I rely on daily. If something's broken, dumb, or could be better: **open an issue, submit a PR, suggest a feature.** No contribution too small, no question too basic.

## License

[MIT](LICENSE) — do whatever you want.

---

*Built with curiosity, caffeine, and an embarrassing amount of Claude. Happy rebalancing.*
