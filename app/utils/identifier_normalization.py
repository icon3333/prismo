"""
Smart Identifier Normalization for Crypto/Stock Detection

This module implements intelligent identifier normalization that automatically detects
and converts cryptocurrency symbols to their correct yfinance format (SYMBOL-USD)
while preserving stock tickers and ISINs in their original format.

Core concept: Test both stock and crypto formats during import to determine the
correct identifier format before database storage, eliminating dual-identifier problems.
"""

import logging
import yfinance as yf
from typing import Dict, Any, Optional
from functools import lru_cache

logger = logging.getLogger(__name__)

# Cache for identifier test results to avoid repeated API calls
_identifier_cache = {}


def normalize_identifier(identifier: str) -> str:
    """
    Primary entry point for identifier normalization.
    
    Routes identifiers through detection and resolution pipeline to determine
    the correct format for database storage.
    
    Args:
        identifier: Raw identifier from CSV/user input
        
    Returns:
        Normalized identifier for database storage
    """
    if not identifier or not identifier.strip():
        logger.warning("Empty identifier provided to normalize_identifier")
        return identifier
    
    clean_identifier = identifier.strip()
    logger.info(f"Normalizing identifier: '{clean_identifier}'")
    
    # Check if identifier needs ambiguity resolution
    if _is_potentially_ambiguous(clean_identifier):
        logger.info(f"'{clean_identifier}' is potentially ambiguous, resolving format")
        normalized = _resolve_ambiguous_identifier(clean_identifier)
        if normalized != clean_identifier:
            logger.info(f"Normalized '{clean_identifier}' -> '{normalized}'")
        return normalized
    else:
        logger.info(f"'{clean_identifier}' is not ambiguous, using as-is")
        return clean_identifier


def _is_potentially_ambiguous(identifier: str) -> bool:
    """
    Identify identifiers that could be either stock or crypto.
    
    Rules:
    - ISINs (12 chars, alphanumeric): Not ambiguous (stock)
    - Exchange suffixes (.PA, .L): Not ambiguous (stock)
    - Short alphabetic (≤5 chars): Potentially ambiguous
    - Others: Not ambiguous
    
    Args:
        identifier: Cleaned identifier string
        
    Returns:
        True if identifier could be either stock or crypto
    """
    clean_id = identifier.upper().strip()
    
    # ISINs are 12 characters - not ambiguous (clearly stock)
    if len(clean_id) == 12 and clean_id[:2].isalpha() and clean_id[2:].isalnum():
        logger.debug(f"'{identifier}' identified as ISIN (not ambiguous)")
        return False
    
    # Exchange suffixes indicate stock - not ambiguous
    if '.' in clean_id:
        logger.debug(f"'{identifier}' has exchange suffix (not ambiguous)")
        return False
    
    # Short alphabetic identifiers are potentially ambiguous
    if len(clean_id) <= 5 and clean_id.isalpha():
        logger.debug(f"'{identifier}' is short alphabetic (potentially ambiguous)")
        return True
    
    # Everything else is not ambiguous
    logger.debug(f"'{identifier}' does not match ambiguous patterns")
    return False


def _resolve_ambiguous_identifier(identifier: str) -> str:
    """
    Test both stock and crypto formats and choose the working one.
    
    Process:
    1. Test stock format: yfinance.Ticker(identifier).info
    2. Test crypto format: yfinance.Ticker(f"{identifier}-USD").info
    3. Apply resolution logic based on results
    
    Resolution Logic Matrix (Updated for Crypto Priority):
    | Stock Works | Crypto Works | Decision | Rationale |
    |-------------|--------------|----------|-----------|
    | ✅ Yes      | ✅ Yes       | Use Crypto| Crypto format more reliable for crypto assets |
    | ✅ Yes      | ❌ No        | Use Stock| Clear stock ticker |
    | ❌ No       | ✅ Yes       | Use Crypto| Clear crypto symbol |
    | ❌ No       | ❌ No        | Use Original| Preserve input, log warning |
    
    Args:
        identifier: Clean identifier to resolve
        
    Returns:
        Resolved identifier in correct format
    """
    clean_id = identifier.upper().strip()
    stock_format = clean_id
    crypto_format = f"{clean_id}-USD"
    
    logger.info(f"Testing formats for '{identifier}': stock='{stock_format}', crypto='{crypto_format}'")
    
    # Test both formats
    stock_works = _test_yfinance_format(stock_format)
    crypto_works = _test_yfinance_format(crypto_format)
    
    logger.info(f"Format test results - stock: {stock_works}, crypto: {crypto_works}")
    
    # Apply resolution logic - prefer crypto format when both work
    if stock_works and crypto_works:
        # Both work - prefer crypto (more reliable for crypto assets, avoids dual format issues)
        logger.info(f"Both formats work for '{identifier}', choosing crypto format: '{crypto_format}'")
        return crypto_format
    elif stock_works and not crypto_works:
        # Only stock works - clear stock ticker
        logger.info(f"Only stock format works for '{identifier}': '{stock_format}'")
        return stock_format
    elif not stock_works and crypto_works:
        # Only crypto works - clear crypto symbol
        logger.info(f"Only crypto format works for '{identifier}': '{crypto_format}'")
        return crypto_format
    else:
        # Neither works - preserve original and log warning
        logger.warning(f"Neither format works for '{identifier}', preserving original")
        return identifier


