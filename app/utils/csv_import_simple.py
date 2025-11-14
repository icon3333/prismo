"""
Simplified CSV Import System
No background threads, no complex progress tracking, no session juggling.
Just direct, straightforward CSV processing with automatic backups.
"""

import logging
import io
from typing import Dict, Any, Tuple, Optional
from app.db_manager import query_db, execute_db, backup_database, get_db
from app.utils.yfinance_utils import get_exchange_rate
from app.utils.db_utils import update_price_in_db

# OPTIMIZATION: Lazy import pandas and yfinance to speed up application startup
# These are only needed during actual CSV processing (rare operation)
# Saves ~190ms of startup time by not loading these heavy libraries

logger = logging.getLogger(__name__)

# Hardcoded crypto symbols removed - now using 5-rule system for better scalability

def normalize_simple(identifier: str) -> str:
    """
    Rule-based identifier normalization using 5-rule system.
    No hardcoded symbols - uses same logic as main normalization module.
    """
    if not identifier or not identifier.strip():
        return identifier
    
    clean_id = identifier.strip().upper()

    # Strategy 1: No format guessing during normalization
    # The cascade logic in fetch_price_with_crypto_fallback() tries both
    # formats automatically at fetch time
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

def consolidate_transactions_by_identifier(transactions_df) -> Dict[str, Dict[str, Any]]:
    """
    Consolidate transactions by identifier, handling Buy/TransferIn vs Sell/TransferOut.
    Calculate net positions and weighted average prices using amount summation approach.
    Cost/Time: O(n) processing with efficient grouping, avoids exchange rate API calls [[memory:6980966]]

    Args:
        transactions_df: pandas DataFrame with transaction data
    """
    # Lazy import pandas - only loaded during CSV processing
    import pandas as pd

    consolidated = {}

    for idx, row in transactions_df.iterrows():
        try:
            # Check for NaN identifier first - this prevents 'nan' from appearing in the portfolio
            if pd.isna(row['identifier']) or not str(row['identifier']).strip():
                logger.warning(f"Skipping transaction {idx}: missing or empty identifier")
                continue
                
            identifier = normalize_simple(str(row['identifier']))
            transaction_type = str(row['type']).lower()
            shares = float(row['shares'])
            price = float(row['price'])
            # Use amount column if available, otherwise calculate from shares * price
            amount = float(row.get('amount', shares * price))
            
            # Skip zero or negative shares
            if shares <= 0:
                continue
            
            # Determine if this is additive or subtractive
            is_additive = transaction_type in ['buy', 'transferin']
            is_subtractive = transaction_type in ['sell', 'transferout']
            
            if not (is_additive or is_subtractive):
                continue  # Skip unknown transaction types
            
            if identifier not in consolidated:
                consolidated[identifier] = {
                    'identifier': identifier,
                    'name': str(row['holdingname']).strip(),
                    'buy_shares': 0.0,
                    'buy_amount': 0.0,
                    'sell_shares': 0.0,
                    'sell_amount': 0.0,
                    'currency': row.get('currency', 'EUR')
                }
            
            position = consolidated[identifier]
            
            if is_additive:
                position['buy_shares'] += shares
                position['buy_amount'] += amount
            elif is_subtractive:
                position['sell_shares'] += shares
                position['sell_amount'] += amount
            
        except Exception as e:
            logger.warning(f"Failed to process transaction {idx}: {e}")
            continue
    
    # Calculate final consolidated positions
    final_positions = {}
    for identifier, position in consolidated.items():
        net_shares = position['buy_shares'] - position['sell_shares']
        net_amount = position['buy_amount'] - position['sell_amount']
        
        # Only keep positions with positive net shares
        if net_shares > 0:
            # Calculate weighted average price for remaining position
            if position['buy_shares'] > 0:
                weighted_avg_price = position['buy_amount'] / position['buy_shares']
            else:
                weighted_avg_price = 0.0
            
            final_positions[identifier] = {
                'identifier': identifier,
                'name': position['name'],
                'net_shares': net_shares,
                'total_amount': net_amount,
                'weighted_avg_price': weighted_avg_price,
                'currency': position['currency']
            }
            
            logger.info(f"Consolidated {identifier}: {net_shares:.6f} shares, €{net_amount:.2f} total, €{weighted_avg_price:.6f} avg price")
    
    return final_positions

