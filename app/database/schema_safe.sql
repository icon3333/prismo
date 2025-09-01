-- Safe schema creation - only create tables if they don't exist
-- Create accounts table
CREATE TABLE IF NOT EXISTS accounts (
 id INTEGER PRIMARY KEY,
 username TEXT UNIQUE NOT NULL,
 created_at TEXT NOT NULL,
 last_price_update DATETIME
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
 identifier TEXT NOT NULL,
 category TEXT NOT NULL,
 portfolio_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL,
 total_invested REAL DEFAULT 0,
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
 country TEXT,
 sector TEXT,
 industry TEXT
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
 name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 progress INTEGER DEFAULT 0,
 total INTEGER DEFAULT 0,
 result TEXT,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for market_prices (only if they don't exist)
CREATE INDEX IF NOT EXISTS idx_market_prices_last_updated ON market_prices(last_updated);
CREATE INDEX IF NOT EXISTS idx_market_prices_identifier ON market_prices(identifier);
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
-- Create indexes for background_jobs
CREATE INDEX IF NOT EXISTS idx_background_jobs_status ON background_jobs(status);
CREATE INDEX IF NOT EXISTS idx_background_jobs_created_at ON background_jobs(created_at);

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

-- Create trigger for background_jobs (only if it doesn't exist)
CREATE TRIGGER IF NOT EXISTS update_background_jobs_timestamp
AFTER UPDATE ON background_jobs
BEGIN
 UPDATE background_jobs SET updated_at = CURRENT_TIMESTAMP
 WHERE id = NEW.id;
END;

 