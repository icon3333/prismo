"""
Test module for the Country Investment Capacity feature.

This module tests the new country capacity API endpoint and related functionality.
"""

import pytest
import json
import sys
import os
from unittest.mock import patch, MagicMock

# Add the project root to the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask
from app.routes.portfolio_api import get_country_capacity_data


@pytest.fixture
def app():
    """Create and configure a test Flask application."""
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['SECRET_KEY'] = 'test_secret_key'
    return app


@pytest.fixture 
def app_context(app):
    """Create an application context for tests."""
    with app.app_context():
        yield app


def test_country_capacity_data_unauthenticated(app_context):
    """Test that the API returns 401 when user is not authenticated."""
    with patch('app.routes.portfolio_api.session', {}):
        response = get_country_capacity_data()
        assert response[1] == 401
        data = response[0].get_json()
        assert data['error'] == 'Not authenticated'


def test_country_capacity_data_no_data(app_context):
    """Test the API when user has no budget/rules data configured."""
    mock_session = {'account_id': 1}
    mock_query_responses = [None, None, []]  # No budget data, no rules data, no country data
    
    with patch('app.routes.portfolio_api.session', mock_session), \
         patch('app.routes.portfolio_api.query_db', side_effect=mock_query_responses):
        
        response = get_country_capacity_data()
        data = response.get_json()
        
        assert 'countries' in data
        assert len(data['countries']) == 0
        assert data['total_investable_capital'] == 0
        assert data['max_per_country_percent'] == 10  # Default value


def test_country_capacity_calculation(app_context):
    """Test the capacity calculation logic with sample data."""
    mock_session = {'account_id': 1}
    
    # Mock budget data: 100,000 total investable capital
    mock_budget_data = {
        'variable_value': json.dumps({'totalInvestableCapital': 100000})
    }
    
    # Mock rules data: 20% max per country
    mock_rules_data = {
        'variable_value': json.dumps({'maxPerCountry': 20})
    }
    
    # Mock position data (individual positions instead of aggregated)
    mock_position_data = [
        {'country': 'USA', 'company_name': 'Apple Inc', 'portfolio_name': 'Tech Portfolio', 'shares': 10, 'price': 150, 'position_value': 1500},
        {'country': 'USA', 'company_name': 'Microsoft', 'portfolio_name': 'Tech Portfolio', 'shares': 5, 'price': 300, 'position_value': 1500},
        {'country': 'USA', 'company_name': 'Google', 'portfolio_name': 'Tech Portfolio', 'shares': 3, 'price': 4000, 'position_value': 12000},  # Total USA: 15000
        {'country': 'Germany', 'company_name': 'SAP', 'portfolio_name': 'Euro Portfolio', 'shares': 100, 'price': 120, 'position_value': 12000},
        {'country': 'Germany', 'company_name': 'Siemens', 'portfolio_name': 'Euro Portfolio', 'shares': 50, 'price': 260, 'position_value': 13000},  # Total Germany: 25000
        {'country': 'China', 'company_name': 'Alibaba', 'portfolio_name': 'Asia Portfolio', 'shares': 20, 'price': 500, 'position_value': 10000},  # Total China: 10000
    ]
    
    mock_query_responses = [mock_budget_data, mock_rules_data, mock_position_data]
    
    with patch('app.routes.portfolio_api.session', mock_session), \
         patch('app.routes.portfolio_api.query_db', side_effect=mock_query_responses):
        
        response = get_country_capacity_data()
        data = response.get_json()
        
        assert data['total_investable_capital'] == 100000
        assert data['max_per_country_percent'] == 20
        assert len(data['countries']) == 3
        
        # Check capacity calculations (max allowed = 100,000 * 20% = 20,000)
        countries_by_name = {c['country']: c for c in data['countries']}
        
        # USA: 20,000 - 15,000 = 5,000 remaining
        assert countries_by_name['USA']['remaining_capacity'] == 5000
        assert countries_by_name['USA']['current_invested'] == 15000
        assert len(countries_by_name['USA']['positions']) == 3  # Apple, Microsoft, Google
        
        # Germany: 20,000 - 25,000 = -5,000, but clamped to 0
        assert countries_by_name['Germany']['remaining_capacity'] == 0
        assert countries_by_name['Germany']['current_invested'] == 25000
        assert len(countries_by_name['Germany']['positions']) == 2  # SAP, Siemens
        
        # China: 20,000 - 10,000 = 10,000 remaining
        assert countries_by_name['China']['remaining_capacity'] == 10000
        assert countries_by_name['China']['current_invested'] == 10000
        assert len(countries_by_name['China']['positions']) == 1  # Alibaba
        
        # Should be sorted by remaining capacity (ascending)
        capacities = [c['remaining_capacity'] for c in data['countries']]
        assert capacities == sorted(capacities)
        
        # Check that positions have the correct structure
        usa_positions = countries_by_name['USA']['positions']
        assert any(pos['company_name'] == 'Apple Inc' and pos['value'] == 1500 for pos in usa_positions)
        assert any(pos['company_name'] == 'Google' and pos['value'] == 12000 for pos in usa_positions)


if __name__ == '__main__':
    pytest.main([__file__])