def _test_yfinance_format(identifier: str) -> bool:
    """
    Test if a specific identifier format works with yfinance.
    Uses caching and timeouts to prevent repeated slow API calls.
    
    Args:
        identifier: Identifier to test
        
    Returns:
        True if identifier returns valid data from yfinance
    """
    # Check cache first to avoid repeated API calls
    if identifier in _identifier_cache:
        logger.debug(f"Using cached result for '{identifier}': {_identifier_cache[identifier]}")
        return _identifier_cache[identifier]
    
    import time
    from concurrent.futures import ThreadPoolExecutor, TimeoutError
    
    def _quick_test(id_to_test):
        """Quick test with minimal timeout"""
        try:
            ticker = yf.Ticker(id_to_test)
            # Use fast method - just check if basic info is accessible
            info = ticker.info
            if not info or not isinstance(info, dict):
                return False
            
            # Quick check for price indicators
            price = info.get('regularMarketPrice') or info.get('currentPrice')
            return price is not None and price > 0
            
        except Exception:
            return False
    
    try:
        logger.debug(f"Testing yfinance format: '{identifier}' with 3s timeout")
        
        # Use thread pool with timeout to prevent hanging
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_quick_test, identifier)
            try:
                result = future.result(timeout=3.0)  # 3 second timeout
                logger.debug(f"Test result for '{identifier}': {result}")
                
                # Cache the result to avoid repeated calls
                _identifier_cache[identifier] = result
                return result
            except TimeoutError:
                logger.warning(f"Timeout testing '{identifier}' - assuming invalid")
                # Cache negative result to avoid retrying
                _identifier_cache[identifier] = False
                return False
                
    except Exception as e:
        logger.debug(f"Exception testing '{identifier}': {e}")
        # Cache negative result to avoid retrying
        _identifier_cache[identifier] = False
        return False


