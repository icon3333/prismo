"""
Business logic for company/security operations.

Pure Python - no Flask dependencies.
Philosophy: Simple, clear operations for managing portfolio holdings.
"""

from typing import Dict, Optional, Any
import logging
from app.utils.text_normalization import normalize_sector, normalize_country

logger = logging.getLogger(__name__)


class CompanyService:
    """Business logic for company/security operations"""

    @staticmethod
    def add_company_manual(account_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Add a company manually (with or without identifier).

        Args:
            account_id: Account ID
            data: Company data from request containing:
                - name (required): Company name
                - identifier (optional): Ticker/ISIN for price lookup
                - portfolio_id (optional): Portfolio ID (None = unassigned)
                - sector (required): Sector name
                - investment_type (optional): 'Stock' or 'ETF'
                - country (optional): Country code
                - shares (required): Number of shares (>0)
                - total_value (conditional): Required if no identifier

        Returns:
            dict with success status and company_id or error
        """
        from app.repositories.portfolio_repository import PortfolioRepository
        from app.repositories.price_repository import PriceRepository

        # 1. Validate input
        validation_result = CompanyService._validate_add_company_input(data)
        if not validation_result['valid']:
            return {'success': False, 'error': validation_result['error']}

        name = data.get('name', '').strip()
        identifier = (data.get('identifier') or '').strip() or None
        portfolio_id = data.get('portfolio_id')
        sector = normalize_sector(data.get('sector', ''))
        investment_type = data.get('investment_type')
        country = normalize_country(data.get('country'))
        shares = float(data.get('shares', 0))
        total_value = data.get('total_value')

        # Validate investment_type if provided
        if investment_type and investment_type not in ('Stock', 'ETF'):
            investment_type = None

        # 2. Check for duplicates (block completely per PRD)
        duplicate = PortfolioRepository.find_duplicate_company(
            account_id, name, identifier
        )
        if duplicate:
            return {
                'success': False,
                'error': 'duplicate',
                'existing': {
                    'id': duplicate['id'],
                    'name': duplicate['name'],
                    'portfolio_name': duplicate.get('portfolio_name', 'Unassigned')
                }
            }

        # 3. Fetch price if identifier provided
        price_data = None
        if identifier:
            price_data = CompanyService._fetch_identifier_price(identifier)
            logger.info(f"Price lookup for {identifier}: {price_data}")

        # 4. Determine if custom value mode
        is_custom = price_data is None
        custom_total_value = None
        custom_price_eur = None

        if is_custom:
            # Need total_value for custom mode
            if total_value is None or total_value <= 0:
                return {
                    'success': False,
                    'error': 'Total value is required when identifier is not provided or price lookup fails'
                }
            custom_total_value = float(total_value)
            custom_price_eur = custom_total_value / shares if shares > 0 else 0

        # Use country from price data if not provided and available
        if not country and price_data:
            country = price_data.get('country')

        # 5. Insert via repository
        try:
            company_id = PortfolioRepository.create_company_manual(
                account_id=account_id,
                portfolio_id=portfolio_id,
                name=name,
                identifier=identifier,
                sector=sector,
                investment_type=investment_type,
                country=country,
                shares=shares,
                is_custom_value=is_custom,
                custom_total_value=custom_total_value,
                custom_price_eur=custom_price_eur,
                source='manual'
            )
        except Exception as e:
            logger.error(f"Failed to create company: {e}")
            return {'success': False, 'error': str(e)}

        # 6. Update market_prices if we have price data
        if price_data and identifier:
            try:
                PriceRepository.upsert_price(
                    identifier=identifier,
                    price=price_data.get('price'),
                    currency=price_data.get('currency', 'EUR'),
                    price_eur=price_data.get('price_eur'),
                    country=price_data.get('country')
                )
            except Exception as e:
                logger.warning(f"Failed to store price for {identifier}: {e}")
                # Don't fail the whole operation for price storage failure

        logger.info(f"Created manual company {name} (ID: {company_id}) for account {account_id}")

        return {
            'success': True,
            'company_id': company_id,
            'message': f"Added {name}",
            'is_custom_value': is_custom
        }

    @staticmethod
    def _validate_add_company_input(data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate input data for adding a company.

        Returns:
            dict with 'valid' boolean and optional 'error' message
        """
        # Required fields
        name = data.get('name', '').strip()
        if not name:
            return {'valid': False, 'error': 'Company name is required'}
        if len(name) > 200:
            return {'valid': False, 'error': 'Company name must be 200 characters or less'}

        sector = data.get('sector', '').strip()
        if not sector:
            return {'valid': False, 'error': 'Sector is required'}
        if len(sector) > 100:
            return {'valid': False, 'error': 'Sector must be 100 characters or less'}

        # Shares validation
        shares = data.get('shares')
        if shares is None:
            return {'valid': False, 'error': 'Shares is required'}
        try:
            shares_float = float(shares)
            if shares_float <= 0:
                return {'valid': False, 'error': 'Shares must be greater than 0'}
        except (ValueError, TypeError):
            return {'valid': False, 'error': 'Shares must be a valid number'}

        # Identifier validation (optional, but if provided must be reasonable)
        identifier = (data.get('identifier') or '').strip()
        if identifier and len(identifier) > 50:
            return {'valid': False, 'error': 'Identifier must be 50 characters or less'}

        return {'valid': True}

    @staticmethod
    def _fetch_identifier_price(identifier: str) -> Optional[Dict[str, Any]]:
        """
        Fetch price data from yfinance for an identifier.

        Args:
            identifier: Ticker symbol or ISIN

        Returns:
            dict with price, currency, price_eur, country or None if not found
        """
        try:
            from app.utils.yfinance_utils import get_isin_data
            from app.utils.identifier_normalization import normalize_identifier

            # Normalize the identifier
            normalized = normalize_identifier(identifier)
            if not normalized:
                normalized = identifier

            # Fetch data from yfinance
            result = get_isin_data(normalized)

            if result and result.get('price_eur'):
                return {
                    'price': result.get('price'),
                    'currency': result.get('currency', 'EUR'),
                    'price_eur': result.get('price_eur'),
                    'country': result.get('country')
                }

            return None

        except Exception as e:
            logger.warning(f"Failed to fetch price for {identifier}: {e}")
            return None

    @staticmethod
    def validate_identifier(identifier: str) -> Dict[str, Any]:
        """
        Validate an identifier by attempting to fetch its price.

        Used by the frontend for real-time validation.

        Args:
            identifier: Ticker symbol or ISIN

        Returns:
            dict with success status and price_data or error
        """
        if not identifier or not identifier.strip():
            return {'success': False, 'error': 'Identifier is required'}

        price_data = CompanyService._fetch_identifier_price(identifier.strip())

        if price_data:
            return {
                'success': True,
                'price_data': price_data
            }
        else:
            return {
                'success': False,
                'error': 'Identifier not found in yfinance'
            }

    @staticmethod
    def delete_manual_companies(account_id: int, company_ids: list) -> Dict[str, Any]:
        """
        Delete manually-added companies.

        Only companies with source='manual' can be deleted.

        Args:
            account_id: Account ID
            company_ids: List of company IDs to delete

        Returns:
            dict with success status and count of deleted companies
        """
        from app.repositories.portfolio_repository import PortfolioRepository

        if not company_ids:
            return {'success': False, 'error': 'No companies specified'}

        deleted_count = 0
        skipped_count = 0

        for company_id in company_ids:
            result = PortfolioRepository.delete_manual_company(account_id, company_id)
            if result:
                deleted_count += 1
            else:
                skipped_count += 1

        return {
            'success': True,
            'deleted_count': deleted_count,
            'skipped_count': skipped_count,
            'message': f"Deleted {deleted_count} company(ies)"
        }
