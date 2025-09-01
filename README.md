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
- Analyze current vs target allocations  
- Get smart rebalancing recommendations
- Visualize portfolio composition and performance

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

# Install dependencies
pip install -r requirements.txt

# Run the application (will automatically set up everything)
./app.sh
```

The app will automatically detect if you need environment setup and run the interactive configuration on first launch!

Visit `http://localhost:8065` to access the application.

## 🎯 How to Use with Parqet

1. **Export your portfolio from Parqet**
   - Go to your Parqet portfolio
   - Export as CSV (use the native Parqet export function)

2. **Import into this tool**
   - Start the application
   - Navigate to "Build Portfolio" 
   - Upload your Parqet CSV file

3. **Set target allocations**
   - Define your desired allocation percentages
   - The tool will calculate what trades you need to make

4. **Get rebalancing recommendations**
   - See exactly how much to buy/sell of each position
   - Copy the recommendations back to Parqet for execution

## 📦 Installation

### Prerequisites

- Python 3.12 or higher
- pip package manager

### Step-by-Step Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/portfolio-rebalancing-flask.git
   cd portfolio-rebalancing-flask
   ```

2. **Create a virtual environment** (recommended)
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Database setup** (automatic on first run)
   - SQLite database will be created automatically

## ⚙️ Configuration

### Environment Variables

The application uses python-dotenv to automatically load environment variables from a `.env` file.

#### Option 1: Automatic Setup (Recommended)

```bash
# Just run the app - it will automatically set up environment if needed
python run.py --port 5000
```

Or run setup manually:
```bash
# Default setup (development, SQLite, auto-generated secret)
python setup_env.py

# Production setup 
python setup_env.py --production

# Interactive setup (prompts for all options)
python setup_env.py --interactive
```

#### Option 2: Manual Setup

1. Copy the example file:
```bash
cp .env.example .env
```

2. Edit `.env` and replace placeholder values:
```bash
# Generate a secure secret key
SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"

# Database configuration
DATABASE_URL="sqlite:///app/database/portfolio.db"

# Flask environment
FLASK_ENV="development"  # or "production"
```

## 🎯 Usage

### Web Interface

1. **Start the application**
   ```bash
   python run.py --port 5000
   ```

2. **Access the dashboard** at `http://localhost:5000`

3. **Import your Parqet data**
   - Navigate to "Build Portfolio"
   - Upload your Parqet CSV export
   - Set target allocations

4. **Analyze and rebalance**
   - View current allocations vs targets
   - Get rebalancing recommendations
   - Track performance over time

### Parqet CSV Format Expected

The tool expects the standard Parqet export format. Make sure to use Parqet's native CSV export function - custom formats won't work!

### API Endpoints

- `GET /api/portfolio` - Get portfolio data
- `POST /api/portfolio/rebalance` - Calculate rebalancing
- `GET /health` - Health check endpoint

## 🚀 Deployment

> **📖 Complete deployment guide**: See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive production deployment instructions.

### Quick Deployment Options

#### Gunicorn (Recommended)
```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:8000 run:app
```

#### Docker
```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
EXPOSE 8000

CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:8000", "run:app"]
```

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

---

⭐ **If you find this tool helpful for your Parqet portfolio management, please give it a star!**

**Development Status**: 🧪 Experimental | 🎯 Functional | 💡 Open to Ideas

*Built with curiosity, caffeine, and a lot of trial and error. Happy rebalancing! 🚀*