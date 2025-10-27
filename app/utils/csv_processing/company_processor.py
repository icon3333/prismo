"""
Company Processor Module
Handles company record processing and identifier mapping.
"""

import pandas as pd
import logging
from typing import Dict, Tuple
from app.db_manager import query_db

logger = logging.getLogger(__name__)


def process_companies(df: pd.DataFrame, account_id: int, cursor) -> Tuple[Dict[str, int], Dict[str, Dict]]:
    """
    Process company records from CSV and create identifier mappings.

    This function:
    1. Normalizes identifiers using user preferences and standard normalization
    2. Calculates share positions through two-pass buy/sell processing
    3. Returns mappings for database operations

    Args:
        df: DataFrame with parsed CSV data
        account_id: Account ID for this import
        cursor: Database cursor for queries

    Returns:
        Tuple of:
        - Dict[str, int]: company_name -> company_id mapping
        - Dict[str, Dict]: company_name -> position data (shares, invested, identifier)
    """
    from app.utils.identifier_normalization import normalize_identifier
    from app.utils.identifier_mapping import get_preferred_identifier

    logger.info("FIRST PASS: Processing buy and transferin transactions")

    company_positions = {}
    total_transactions = len(df)

    # First pass: Accumulate buys and transfers in
    for idx, row in df.iterrows():
        company_name = row['holdingname']
        transaction_type = row['type']

        # Check for NaN identifier
        if pd.isna(row['identifier']) or not str(row['identifier']).strip():
            logger.warning(f"Skipping transaction {idx}: missing identifier for {company_name}")
            continue

        if transaction_type == 'dividend':
            logger.info(f"Skipping dividend transaction for {company_name}")
            continue

        if transaction_type not in ['buy', 'transferin']:
            continue

        shares = round(float(row['shares']), 6)
        price = float(row['price'])
        raw_identifier = row['identifier']

        # Check for user's preferred identifier mapping first
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
            logger.info(f"Skipping {transaction_type} transaction with zero shares for {company_name}")
            continue

        # Initialize or update company position
        if company_name not in company_positions:
            company_positions[company_name] = {
                'identifier': identifier,
                'total_shares': 0,
                'total_invested': 0,
            }

        company = company_positions[company_name]
        transaction_amount = shares * price
        company['total_shares'] = round(company['total_shares'] + shares, 6)
        company['total_invested'] = round(company['total_invested'] + transaction_amount, 2)

        logger.info(
            f"Buy/TransferIn: {company_name}, +{shares} @ {price}, "
            f"total shares: {company['total_shares']}, total invested: {company['total_invested']:.2f}"
        )

    # Second pass: Process sells and transfers out
    logger.info("SECOND PASS: Processing sell and transferout transactions")

    for idx, row in df.iterrows():
        company_name = row['holdingname']
        transaction_type = row['type']

        # Check for NaN identifier for consistency
        if pd.isna(row['identifier']) or not str(row['identifier']).strip():
            logger.warning(f"Skipping transaction {idx}: missing identifier for {company_name}")
            continue

        if transaction_type == 'dividend':
            logger.info(f"Skipping dividend transaction for {company_name}")
            continue

        if transaction_type not in ['sell', 'transferout']:
            continue

        shares = round(float(row['shares']), 6)
        price = float(row['price'])
        fee = float(row['fee']) if 'fee' in row else 0
        tax = float(row['tax']) if 'tax' in row else 0

        if shares <= 0:
            logger.info(f"Skipping {transaction_type} transaction with zero shares for {company_name}")
            continue

        if company_name not in company_positions:
            logger.warning(
                f"Cannot {transaction_type} shares of {company_name} - company not in positions"
            )
            continue

        company = company_positions[company_name]
        logger.info(
            f"Processing {transaction_type} of {shares} shares for {company_name} "
            f"(current total: {company['total_shares']})"
        )

        # Validate and limit shares to available amount
        if shares > (company['total_shares'] + 1e-6):
            logger.warning(
                f"Attempting to {transaction_type} more shares ({shares}) than available "
                f"({company['total_shares']}). Limiting to available shares."
            )
            shares = company['total_shares']

        if shares <= 0:
            logger.info(f"Skipping {transaction_type} with zero or negative shares")
            continue

        # Calculate proportional reduction
        proportion_sold = shares / company['total_shares'] if company['total_shares'] > 0 else 0
        investment_reduction = company['total_invested'] * proportion_sold

        company['total_shares'] = round(company['total_shares'] - shares, 6)
        company['total_invested'] = round(company['total_invested'] - investment_reduction, 2)

    # Get existing companies for mapping
    existing_companies = query_db(
        'SELECT id, name, identifier, total_invested, portfolio_id FROM companies WHERE account_id = ?',
        [account_id]
    )
    existing_company_map = {c['name']: c for c in existing_companies}

    return existing_company_map, company_positions
