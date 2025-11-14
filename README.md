# Parqet Portfolio Rebalancer 📈

A Flask web application designed specifically for [Parqet](https://parqet.com) portfolio management - helping you rebalance your investment portfolios with ease and precision.

[![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![Flask](https://img.shields.io/badge/flask-latest-green.svg)](https://flask.palletsprojects.com/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Experimental](https://img.shields.io/badge/status-experimental-orange.svg)](#about)

## 🎯 What is this?

This tool was born out of necessity over several months of struggling with portfolio allocation management on [Parqet](https://parqet.com). As someone who wanted better control over portfolio rebalancing and allocation visualization, I started tinkering with code and... well, here we are! 

It's a portfolio rebalancer specifically designed to work with Parqet's data, helping you:
- Import your Parqet portfolio data via CSV
- Enrich holdings with real-time market prices from yfinance
- Build and set target allocations
- Get smart rebalancing recommendations (buy/sell amounts)
- Analyze portfolio composition, performance, and risks with visualizations

Guided by a philosophy of **elegance, simplicity, and robustness**, it delivers 80% of the impact with 20% of the effort—focusing on automated, user-friendly features in a minimalistic, Apple-inspired UI.

## 🤓 The Backstory

This project started as a weekend experiment and grew organically over a few months. I had little formal coding knowledge but was frustrated with manually calculating portfolio rebalancing for my Parqet portfolios. So I decided to have some fun and build something that actually worked!

It's definitely **experimental** and **vibe-coded** - meaning I learned as I went, made things work, and probably broke a few best practices along the way. But hey, it does what it's supposed to do and I genuinely enjoyed building it!

## ⚠️ Important Notes

- **CSV Import**: Only works with native Parqet export CSV files (the format Parqet provides when you export your portfolio data)
- **Experimental Status**: This is hobby-level code written by someone learning as they go
- **No Guarantees**: Use at your own risk - double-check all calculations!

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/your-username/portfolio-rebalancing-flask.git
cd portfolio-rebalancing-flask

# Set up virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the application (auto-sets up env and database)
python3 run.py --port 8065
```

The app auto-detects and configures everything on first launch. Visit `http://localhost:8065` to start.

## 🎯 How to Use with Parqet

1. **Export from Parqet**: Download your portfolio as a native CSV export.

2. **Import & Build**: Navigate to "Build Portfolio" → Upload CSV → Set target allocations.

3. **Enrich Data**: Go to "Enrich" to fetch/update real-time prices via yfinance.

4. **Rebalance**: Use "Allocate" for precise buy/sell recommendations based on your targets.

5. **Analyze**: Check "Analyse" for portfolio visualizations and "Risk Overview" for global allocation insights.

The workflow is designed to be intuitive—each page builds on the previous step, guiding you from raw data to actionable investment decisions.

## 📦 Installation

### Prerequisites

- Python 3.12+ (use `python3` command)
- pip package manager
- Optional: Docker for deployment

### Step-by-Step Installation

1. **Clone and set up virtual environment** (as shown in Quick Start)
   ```bash
   git clone https://github.com/your-username/portfolio-rebalancing-flask.git
   cd portfolio-rebalancing-flask
   python3 -m venv venv
   source venv/bin/activate
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Database setup** (automatic on first run)
   - SQLite database auto-initializes with proper schema
   - Automatic backups are configured

## ⚙️ Configuration

The app auto-loads configuration from a `.env` file and handles database setup automatically.

### Manual Configuration (Optional)

If you need custom settings:

1. Copy the example: `cp env.example .env`
2. Generate a secure key: `python3 -c 'import secrets; print(secrets.token_hex(32))'`
3. Edit `.env` with your SECRET_KEY and other preferences

The app includes automatic backup management and price update scheduling.

## 🎯 Usage

Start with `python3 run.py --port 8065`. Create/select an account, then navigate through:

- **Build**: Upload Parqet CSV and define target allocations
- **Enrich**: Update prices and metadata via yfinance integration  
- **Allocate**: Get precise buy/sell trade recommendations
- **Analyse**: View portfolio composition charts and metrics
- **Risk Overview**: Global allocation and risk analysis

### API Access
Key endpoints for programmatic use:
- `GET /api/portfolio` - Portfolio data
- `GET /health` - System health check
- Various update and analysis endpoints

Expects standard Parqet CSV export format only.

## 🚀 Deployment

### Production Deployment (Simple)

For server deployment:

1. **Pull updates**: `git pull origin main`
2. **Deploy**: Run `./deploy.sh` 
   - Auto-builds Docker image
   - Restarts container via docker-compose
   - Handles environment setup

Access at `http://your-server:8065`

### Docker Setup

The included `docker-compose.yml` handles everything:
```bash
docker-compose up -d
```

Data persists in `./instance` directory. The deploy script manages the full update cycle automatically.

## 🔒 Security

> **🔐 Complete security guide**: See [SECURITY.md](SECURITY.md) for detailed security guidelines.

Note: While I've tried to implement reasonable security measures, remember this is experimental code! Review everything before using in production.

## 🤝 Contributing & Feedback

This project is **totally open for input**! Whether you're a coding wizard or just someone who uses Parqet and has ideas, I'd love to hear from you:

- **Found a bug?** Open an issue
- **Have an idea?** Start a discussion  
- **Want to contribute?** Pull requests welcome
- **Just want to chat about portfolio management?** Hit me up!

Since this was a learning project for me, I'm sure there are plenty of improvements that could be made. Don't hesitate to suggest better ways of doing things!

## 🎉 What's Missing?

If you notice anything important missing from this tool for Parqet users, please let me know! Some ideas I've been thinking about:

- Better error handling for malformed CSV files
- More detailed portfolio analytics
- Historical performance tracking
- Integration with more data sources
- Better mobile interface

## 📄 License

This project is licensed under the MIT License - feel free to use, modify, and share!

## 🆘 Support

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/your-username/portfolio-rebalancing-flask/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/portfolio-rebalancing-flask/discussions)

### Common Issues

<details>
<summary>CSV import not working</summary>

Make sure you're using the native Parqet CSV export format. Custom exports or modified files won't work properly.
</details>

<details>
<summary>Database connection errors</summary>

Ensure your DATABASE_URL is correctly set and the database is accessible.
</details>

<details>
<summary>Market data not updating</summary>

Check your internet connection and Yahoo Finance API availability.
</details>

## 🏗️ Architecture & Code Quality

This project has evolved through three major phases:

###  **Phase 1**: Initial Development
- Basic Flask app with portfolio management
- CSV import functionality
- yfinance integration for prices
- Simple allocation calculations

### **Phase 2**: Performance & Architecture (Completed)
- Introduced **Service Layer** (AllocationService, PortfolioService, PriceService)
- Introduced **Repository Layer** (PortfolioRepository for data access)
- Added **Flask-Caching** (15-min for prices, 1-hr for exchange rates)
- Smart **batch processing** (sync for <20 items, async for ≥20)
- **50-90% reduction in API calls** through strategic caching
- Validated with **31+ unit tests**

### **Phase 3**: Code Health & Maintainability (Completed)
Focused refactoring for single-user homeserver deployment:

**Phase 3a - Foundations** (22h):
- ✅ `@require_auth` decorator (eliminated 90+ lines of duplicate code)
- ✅ Response helpers for consistent API responses
- ✅ AccountRepository & PriceRepository
- ✅ Extended PortfolioRepository with allocation methods

**Phase 3b - Core Refactoring** (44h):
- ✅ Split 625-line `process_csv_data()` into 6 testable modules
- ✅ Refactored 249-line allocation route → 87 lines (65% reduction)
- ✅ Added two-phase validation for batch updates
- ✅ Optimized portfolio data loading with single-query repository method

**Phase 3c - Robust Testing** (18h):
- ✅ Extended exceptions.py with 8 structured error types
- ✅ Added error handling to all critical API routes
- ✅ Created pragmatic test suite (50-60% coverage on critical paths)
  - CSV processing tests
  - Repository layer tests
  - Allocation service tests

**Total Impact**:
- **~200 lines of duplicate code removed**
- **625-line function → 6 testable modules**
- **Consistent error handling** with proper HTTP status codes
- **Test coverage** for critical business logic
- **Cleaner architecture**: Routes → Services → Repositories → Database

**Current Architecture**:
```
Routes (HTTP handling)
  ↓
Services (Business logic)
  ↓
Repositories (Data access)
  ↓
Database (SQLite)
```

**Philosophy**: Simple, Modular, Elegant, Efficient, Robust - optimized for single-user homeserver deployment.

---

⭐ **If you find this tool helpful for your Parqet portfolio management, please give it a star!**

**Development Status**: 🧪 Experimental | 🎯 Functional | 💡 Open to Ideas

*Built with curiosity, caffeine, and a lot of trial and error. Happy rebalancing! 🚀*