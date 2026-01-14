"""
Share Calculator Module
Calculates share changes and handles user manual edits.
"""

import pandas as pd
import logging
from typing import Dict, Set

logger = logging.getLogger(__name__)

# Standardized epsilon for floating point comparisons
# Use this constant throughout for consistent zero-share detection
SHARE_EPSILON = 1e-6


def calculate_share_changes(
    df: pd.DataFrame,
    company_positions: Dict[str, Dict],
    user_edit_map: Dict[str, Dict]
) -> Dict[str, Dict]:
    """
    Calculate share changes for each company, respecting user manual edits.

    For manually edited companies, this function calculates the net change
    from transactions newer than the manual edit date and applies it to
    both the CSV shares and the user's override shares.

    Args:
        df: DataFrame with parsed transactions (must have 'parsed_date' column)
        company_positions: Dict of company_name -> position data (from process_companies)
        user_edit_map: Dict of company_name -> user edit data (from portfolio_handler)

    Returns:
        Dict[str, Dict]: company_name -> calculated share data
            {
                'csv_shares': float,
                'override_shares': float or None,
                'has_manual_edit': bool,
                'csv_modified_after_edit': bool
            }
    """
    share_calculations = {}

    for company_name, position in company_positions.items():
        current_shares = position['total_shares']

        # Check if user has manually edited this company FIRST
        # (need to process manual edits even for zero-share companies to update overrides)
        if company_name in user_edit_map:
            user_edit_info = user_edit_map[company_name]
            manual_edit_date = user_edit_info['manual_edit_date']
            manual_shares = user_edit_info['manual_shares']

            # Parse manual edit date for comparison
            if manual_edit_date:
                try:
                    # CRITICAL FIX: Ensure timezone-naive comparison
                    # CSV dates may be timezone-aware (UTC), DB dates are naive
                    # Pandas fails silently when comparing aware vs naive
                    manual_edit_datetime = pd.to_datetime(manual_edit_date)
                    if manual_edit_datetime.tz is not None:
                        manual_edit_datetime = manual_edit_datetime.tz_localize(None)

                    # Create a copy of df with timezone-naive dates for comparison
                    df_for_comparison = df.copy()
                    if df_for_comparison['parsed_date'].dt.tz is not None:
                        df_for_comparison['parsed_date'] = df_for_comparison['parsed_date'].dt.tz_localize(None)

                    logger.debug(
                        f"[MANUAL EDIT] {company_name}: manual_date={manual_edit_datetime}, "
                        f"manual_shares={manual_shares}, current_csv_shares={current_shares}"
                    )

                    # Find transactions after the manual edit date
                    newer_transactions = df_for_comparison[
                        (df_for_comparison['holdingname'] == company_name) &
                        (df_for_comparison['parsed_date'] > manual_edit_datetime)
                    ]

                    logger.debug(
                        f"[MANUAL EDIT] {company_name}: found {len(newer_transactions)} "
                        f"transactions after manual edit date"
                    )

                    if not newer_transactions.empty:
                        # Calculate net change from newer transactions
                        net_change = _calculate_net_change(newer_transactions)

                        # Apply the net change to BOTH original CSV shares and user-edited shares
                        final_csv_shares = round(current_shares, 6)
                        final_override_shares = round(manual_shares + net_change, 6)

                        logger.info(
                            f"User-edited shares for {company_name}: csv_shares={final_csv_shares}, "
                            f"manual={manual_shares}, net_change_from_newer_transactions={net_change}, "
                            f"final_override={final_override_shares}"
                        )

                        # Skip if both CSV and override shares are zero (company should be removed)
                        # Use abs() to handle potential negative values from floating point errors
                        if abs(final_csv_shares) <= SHARE_EPSILON and abs(final_override_shares) <= SHARE_EPSILON:
                            logger.info(
                                f"Skipping {company_name} - both CSV and override shares are zero "
                                f"(csv={final_csv_shares}, override={final_override_shares}). "
                                "Company will be marked for removal."
                            )
                            continue

                        share_calculations[company_name] = {
                            'csv_shares': final_csv_shares,
                            'override_shares': final_override_shares,
                            'has_manual_edit': True,
                            'csv_modified_after_edit': True
                        }
                    else:
                        # No newer transactions - update CSV shares but keep user-edited override as is
                        final_csv_shares = round(current_shares, 6)
                        logger.info(
                            f"No newer transactions for user-edited {company_name}, "
                            f"updating CSV shares to: {final_csv_shares}, keeping override: {manual_shares}"
                        )

                        # Skip if both CSV and override shares are zero (company should be removed)
                        # Use abs() to handle potential negative values from floating point errors
                        if abs(final_csv_shares) <= SHARE_EPSILON and abs(manual_shares) <= SHARE_EPSILON:
                            logger.info(
                                f"Skipping {company_name} - both CSV and override shares are zero "
                                f"(csv={final_csv_shares}, override={manual_shares}). "
                                "Company will be marked for removal."
                            )
                            continue

                        share_calculations[company_name] = {
                            'csv_shares': final_csv_shares,
                            'override_shares': manual_shares,
                            'has_manual_edit': True,
                            'csv_modified_after_edit': False
                        }
                except Exception as e:
                    logger.error(f"Error parsing manual edit date for {company_name}: {e}")
                    # Fallback to normal CSV processing
                    share_calculations[company_name] = {
                        'csv_shares': current_shares,
                        'override_shares': None,
                        'has_manual_edit': False,
                        'csv_modified_after_edit': False
                    }
            else:
                # No manual edit date - fallback to normal processing
                share_calculations[company_name] = {
                    'csv_shares': current_shares,
                    'override_shares': None,
                    'has_manual_edit': False,
                    'csv_modified_after_edit': False
                }
        else:
            # No user edit for this company - normal CSV processing
            # Skip companies with zero or negative shares (will be removed)
            # Use abs() to handle potential negative values from floating point errors
            if abs(current_shares) <= SHARE_EPSILON:
                logger.info(
                    f"Skipping {company_name} - CSV shares are zero or negative "
                    f"(shares={current_shares}). Company will be marked for removal."
                )
                continue

            share_calculations[company_name] = {
                'csv_shares': current_shares,
                'override_shares': None,
                'has_manual_edit': False,
                'csv_modified_after_edit': False
            }

    return share_calculations