def cleanup_crypto_duplicates() -> Dict[str, Any]:
    """
    One-time cleanup of existing duplicate entries caused by crypto format mismatch.
    
    Process:
    1. Find duplicate pairs in market_prices (base + -USD formats)
    2. Check which companies are using which format
    3. Remove unused duplicate market_prices entries
    4. Log all changes for audit trail
    
    Returns:
        Dictionary with cleanup results and statistics
    """
    from .db_utils import query_db
    from ..database.db_manager import get_db
    
    logger.info("Starting crypto duplicates cleanup")
    
    try:
        db = get_db()
        cursor = db.cursor()
        
        # Find duplicate pairs in market_prices using a direct approach
        duplicates_found = query_db('''
            SELECT 
                mp1.identifier as base_id,
                mp2.identifier as crypto_id,
                mp1.price as base_price,
                mp2.price as crypto_price,
                mp1.last_updated as base_updated,
                mp2.last_updated as crypto_updated
            FROM market_prices mp1
            JOIN market_prices mp2 ON mp2.identifier = mp1.identifier || '-USD'
            WHERE LENGTH(mp1.identifier) <= 5
            AND mp1.identifier NOT LIKE '%.%'
            AND mp1.identifier NOT LIKE '%-%'
            ORDER BY mp1.identifier
        ''')
        
        if not duplicates_found:
            logger.info("No duplicate pairs found in market_prices")
            return {
                'success': True,
                'companies_updated': 0,
                'market_prices_removed': 0,
                'pairs_found': [],
                'message': 'No duplicate pairs found - database is clean'
            }
        
        logger.info(f"Found {len(duplicates_found)} duplicate pairs in market_prices")
        
        pairs_processed = []
        companies_updated = 0
        market_prices_removed = 0
        
        for dup in duplicates_found:
            base_id = dup['base_id']
            crypto_id = dup['crypto_id']
            
            logger.info(f"Processing duplicate pair: '{base_id}' ↔ '{crypto_id}'")
            
            # Check which companies are using each format
            companies_using_base = query_db(
                'SELECT COUNT(*) as count FROM companies WHERE identifier = ?',
                [base_id],
                one=True
            )['count']
            
            companies_using_crypto = query_db(
                'SELECT COUNT(*) as count FROM companies WHERE identifier = ?', 
                [crypto_id],
                one=True
            )['count']
            
            logger.info(f"  Companies using '{base_id}': {companies_using_base}")
            logger.info(f"  Companies using '{crypto_id}': {companies_using_crypto}")
            
            action_taken = ""
            
            if companies_using_crypto > 0 and companies_using_base == 0:
                # Companies are using crypto format, remove base format from market_prices
                cursor.execute(
                    'DELETE FROM market_prices WHERE identifier = ?',
                    [base_id]
                )
                market_prices_removed += 1
                action_taken = "removed_unused_base_format"
                logger.info(f"  ✅ Removed unused base format '{base_id}' from market_prices")
                
            elif companies_using_base > 0 and companies_using_crypto == 0:
                # Companies are using base format, remove crypto format from market_prices
                cursor.execute(
                    'DELETE FROM market_prices WHERE identifier = ?',
                    [crypto_id]
                )
                market_prices_removed += 1
                action_taken = "removed_unused_crypto_format"
                logger.info(f"  ✅ Removed unused crypto format '{crypto_id}' from market_prices")
                
            elif companies_using_crypto > 0 and companies_using_base > 0:
                # Both formats are being used - need to decide which to keep
                # Test which format actually works with yfinance
                if _test_yfinance_format(crypto_id):
                    # Crypto format works - migrate base format companies to crypto
                    companies_to_update = query_db(
                        'SELECT id, name FROM companies WHERE identifier = ?',
                        [base_id]
                    )
                    
                    for company in companies_to_update:
                        cursor.execute('''
                            UPDATE companies 
                            SET identifier = ?
                            WHERE id = ?
                        ''', [crypto_id, company['id']])
                        companies_updated += 1
                        logger.info(f"  ✅ Updated company '{company['name']}': '{base_id}' → '{crypto_id}'")
                    
                    # Remove base format from market_prices
                    cursor.execute(
                        'DELETE FROM market_prices WHERE identifier = ?',
                        [base_id]
                    )
                    market_prices_removed += 1
                    action_taken = "migrated_to_crypto_format"
                    
                elif _test_yfinance_format(base_id):
                    # Base format works - migrate crypto format companies to base
                    companies_to_update = query_db(
                        'SELECT id, name FROM companies WHERE identifier = ?',
                        [crypto_id]
                    )
                    
                    for company in companies_to_update:
                        cursor.execute('''
                            UPDATE companies 
                            SET identifier = ?
                            WHERE id = ?
                        ''', [base_id, company['id']])
                        companies_updated += 1
                        logger.info(f"  ✅ Updated company '{company['name']}': '{crypto_id}' → '{base_id}'")
                    
                    # Remove crypto format from market_prices
                    cursor.execute(
                        'DELETE FROM market_prices WHERE identifier = ?',
                        [crypto_id]
                    )
                    market_prices_removed += 1
                    action_taken = "migrated_to_base_format"
                    
                else:
                    # Neither works reliably - keep crypto format (safer assumption)
                    companies_to_update = query_db(
                        'SELECT id, name FROM companies WHERE identifier = ?',
                        [base_id]
                    )
                    
                    for company in companies_to_update:
                        cursor.execute('''
                            UPDATE companies 
                            SET identifier = ?
                            WHERE id = ?
                        ''', [crypto_id, company['id']])
                        companies_updated += 1
                        logger.info(f"  ⚠️ Updated company '{company['name']}': '{base_id}' → '{crypto_id}' (fallback)")
                    
                    # Remove base format from market_prices
                    cursor.execute(
                        'DELETE FROM market_prices WHERE identifier = ?',
                        [base_id]
                    )
                    market_prices_removed += 1
                    action_taken = "fallback_to_crypto_format"
                    
            else:
                # Neither format is being used by companies - keep the more recent one
                base_updated = dup['base_updated']
                crypto_updated = dup['crypto_updated']
                
                if crypto_updated > base_updated:
                    cursor.execute(
                        'DELETE FROM market_prices WHERE identifier = ?',
                        [base_id]
                    )
                    market_prices_removed += 1
                    action_taken = "kept_more_recent_crypto"
                    logger.info(f"  ✅ Kept more recent crypto format '{crypto_id}', removed '{base_id}'")
                else:
                    cursor.execute(
                        'DELETE FROM market_prices WHERE identifier = ?',
                        [crypto_id]
                    )
                    market_prices_removed += 1
                    action_taken = "kept_more_recent_base"
                    logger.info(f"  ✅ Kept more recent base format '{base_id}', removed '{crypto_id}'")
            
            pairs_processed.append({
                'base': base_id,
                'crypto': crypto_id,
                'action': action_taken,
                'companies_affected': companies_using_base + companies_using_crypto
            })
        
        # Commit changes
        db.commit()
        
        result = {
            'success': True,
            'companies_updated': companies_updated,
            'market_prices_removed': market_prices_removed,
            'pairs_found': pairs_processed,
            'message': f'Cleanup completed: {companies_updated} companies updated, {market_prices_removed} duplicate prices removed from {len(duplicates_found)} pairs'
        }
        
        logger.info(f"Cleanup completed successfully: {result['message']}")
        return result
        
    except Exception as e:
        logger.error(f"Error during cleanup: {e}")
        if 'db' in locals():
            db.rollback()
        return {
            'success': False,
            'error': str(e),
            'companies_updated': 0,
            'market_prices_removed': 0,
            'pairs_found': [],
            'message': f'Cleanup failed: {str(e)}'
        }


