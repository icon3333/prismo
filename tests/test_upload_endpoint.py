"""
Integration Tests for Simplified CSV Upload Endpoint
Tests the complete upload flow from HTTP request to database.
"""

import pytest
import io
import json
from unittest.mock import patch
from app import create_app
from tests.test_data_generators import CSVTestData
import sys
sys.path.insert(0, '/Users/nico/Documents/Interests/TECH/coding/_FINANCE/portfolio_rebalancing_flask')

class TestUploadEndpoint:
    """Test the simplified upload endpoint integration."""
    
    @pytest.fixture
    def app(self):
        """Create test Flask app."""
        app = create_app({'TESTING': True, 'SECRET_KEY': 'test-secret-key'})
        return app
    
    @pytest.fixture
    def client(self, app):
        """Create test client."""
        with app.test_client() as client:
            yield client
    
    @pytest.fixture
    def authenticated_session(self, client):
        """Setup authenticated session."""
        with client.session_transaction() as sess:
            sess['account_id'] = 1
            sess['username'] = 'testuser'
        return client
    
    @pytest.fixture
    def mock_db_operations(self):
        """Mock all database operations for testing."""
        with patch('app.utils.csv_import_simple.backup_database') as mock_backup, \
             patch('app.utils.csv_import_simple.get_db') as mock_get_db, \
             patch('app.utils.csv_import_simple.query_db') as mock_query, \
             patch('app.utils.csv_import_simple.execute_db') as mock_execute, \
             patch('app.utils.csv_import_simple.fetch_price_simple') as mock_fetch:
            
            # Setup mocks
            mock_query.return_value = None  # No existing positions
            mock_execute.return_value = True
            mock_fetch.return_value = {
                'price': 150.00,
                'currency': 'USD',
                'country': 'United States',
                'success': True
            }
            
            yield {
                'backup': mock_backup,
                'query': mock_query,
                'execute': mock_execute,
                'fetch': mock_fetch
            }
    
    def test_successful_upload_ajax(self, authenticated_session, mock_db_operations):
        """Test successful CSV upload via AJAX."""
        csv_data = CSVTestData.get_all_test_cases()['basic']
        
        data = {
            'csv_file': (io.BytesIO(csv_data.encode('utf-8')), 'test_portfolio.csv')
        }
        
        response = authenticated_session.post(
            '/portfolio/upload',
            data=data,
            content_type='multipart/form-data',
            headers={'Accept': 'application/json'}
        )
        
        assert response.status_code == 200
        result = response.get_json()
        assert result['success'] == True
        assert "Successfully imported" in result['message']
        assert 'redirect' in result
        
        # Verify backup was called
        mock_db_operations['backup'].assert_called_once()
    
    def test_successful_upload_form(self, authenticated_session, mock_db_operations):
        """Test successful CSV upload via HTML form."""
        csv_data = CSVTestData.get_all_test_cases()['basic']
        
        data = {
            'csv_file': (io.BytesIO(csv_data.encode('utf-8')), 'test_portfolio.csv')
        }
        
        response = authenticated_session.post(
            '/portfolio/upload',
            data=data,
            content_type='multipart/form-data'
        )
        
        # Should redirect on success
        assert response.status_code == 302
        assert '/portfolio/enrich' in response.location
    
    def test_upload_without_authentication(self, client):
        """Test upload without authentication should fail."""
        csv_data = CSVTestData.get_all_test_cases()['basic']
        
        data = {
            'csv_file': (io.BytesIO(csv_data.encode('utf-8')), 'test.csv')
        }
        
        response = client.post(
            '/portfolio/upload',
            data=data,
            headers={'Accept': 'application/json'}
        )
        
        assert response.status_code == 401
        result = response.get_json()
        assert result['success'] == False
        assert 'account' in result['message'].lower()
    
    def test_upload_without_file(self, authenticated_session):
        """Test upload without file should fail."""
        response = authenticated_session.post(
            '/portfolio/upload',
            headers={'Accept': 'application/json'}
        )
        
        assert response.status_code == 400
        result = response.get_json()
        assert result['success'] == False
        assert 'no file' in result['message'].lower()
    
    def test_upload_empty_filename(self, authenticated_session):
        """Test upload with empty filename should fail."""
        data = {
            'csv_file': (io.BytesIO(b''), '')
        }
        
        response = authenticated_session.post(
            '/portfolio/upload',
            data=data,
            headers={'Accept': 'application/json'}
        )
        
        assert response.status_code == 400
        result = response.get_json()
        assert result['success'] == False
        assert 'no file selected' in result['message'].lower()
    
    def test_upload_invalid_csv_format(self, authenticated_session, mock_db_operations):
        """Test upload with invalid CSV format."""
        invalid_csv = CSVTestData.get_all_test_cases()['invalid_missing_columns']
        
        data = {
            'csv_file': (io.BytesIO(invalid_csv.encode('utf-8')), 'invalid.csv')
        }
        
        response = authenticated_session.post(
            '/portfolio/upload',
            data=data,
            headers={'Accept': 'application/json'}
        )
        
        assert response.status_code == 400
        result = response.get_json()
        assert result['success'] == False
        assert 'missing' in result['message'].lower() or 'column' in result['message'].lower()
    
    def test_upload_invalid_encoding(self, authenticated_session):
        """Test upload with invalid file encoding."""
        # Create invalid UTF-8 content
        invalid_content = b'\xff\xfe\x00\x00invalid encoding'
        
        data = {
            'csv_file': (io.BytesIO(invalid_content), 'invalid_encoding.csv')
        }
        
        response = authenticated_session.post(
            '/portfolio/upload',
            data=data,
            headers={'Accept': 'application/json'}
        )
        
        assert response.status_code == 400
        result = response.get_json()
        assert result['success'] == False
        assert 'encoding' in result['message'].lower()
    
    def test_upload_large_file_performance(self, authenticated_session, mock_db_operations):
        """Test upload performance with larger file."""
        from tests.test_data_generators import generate_large_csv
        import time
        
        # Generate 100 row CSV
        large_csv = generate_large_csv(100)
        
        data = {
            'csv_file': (io.BytesIO(large_csv.encode('utf-8')), 'large_test.csv')
        }
        
        start_time = time.time()
        response = authenticated_session.post(
            '/portfolio/upload',
            data=data,
            headers={'Accept': 'application/json'}
        )
        end_time = time.time()
        
        duration = end_time - start_time
        
        assert response.status_code == 200
        result = response.get_json()
        assert result['success'] == True
        assert duration < 30, f"Upload took {duration:.1f}s (should be < 30s)"
        print(f"✅ Large file upload completed in {duration:.1f}s")
    
    def test_upload_edge_cases(self, authenticated_session, mock_db_operations):
        """Test upload with edge case data."""
        edge_csv = CSVTestData.get_all_test_cases()['edge_cases']
        
        data = {
            'csv_file': (io.BytesIO(edge_csv.encode('utf-8')), 'edge_cases.csv')
        }
        
        response = authenticated_session.post(
            '/portfolio/upload',
            data=data,
            headers={'Accept': 'application/json'}
        )
        
        assert response.status_code == 200
        result = response.get_json()
        assert result['success'] == True
        # Should handle some errors gracefully
        assert "imported" in result['message'].lower()
    
    def test_upload_mixed_transactions(self, authenticated_session, mock_db_operations):
        """Test upload with mixed transaction types (buy, dividend, etc.)."""
        mixed_csv = CSVTestData.get_all_test_cases()['mixed_transactions']
        
        data = {
            'csv_file': (io.BytesIO(mixed_csv.encode('utf-8')), 'mixed.csv')
        }
        
        response = authenticated_session.post(
            '/portfolio/upload',
            data=data,
            headers={'Accept': 'application/json'}
        )
        
        assert response.status_code == 200
        result = response.get_json()
        assert result['success'] == True
        # Should only import buy/transferin transactions
        assert "imported" in result['message'].lower()
    
    def test_upload_international_stocks(self, authenticated_session, mock_db_operations):
        """Test upload with international stocks."""
        intl_csv = CSVTestData.get_all_test_cases()['international']
        
        data = {
            'csv_file': (io.BytesIO(intl_csv.encode('utf-8')), 'international.csv')
        }
        
        response = authenticated_session.post(
            '/portfolio/upload',
            data=data,
            headers={'Accept': 'application/json'}
        )
        
        assert response.status_code == 200
        result = response.get_json()
        assert result['success'] == True
    
    @patch('app.utils.csv_import_simple.backup_database')
    def test_upload_backup_failure(self, mock_backup, authenticated_session):
        """Test upload when backup fails (should fail early)."""
        mock_backup.side_effect = Exception("Backup failed")
        
        csv_data = CSVTestData.get_all_test_cases()['basic']
        data = {
            'csv_file': (io.BytesIO(csv_data.encode('utf-8')), 'test.csv')
        }
        
        response = authenticated_session.post(
            '/portfolio/upload',
            data=data,
            headers={'Accept': 'application/json'}
        )
        
        # Should fail due to backup requirement
        assert response.status_code in [400, 500]
        result = response.get_json()
        assert result['success'] == False
        assert 'backup' in result['message'].lower() or 'failed' in result['message'].lower()
    
    def test_upload_database_error(self, authenticated_session):
        """Test upload when database operations fail."""
        with patch('app.utils.csv_import_simple.backup_database'), \
             patch('app.utils.csv_import_simple.execute_db') as mock_execute:
            
            # Mock database failure
            mock_execute.side_effect = Exception("Database error")
            
            csv_data = CSVTestData.get_all_test_cases()['basic']
            data = {
                'csv_file': (io.BytesIO(csv_data.encode('utf-8')), 'test.csv')
            }
            
            response = authenticated_session.post(
                '/portfolio/upload',
                data=data,
                headers={'Accept': 'application/json'}
            )
            
            assert response.status_code in [400, 500]
            result = response.get_json()
            assert result['success'] == False

