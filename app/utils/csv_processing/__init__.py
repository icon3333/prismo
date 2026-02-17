"""
CSV Processing Module
Refactored from monolithic process_csv_data() function.
Supports both Parqet and IBKR CSV formats with auto-detection.
"""

from .parser import parse_csv_file, detect_csv_format, parse_ibkr_csv
from .company_processor import process_companies, process_companies_snapshot
from .portfolio_handler import assign_portfolios
from .share_calculator import calculate_share_changes, calculate_share_changes_snapshot
from .transaction_manager import apply_share_changes
from .price_updater import update_prices_from_csv

__all__ = [
    'parse_csv_file',
    'detect_csv_format',
    'parse_ibkr_csv',
    'process_companies',
    'process_companies_snapshot',
    'assign_portfolios',
    'calculate_share_changes',
    'calculate_share_changes_snapshot',
    'apply_share_changes',
    'update_prices_from_csv',
]
