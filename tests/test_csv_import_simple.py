"""
Comprehensive Test Suite for Simplified CSV Import
Tests all aspects of the new simple CSV import system.
"""

import pytest
import tempfile
import os
import time
from unittest.mock import patch, MagicMock
from app.utils.csv_import_simple import (
    import_csv_simple, 
    normalize_simple, 
    fetch_price_simple,
    save_transaction_simple,
    validate_csv_format
)
from tests.test_data_generators import CSVTestData
import sys
sys.path.insert(0, '/Users/nico/Documents/Interests/TECH/coding/_FINANCE/portfolio_rebalancing_flask')

class TestSimpleCSVImport:
    """Test the core CSV import functionality."""
    
    @pytest.fixture
    def test_account_id(self):
        return 1
    
    @pytest.fixture
    def mock_db_functions(self):
        """Mock all database functions to avoid actual DB operations during testing."""
        with patch('app.utils.csv_import_simple.backup_database') as mock_backup, \
             patch('app.utils.csv_import_simple.get_db') as mock_get_db, \
             patch('app.utils.csv_import_simple.query_db') as mock_query, \
             patch('app.utils.csv_import_simple.execute_db') as mock_execute:
            
            # Setup mock database
            mock_db = MagicMock()
            mock_get_db.return_value = mock_db
            mock_query.return_value = None  # No existing positions
            mock_execute.return_value = True
            
            yield {
                'backup': mock_backup,
                'get_db': mock_get_db, 
                'query': mock_query,
                'execute': mock_execute
            }
    
    def test_normalize_simple_stocks(self):
        """Test identifier normalization for stocks."""
        assert normalize_simple('AAPL') == 'AAPL'
        assert normalize_simple('aapl') == 'AAPL'
        assert normalize_simple(' MSFT ') == 'MSFT'
        assert normalize_simple('BRK-B') == 'BRK-B'
        assert normalize_simple('GOOGL') == 'GOOGL'
    
    def test_normalize_simple_crypto(self):
        """Test identifier normalization for crypto."""
        assert normalize_simple('BTC') == 'BTC-USD'
        assert normalize_simple('ETH') == 'ETH-USD'
        assert normalize_simple('ADA') == 'ADA-USD'
        assert normalize_simple('BTC-USD') == 'BTC-USD'  # Already formatted
        assert normalize_simple('eth-usd') == 'ETH-USD'
    
    def test_normalize_simple_edge_cases(self):
        """Test identifier normalization edge cases."""
        assert normalize_simple('') == ''
        assert normalize_simple(None) == None
        assert normalize_simple('   ') == ''
    
    @patch('app.utils.csv_import_simple.yf.Ticker')
    def test_fetch_price_simple_success(self, mock_ticker):
        """Test successful price fetching."""
        # Mock yfinance response
        mock_info = {
            'regularMarketPrice': 150.50,
            'currency': 'USD',
            'country': 'United States'
        }
        mock_ticker.return_value.info = mock_info
        
        result = fetch_price_simple('AAPL')
        
        assert result['success'] == True
        assert result['price'] == 150.50
        assert result['currency'] == 'USD'
        assert result['country'] == 'United States'
    
    @patch('app.utils.csv_import_simple.yf.Ticker')
    def test_fetch_price_simple_failure(self, mock_ticker):
        """Test price fetching failure handling."""
        # Mock yfinance exception
        mock_ticker.side_effect = Exception("API Error")
        
        result = fetch_price_simple('INVALID')
        
        assert result['success'] != True
        assert result['price'] is None
        assert 'error' in result
    
    @patch('app.utils.csv_import_simple.yf.Ticker')
    def test_fetch_price_simple_no_price(self, mock_ticker):
        """Test handling when no price is available."""
        # Mock empty info
        mock_ticker.return_value.info = {}
        
        result = fetch_price_simple('AAPL')
        
        assert result['price'] is None
        assert 'error' in result
    
    def test_save_transaction_simple_new_position(self, mock_db_functions):
        """Test saving a new position."""
        transaction_data = {
            'identifier': 'AAPL',
            'name': 'Apple Inc',
            'shares': 100,
            'price': 150.00,
            'current_price': 155.00,
            'currency': 'USD',
            'country': 'United States'
        }
        
        # Mock no existing position
        mock_db_functions['query'].return_value = None
        
        result = save_transaction_simple(1, transaction_data)
        
        assert result == True
        mock_db_functions['execute'].assert_called()
    
    def test_save_transaction_simple_update_position(self, mock_db_functions):
        """Test updating an existing position."""
        transaction_data = {
            'identifier': 'AAPL',
            'name': 'Apple Inc',
            'shares': 50,
            'price': 150.00,
            'current_price': 155.00,
            'currency': 'USD'
        }
        
        # Mock existing position
        mock_db_functions['query'].return_value = {'id': 1, 'shares': 100}
        
        result = save_transaction_simple(1, transaction_data)
        
        assert result == True
        mock_db_functions['execute'].assert_called()
    
    def test_validate_csv_format_valid(self):
        """Test CSV format validation with valid data."""
        valid, message = validate_csv_format(CSVTestData.get_all_test_cases()['basic'])
        assert valid == True
        assert "valid" in message.lower()
    
    def test_validate_csv_format_empty(self):
        """Test CSV format validation with empty file."""
        valid, message = validate_csv_format("")
        assert valid == False
        assert "empty" in message.lower()
    
    def test_validate_csv_format_missing_columns(self):
        """Test CSV format validation with missing columns."""
        invalid_csv = "identifier;shares\nAAPL;100"
        valid, message = validate_csv_format(invalid_csv)
        assert valid == False
        assert "missing" in message.lower()
    
    def test_validate_csv_format_no_delimiter(self):
        """Test CSV format validation without proper delimiters."""
        invalid_csv = "identifier holdingname shares\nAAPL Apple 100"
        valid, message = validate_csv_format(invalid_csv)
        assert valid == False
        assert "delimiter" in message.lower()
    
    @patch('app.utils.csv_import_simple.fetch_price_simple')
    def test_import_csv_simple_basic_success(self, mock_fetch_price, test_account_id, mock_db_functions):
        """Test basic successful CSV import."""
        # Mock price fetching
        mock_fetch_price.return_value = {
            'price': 155.00,
            'currency': 'USD',
            'country': 'United States',
            'success': True
        }
        
        csv_data = CSVTestData.get_all_test_cases()['basic']
        success, message = import_csv_simple(test_account_id, csv_data)
        
        assert success == True
        assert "Successfully imported" in message
        mock_db_functions['backup'].assert_called_once()
    
    @patch('app.utils.csv_import_simple.fetch_price_simple')
    def test_import_csv_simple_edge_cases(self, mock_fetch_price, test_account_id, mock_db_functions):
        """Test CSV import with edge cases."""
        mock_fetch_price.return_value = {'price': 100.00, 'currency': 'USD', 'success': True}
        
        csv_data = CSVTestData.get_all_test_cases()['edge_cases']
        success, message = import_csv_simple(test_account_id, csv_data)
        
        assert success == True
        assert "imported" in message.lower()
        # Should have some errors due to invalid data
        assert "error" in message.lower() or "imported" in message.lower()
    
    def test_import_csv_simple_invalid_format(self, test_account_id, mock_db_functions):
        """Test CSV import with invalid format."""
        csv_data = CSVTestData.get_all_test_cases()['invalid_missing_columns']
        success, message = import_csv_simple(test_account_id, csv_data)
        
        assert success == False
        assert "Missing required columns" in message
    
    def test_import_csv_simple_empty_file(self, test_account_id, mock_db_functions):
        """Test CSV import with empty file."""
        success, message = import_csv_simple(test_account_id, "")
        
        assert success == False
        assert "empty" in message.lower() or "error" in message.lower()
    
    @patch('app.utils.csv_import_simple.fetch_price_simple')
    def test_import_csv_simple_dividend_skip(self, mock_fetch_price, test_account_id, mock_db_functions):
        """Test that dividend transactions are skipped."""
        mock_fetch_price.return_value = {'price': 100.00, 'currency': 'USD', 'success': True}
        
        csv_data = CSVTestData.get_all_test_cases()['dividend_only']
        success, message = import_csv_simple(test_account_id, csv_data)
        
        assert success == False
        assert "No valid transactions found" in message
    
    @patch('app.utils.csv_import_simple.backup_database')
    def test_import_csv_simple_backup_failure(self, mock_backup, test_account_id):
        """Test handling of backup failure (should fail early)."""
        mock_backup.side_effect = Exception("Backup failed")
        
        csv_data = CSVTestData.get_all_test_cases()['basic']
        success, message = import_csv_simple(test_account_id, csv_data)
        
        assert success == False
        assert "Backup failed" in message

