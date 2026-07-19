-- Safe schema creation - only create tables if they don't exist
-- Create accounts table
CREATE TABLE IF NOT EXISTS accounts (
 id INTEGER PRIMARY KEY,
 username TEXT UNIQUE NOT NULL,
 created_at TEXT NOT NULL,
 last_price_update DATETIME,
 cash REAL DEFAULT 0
);
-- Create portfolios table
CREATE TABLE IF NOT EXISTS portfolios (
 id INTEGER PRIMARY KEY,
 name TEXT NOT NULL,
 account_id INTEGER NOT NULL,
 FOREIGN KEY (account_id) REFERENCES accounts (id),
 UNIQUE (account_id, name)
);
-- Create companies table
CREATE TABLE IF NOT EXISTS companies (
 id INTEGER PRIMARY KEY,
 name TEXT NOT NULL,
 identifier TEXT,
 sector TEXT NOT NULL,
 thesis TEXT DEFAULT '',
 portfolio_id INTEGER,
 account_id INTEGER NOT NULL,
 total_invested REAL DEFAULT 0,
 override_country TEXT,
 country_manually_edited BOOLEAN DEFAULT 0,
 country_manual_edit_date DATETIME,
 custom_total_value REAL,
 custom_price_eur REAL,
 is_custom_value BOOLEAN DEFAULT 0,
 custom_value_date DATETIME,
 investment_type TEXT CHECK(investment_type IN ('Stock', 'ETF', 'Crypto')),
 override_identifier TEXT,
 identifier_manually_edited BOOLEAN DEFAULT 0,
 identifier_manual_edit_date DATETIME,
 source TEXT DEFAULT 'parqet' CHECK(source IN ('parqet', 'ibkr', 'manual')),
 first_bought_date DATETIME,
 FOREIGN KEY (portfolio_id) REFERENCES portfolios (id),
 FOREIGN KEY (account_id) REFERENCES accounts (id),
 UNIQUE (account_id, name)
);
-- Create company_shares table
CREATE TABLE IF NOT EXISTS company_shares (
 company_id INTEGER PRIMARY KEY,
 shares REAL,
 override_share REAL,
 manual_edit_date DATETIME,
 is_manually_edited BOOLEAN DEFAULT 0,
 csv_modified_after_edit BOOLEAN DEFAULT 0,
 FOREIGN KEY (company_id) REFERENCES companies (id)
);
-- Create market_prices table
CREATE TABLE IF NOT EXISTS market_prices (
 identifier TEXT PRIMARY KEY,
 price REAL,
 currency TEXT,
 price_eur REAL,
 last_updated DATETIME,
 country TEXT
);
-- Create expanded_state table
CREATE TABLE IF NOT EXISTS expanded_state (
 id INTEGER PRIMARY KEY,
 account_id INTEGER NOT NULL,
 page_name TEXT NOT NULL,
 variable_name TEXT NOT NULL,
 variable_type TEXT NOT NULL,
 variable_value TEXT NOT NULL,
 last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (account_id) REFERENCES accounts (id),
 UNIQUE (account_id, page_name, variable_name)
);
-- Create identifier_mappings table
CREATE TABLE IF NOT EXISTS identifier_mappings (
 id INTEGER PRIMARY KEY,
 account_id INTEGER NOT NULL,
 csv_identifier TEXT NOT NULL,
 preferred_identifier TEXT NOT NULL,
 company_name TEXT,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (account_id) REFERENCES accounts (id),
 UNIQUE (account_id, csv_identifier)
);
-- Create background_jobs table
CREATE TABLE IF NOT EXISTS background_jobs (
 id TEXT PRIMARY KEY,
 account_id INTEGER,
 name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 progress INTEGER DEFAULT 0,
 total INTEGER DEFAULT 0,
 result TEXT,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- One versioned aggregate per monthly decision review.
CREATE TABLE IF NOT EXISTS monthly_reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 account_id INTEGER NOT NULL,
 source_job_id TEXT,
 period TEXT NOT NULL,
 previous_review_id INTEGER,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'completed')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
 payload TEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TIMESTAMP,
 FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
 FOREIGN KEY (source_job_id) REFERENCES background_jobs(id) ON DELETE SET NULL,
 FOREIGN KEY (previous_review_id) REFERENCES monthly_reviews(id) ON DELETE SET NULL
);

-- Create exchange_rates table for consistent currency conversion
-- Stores latest exchange rate per currency pair (no historical tracking)
CREATE TABLE IF NOT EXISTS exchange_rates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 from_currency TEXT NOT NULL,
 to_currency TEXT DEFAULT 'EUR',
 rate REAL NOT NULL,
 last_updated DATETIME NOT NULL,
 UNIQUE(from_currency, to_currency)
);

