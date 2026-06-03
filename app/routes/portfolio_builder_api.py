import logging

from flask import g, jsonify

from app.db_manager import get_db
from app.decorators import require_auth
from app.utils.response_helpers import error_response, success_response


logger = logging.getLogger(__name__)


@require_auth
def builder_investment_targets():
    """
    Get Builder investment targets for cross-page integration.

    GET /portfolio/api/builder/investment-targets

    Returns:
        JSON with budget data and portfolio targets from Builder configuration.
        Used by Simulator to show "Remaining to Invest" progress.
    """
    try:
        from app.services.builder_service import BuilderService

        account_id = g.account_id
        db = get_db()
        service = BuilderService(db)

        targets = service.get_investment_targets(account_id)

        if not targets:
            return jsonify({
                'success': False,
                'error': 'no_builder_data',
                'message': 'No allocation targets configured. Please set up your budget in the Builder page.'
            }), 404

        # Validate completeness
        missing_fields = []
        if targets['budget']['totalNetWorth'] <= 0:
            missing_fields.append('totalNetWorth')
        if not targets['portfolioTargets']:
            missing_fields.append('portfolioAllocations')
        if targets['totals']['totalAllocationPercent'] < 100:
            missing_fields.append('completeAllocation')

        if missing_fields:
            return jsonify({
                'success': False,
                'error': 'incomplete_builder_data',
                'message': f'Builder configuration incomplete. Missing: {", ".join(missing_fields)}.',
                'missingFields': missing_fields,
                'partialData': targets  # Include partial data for UI flexibility
            }), 400

        logger.info(f"Returning investment targets for account {account_id}: {len(targets['portfolioTargets'])} portfolios")
        return success_response(targets)

    except Exception as e:
        logger.exception("Error getting investment targets")
        return error_response('Failed to get investment targets', 500)


# ============================================================================
# Account Cash API
# ============================================================================
