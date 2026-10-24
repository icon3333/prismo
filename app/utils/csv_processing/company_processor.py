"""Reconstruct imported holdings and match them without crossing feed ownership."""

import pandas as pd
import logging
from typing import Dict, Tuple
from app.db_manager import query_db

logger = logging.getLogger(__name__)


def _match_existing_companies(
    company_positions: Dict[str, Dict], existing_companies, cursor, source='parqet'
) -> Dict[str, Dict]:
    """Validate all identities/source owners before applying identifier-based renames."""
    by_identifier = {}
    by_name = {}
    for company in existing_companies:
        identifier = str(company.get('identifier') or '').strip().upper()
        if identifier:
            by_identifier.setdefault(identifier, []).append(company)
        by_name.setdefault(company['name'].casefold(), []).append(company)

    incoming_names = {}
    incoming_identifiers = {}
    for name, position in company_positions.items():
        identifier = str(position.get('identifier') or '').strip().upper()
        folded_name = name.casefold()
        if folded_name in incoming_names and incoming_names[folded_name] != identifier:
            raise ValueError(f"Holding identity collision for name '{name}'")
        if identifier in incoming_identifiers and incoming_identifiers[identifier] != folded_name:
            raise ValueError(f"Holding identity collision for identifier '{identifier}'")
        incoming_names[folded_name] = identifier
        incoming_identifiers[identifier] = folded_name

    matched = {}
    used_ids = set()
    for name, position in company_positions.items():
        identifier = str(position.get('identifier') or '').strip().upper()
        id_matches = by_identifier.get(identifier, [])
        name_matches = by_name.get(name.casefold(), [])
        if len(id_matches) > 1 or len(name_matches) > 1:
            raise ValueError(f"Holding identity collision for '{name}'")
        existing = id_matches[0] if id_matches else None
        if name_matches and (not existing or name_matches[0]['id'] != existing['id']):
            raise ValueError(f"Holding identity collision: '{name}' has a different identifier")
        if existing:
            if (existing.get('source') or 'parqet') != source:
                raise ValueError(f"Holding source conflict for '{name}': owned by another source")
            if existing['id'] in used_ids:
                raise ValueError(f"Holding identity collision for '{name}'")
            used_ids.add(existing['id'])
            matched[name] = existing

    # A later conflict must not leave earlier holdings renamed, even for callers
    # that invoke this helper outside the full import transaction.
    for name, existing in matched.items():
        if existing['name'] != name:
            cursor.execute("UPDATE companies SET name = ? WHERE id = ?", (name, existing['id']))
            matched[name] = {**existing, 'name': name}
    return matched


