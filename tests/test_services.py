"""
Tests for service layer business logic.

Tests the service modules (allocation, portfolio, price) with pure Python tests.
"""

import pytest
from decimal import Decimal
from app.services.allocation_service import AllocationService, AllocationRule
from app.services.portfolio_service import PortfolioService
from app.services.price_service import PriceService
from datetime import datetime, timedelta


class TestAllocationService:
    """Tests for AllocationService"""

    def test_proportional_allocation(self):
        """Test proportional allocation calculation"""
        service = AllocationService()

        portfolio_data = [
            {
                'id': 1,
                'name': 'Apple',
                'identifier': 'AAPL',
                'price_eur': 150,
                'current_value': 1500
            },
            {
                'id': 2,
                'name': 'Microsoft',
                'identifier': 'MSFT',
                'price_eur': 380,
                'current_value': 1900
            }
        ]

        target_allocations = {
            1: 60.0,  # 60% to Apple
            2: 40.0   # 40% to Microsoft
        }

        investment_amount = Decimal('1000')

        recommendations = service.calculate_rebalancing(
            portfolio_data,
            target_allocations,
            investment_amount,
            mode='proportional'
        )

        assert len(recommendations) == 2
        # Use quantize for floating point comparison
        assert recommendations[0].amount_to_buy.quantize(Decimal('0.01')) == Decimal('600.00')
        assert recommendations[1].amount_to_buy.quantize(Decimal('0.01')) == Decimal('400.00')

    def test_equal_weight_allocation(self):
        """Test equal weight allocation calculation"""
        service = AllocationService()

        portfolio_data = [
            {'id': 1, 'name': 'Apple', 'identifier': 'AAPL', 'price_eur': 150, 'current_value': 1500},
            {'id': 2, 'name': 'Microsoft', 'identifier': 'MSFT', 'price_eur': 380, 'current_value': 1900},
            {'id': 3, 'name': 'Google', 'identifier': 'GOOGL', 'price_eur': 140, 'current_value': 1400}
        ]

        investment_amount = Decimal('900')

        recommendations = service.calculate_rebalancing(
            portfolio_data,
            {},
            investment_amount,
            mode='equal_weight'
        )

        assert len(recommendations) == 3
        # Each should get 300 (900/3)
        for rec in recommendations:
            assert rec.amount_to_buy == Decimal('300')

    def test_allocation_validation_success(self):
        """Test allocation validation with valid data"""
        # Create rules that allow up to 60% per stock
        rules = AllocationRule(max_stock_percentage=60.0)
        service = AllocationService(rules)
        allocations = {1: 60.0, 2: 40.0}

        is_valid, error = service.validate_allocations(allocations)

        assert is_valid is True
        assert error is None

    def test_allocation_validation_not_100_percent(self):
        """Test allocation validation fails if not 100%"""
        service = AllocationService()
        allocations = {1: 60.0, 2: 30.0}  # Only 90%

        is_valid, error = service.validate_allocations(allocations)

        assert is_valid is False
        assert "sum to 100%" in error

    def test_allocation_validation_exceeds_max_stock(self):
        """Test allocation validation fails if exceeds max stock %"""
        rules = AllocationRule(max_stock_percentage=5.0)
        service = AllocationService(rules)

        allocations = {1: 10.0, 2: 90.0}  # 10% exceeds 5% limit

        is_valid, error = service.validate_allocations(allocations)

        assert is_valid is False
        assert "exceeds max" in error

    def test_normalize_allocations(self):
        """Test allocation normalization"""
        service = AllocationService()
        allocations = {1: 30.0, 2: 20.0}  # Only 50% total

        normalized = service.normalize_allocations(allocations)

        assert normalized[1] == 60.0  # 30/50 * 100
        assert normalized[2] == 40.0  # 20/50 * 100