def save_consolidated_position(account_id: int, position_data: Dict[str, Any]) -> bool:
    """
    Save consolidated position data to database.
    Position data contains final net shares, total amount, and weighted average price.
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
            (account_id, position_data['identifier']),
            one=True
        )
        
        if existing_company:
            company_id = existing_company['id']
            
            # Get existing override status to preserve user manual edits
            existing_shares_data = query_db(
                "SELECT shares, override_share FROM company_shares WHERE company_id = ?",
                (company_id,), one=True
            )
            
            if existing_shares_data:
                preserve_override = existing_shares_data.get('override_share', False)
                
                if preserve_override:
                    # User has manually edited - preserve their override, don't update shares
                    logger.info(f"Preserving user manual override for {position_data['identifier']} - shares not updated from CSV")
                else:
                    # Update with consolidated position
                    execute_db(
                        "UPDATE company_shares SET shares = ? WHERE company_id = ?",
                        (position_data['net_shares'], company_id)
                    )
                    # Update total_invested with total amount
                    execute_db(
                        "UPDATE companies SET total_invested = ? WHERE id = ?",
                        (position_data['total_amount'], company_id)
                    )
                    logger.info(f"Updated consolidated position for {position_data['identifier']}: {position_data['net_shares']:.6f} shares, €{position_data['total_amount']:.2f} total, €{position_data['weighted_avg_price']:.6f} avg price")
            else:
                # Insert shares record for existing company
                execute_db(
                    "INSERT INTO company_shares (company_id, shares) VALUES (?, ?)",
                    (company_id, position_data['net_shares'])
                )
                execute_db(
                    "UPDATE companies SET total_invested = ? WHERE id = ?",
                    (position_data['total_amount'], company_id)
                )
                logger.info(f"Added consolidated shares for existing company {position_data['identifier']}: {position_data['net_shares']:.6f} shares")
        else:
            # Insert new company
            execute_db(
                """INSERT INTO companies 
                   (name, identifier, category, portfolio_id, account_id, total_invested)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (position_data['name'], position_data['identifier'], '',
                 portfolio_id, account_id, position_data['total_amount'])
            )
            
            # Get the new company ID
            new_company = query_db(
                "SELECT id FROM companies WHERE account_id = ? AND identifier = ?",
                (account_id, position_data['identifier']),
                one=True
            )
            
            if new_company:
                # Insert shares record
                execute_db(
                    "INSERT INTO company_shares (company_id, shares) VALUES (?, ?)",
                    (new_company['id'], position_data['net_shares'])
                )
                logger.info(f"Added new consolidated position: {position_data['identifier']} - {position_data['net_shares']:.6f} shares, €{position_data['total_amount']:.2f} total")
        
        # Update market price using robust database function if we have current price data
        if position_data.get('current_price') and position_data.get('price_eur'):
            try:
                # Use the existing robust database update function
                update_price_in_db(
                    identifier=position_data['identifier'],
                    price=float(position_data['current_price']),
                    currency=position_data.get('currency', 'USD'),
                    price_eur=float(position_data['price_eur']),
                    country=position_data.get('country')
                )
                logger.debug(f"Updated market price for {position_data['identifier']}: {position_data['current_price']} {position_data.get('currency', 'USD')}")
            except Exception as e:
                logger.warning(f"Failed to update market price for {position_data['identifier']}: {e}")
        
        return True
        
    except Exception as e:
        logger.error(f"Failed to save consolidated position: {e}")
        return False

