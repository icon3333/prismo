import pandas as pd
import logging
import io
from flask import session
from app.database.db_manager import query_db, execute_db, backup_database, get_db
from app.utils.db_utils import update_price_in_db
from app.utils.yfinance_utils import get_isin_data
from app.utils.data_processing import clear_data_caches
from app.utils.identifier_normalization import normalize_identifier
from app.utils.identifier_mapping import get_preferred_identifier

logger = logging.getLogger(__name__)


def update_csv_progress(current, total, message="Processing...", status="processing"):
    """Update CSV upload progress in session with improved persistence"""
    import time
    percentage = int((current / total) * 100) if total > 0 else 0
    
    # Add timestamp for better tracking
    progress_data = {
        'current': current,
        'total': total,
        'percentage': percentage,
        'status': status,
        'message': message,
        'timestamp': time.time(),
        'updated_at': time.strftime('%Y-%m-%d %H:%M:%S')
    }
    
    try:
        session['csv_upload_progress'] = progress_data
        session.modified = True
        
        # Force session to be saved immediately
        session.permanent = True
        
        # Log progress for debugging
        logger.info(f"CSV Progress: {percentage}% - {message} (Status: {status})")
        
    except Exception as e:
        logger.error(f"Failed to update CSV progress: {e}")
        # Continue processing even if progress update fails