class TestPortfolioService:
    """Tests for PortfolioService"""

    def test_calculate_portfolio_value(self):
        """Test total portfolio value calculation"""
        holdings = [
            {'shares': 10, 'price_eur': 150},  # 1500
            {'shares': 5, 'price_eur': 380}    # 1900
        ]

        total_value = PortfolioService.calculate_portfolio_value(holdings)

        assert total_value == Decimal('3400')

    def test_calculate_portfolio_value_empty(self):
        """Test portfolio value calculation with empty holdings"""
        holdings = []

        total_value = PortfolioService.calculate_portfolio_value(holdings)

        assert total_value == Decimal('0')

    def test_calculate_asset_allocation(self):
        """Test asset allocation by category"""
        holdings = [
            {'category': 'Tech', 'shares': 10, 'price_eur': 150},  # 1500
            {'category': 'Tech', 'shares': 5, 'price_eur': 380},   # 1900
            {'category': 'ETF', 'shares': 20, 'price_eur': 75}     # 1500
        ]

        allocations = PortfolioService.calculate_asset_allocation(holdings)

        # Total = 4900
        # Tech = 3400/4900 = 69.39%
        # ETF = 1500/4900 = 30.61%
        assert abs(allocations['Tech'] - Decimal('69.39')) < Decimal('0.5')
        assert abs(allocations['ETF'] - Decimal('30.61')) < Decimal('0.5')

    def test_calculate_geographic_allocation(self):
        """Test allocation by country"""
        holdings = [
            {'country': 'US', 'shares': 10, 'price_eur': 100},  # 1000
            {'country': 'IE', 'shares': 10, 'price_eur': 100}   # 1000
        ]

        allocations = PortfolioService.calculate_geographic_allocation(holdings)

        assert allocations['US'] == Decimal('50')
        assert allocations['IE'] == Decimal('50')

    def test_identify_underweight_positions(self):
        """Test identifying underweight positions"""
        current = {1: Decimal('10.0'), 2: Decimal('15.0'), 3: Decimal('5.0')}
        target = {1: Decimal('15.0'), 2: Decimal('15.0'), 3: Decimal('10.0')}

        underweight = PortfolioService.identify_underweight_positions(
            current, target, threshold=Decimal('2.0')
        )

        # Position 1: target 15%, current 10% = 5% underweight (flagged)
        # Position 2: target 15%, current 15% = 0% (not flagged)
        # Position 3: target 10%, current 5% = 5% underweight (flagged)
        assert 1 in underweight
        assert 2 not in underweight
        assert 3 in underweight

    def test_calculate_position_size(self):
        """Test position size calculation"""
        holding_value = Decimal('1000')
        portfolio_value = Decimal('10000')

        position_size = PortfolioService.calculate_position_size(
            holding_value, portfolio_value
        )

        assert position_size == Decimal('10')  # 10%

    def test_calculate_position_size_zero_portfolio(self):
        """Test position size with zero portfolio value"""
        holding_value = Decimal('1000')
        portfolio_value = Decimal('0')

        position_size = PortfolioService.calculate_position_size(
            holding_value, portfolio_value
        )

        assert position_size == Decimal('0')


class TestPriceService:
    """Tests for PriceService"""

    def test_convert_to_eur_same_currency(self):
        """Test currency conversion for EUR to EUR"""
        amount = Decimal('100')
        result = PriceService.convert_to_eur(amount, 'EUR', {})

        assert result == Decimal('100')

    def test_convert_to_eur_with_rate(self):
        """Test currency conversion with exchange rate"""
        amount = Decimal('100')
        rates = {'USD': Decimal('0.92')}

        result = PriceService.convert_to_eur(amount, 'USD', rates)

        assert result == Decimal('92.0')

    def test_calculate_price_change(self):
        """Test price change calculation"""
        current = Decimal('110')
        previous = Decimal('100')

        change_amount, change_pct = PriceService.calculate_price_change(
            current, previous
        )

        assert change_amount == Decimal('10')
        assert change_pct == Decimal('10')

    def test_calculate_price_change_zero_previous(self):
        """Test price change with zero previous price"""
        current = Decimal('110')
        previous = Decimal('0')

        change_amount, change_pct = PriceService.calculate_price_change(
            current, previous
        )

        assert change_amount == Decimal('0')
        assert change_pct == Decimal('0')

    def test_calculate_average_price(self):
        """Test average price calculation"""
        prices = [Decimal('100'), Decimal('110'), Decimal('105')]

        avg = PriceService.calculate_average_price(prices)

        assert avg == Decimal('105')

    def test_calculate_average_price_empty(self):
        """Test average price with empty list"""
        prices = []

        avg = PriceService.calculate_average_price(prices)

        assert avg == Decimal('0')

    def test_is_stale_price_not_stale(self):
        """Test stale price detection for recent price"""
        last_updated = datetime.now() - timedelta(hours=12)

        is_stale = PriceService.is_stale_price(last_updated, max_age_hours=24)

        assert is_stale is False

    def test_is_stale_price_stale(self):
        """Test stale price detection for old price"""
        last_updated = datetime.now() - timedelta(hours=48)

        is_stale = PriceService.is_stale_price(last_updated, max_age_hours=24)

        assert is_stale is True

    def test_format_price(self):
        """Test price formatting"""
        price = Decimal('1234.56')

        formatted = PriceService.format_price(price, 'EUR', 2)

        assert '€' in formatted
        assert '1234.56' in formatted
