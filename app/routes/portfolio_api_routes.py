from app.routes.portfolio_account_api import (
    api_delete_account, api_delete_stocks_crypto, api_import_account_data,
    api_reset_account_settings, get_account_cash, get_account_info,
    set_account_cash, update_account_username,
)
from app.routes.portfolio_company_api import manage_portfolios, update_portfolio_api
from app.routes.portfolio_data_api import (
    get_portfolio_data_api, get_portfolio_metrics, get_portfolios_api,
    get_simulator_portfolio_data, get_single_portfolio_data_api,
)
from app.routes.portfolio_state_api import manage_state
from app.routes.portfolio_builder_api import builder_investment_targets
from app.routes.portfolio_manual_api import (
    add_company, delete_manual_companies, get_historical_prices_api,
    get_portfolios_for_dropdown, validate_identifier,
)
from app.routes.portfolio_simulator_api import (
    simulator_clone_portfolio, simulator_portfolio_allocations,
    simulator_search_investments, simulator_simulation_create,
    simulator_simulation_delete, simulator_simulation_get,
    simulator_simulation_update, simulator_simulations_list,
    simulator_ticker_lookup,
)
from app.routes.portfolio_updates import (
    bulk_update, get_portfolio_companies, price_fetch_progress,
    update_all_prices, update_selected_prices, update_single_portfolio_api,
)
from app.routes.simple_upload import get_simple_upload_progress, upload_csv_simple
from app.routes.monthly_review_api import (
    complete_monthly_review, create_monthly_review, get_monthly_review,
    list_monthly_reviews, patch_monthly_review,
)


def _register(blueprint, routes):
    for route, view, methods, *endpoint in routes:
        kwargs = {"view_func": view}
        if methods:
            kwargs["methods"] = methods
        if endpoint:
            kwargs["endpoint"] = endpoint[0]
        blueprint.add_url_rule(route, **kwargs)


# (path, view, methods); omitted methods retain Flask's implicit GET/HEAD/OPTIONS.
_CORE = [
    ("/api/state", manage_state, ["GET", "POST"]),
    ("/api/portfolio_companies/<int:portfolio_id>", get_portfolio_companies, None),
    ("/api/portfolio_data", get_portfolio_data_api, ["GET"]),
    ("/api/portfolios", get_portfolios_api, None),
    ("/api/update_portfolio", update_portfolio_api, ["POST"]),
    ("/manage_portfolios", manage_portfolios, ["POST"]),
    ("/api/manage_portfolios", manage_portfolios, ["POST"], "manage_portfolios_api"),
    ("/api/portfolio_metrics", get_portfolio_metrics, ["GET"]),
    ("/api/portfolio_data/<portfolio_id>", get_single_portfolio_data_api, ["GET"]),
]
_UPLOAD = [
    ("/upload", upload_csv_simple, ["POST"], "upload_csv"),
    ("/api/simple_upload_progress", get_simple_upload_progress, ["GET", "DELETE"], "simple_upload_progress"),
]
_PRICES = [
    ("/api/update_portfolio/<int:company_id>", update_single_portfolio_api, ["POST"]),
    ("/api/bulk_update", bulk_update, ["POST"]),
    ("/api/update_all_prices", update_all_prices, ["POST"]),
    ("/api/update_selected_prices", update_selected_prices, ["POST"]),
    ("/api/price_fetch_progress", price_fetch_progress, ["GET"]),
    ("/api/historical_prices", get_historical_prices_api, ["GET"]),
]
_SIMULATOR = [
    ("/api/simulator/portfolio-data", get_simulator_portfolio_data, None),
    ("/api/simulator/ticker-lookup", simulator_ticker_lookup, ["POST"]),
    ("/api/simulator/portfolio-allocations", simulator_portfolio_allocations, ["GET"]),
    ("/api/simulator/simulations", simulator_simulations_list, ["GET"]),
    ("/api/simulator/simulations", simulator_simulation_create, ["POST"]),
    ("/api/simulator/simulations/<int:simulation_id>", simulator_simulation_get, ["GET"]),
    ("/api/simulator/simulations/<int:simulation_id>", simulator_simulation_update, ["PUT"]),
    ("/api/simulator/simulations/<int:simulation_id>", simulator_simulation_delete, ["DELETE"]),
    ("/api/simulator/search-investments", simulator_search_investments, ["GET"]),
    ("/api/simulator/clone-portfolio", simulator_clone_portfolio, ["POST"]),
]
_BUILDER = [("/api/builder/investment-targets", builder_investment_targets, ["GET"])]
_MANUAL = [
    ("/api/add_company", add_company, ["POST"]),
    ("/api/validate_identifier", validate_identifier, ["GET"]),
    ("/api/delete_companies", delete_manual_companies, ["POST"]),
    ("/api/portfolios_dropdown", get_portfolios_for_dropdown, ["GET"]),
]
_ACCOUNT = [
    ("/api/account/cash", get_account_cash, ["GET"]),
    ("/api/account/cash", set_account_cash, ["POST"]),
    ("/api/account", get_account_info, ["GET"]),
    ("/api/account/username", update_account_username, ["PUT"]),
    ("/api/account/reset-settings", api_reset_account_settings, ["POST"]),
    ("/api/account/delete-stocks-crypto", api_delete_stocks_crypto, ["POST"]),
    ("/api/account/delete", api_delete_account, ["POST"]),
    ("/api/account/import", api_import_account_data, ["POST"]),
]
_MONTHLY_REVIEWS = [
    ("/api/monthly-reviews", list_monthly_reviews, ["GET"], "monthly_reviews_list"),
    ("/api/monthly-reviews", create_monthly_review, ["POST"], "monthly_reviews_create"),
    ("/api/monthly-reviews/<int:review_id>", get_monthly_review, ["GET"], "monthly_reviews_get"),
    ("/api/monthly-reviews/<int:review_id>", patch_monthly_review, ["PATCH"], "monthly_reviews_patch"),
    ("/api/monthly-reviews/<int:review_id>/complete", complete_monthly_review, ["POST"], "monthly_reviews_complete"),
]


def register_portfolio_api_routes(portfolio_bp):
    for table in (_CORE, _UPLOAD, _PRICES, _SIMULATOR, _BUILDER, _MANUAL, _ACCOUNT, _MONTHLY_REVIEWS):
        _register(portfolio_bp, table)