class TestPerformance:
    """Test performance of the simplified CSV import."""
    
    @pytest.fixture
    def mock_fast_functions(self):
        """Mock external functions for performance testing."""
        with patch('app.utils.csv_import_simple.backup_database'), \
             patch('app.utils.csv_import_simple.get_db') as mock_get_db, \
             patch('app.utils.csv_import_simple.query_db') as mock_query, \
             patch('app.utils.csv_import_simple.execute_db') as mock_execute, \
             patch('app.utils.csv_import_simple.fetch_price_simple') as mock_fetch:
            
            # Setup fast mocks
            mock_db = MagicMock()
            mock_get_db.return_value = mock_db
            mock_query.return_value = None
            mock_execute.return_value = True
            mock_fetch.return_value = {'price': 100.00, 'currency': 'USD', 'success': True}
            
            yield
    
    @pytest.mark.parametrize("row_count,max_seconds", CSVTestData.get_performance_test_data())
    def test_import_performance(self, row_count, max_seconds, mock_fast_functions):
        """Test import performance with different file sizes."""
        from tests.test_data_generators import generate_large_csv
        
        csv_data = generate_large_csv(row_count)
        
        start_time = time.time()
        success, message = import_csv_simple(1, csv_data)
        end_time = time.time()
        
        duration = end_time - start_time
        
        assert success == True
        assert duration < max_seconds, f"Import of {row_count} rows took {duration:.1f}s (max: {max_seconds}s)"
        print(f"✅ {row_count} rows imported in {duration:.1f}s")
    
    def test_memory_usage_large_file(self, mock_fast_functions):
        """Test memory usage doesn't grow excessively with large files."""
        import psutil
        import os
        from tests.test_data_generators import generate_large_csv
        
        process = psutil.Process(os.getpid())
        initial_memory = process.memory_info().rss
        
        # Process large CSV
        large_csv = generate_large_csv(1000)
        success, message = import_csv_simple(1, large_csv)
        
        final_memory = process.memory_info().rss
        memory_increase = (final_memory - initial_memory) / 1024 / 1024  # MB
        
        assert success == True
        assert memory_increase < 100, f"Memory increased by {memory_increase:.1f}MB (should be < 100MB)"

