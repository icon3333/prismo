"""
Simplified CSV Import System
No background threads, no complex progress tracking, no session juggling.
Just direct, straightforward CSV processing with automatic backups.
"""

import pandas as pd
import logging
import io
import yfinance as yf
from typing import Dict, Any, Tuple, Optional
from app.db_manager import query_db, execute_db, backup_database, get_db
from app.utils.yfinance_utils import get_exchange_rate
from app.utils.db_utils import update_price_in_db

logger = logging.getLogger(__name__)

# Pre-defined crypto symbols for fast identification
KNOWN_CRYPTO_SYMBOLS = {
    'BTC', 'ETH', 'ADA', 'SOL', 'BNB', 'DOT', 'MATIC', 'AVAX', 'ATOM', 'LINK',
    'UNI', 'LTC', 'BCH', 'XLM', 'VET', 'ICP', 'FIL', 'TRX', 'ETC', 'XMR',
    'ALGO', 'MANA', 'SAND', 'CRV', 'COMP', 'AAVE', 'MKR', 'SNX', 'YFI', 'SUSHI'
}

def normalize_simple(identifier: str) -> str:
    """
    Ultra-simple identifier normalization using heuristics first, API calls as fallback.
    Much faster than the complex dual-testing approach.
    """
    if not identifier or not identifier.strip():
        return identifier
    
    clean_id = identifier.strip().upper()
    
    # Already in crypto format
    if clean_id.endswith('-USD'):
        return clean_id
    
    # Known crypto symbols
    if clean_id in KNOWN_CRYPTO_SYMBOLS:
        return f"{clean_id}-USD"
    
    # Stock symbols (most common case)
    return clean_id

def fetch_price_simple(identifier: str) -> Dict[str, Any]:
    """
    Enhanced price fetching with EUR conversion for CSV import integration.
    Uses existing robust yfinance utilities to avoid session issues.
    Cost/Time: Fast execution with proper timeout handling, runs concurrently [[memory:6980966]]
    """
    try:
        logger.debug(f"Fetching price for {identifier}")
        
        # Use the existing robust yfinance data fetching that handles sessions properly
        from app.utils.yfinance_utils import get_isin_data
        
        # Get comprehensive price data using the existing robust function
        result = get_isin_data(identifier)
        
        if result.get('success'):
            return {
                'price': result.get('price'),
                'currency': result.get('currency', 'USD'),
                'price_eur': result.get('price_eur'),
                'country': result.get('country'),
                'success': True
            }
        else:
            # Fallback to simple yfinance call without custom session
            try:
                import yfinance as yf
                
                # Let yfinance handle its own session management
                ticker = yf.Ticker(identifier)
                price = None
                currency = 'USD'
                country = None
                
                try:
                    # Try info first for comprehensive data
                    info = ticker.info
                    
                    if info:
                        price = info.get('regularMarketPrice') or info.get('currentPrice')
                        currency = info.get('currency', 'USD') or 'USD'
                        country = info.get('country')
                        
                        if price and price > 0:
                            price = float(price)
                        else:
                            price = None
                except:
                    # Fallback to history if info fails
                    try:
                        hist = ticker.history(period="1d")
                        if not hist.empty:
                            price = float(hist['Close'].iloc[-1])
                            currency = 'USD'  # Default for history fallback
                    except:
                        pass
                
                # If we got a price, calculate EUR conversion
                if price is not None and price > 0:
                    try:
                        # Convert to EUR using existing exchange rate function
                        if currency != 'EUR':
                            exchange_rate = get_exchange_rate(currency, 'EUR')
                            price_eur = price * exchange_rate
                            logger.debug(f"Converted {price:.2f} {currency} to {price_eur:.2f} EUR (rate: {exchange_rate})")
                        else:
                            price_eur = price
                        
                        return {
                            'price': price,
                            'currency': currency,
                            'price_eur': price_eur,
                            'country': country,
                            'success': True
                        }
                    except Exception as e:
                        logger.warning(f"EUR conversion failed for {identifier}: {e}")
                        # Return without EUR conversion if it fails
                        return {
                            'price': price,
                            'currency': currency,
                            'price_eur': price,  # Fallback: use original price
                            'country': country,
                            'success': True
                        }
                
                # No price found in fallback
                return {
                    'price': None,
                    'currency': currency,
                    'price_eur': None,
                    'country': country,
                    'error': 'No valid price found',
                    'success': False
                }
                
            except Exception as fallback_error:
                logger.debug(f"Fallback price fetch failed for {identifier}: {fallback_error}")
                return {
                    'price': None,
                    'currency': 'USD',
                    'price_eur': None,
                    'country': None,
                    'error': f"Primary and fallback fetch failed: {result.get('error', 'Unknown')}",
                    'success': False
                }
            
    except Exception as e:
        logger.debug(f"Price fetch failed for {identifier}: {e}")
        return {
            'price': None,
            'currency': 'USD',
            'price_eur': None,
            'country': None,
            'error': str(e),
            'success': False
        }