def process_companies(df: pd.DataFrame, account_id: int, cursor) -> Tuple[Dict[str, Dict], Dict[str, Dict]]:
    """Reconstruct a full transaction history in stable chronological order.

    Basis retains the existing proportional-average policy, not FIFO or tax
    accounting. Fees/tax and sale proceeds do not enter remaining purchase basis.
    """
    from app.utils.identifier_normalization import normalize_identifier
    from app.utils.identifier_mapping import get_preferred_identifier

    positions_by_identifier = {}
    names_by_identifier = {}
    identifiers_by_name = {}
    for _, row in df.sort_values('parsed_date', kind='stable').iterrows():
        name = row['holdingname']
        kind = row['type']
        if kind == 'dividend':
            continue
        if pd.isna(row['identifier']) or not str(row['identifier']).strip():
            continue
        identifier = normalize_identifier(
            get_preferred_identifier(account_id, row['identifier']) or row['identifier']
        )
        if name.casefold() in identifiers_by_name and identifiers_by_name[name.casefold()] != identifier:
            raise ValueError(f"Holding identity collision: '{name}' has multiple identifiers")
        shares = round(float(row['shares']), 6)
        if shares <= 0:
            continue
        identifiers_by_name[name.casefold()] = identifier
        # Display names can change within one export; inventory belongs to the
        # normalized identifier, with the latest chronological name for display.
        names_by_identifier[identifier] = name
        if kind in ('sell', 'transferout'):
            company = positions_by_identifier.get(identifier)
            available = company['total_shares'] if company else 0
            if shares - available > 1e-6:
                raise ValueError(
                    f"Incomplete transaction history for '{name}': outgoing shares exceed "
                    "the preceding holdings; import the full history including transfers"
                )
            if company and available > 0:
                sold = min(shares, available)
                company['total_invested'] = round(
                    company['total_invested'] * (1 - sold / available), 2
                )
                company['total_shares'] = round(available - sold, 6)
            continue
        if identifier not in positions_by_identifier:
            positions_by_identifier[identifier] = {
                'identifier': identifier, 'total_shares': 0,
                'total_invested': 0, 'first_bought_date': None,
            }
        company = positions_by_identifier[identifier]
        company['total_shares'] = round(company['total_shares'] + shares, 6)
        company['total_invested'] = round(company['total_invested'] + shares * float(row['price']), 2)
        if company['first_bought_date'] is None:
            company['first_bought_date'] = row['parsed_date']

    company_positions = {
        names_by_identifier[identifier]: position
        for identifier, position in positions_by_identifier.items()
    }
    existing_companies = query_db(
        'SELECT id, name, identifier, total_invested, portfolio_id, source FROM companies WHERE account_id = ?',
        [account_id]
    )
    existing_company_map = _match_existing_companies(company_positions, existing_companies, cursor)
    matched_ids = {matched['id'] for matched in existing_company_map.values()}
    existing_company_map.update({
        c['name']: c for c in existing_companies if c['id'] not in matched_ids
    })
    return existing_company_map, company_positions


def process_companies_snapshot(df: pd.DataFrame, account_id: int, cursor) -> Tuple[Dict[str, Dict], Dict[str, Dict]]:
    """Read IBKR final positions, aggregating lots rather than replaying trades."""
    from app.utils.identifier_normalization import normalize_identifier
    from app.utils.identifier_mapping import get_preferred_identifier

    company_positions = {}
    for idx, row in df.iterrows():
        company_name = row['holdingname']
        if pd.isna(row['identifier']) or not str(row['identifier']).strip():
            logger.warning(f"Skipping row {idx}: missing identifier for {company_name}")
            continue
        shares = round(float(row['shares']), 6)
        if shares <= 0:
            continue
        raw_identifier = row['identifier']
        identifier = get_preferred_identifier(account_id, raw_identifier) or normalize_identifier(raw_identifier)
        if company_name in company_positions and company_positions[company_name]['identifier'] != identifier:
            raise ValueError(f"Holding identity collision: '{company_name}' has multiple identifiers")
        total_invested = float(row['total_invested']) if 'total_invested' in row and pd.notna(row['total_invested']) else 0.0
        first_bought = row.get('first_bought_date')
        investment_type = row.get('investment_type')
        price = float(row['price']) if 'price' in row and pd.notna(row['price']) else None
        currency = row.get('currency', 'USD')
        if company_name in company_positions:
            existing = company_positions[company_name]
            existing['total_shares'] = round(existing['total_shares'] + shares, 6)
            existing['total_invested'] = round(existing['total_invested'] + total_invested, 2)
            if first_bought and (existing['first_bought_date'] is None or first_bought < existing['first_bought_date']):
                existing['first_bought_date'] = first_bought
        else:
            company_positions[company_name] = {
                'identifier': identifier, 'total_shares': shares,
                'total_invested': total_invested, 'first_bought_date': first_bought,
                'investment_type': investment_type, 'price': price, 'currency': currency,
            }

    existing_companies = query_db(
        'SELECT id, name, identifier, total_invested, portfolio_id, source FROM companies WHERE account_id = ?',
        [account_id]
    )
    existing_company_map = _match_existing_companies(
        company_positions, existing_companies, cursor, source='ibkr'
    )
    matched_ids = {matched['id'] for matched in existing_company_map.values()}
    existing_company_map.update({
        c['name']: c for c in existing_companies if c['id'] not in matched_ids
    })
    return existing_company_map, company_positions