class TestCSVVariants:
    """Test different CSV format variants."""
    
    @pytest.fixture
    def mock_functions(self):
        """Mock functions for variant testing."""
        with patch('app.utils.csv_import_simple.backup_database'), \
             patch('app.utils.csv_import_simple.get_db') as mock_get_db, \
             patch('app.utils.csv_import_simple.query_db') as mock_query, \
             patch('app.utils.csv_import_simple.execute_db') as mock_execute, \
             patch('app.utils.csv_import_simple.fetch_price_simple') as mock_fetch:
            
            mock_db = MagicMock()
            mock_get_db.return_value = mock_db
            mock_query.return_value = None
            mock_execute.return_value = True
            mock_fetch.return_value = {'price': 100.00, 'currency': 'USD', 'success': True}
            
            yield
    
    def test_semicolon_delimiter(self, mock_functions):
        """Test semicolon delimiter (default)."""
        csv_data = CSVTestData.get_format_variants()['semicolon']
        success, message = import_csv_simple(1, csv_data)
        assert success == True
    
    def test_comma_delimiter(self, mock_functions):
        """Test comma delimiter."""
        csv_data = CSVTestData.get_format_variants()['comma']
        success, message = import_csv_simple(1, csv_data)
        assert success == True
    
    def test_bom_handling(self, mock_functions):
        """Test BOM (Byte Order Mark) handling."""
        csv_data = CSVTestData.get_format_variants()['with_bom']
        success, message = import_csv_simple(1, csv_data)
        assert success == True
    
    def test_whitespace_handling(self, mock_functions):
        """Test extra whitespace handling."""
        csv_data = CSVTestData.get_format_variants()['whitespace']
        success, message = import_csv_simple(1, csv_data)
        assert success == True

if __name__ == "__main__":
    # Run basic tests when called directly
    import unittest
    
    # Create test instances
    test_import = TestSimpleCSVImport()
    test_performance = TestPerformance()
    
    print("🧪 Running Simple CSV Import Tests")
    print("=" * 50)
    
    # Run basic functionality tests
    print("Testing identifier normalization...")
    test_import.test_normalize_simple_stocks()
    test_import.test_normalize_simple_crypto()
    print("✅ Identifier normalization tests passed")
    
    print("Testing CSV validation...")
    test_import.test_validate_csv_format_valid()
    test_import.test_validate_csv_format_empty()
    print("✅ CSV validation tests passed")
    
    print("\n🚀 All basic tests completed successfully!")
    print("Run 'pytest tests/test_csv_import_simple.py -v' for full test suite")