def save_transaction_simple(account_id: int, transaction_data: Dict[str, Any]) -> bool:
    """
    Save transaction to database using the correct companies + company_shares structure.
    """
    try:
        from app.utils.db_utils import query_db, execute_db
        
        # Get default portfolio for this account
        portfolio = query_db(
            "SELECT id FROM portfolios WHERE account_id = ? AND name = '-'",
            (account_id,), one=True
        )
        
        if not portfolio:
            # Create default portfolio if it doesn't exist
            execute_db(
                "INSERT INTO portfolios (name, account_id) VALUES (?, ?)",
                ('-', account_id)
            )
            portfolio = query_db(
                "SELECT id FROM portfolios WHERE account_id = ? AND name = '-'",
                (account_id,), one=True
            )
        
        portfolio_id = portfolio['id']
        
        # Check if company already exists
        existing_company = query_db(
            "SELECT id, name FROM companies WHERE account_id = ? AND identifier = ?",
            (account_id, transaction_data['identifier']),
            one=True
        )
        
        if existing_company:
            company_id = existing_company['id']
            
            # Get existing shares
            existing_shares = query_db(
                "SELECT shares FROM company_shares WHERE company_id = ?",
                (company_id,), one=True
            )
            
            if existing_shares:
                # Update existing shares
                new_shares = existing_shares['shares'] + transaction_data['shares']
                execute_db(
                    "UPDATE company_shares SET shares = ? WHERE company_id = ?",
                    (new_shares, company_id)
                )
                logger.info(f"Updated shares for {transaction_data['identifier']}: {new_shares}")
            else:
                # Insert shares record
                execute_db(
                    "INSERT INTO company_shares (company_id, shares) VALUES (?, ?)",
                    (company_id, transaction_data['shares'])
                )
                logger.info(f"Added shares for existing company {transaction_data['identifier']}: {transaction_data['shares']}")
        else:
            # Insert new company
            execute_db(
                """INSERT INTO companies 
                   (name, identifier, category, portfolio_id, account_id, total_invested)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (transaction_data['name'], transaction_data['identifier'], '',
                 portfolio_id, account_id, transaction_data['shares'] * transaction_data['price'])
            )
            
            # Get the new company ID
            new_company = query_db(
                "SELECT id FROM companies WHERE account_id = ? AND identifier = ?",
                (account_id, transaction_data['identifier']),
                one=True
            )
            
            if new_company:
                # Insert shares record
                execute_db(
                    "INSERT INTO company_shares (company_id, shares) VALUES (?, ?)",
                    (new_company['id'], transaction_data['shares'])
                )
                logger.info(f"Added new position: {transaction_data['identifier']} - {transaction_data['shares']} shares")
        
        # Update market price using robust database function if we have current price data
        if transaction_data.get('current_price') and transaction_data.get('price_eur'):
            try:
                # Use the existing robust database update function
                update_price_in_db(
                    identifier=transaction_data['identifier'],
                    price=float(transaction_data['current_price']),
                    currency=transaction_data.get('currency', 'USD'),
                    price_eur=float(transaction_data['price_eur']),
                    country=transaction_data.get('country')
                )
                logger.debug(f"Updated market price for {transaction_data['identifier']}: {transaction_data['current_price']} {transaction_data.get('currency', 'USD')}")
            except Exception as e:
                logger.warning(f"Failed to update market price for {transaction_data['identifier']}: {e}")
        
        return True
        
    except Exception as e:
        logger.error(f"Failed to save transaction: {e}")
        return False

def update_simple_progress(current: int, total: int, message: str = "Processing..."):
    """Update progress in Flask session for simple upload."""
    from flask import session
    try:
        percentage = int((current / total) * 100) if total > 0 else 0
        session['simple_upload_progress'] = {
            'current': current,
            'total': total,
            'percentage': percentage,
            'message': message,
            'status': 'processing'
        }
        session.modified = True
        logger.info(f"Simple Progress: {percentage}% ({current}/{total}) - {message}")
    except Exception as e:
        logger.warning(f"Failed to update progress: {e}")

def import_csv_simple(account_id: int, file_content: str) -> Tuple[bool, str]:
    """
    Main CSV import function - simple, direct processing.
    Real-time progress tracking based on actual API calls.
    """
    from flask import session
    
    try:
        logger.info(f"Starting simple CSV import for account {account_id}")
        
        # Initialize progress
        session['simple_upload_progress'] = {
            'current': 0,
            'total': 0,
            'percentage': 0,
            'message': 'Starting import...',
            'status': 'processing'
        }
        session.modified = True
        
        # CRITICAL: Always backup before processing [[memory:7528819]]
        logger.info("Creating automatic backup before CSV processing...")
        backup_database()
        
        # Parse CSV with common delimiters
        try:
            df = pd.read_csv(
                io.StringIO(file_content),
                delimiter=';',
                decimal=',',
                thousands='.'
            )
        except:
            # Try comma delimiter as fallback
            df = pd.read_csv(io.StringIO(file_content))
        
        # Normalize column names
        df.columns = df.columns.str.lower().str.strip()
        
        # Validate required columns
        required_columns = ['identifier', 'holdingname', 'shares', 'price', 'type']
        missing_columns = [col for col in required_columns if col not in df.columns]
        
        if missing_columns:
            return False, f"Missing required columns: {missing_columns}"
        
        # Fill optional columns with defaults
        if 'currency' not in df.columns:
            df['currency'] = 'USD'
        if 'date' not in df.columns:
            df['date'] = pd.Timestamp.now()
        
        # Count valid transactions for accurate progress
        valid_transactions = []
        for idx, row in df.iterrows():
            try:
                # Skip dividend transactions
                if row.get('type', '').lower() in ['dividend', 'div']:
                    continue
                
                # Only process buy/transferin transactions
                if row.get('type', '').lower() not in ['buy', 'transferin', 'purchase']:
                    continue
                
                # Basic validation
                shares = float(row['shares'])
                if shares <= 0:
                    continue
                    
                valid_transactions.append(row)
            except:
                continue
        
        total_stocks = len(valid_transactions)
        processed = 0
        errors = []
        
        update_simple_progress(0, total_stocks, f"Starting concurrent processing of {total_stocks} positions...")
        logger.info(f"Processing {total_stocks} valid positions with concurrent price fetching...")
        
        # Process transactions concurrently for faster execution
        import concurrent.futures
        import threading
        from queue import Queue
        
        # Thread-safe counters and progress tracking
        progress_lock = threading.Lock()
        
        def process_transaction(row_data):
            """Process a single transaction with price fetching"""
            idx, row = row_data
            
            # CRITICAL: Create Flask application context for this thread
            with app.app_context():
                try:
                    # Basic data validation
                    shares = float(row['shares'])
                    price = float(row['price'])
                    
                    # Simple identifier normalization
                    identifier = normalize_simple(str(row['identifier']))
                    
                    # Fetch current price (this is the API call) [[memory:6980966]]
                    price_data = fetch_price_simple(identifier)
                    
                    # Prepare transaction data with enhanced price information
                    transaction = {
                        'identifier': identifier,
                        'name': str(row['holdingname']).strip(),
                        'shares': shares,
                        'price': price,
                        'current_price': price_data.get('price'),
                        'price_eur': price_data.get('price_eur'),
                        'currency': price_data.get('currency', row.get('currency', 'USD')),
                        'country': price_data.get('country')
                    }
                    
                    # Save to database (now with proper app context)
                    save_success = save_transaction_simple(account_id, transaction)
                    
                    return {
                        'success': save_success,
                        'identifier': identifier,
                        'price_data': price_data,
                        'idx': idx
                    }
                    
                except Exception as e:
                    return {
                        'success': False,
                        'identifier': row.get('identifier', f'row_{idx}'),
                        'error': str(e),
                        'idx': idx
                    }
        
        # Get current Flask app for thread context
        from flask import current_app
        app = current_app._get_current_object()
        
        # Use ThreadPoolExecutor for concurrent processing
        # Limit to 5 concurrent threads to avoid overwhelming yfinance API
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            # Submit all tasks
            future_to_row = {executor.submit(process_transaction, (idx, row)): idx 
                           for idx, row in enumerate(valid_transactions)}
            
            # Process results as they complete
            for future in concurrent.futures.as_completed(future_to_row):
                result = future.result()
                
                with progress_lock:
                    processed += 1
                    
                    if result['success']:
                        success_msg = f"✓ {result['identifier']}"
                        price_data = result.get('price_data', {})
                        if price_data.get('success') and price_data.get('price'):
                            price = price_data['price']
                            currency = price_data.get('currency', 'USD')
                            success_msg += f" (price: {price:.2f} {currency})"
                        elif price_data.get('error'):
                            success_msg += f" (price: {price_data['error']})"
                        update_simple_progress(processed, total_stocks, success_msg)
                    else:
                        if 'error' in result:
                            error_msg = f"Position {result['idx'] + 1}: {result['error']}"
                            errors.append(error_msg)
                            logger.warning(error_msg)
                            update_simple_progress(processed, total_stocks, f"✗ {result['identifier']} (error)")
                        else:
                            update_simple_progress(processed, total_stocks, f"✗ {result['identifier']} (save failed)")
                
                logger.debug(f"Completed {processed}/{total_stocks} transactions")
        
        # Mark progress as completed
        update_simple_progress(total_stocks, total_stocks, "Import completed successfully!")
        
        # Clear progress after completion
        session['simple_upload_progress'] = {
            'current': total_stocks,
            'total': total_stocks,
            'percentage': 100,
            'message': 'Import completed successfully!',
            'status': 'completed'
        }
        session.modified = True
        
        # Prepare result message
        if processed == 0:
            return False, "No valid transactions found to import"
        
        message = f"Successfully imported {processed}/{total_stocks} transactions"
        if errors:
            message += f" ({len(errors)} errors)"
            if len(errors) <= 5:  # Show first 5 errors
                message += f": {'; '.join(errors[:5])}"
        
        logger.info(f"CSV import completed: {message}")
        return True, message
        
    except Exception as e:
        error_msg = f"CSV import failed: {str(e)}"
        logger.error(error_msg)
        return False, error_msg

def validate_csv_format(file_content: str) -> Tuple[bool, str]:
    """
    Quick validation of CSV format before processing.
    """
    try:
        if not file_content.strip():
            return False, "CSV file is empty"
        
        # Try parsing first few lines
        lines = file_content.split('\n')[:5]
        if len(lines) < 2:
            return False, "CSV must have at least header and one data row"
        
        # Check for common delimiters
        header = lines[0].lower()
        has_semicolon = ';' in header
        has_comma = ',' in header
        
        if not (has_semicolon or has_comma):
            return False, "CSV must use semicolon (;) or comma (,) as delimiter"
        
        # Check for required column names
        required = ['identifier', 'holdingname', 'shares', 'price', 'type']
        header_words = header.replace(';', ',').split(',')
        
        missing = []
        for req in required:
            if not any(req in word for word in header_words):
                missing.append(req)
        
        if missing:
            return False, f"Missing required columns: {missing}"
        
        return True, "CSV format is valid"
        
    except Exception as e:
        return False, f"CSV validation error: {str(e)}"