# Test data for validation
TEST_CASES = [
    # Clear stocks - should not be normalized
    ("US0378331005", "US0378331005"),  # Apple ISIN
    ("AAPL.DE", "AAPL.DE"),           # Exchange-specific
    ("2222.SR", "2222.SR"),           # Saudi exchange
    
    # Clear crypto - will be tested and normalized if appropriate
    ("BTC", "BTC-USD"),               # Bitcoin (expected)
    ("ETH", "ETH-USD"),               # Ethereum (expected)
    ("ATOM", "ATOM-USD"),             # Cosmos (expected)
    
    # Ambiguous cases - will be tested to determine correct format (now preferring crypto)
    ("AAPL", "AAPL-USD"),             # Could be stock or crypto - prefer crypto format if both work
    ("LINK", "LINK-USD"),             # Crypto symbol (expected)
    
    # Edge cases
    ("", ""),                         # Empty
    ("INVALID", "INVALID"),           # Neither format works (expected)
]


def run_test_cases() -> Dict[str, Any]:
    """
    Run test cases to validate normalization logic.
    
    Returns:
        Test results with success/failure statistics
    """
    logger.info("Running identifier normalization test cases")
    
    results = {
        'total_tests': len(TEST_CASES),
        'passed': 0,
        'failed': 0,
        'details': []
    }
    
    for input_id, expected_output in TEST_CASES:
        try:
            actual_output = normalize_identifier(input_id)
            passed = actual_output == expected_output
            
            if passed:
                results['passed'] += 1
                logger.info(f"✅ Test passed: '{input_id}' -> '{actual_output}'")
            else:
                results['failed'] += 1
                logger.warning(f"❌ Test failed: '{input_id}' -> expected '{expected_output}', got '{actual_output}'")
            
            results['details'].append({
                'input': input_id,
                'expected': expected_output, 
                'actual': actual_output,
                'passed': passed
            })
            
        except Exception as e:
            results['failed'] += 1
            logger.error(f"❌ Test error for '{input_id}': {e}")
            results['details'].append({
                'input': input_id,
                'expected': expected_output,
                'actual': f"ERROR: {str(e)}",
                'passed': False
            })
    
    success_rate = (results['passed'] / results['total_tests']) * 100 if results['total_tests'] > 0 else 0
    logger.info(f"Test results: {results['passed']}/{results['total_tests']} passed ({success_rate:.1f}%)")
    
    return results 