def save_transaction_simple(account_id: int, transaction_data: Dict[str, Any]) -> bool:
    """
    Save transaction using REPLACE semantics (not additive).
    CSV represents current portfolio state, not new transactions to add.
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
            
            # Get existing override status to preserve user manual edits
            existing_shares_data = query_db(
                "SELECT shares, override_share FROM company_shares WHERE company_id = ?",
                (company_id,), one=True
            )
            
            if existing_shares_data:
                preserve_override = existing_shares_data.get('override_share', False)
                
                if preserve_override:
                    # User has manually edited - preserve their override, don't update shares
                    logger.info(f"Preserving user manual override for {transaction_data['identifier']} - shares not updated from CSV")
                else:
                    # Normal case: REPLACE with CSV value (not add)
                    new_shares = transaction_data['shares']  # Direct replacement
                    execute_db(
                        "UPDATE company_shares SET shares = ? WHERE company_id = ?",
                        (new_shares, company_id)
                    )
                    logger.info(f"Replaced shares for {transaction_data['identifier']}: {new_shares} (was {existing_shares_data['shares']})")
            else:
                # Insert shares record for existing company
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
    """Update progress - works with both session and background processing."""
    try:
        # Try to use the global update_csv_progress function if it exists (background mode)
        if 'update_csv_progress' in globals():
            globals()['update_csv_progress'](current, total, message, "processing")
        else:
            # Fall back to session-based progress (original mode, only if in request context)
            try:
                from flask import session
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
            except RuntimeError:
                # Working outside of request context (background thread) - just log
                percentage = int((current / total) * 100) if total > 0 else 0
                logger.info(f"Simple Progress: {percentage}% ({current}/{total}) - {message}")
    except Exception as e:
        logger.warning(f"Failed to update progress: {e}")

def import_csv_simple(account_id: int, file_content: str) -> Tuple[bool, str]:
    """
    Main CSV import function - portfolio replacement with transaction consolidation.
    CSV transactions are consolidated by identifier, handling Buy/TransferIn vs Sell/TransferOut properly.
    Calculates weighted average prices and net positions using amount summation approach.
    Avoids exchange rate discrepancies by using pre-converted amounts from CSV.
    """
    # Lazy import pandas - only loaded during CSV processing (rare operation)
    import pandas as pd

    try:
        logger.info(f"Starting CSV portfolio replacement for account {account_id}")
        
        # Initialize progress (only if in request context)
        try:
            from flask import session
            session['simple_upload_progress'] = {
                'current': 0,
                'total': 0,
                'percentage': 0,
                'message': 'Starting portfolio replacement...',
                'status': 'processing'
            }
            session.modified = True
        except RuntimeError:
            # Working outside of request context (background thread) - skip session updates
            logger.debug("Working outside request context - skipping session updates")
        
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
            df['currency'] = 'EUR'  # Default to EUR since amounts are typically pre-converted
        if 'date' not in df.columns:
            df['date'] = pd.Timestamp.now()
        if 'amount' not in df.columns:
            # Calculate amount from shares * price if not provided
            df['amount'] = df['shares'] * df['price']
        
        # Filter and validate transactions - now including Sell and TransferOut
        valid_transactions = []
        for idx, row in df.iterrows():
            try:
                # Process Buy, Sell, TransferIn, TransferOut transactions
                transaction_type = str(row.get('type', '')).lower()
                if transaction_type not in ['buy', 'sell', 'transferin', 'transferout']:
                    continue
                
                # Basic validation
                shares = float(row['shares'])
                if shares <= 0:
                    continue
                    
                valid_transactions.append(row)
            except:
                continue
        
        if not valid_transactions:
            return False, "No valid transactions found in CSV"
        
        # Convert to DataFrame for easier processing
        transactions_df = pd.DataFrame(valid_transactions)
        
        # CRITICAL: Consolidate transactions by identifier with weighted price calculation [[memory:6980966]]
        logger.info("Consolidating transactions by identifier with amount summation approach...")
        consolidated_positions = consolidate_transactions_by_identifier(transactions_df)
        
        if not consolidated_positions:
            return False, "No net positive positions after consolidation"
        
        total_stocks = len(consolidated_positions)
        processed = 0
        errors = []
        
        # Get current portfolio state for cleanup later
        current_positions = get_current_portfolio_positions(account_id)
        csv_identifiers = set(consolidated_positions.keys())
        
        # Calculate total operations for progress tracking (positions + cleanup)
        positions_to_remove = current_positions - csv_identifiers
        total_operations = total_stocks + len(positions_to_remove)
        
        update_simple_progress(0, total_operations, f"Starting portfolio replacement: {total_stocks} consolidated positions to process, {len(positions_to_remove)} to remove...")
        logger.info(f"Portfolio replacement: {total_stocks} consolidated positions to process, {len(positions_to_remove)} existing positions to remove")
        
        # Start database transaction for atomic operations
        db = get_db()
        
        # Process transactions concurrently for faster execution
        import concurrent.futures
        import threading
        from queue import Queue
        
        # Thread-safe counters and progress tracking
        progress_lock = threading.Lock()
        
        def fetch_price_for_position(position_data):
            """Fetch price for a single position (thread-safe, no database writes)"""
            identifier = position_data['identifier']

            # CRITICAL: Create Flask application context for this thread
            with app.app_context():
                try:
                    # Fetch current price (this is the API call - I/O bound, safe to parallelize)
                    price_data = fetch_price_simple(identifier)

                    # Enhance position data with current market price information
                    enhanced_position = {
                        **position_data,
                        'current_price': price_data.get('price'),
                        'price_eur': price_data.get('price_eur'),
                        'currency': price_data.get('currency', position_data.get('currency', 'EUR')),
                        'country': price_data.get('country')
                    }

                    return {
                        'success': True,
                        'identifier': identifier,
                        'price_data': price_data,
                        'position': enhanced_position
                    }

                except Exception as e:
                    logger.error(f"Failed to fetch price for {identifier}: {e}")
                    return {
                        'success': False,
                        'identifier': identifier,
                        'error': str(e),
                        'position': position_data  # Return original data without price
                    }
        
        # Get current Flask app for thread context
        from flask import current_app
        app = current_app._get_current_object()
        
        # PHASE 1: Fetch prices concurrently (I/O bound, safe to parallelize)
        # PHASE 2: Save to database sequentially (avoids race conditions)
        enhanced_positions = []  # Collect positions with prices

        try:
            # Use ThreadPoolExecutor for concurrent price fetching only
            # Limit to 10 concurrent threads (increased from 5 for better throughput)
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                # Submit all positions for price fetching
                future_to_position = {executor.submit(fetch_price_for_position, position): position['identifier']
                                   for position in consolidated_positions.values()}

                # Collect results as they complete (price fetching only)
                for future in concurrent.futures.as_completed(future_to_position):
                    result = future.result()

                    with progress_lock:
                        processed += 1

                        if result['success']:
                            position = result['position']
                            enhanced_positions.append(position)  # Store for later database save

                            success_msg = f"✓ Fetched price for {result['identifier']} ({position['net_shares']:.2f} shares)"
                            price_data = result.get('price_data', {})
                            if price_data.get('success') and price_data.get('price'):
                                price = price_data['price']
                                currency = price_data.get('currency', 'USD')
                                success_msg += f" [market: {price:.2f} {currency}]"
                            elif price_data.get('error'):
                                success_msg += f" [market: {price_data['error']}]"
                            update_simple_progress(processed, total_operations, success_msg)
                        else:
                            # Even if price fetch failed, add position without price
                            enhanced_positions.append(result['position'])

                            if 'error' in result:
                                error_msg = f"Price fetch for {result['identifier']}: {result['error']}"
                                logger.warning(error_msg)
                                update_simple_progress(processed, total_operations, f"⚠ {result['identifier']} (no price)")
                            else:
                                update_simple_progress(processed, total_operations, f"⚠ {result['identifier']} (no price)")

                    logger.debug(f"Fetched prices for {processed}/{total_stocks} positions")

            # PHASE 2: Save all positions to database sequentially (thread-safe)
            logger.info(f"All prices fetched. Starting sequential database writes for {len(enhanced_positions)} positions...")
            db = get_db()

            # Start atomic transaction for database writes
            db_save_count = 0
            for enhanced_position in enhanced_positions:
                try:
                    save_success = save_consolidated_position(account_id, enhanced_position)
                    if save_success:
                        db_save_count += 1
                    else:
                        error_msg = f"Failed to save position {enhanced_position['identifier']} to database"
                        errors.append(error_msg)
                        logger.error(error_msg)
                except Exception as save_error:
                    error_msg = f"Database save error for {enhanced_position['identifier']}: {save_error}"
                    errors.append(error_msg)
                    logger.error(error_msg)

            logger.info(f"Database writes completed: {db_save_count}/{len(enhanced_positions)} positions saved")
            
            # Step 2: Clean up positions not in CSV (portfolio replacement behavior)
            removed_count = 0
            for identifier in positions_to_remove:
                if remove_position_completely(account_id, identifier):
                    removed_count += 1
                    with progress_lock:
                        processed += 1
                        update_simple_progress(processed, total_operations, f"Removed position: {identifier}")
                else:
                    with progress_lock:
                        processed += 1
                        update_simple_progress(processed, total_operations, f"Failed to remove: {identifier}")
            
            # Commit the transaction
            db.commit()
            logger.info(f"Portfolio replacement completed successfully - {removed_count} positions removed")
        
            # Mark progress as completed
            update_simple_progress(total_operations, total_operations, f"Portfolio replacement completed! Removed {removed_count} old positions.")
            
        except Exception as e:
            # Rollback on any error
            db.rollback()
            logger.error(f"Portfolio replacement failed, rolled back: {e}")
            raise
        
        # Clear progress after completion (only if in request context)
        try:
            from flask import session
            session['simple_upload_progress'] = {
                'current': total_operations,
                'total': total_operations,
                'percentage': 100,
                'message': f'Portfolio replacement completed! Removed {removed_count} old positions.',
                'status': 'completed'
            }
            session.modified = True
        except RuntimeError:
            # Working outside of request context (background thread) - skip session updates
            logger.debug("Working outside request context - skipping final session update")
        
        # Prepare result message
        if total_stocks == 0:
            return False, "No valid positions found in CSV to import"
        
        successful_imports = processed - removed_count
        message = f"Portfolio replacement completed: {successful_imports}/{total_stocks} consolidated positions processed"
        if removed_count > 0:
            message += f", {removed_count} old positions removed"
        if errors:
            message += f" ({len(errors)} errors)"
            if len(errors) <= 5:  # Show first 5 errors
                message += f": {'; '.join(errors[:5])}"
        
        logger.info(f"Portfolio replacement completed: {message}")
        return True, message
        
    except Exception as e:
        error_msg = f"CSV import failed: {str(e)}"
        logger.error(error_msg)
        return False, error_msg

def get_current_portfolio_positions(account_id: int) -> set:
    """Get all current position identifiers for the account."""
    try:
        from app.utils.db_utils import query_db
        
        positions = query_db(
            """SELECT DISTINCT c.identifier 
               FROM companies c 
               JOIN company_shares cs ON c.id = cs.company_id 
               WHERE c.account_id = ? AND cs.shares > 0""",
            (account_id,)
        )
        
        return {pos['identifier'] for pos in positions if pos['identifier']}
    except Exception as e:
        logger.error(f"Failed to get current portfolio positions: {e}")
        return set()

def remove_position_completely(account_id: int, identifier: str) -> bool:
    """Remove a position completely from the portfolio."""
    try:
        from app.utils.db_utils import query_db, execute_db
        
        # Find the company
        company = query_db(
            "SELECT id FROM companies WHERE account_id = ? AND identifier = ?",
            (account_id, identifier), one=True
        )
        
        if not company:
            return True  # Already removed
        
        company_id = company['id']
        
        # Check if user has manual override - preserve if they do
        shares_data = query_db(
            "SELECT override_share FROM company_shares WHERE company_id = ?",
            (company_id,), one=True
        )
        
        if shares_data and shares_data.get('override_share', False):
            logger.info(f"Preserving position {identifier} - user has manual override")
            return True  # Don't remove user overrides
        
        # Remove shares first
        execute_db("DELETE FROM company_shares WHERE company_id = ?", (company_id,))
        
        # Remove company
        execute_db("DELETE FROM companies WHERE id = ?", (company_id,))
        
        # Clean up market prices if no other accounts use this identifier
        other_companies = query_db(
            "SELECT COUNT(*) as count FROM companies WHERE identifier = ? AND account_id != ?",
            (identifier, account_id), one=True
        )
        
        if other_companies and other_companies['count'] == 0:
            execute_db("DELETE FROM market_prices WHERE identifier = ?", (identifier,))
            logger.info(f"Removed market price data for {identifier} (no other accounts use it)")
        
        logger.info(f"Removed position: {identifier}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to remove position {identifier}: {e}")
        return False

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