def process_csv_data(account_id, file_content):
    """Process and import CSV data into the database using simple +/- approach"""
    db = None
    cursor = None
    try:
        # Initialize progress tracking
        update_csv_progress(0, 100, "Starting CSV processing...", "processing")
        
        # Add a small delay to ensure session is updated
        import time
        time.sleep(0.2)
        
        db = get_db()
        cursor = db.cursor()
        
        # CRITICAL: Always create backup before processing [[memory:7528819]]
        logger.info("Creating automatic backup before CSV processing...")
        backup_database()
        update_csv_progress(5, 100, "Backup created, processing CSV...", "processing")
        time.sleep(0.1)
        
        update_csv_progress(10, 100, "Reading CSV file...", "processing")
        
        # Add small delay to ensure progress is captured
        time.sleep(0.2)

        df = pd.read_csv(io.StringIO(file_content),
                         delimiter=';',
                         decimal=',',
                         thousands='.')
        df.columns = df.columns.str.lower()
        
        update_csv_progress(20, 100, "Validating CSV columns...", "processing")
        time.sleep(0.2)

        essential_columns = {
            "identifier": ["identifier", "isin", "symbol"],
            "holdingname": ["holdingname", "name", "securityname"],
            "shares": ["shares", "quantity", "units"],
            "price": ["price", "unitprice", "priceperunit"],
            "type": ["type", "transactiontype"],
        }
        optional_columns = {
            "broker": ["broker", "brokername"],
            "assettype": ["assettype", "securitytype"],
            "wkn": ["wkn"],
            "currency": ["currency"],
        
            "date": ["date", "transactiondate", "datetime"],
            "fee": ["fee", "commission", "costs"],
            "tax": ["tax", "taxes"],
        }

        column_mapping = {}
        missing_columns = []
        for required_col, alternatives in essential_columns.items():
            found = False
            for alt in alternatives:
                if any(col for col in df.columns if alt in col):
                    matching_col = next(
                        col for col in df.columns if alt in col)
                    column_mapping[required_col] = matching_col
                    found = True
                    break
            if not found:
                missing_columns.append(required_col)
        if missing_columns:
            logger.warning(f"Missing essential columns: {missing_columns}")
            error_msg = f"Missing required columns: {', '.join(missing_columns)}"
            update_csv_progress(0, 100, error_msg, "failed")
            time.sleep(0.2)  # Ensure error status is captured
            return False, error_msg, {}

        for opt_col, alternatives in optional_columns.items():
            for alt in alternatives:
                matching_cols = [col for col in df.columns if alt in col]
                if matching_cols and opt_col not in column_mapping:
                    column_mapping[opt_col] = matching_cols[0]
                    break

        df = df.rename(columns=column_mapping)
        
        update_csv_progress(30, 100, "Preparing data...", "processing")
        time.sleep(0.2)

        if 'currency' not in df.columns:
            df['currency'] = 'EUR'
        if 'fee' not in df.columns:
            df['fee'] = 0
        if 'tax' not in df.columns:
            df['tax'] = 0
        if 'date' not in df.columns:
            df['date'] = pd.Timestamp.now()

        df['identifier'] = df['identifier'].apply(
            lambda x: str(x).strip() if pd.notna(x) else '')
        df['holdingname'] = df['holdingname'].apply(
            lambda x: str(x).strip() if pd.notna(x) else '')

        def normalize_transaction_type(t):
            if pd.isna(t):
                return 'buy'
            t = str(t).strip().lower()
            if t in ['buy', 'purchase', 'bought', 'acquire', 'deposit']:
                return 'buy'
            elif t in ['sell', 'sold', 'dispose', 'withdrawal']:
                return 'sell'
            elif t in ['transferin', 'transfer in', 'transfer-in', 'move in', 'movein', 'deposit']:
                return 'transferin'
            elif t in ['transferout', 'transfer out', 'transfer-out', 'move out', 'moveout', 'withdrawal']:
                return 'transferout'
            elif t in ['dividend', 'div', 'dividends', 'income', 'interest']:
                return 'dividend'
            else:
                logger.warning(
                    f"Unknown transaction type '{t}', defaulting to 'buy'")
                return 'buy'

        df['type'] = df['type'].apply(normalize_transaction_type)

        df = df[df['identifier'].str.len() > 0]
        if len(df) == 0:
            return False, "No valid entries found in CSV file", {}

        def convert_numeric(val):
            if pd.isna(val):
                return 0
            if isinstance(val, (int, float)):
                return float(val)
            try:
                val_str = str(val).strip().replace(',', '.')
                return float(val_str)
            except (ValueError, TypeError):
                return 0

        df['shares'] = df['shares'].apply(convert_numeric)
        df['price'] = df['price'].apply(convert_numeric)
        df['fee'] = df['fee'].apply(convert_numeric)
        df['tax'] = df['tax'].apply(convert_numeric)

        df = df.dropna(subset=['shares', 'price'])
        if df.empty:
            return False, "No valid entries found in CSV file after converting numeric values", {}

        try:
            if 'datetime' in df.columns:
                df['parsed_date'] = pd.to_datetime(
                    df['datetime'], errors='coerce')
                mask = df['parsed_date'].isna()
                if mask.any():
                    df.loc[mask, 'parsed_date'] = pd.to_datetime(
                        df.loc[mask, 'date'], format='%d.%m.%Y', errors='coerce')
                    still_mask = df['parsed_date'].isna()
                    if still_mask.any():
                        df.loc[still_mask, 'parsed_date'] = pd.to_datetime(
                            df.loc[still_mask, 'date'], dayfirst=True, errors='coerce')
            else:
                df['parsed_date'] = pd.to_datetime(
                    df['date'], format='%d.%m.%Y', errors='coerce')
                mask = df['parsed_date'].isna()
                if mask.any():
                    df.loc[mask, 'parsed_date'] = pd.to_datetime(
                        df.loc[mask, 'date'], dayfirst=True, errors='coerce')
        except Exception as e:
            logger.warning(
                f"Error during date parsing: {str(e)}. Falling back to default parsing.")
            df['parsed_date'] = pd.to_datetime(
                df['date'], dayfirst=True, errors='coerce')

        nat_count = df['parsed_date'].isna().sum()
        if nat_count > 0:
            logger.warning(
                f"{nat_count} dates could not be parsed and will be set to current time")
        df['parsed_date'] = df['parsed_date'].fillna(pd.Timestamp.now())

        df = df.sort_values('parsed_date', ascending=True)

        logger.info("Transaction order after sorting:")
        for idx, row in df.iterrows():
            logger.info(
                f"Processing order: {row['parsed_date']} - {row['type']} - {row['holdingname']} - {row['shares']} shares")

        company_positions = {}

        update_csv_progress(40, 100, "Processing buy transactions...", "processing")
        time.sleep(0.1)
        
        logger.info("FIRST PASS: Processing buy and transferin transactions")
        for idx, row in df.iterrows():
            company_name = row['holdingname']
            transaction_type = row['type']
            if transaction_type == 'dividend':
                logger.info(
                    f"Skipping dividend transaction for {company_name}")
                continue
            if transaction_type not in ['buy', 'transferin']:
                continue
            shares = round(float(row['shares']), 6)
            price = float(row['price'])
            raw_identifier = row['identifier']
            
            # NEW: Check for user's preferred identifier mapping first
            preferred_identifier = get_preferred_identifier(account_id, raw_identifier)
            if preferred_identifier:
                identifier = preferred_identifier
                logger.info(f"Using mapped identifier for {company_name}: '{raw_identifier}' -> '{identifier}'")
            else:
                # Fall back to standard normalization
                identifier = normalize_identifier(raw_identifier)
                if raw_identifier != identifier:
                    logger.info(f"Normalized identifier for {company_name}: '{raw_identifier}' -> '{identifier}'")
            fee = float(row['fee']) if 'fee' in row else 0
            tax = float(row['tax']) if 'tax' in row else 0
            if shares <= 0:
                logger.info(
                    f"Skipping {transaction_type} transaction with zero shares for {company_name}")
                continue
            if company_name not in company_positions:
                company_positions[company_name] = {
                    'identifier': identifier,
                    'total_shares': 0,
                    'total_invested': 0,
                }
            company = company_positions[company_name]
            transaction_amount = shares * price
            company['total_shares'] = round(
                company['total_shares'] + shares, 6)
            company['total_invested'] = round(
                company['total_invested'] + transaction_amount, 2)
            logger.info(
                f"Buy/TransferIn: {company_name}, +{shares} @ {price}, total shares: {company['total_shares']}, total invested: {company['total_invested']:.2f}")

        update_csv_progress(50, 100, "Processing sell transactions...", "processing")
        time.sleep(0.1)
        
        logger.info("SECOND PASS: Processing sell and transferout transactions")
        for idx, row in df.iterrows():
            company_name = row['holdingname']
            transaction_type = row['type']
            if transaction_type == 'dividend':
                logger.info(
                    f"Skipping dividend transaction for {company_name}")
                continue
            if transaction_type not in ['sell', 'transferout']:
                continue
            shares = round(float(row['shares']), 6)
            price = float(row['price'])
            fee = float(row['fee']) if 'fee' in row else 0
            tax = float(row['tax']) if 'tax' in row else 0
            if shares <= 0:
                logger.info(
                    f"Skipping {transaction_type} transaction with zero shares for {company_name}")
                continue
            if company_name not in company_positions:
                logger.warning(
                    f"Cannot {transaction_type} shares of {company_name} - company not in positions")
                continue
            company = company_positions[company_name]
            logger.info(
                f"Processing {transaction_type} of {shares} shares for {company_name} (current total: {company['total_shares']}")
            if shares > (company['total_shares'] + 1e-6):
                logger.warning(
                    f"Attempting to {transaction_type} more shares ({shares}) than available ({company['total_shares']}). Limiting to available shares.")
                shares = company['total_shares']
            if shares <= 0:
                logger.info(
                    f"Skipping {transaction_type} with zero or negative shares")
                continue
            proportion_sold = shares / \
                company['total_shares'] if company['total_shares'] > 0 else 0
            investment_reduction = company['total_invested'] * proportion_sold
            company['total_shares'] = round(
                company['total_shares'] - shares, 6)
            company['total_invested'] = round(
                company['total_invested'] - investment_reduction, 2)

        existing_companies = query_db(
            'SELECT id, name, identifier, total_invested, portfolio_id FROM companies WHERE account_id = ?',
            [account_id]
        )
        existing_company_map = {c['name']: c for c in existing_companies}

        # Get existing override shares to preserve them
        existing_overrides = query_db(
            'SELECT cs.company_id, cs.override_share FROM company_shares cs JOIN companies c ON cs.company_id = c.id WHERE c.account_id = ?',
            [account_id]
        )
        override_map = {row['company_id']: row['override_share'] for row in existing_overrides if row['override_share'] is not None}

        # Get existing user edit data to handle transactions after manual edits
        user_edit_data = query_db('''
            SELECT cs.company_id, cs.shares, cs.override_share, cs.manual_edit_date, cs.is_manually_edited, cs.csv_modified_after_edit, c.name
            FROM company_shares cs 
            JOIN companies c ON cs.company_id = c.id 
            WHERE c.account_id = ? AND cs.is_manually_edited = 1
        ''', [account_id])
        
        user_edit_map = {}
        for row in user_edit_data:
            user_edit_map[row['name']] = {
                'company_id': row['company_id'],
                'original_shares': row['shares'],  # Original CSV shares
                'manual_shares': row['override_share'],  # User-edited shares
                'manual_edit_date': row['manual_edit_date'],
                'csv_modified_after_edit': row['csv_modified_after_edit']
            }

        default_portfolio = query_db(
            'SELECT id FROM portfolios WHERE account_id = ? AND name = "-"',
            [account_id],
            one=True,
        )
        if not default_portfolio:
            cursor.execute(
                'INSERT INTO portfolios (name, account_id) VALUES (?, ?)',
                ['-', account_id],
            )
            default_portfolio_id = cursor.lastrowid
        else:
            default_portfolio_id = default_portfolio['id']

        positions_added = []
        positions_updated = []
        positions_removed = []
        failed_prices = []

        csv_company_names = set(df['holdingname'])
        
        update_csv_progress(60, 100, "Updating database...", "processing")
        time.sleep(0.2)
        
        # Track companies that should be removed (either not in CSV or have zero shares)
        companies_with_zero_shares = set()

        total_positions = len(company_positions)
        for idx, (company_name, position) in enumerate(company_positions.items()):
            # Update progress for each company processed
            if total_positions > 0 and idx % max(1, total_positions // 10) == 0:
                progress = 60 + int((idx / total_positions) * 20)  # 60-80% range
                update_csv_progress(progress, 100, f"Processing company {idx+1}/{total_positions}...", "processing")
            current_shares = position['total_shares']
            total_invested = position['total_invested']
            
            # Track companies with zero or negative shares for removal (including tiny amounts from floating point precision)
            if current_shares <= 1e-6:
                logger.info(f"Company {company_name} has {current_shares} shares (zero or negative) - will be removed from database")
                companies_with_zero_shares.add(company_name)
                continue
                
            if company_name in existing_company_map:
                company_id = existing_company_map[company_name]['id']
                existing_portfolio_id = existing_company_map[company_name]['portfolio_id']
                
                # Preserve existing portfolio assignment unless it's being moved from a non-existent portfolio
                final_portfolio_id = existing_portfolio_id if existing_portfolio_id else default_portfolio_id
                
                cursor.execute(
                    'UPDATE companies SET identifier = ?, portfolio_id = ?, total_invested = ? WHERE id = ?',
                    [position['identifier'], final_portfolio_id,
                        total_invested, company_id],
                )
                
                # Preserve existing override_share if it exists
                existing_override = override_map.get(company_id)
                
                # Handle user-edited shares - apply CSV changes as differences
                if company_name in user_edit_map:
                    user_edit_info = user_edit_map[company_name]
                    manual_edit_date = user_edit_info['manual_edit_date']
                    manual_shares = user_edit_info['manual_shares']
                    
                    # Parse manual edit date for comparison
                    if manual_edit_date:
                        try:
                            manual_edit_datetime = pd.to_datetime(manual_edit_date)
                            
                            # Find transactions after the manual edit date
                            newer_transactions = df[
                                (df['holdingname'] == company_name) & 
                                (df['parsed_date'] > manual_edit_datetime)
                            ]
                            
                            if not newer_transactions.empty:
                                # Calculate net change from newer transactions
                                net_change = 0
                                for _, transaction in newer_transactions.iterrows():
                                    transaction_type = transaction['type']
                                    shares = float(transaction['shares'])
                                    
                                    if transaction_type in ['buy', 'transferin']:
                                        net_change += shares
                                    elif transaction_type in ['sell', 'transferout']:
                                        net_change -= shares
                                
                                # Apply the net change to BOTH original CSV shares and user-edited shares
                                final_csv_shares = round(current_shares, 6)  # Update shares with new CSV calculation
                                final_override_shares = round(manual_shares + net_change, 6)  # Update override with net change applied to user edit
                                
                                logger.info(f"User-edited shares for {company_name}: csv_shares={final_csv_shares}, manual={manual_shares}, net_change_from_newer_transactions={net_change}, final_override={final_override_shares}")
                                
                                share_row = query_db('SELECT shares FROM company_shares WHERE company_id = ?', [company_id], one=True)
                                if share_row:
                                    cursor.execute('''
                                        UPDATE company_shares 
                                        SET shares = ?, override_share = ?, csv_modified_after_edit = 1 
                                        WHERE company_id = ?
                                    ''', [final_csv_shares, final_override_shares, company_id])
                                else:
                                    cursor.execute('''
                                        INSERT INTO company_shares 
                                        (company_id, shares, override_share, is_manually_edited, csv_modified_after_edit) 
                                        VALUES (?, ?, ?, 1, 1)
                                    ''', [company_id, final_csv_shares, final_override_shares])
                            else:
                                # No newer transactions - update CSV shares but keep user-edited override as is
                                final_csv_shares = round(current_shares, 6)
                                logger.info(f"No newer transactions for user-edited {company_name}, updating CSV shares to: {final_csv_shares}, keeping override: {manual_shares}")
                                share_row = query_db('SELECT shares FROM company_shares WHERE company_id = ?', [company_id], one=True)
                                if share_row:
                                    cursor.execute(
                                        'UPDATE company_shares SET shares = ?, override_share = ? WHERE company_id = ?',
                                        [final_csv_shares, manual_shares, company_id])
                                else:
                                    cursor.execute(
                                        'INSERT INTO company_shares (company_id, shares, override_share, is_manually_edited) VALUES (?, ?, ?, 1)',
                                        [company_id, final_csv_shares, manual_shares])
                        except Exception as e:
                            logger.error(f"Error parsing manual edit date for {company_name}: {e}")
                            # Fallback to normal CSV processing
                            share_row = query_db('SELECT shares FROM company_shares WHERE company_id = ?', [company_id], one=True)
                            if share_row:
                                cursor.execute(
                                    'UPDATE company_shares SET shares = ?, override_share = ? WHERE company_id = ?',
                                    [current_shares, existing_override, company_id])
                            else:
                                cursor.execute(
                                    'INSERT INTO company_shares (company_id, shares, override_share) VALUES (?, ?, ?)',
                                    [company_id, current_shares, existing_override])
                    else:
                        # No manual edit date - fallback to normal processing
                        share_row = query_db('SELECT shares FROM company_shares WHERE company_id = ?', [company_id], one=True)
                        if share_row:
                            cursor.execute(
                                'UPDATE company_shares SET shares = ?, override_share = ? WHERE company_id = ?',
                                [current_shares, existing_override, company_id])
                        else:
                            cursor.execute(
                                'INSERT INTO company_shares (company_id, shares, override_share) VALUES (?, ?, ?)',
                                [company_id, current_shares, existing_override])
                else:
                    # No user edit for this company - normal CSV processing
                    share_row = query_db('SELECT shares FROM company_shares WHERE company_id = ?', [company_id], one=True)
                    if share_row:
                        cursor.execute(
                            'UPDATE company_shares SET shares = ?, override_share = ? WHERE company_id = ?',
                            [current_shares, existing_override, company_id])
                    else:
                        cursor.execute(
                            'INSERT INTO company_shares (company_id, shares, override_share) VALUES (?, ?, ?)',
                            [company_id, current_shares, existing_override])
                
                positions_updated.append(company_name)
            else:
                cursor.execute(
                    'INSERT INTO companies (name, identifier, category, portfolio_id, account_id, total_invested) VALUES (?, ?, ?, ?, ?, ?)',
                    [company_name, position['identifier'], '',
                        default_portfolio_id, account_id, total_invested],
                )
                company_id = cursor.lastrowid
                cursor.execute(
                    'INSERT INTO company_shares (company_id, shares) VALUES (?, ?)',
                    [company_id, current_shares],
                )
                positions_added.append(company_name)

        db_company_names = {company['name'] for company in existing_companies}
        
        # Companies to remove: existing DB companies not in CSV OR existing DB companies with zero shares
        companies_not_in_csv = db_company_names - csv_company_names
        existing_companies_with_zero_shares = companies_with_zero_shares & db_company_names
        companies_to_remove = companies_not_in_csv | existing_companies_with_zero_shares
        
        for company_name in companies_to_remove:
            company_id = existing_company_map[company_name]['id']
            identifier = existing_company_map[company_name]['identifier']
            
            # Determine removal reason for logging
            if company_name in existing_companies_with_zero_shares:
                removal_reason = "has zero shares"
            else:
                removal_reason = "not present in CSV"
            
            logger.info(f"Removing company {company_name} ({removal_reason})")
            cursor.execute(
                'DELETE FROM company_shares WHERE company_id = ?', [company_id])
            cursor.execute('DELETE FROM companies WHERE id = ?', [company_id])
            if identifier:
                other_companies_count = query_db(
                    'SELECT COUNT(*) as count FROM companies WHERE identifier = ? AND account_id != ?',
                    [identifier, account_id],
                    one=True,
                )
                if other_companies_count and other_companies_count['count'] == 0:
                    logger.info(
                        f"No other accounts use {identifier}, removing from market_prices")
                    cursor.execute(
                        'DELETE FROM market_prices WHERE identifier = ?', [identifier])
            positions_removed.append(company_name)

        update_csv_progress(80, 100, "Saving changes...", "processing")
        time.sleep(0.2)
        
        db.commit()
        clear_data_caches()
        
        update_csv_progress(87, 100, "Preparing price updates...", "processing")
        time.sleep(0.2)

        all_identifiers = set()
        for company_name in positions_added + positions_updated:
            company = query_db(
                'SELECT id, identifier FROM companies WHERE name = ? AND account_id = ?',
                [company_name, account_id],
                one=True,
            )
            if company and company['identifier']:
                all_identifiers.add(company['identifier'])

        if all_identifiers:
            update_csv_progress(90, 100, "Updating prices...", "processing")
            time.sleep(0.2)
            logger.info(f"Updating prices for {len(all_identifiers)} identifiers...")
            
            try:
                # Use the more efficient batch price update method
                from app.utils.yfinance_price import update_multiple_prices
                results = update_multiple_prices(list(all_identifiers))
                
                # Process results
                updated_count = len([r for r in results if r['success']])
                failed_count = len([r for r in results if not r['success']])
                
                logger.info(f"Price update results: {updated_count} updated, {failed_count} failed")
                
                # Collect failed identifiers for reporting
                failed_prices = [r['identifier'] for r in results if not r['success']]
                
                if failed_count > 0:
                    logger.warning(f"Failed to update prices for {failed_count} companies: {failed_prices[:5]}{'...' if len(failed_prices) > 5 else ''}")
                    
            except Exception as e:
                logger.error(f"Error during batch price update: {str(e)}")
                # If batch update fails, fall back to individual updates for critical identifiers
                logger.info("Falling back to individual price updates...")
                for identifier in list(all_identifiers)[:10]:  # Limit to first 10 to avoid long delays
                    try:
                        result = get_isin_data(identifier)
                        if result['success'] and result.get('price') is not None:
                            price = result.get('price')
                            currency = result.get('currency', 'USD')
                            price_eur = result.get('price_eur', price)
                            country = result.get('country')
                            if not update_price_in_db(identifier, price, currency, price_eur, country):
                                failed_prices.append(identifier)
                        else:
                            failed_prices.append(identifier)
                    except Exception as e:
                        logger.error(f"Error updating price for {identifier}: {str(e)}")
                        failed_prices.append(identifier)
        else:
            logger.info("No identifiers found for price updates")

        # Final completion with longer persistence
        update_csv_progress(100, 100, "CSV import completed successfully!", "completed")
        
        # Keep the completion status for a bit longer for frontend to catch it
        time.sleep(0.5)
        
        # Build success message with details
        message_parts = ["CSV data imported successfully"]
        
        # Add position details
        if positions_added:
            message_parts.append(f"Added {len(positions_added)} new positions")
        if positions_updated:
            message_parts.append(f"Updated {len(positions_updated)} existing positions")
        if positions_removed:
            message_parts.append(f"Removed {len(positions_removed)} positions")
            
        # Add price update info
        if all_identifiers:
            successful_prices = len(all_identifiers) - len(failed_prices)
            if successful_prices > 0:
                message_parts.append(f"Updated prices for {successful_prices} companies")
            if failed_prices:
                message_parts.append(f"Could not update prices for {len(failed_prices)} companies (network issues)")
        
        message = ". ".join(message_parts) + "."
        
        # Add details about removed companies if any
        if positions_removed:
            removed_details = ', '.join(positions_removed)
            if len(removed_details) > 100:
                removed_details = removed_details[:97] + '...'
            message += f" <br><small>Removed companies: {removed_details}</small>"

        return True, message, {
            'added': positions_added,
            'updated': positions_updated,
            'removed': positions_removed,
            'failed_prices': failed_prices,
        }

    except Exception as e:
        logger.error(f"Error processing CSV: {str(e)}", exc_info=True)
        update_csv_progress(0, 100, f"Error: {str(e)}", "failed")
        if db:
            db.rollback()
        return False, str(e), {}
    finally:
        if cursor:
            cursor.close()