-- Create simulations table for saving allocation simulator scenarios
CREATE TABLE IF NOT EXISTS simulations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 account_id INTEGER NOT NULL,
 name TEXT NOT NULL,
 scope TEXT NOT NULL DEFAULT 'global',
 portfolio_id INTEGER,
 items TEXT NOT NULL,
 type TEXT NOT NULL DEFAULT 'overlay' CHECK(type IN ('overlay', 'portfolio')),
 cloned_from_portfolio_id INTEGER,
 cloned_from_name TEXT,
 global_value_mode TEXT NOT NULL DEFAULT 'euro' CHECK(global_value_mode IN ('euro', 'percent')),
 total_amount REAL DEFAULT 0,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (account_id) REFERENCES accounts(id),
 FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

-- Create indexes for market_prices (only if they don't exist)
-- Note: identifier is PRIMARY KEY so an explicit index would be redundant.
CREATE INDEX IF NOT EXISTS idx_market_prices_last_updated ON market_prices(last_updated);
-- Create indexes for expanded_state
CREATE INDEX IF NOT EXISTS idx_state_lookup ON expanded_state(account_id, page_name, variable_name);
CREATE INDEX IF NOT EXISTS idx_state_type ON expanded_state(variable_type);
CREATE INDEX IF NOT EXISTS idx_state_updated ON expanded_state(last_updated);
-- Create indexes for identifier_mappings
CREATE INDEX IF NOT EXISTS idx_identifier_mappings_account ON identifier_mappings(account_id);
CREATE INDEX IF NOT EXISTS idx_identifier_mappings_csv_id ON identifier_mappings(csv_identifier);
CREATE INDEX IF NOT EXISTS idx_identifier_mappings_preferred ON identifier_mappings(preferred_identifier);
-- Indexes for portfolio data query performance
CREATE INDEX IF NOT EXISTS idx_companies_account_id ON companies(account_id);
CREATE INDEX IF NOT EXISTS idx_company_shares_company_id ON company_shares(company_id);
CREATE INDEX IF NOT EXISTS idx_companies_portfolio_id ON companies(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_companies_identifier ON companies(identifier);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
CREATE INDEX IF NOT EXISTS idx_companies_investment_type ON companies(investment_type);
CREATE INDEX IF NOT EXISTS idx_companies_sector ON companies(sector);
CREATE INDEX IF NOT EXISTS idx_companies_source ON companies(source);
CREATE INDEX IF NOT EXISTS idx_portfolios_account_id ON portfolios(account_id);

-- PERFORMANCE OPTIMIZATION: Composite indexes for common query patterns
-- Covers the most common access pattern: filtering by portfolio_id and account_id together
CREATE INDEX IF NOT EXISTS idx_companies_portfolio_account ON companies(portfolio_id, account_id);
-- Optimizes sector grouping within portfolios
CREATE INDEX IF NOT EXISTS idx_companies_portfolio_sector ON companies(portfolio_id, sector);
-- Create indexes for background_jobs
CREATE INDEX IF NOT EXISTS idx_background_jobs_status ON background_jobs(status);
CREATE INDEX IF NOT EXISTS idx_background_jobs_created_at ON background_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_background_jobs_account_status ON background_jobs(account_id, status);
-- Account-owned jobs are CSV imports. Enforce one active import atomically;
-- global price jobs keep account_id NULL and are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_background_jobs_active_account
ON background_jobs(account_id)
WHERE account_id IS NOT NULL AND status IN ('pending', 'processing');
-- Monthly review indexes support history, draft resume, completed comparison,
-- and idempotent creation from a terminal CSV job.
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_reviews_account_source_job
ON monthly_reviews(account_id, source_job_id)
WHERE source_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_monthly_reviews_account_status_created
ON monthly_reviews(account_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_reviews_account_completed
ON monthly_reviews(account_id, completed_at DESC, id DESC)
WHERE status = 'completed';
-- Create index for exchange_rates
CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency ON exchange_rates(from_currency, to_currency);

-- Create indexes for simulations
CREATE INDEX IF NOT EXISTS idx_simulations_account_id ON simulations(account_id);
CREATE INDEX IF NOT EXISTS idx_simulations_name ON simulations(account_id, name);

-- Create trigger for expanded_state (only if it doesn't exist)
CREATE TRIGGER IF NOT EXISTS update_state_timestamp
AFTER UPDATE ON expanded_state
BEGIN
 UPDATE expanded_state SET last_updated = CURRENT_TIMESTAMP
 WHERE id = NEW.id;
END;

-- Create trigger for identifier_mappings (only if it doesn't exist)
CREATE TRIGGER IF NOT EXISTS update_identifier_mappings_timestamp
AFTER UPDATE ON identifier_mappings
BEGIN
 UPDATE identifier_mappings SET updated_at = CURRENT_TIMESTAMP
 WHERE id = NEW.id;
END;

-- REMOVED: Auto-update trigger doubles write operations unnecessarily
-- Progress update code already sets updated_at explicitly
-- CREATE TRIGGER IF NOT EXISTS update_background_jobs_timestamp
-- AFTER UPDATE ON background_jobs
-- BEGIN
--  UPDATE background_jobs SET updated_at = CURRENT_TIMESTAMP
--  WHERE id = NEW.id;
-- END;