def _calculate_net_change(transactions: pd.DataFrame) -> float:
    """
    Calculate net share change from a set of transactions using vectorized operations.

    Args:
        transactions: DataFrame of transactions

    Returns:
        float: Net change in shares (positive = bought, negative = sold)
    """
    if transactions.empty:
        return 0.0

    # Vectorized: sum buys, subtract sells (5-10x faster than iterrows())
    buy_mask = transactions['type'].isin(['buy', 'transferin'])
    sell_mask = transactions['type'].isin(['sell', 'transferout'])

    buys = transactions.loc[buy_mask, 'shares'].sum()
    sells = transactions.loc[sell_mask, 'shares'].sum()

    return float(buys - sells)


def identify_companies_to_remove(
    csv_company_names: Set[str],
    db_company_names: Set[str],
    company_positions: Dict[str, Dict]
) -> Set[str]:
    """
    Identify companies to remove from database.

    Companies are removed if:
    1. They exist in DB but not in CSV (removed from portfolio)
    2. They have zero or negative shares after calculations

    Args:
        csv_company_names: Set of company names in CSV
        db_company_names: Set of company names in database
        company_positions: Dict of company_name -> position data

    Returns:
        Set[str]: Company names to remove
    """
    # Companies with zero shares
    companies_with_zero_shares = {
        name for name, position in company_positions.items()
        if position['total_shares'] <= SHARE_EPSILON
    }

    # Companies not in CSV
    companies_not_in_csv = db_company_names - csv_company_names

    # Companies existing in DB with zero shares
    existing_companies_with_zero_shares = companies_with_zero_shares & db_company_names

    # Combine both sets
    companies_to_remove = companies_not_in_csv | existing_companies_with_zero_shares

    # Enhanced logging for debugging zero-share removal
    if companies_with_zero_shares:
        logger.info(f"[REMOVAL] Companies with zero shares in CSV: {companies_with_zero_shares}")
        for name in companies_with_zero_shares:
            shares = company_positions[name]['total_shares']
            logger.debug(f"[REMOVAL] {name}: total_shares={shares}")

    if existing_companies_with_zero_shares:
        logger.info(
            f"[REMOVAL] Companies with zero shares that exist in DB (will be removed): "
            f"{existing_companies_with_zero_shares}"
        )

    if companies_not_in_csv:
        logger.info(f"[REMOVAL] Companies not in CSV (will be removed): {companies_not_in_csv}")

    if companies_to_remove:
        logger.info(
            f"[REMOVAL] Identified {len(companies_to_remove)} companies to remove: "
            f"{len(companies_not_in_csv)} not in CSV, "
            f"{len(existing_companies_with_zero_shares)} with zero shares"
        )
        logger.info(f"[REMOVAL] Complete removal list: {companies_to_remove}")

    return companies_to_remove
