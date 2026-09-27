"""Allocation categories and Builder progress share one calculation path."""

from app.routes.portfolio_simulator_api import _allocation_breakdown, _investment_progress


def test_allocation_breakdown_preserves_fallbacks_order_and_cash_denominator():
    positions = [
        {'country': None, 'sector': 'Tech', 'thesis': '  ', 'value': 25},
        {'country': 'DE', 'sector': None, 'thesis': 'Core', 'value': 50},
        {'country': 'DE', 'sector': 'Tech', 'thesis': ' Core ', 'value': 25},
    ]
    assert _allocation_breakdown(positions, 'country', 200) == [
        {'name': 'DE', 'value': 75, 'percentage': 37.5},
        {'name': 'Unknown', 'value': 25, 'percentage': 12.5},
    ]
    assert _allocation_breakdown(positions, 'sector', 200) == [
        {'name': 'Tech', 'value': 50, 'percentage': 25},
        {'name': 'Unknown', 'value': 50, 'percentage': 25},
    ]
    assert _allocation_breakdown(positions, 'thesis', 200) == [
        {'name': 'Core', 'value': 75, 'percentage': 37.5},
        {'name': 'Unassigned', 'value': 25, 'percentage': 12.5},
    ]
    assert _allocation_breakdown(positions, 'country', 0)[0]['percentage'] == 0


def test_progress_handles_zero_target_and_over_target():
    assert _investment_progress(0, 50) == {
        'targetAmount': 0,
        'remainingToInvest': 0,
        'percentComplete': 0,
        'isOverTarget': True,
    }
    assert _investment_progress(40, 50) == {
        'targetAmount': 40,
        'remainingToInvest': 0,
        'percentComplete': 125,
        'isOverTarget': True,
    }