class TestUploadFormatVariants:
    """Test different CSV format variants via upload endpoint."""
    
    @pytest.fixture
    def app(self):
        app = create_app({'TESTING': True, 'SECRET_KEY': 'test-secret-key'})
        return app
    
    @pytest.fixture
    def client(self, app):
        with app.test_client() as client:
            yield client
    
    @pytest.fixture
    def authenticated_session(self, client):
        with client.session_transaction() as sess:
            sess['account_id'] = 1
            sess['username'] = 'testuser'
        return client
    
    @pytest.fixture
    def mock_operations(self):
        with patch('app.utils.csv_import_simple.backup_database'), \
             patch('app.utils.csv_import_simple.get_db'), \
             patch('app.utils.csv_import_simple.query_db') as mock_query, \
             patch('app.utils.csv_import_simple.execute_db') as mock_execute, \
             patch('app.utils.csv_import_simple.fetch_price_simple') as mock_fetch:
            
            mock_query.return_value = None
            mock_execute.return_value = True
            mock_fetch.return_value = {'price': 100.00, 'currency': 'USD', 'success': True}
            yield
    
    @pytest.mark.parametrize("variant_name", ['semicolon', 'comma', 'with_bom', 'whitespace'])
    def test_upload_format_variant(self, variant_name, authenticated_session, mock_operations):
        """Test upload with different CSV format variants."""
        variants = CSVTestData.get_format_variants()
        csv_data = variants[variant_name]
        
        data = {
            'csv_file': (io.BytesIO(csv_data.encode('utf-8')), f'{variant_name}_test.csv')
        }
        
        response = authenticated_session.post(
            '/portfolio/upload',
            data=data,
            headers={'Accept': 'application/json'}
        )
        
        assert response.status_code == 200
        result = response.get_json()
        assert result['success'] == True, f"Failed for variant: {variant_name}"
        print(f"✅ {variant_name} format variant uploaded successfully")

if __name__ == "__main__":
    print("🧪 Running Upload Endpoint Integration Tests")
    print("=" * 50)
    print("Run 'pytest tests/test_upload_endpoint.py -v' for full test suite")
