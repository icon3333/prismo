from flask import Flask

from app.routes.portfolio_routes import portfolio_bp


# Captured from the pre-refactor blueprint map. Keep this independent of the
# registration tables so an omitted or altered declaration fails loudly.
EXPECTED = {
    "/portfolio/api/state": {"manage_state": {"GET", "POST", "HEAD", "OPTIONS"}},
    "/portfolio/api/portfolio_companies/<int:portfolio_id>": {"get_portfolio_companies": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/portfolio_data": {"get_portfolio_data_api": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/portfolios": {"get_portfolios_api": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/update_portfolio": {"update_portfolio_api": {"POST", "OPTIONS"}},
    "/portfolio/manage_portfolios": {"manage_portfolios": {"POST", "OPTIONS"}},
    "/portfolio/api/manage_portfolios": {"manage_portfolios_api": {"POST", "OPTIONS"}},
    "/portfolio/api/portfolio_metrics": {"get_portfolio_metrics": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/portfolio_data/<portfolio_id>": {"get_single_portfolio_data_api": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/upload": {"upload_csv": {"POST", "OPTIONS"}},
    "/portfolio/api/simple_upload_progress": {"simple_upload_progress": {"GET", "DELETE", "HEAD", "OPTIONS"}},
    "/portfolio/api/update_portfolio/<int:company_id>": {"update_single_portfolio_api": {"POST", "OPTIONS"}},
    "/portfolio/api/bulk_update": {"bulk_update": {"POST", "OPTIONS"}},
    "/portfolio/api/update_all_prices": {"update_all_prices": {"POST", "OPTIONS"}},
    "/portfolio/api/update_selected_prices": {"update_selected_prices": {"POST", "OPTIONS"}},
    "/portfolio/api/price_fetch_progress": {"price_fetch_progress": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/historical_prices": {"get_historical_prices_api": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/simulator/portfolio-data": {"get_simulator_portfolio_data": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/simulator/ticker-lookup": {"simulator_ticker_lookup": {"POST", "OPTIONS"}},
    "/portfolio/api/simulator/portfolio-allocations": {"simulator_portfolio_allocations": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/simulator/simulations": {"simulator_simulations_list": {"GET", "HEAD", "OPTIONS"}, "simulator_simulation_create": {"POST", "OPTIONS"}},
    "/portfolio/api/simulator/simulations/<int:simulation_id>": {"simulator_simulation_get": {"GET", "HEAD", "OPTIONS"}, "simulator_simulation_update": {"PUT", "OPTIONS"}, "simulator_simulation_delete": {"DELETE", "OPTIONS"}},
    "/portfolio/api/simulator/search-investments": {"simulator_search_investments": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/simulator/clone-portfolio": {"simulator_clone_portfolio": {"POST", "OPTIONS"}},
    "/portfolio/api/builder/investment-targets": {"builder_investment_targets": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/add_company": {"add_company": {"POST", "OPTIONS"}},
    "/portfolio/api/validate_identifier": {"validate_identifier": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/delete_companies": {"delete_manual_companies": {"POST", "OPTIONS"}},
    "/portfolio/api/portfolios_dropdown": {"get_portfolios_for_dropdown": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/account/cash": {"get_account_cash": {"GET", "HEAD", "OPTIONS"}, "set_account_cash": {"POST", "OPTIONS"}},
    "/portfolio/api/account": {"get_account_info": {"GET", "HEAD", "OPTIONS"}},
    "/portfolio/api/account/username": {"update_account_username": {"PUT", "OPTIONS"}},
    "/portfolio/api/account/reset-settings": {"api_reset_account_settings": {"POST", "OPTIONS"}},
    "/portfolio/api/account/delete-stocks-crypto": {"api_delete_stocks_crypto": {"POST", "OPTIONS"}},
    "/portfolio/api/account/delete": {"api_delete_account": {"POST", "OPTIONS"}},
    "/portfolio/api/account/import": {"api_import_account_data": {"POST", "OPTIONS"}},
    "/portfolio/api/monthly-reviews": {"monthly_reviews_list": {"GET", "HEAD", "OPTIONS"}, "monthly_reviews_create": {"POST", "OPTIONS"}},
    "/portfolio/api/monthly-reviews/<int:review_id>": {"monthly_reviews_get": {"GET", "HEAD", "OPTIONS"}, "monthly_reviews_patch": {"PATCH", "OPTIONS"}},
    "/portfolio/api/monthly-reviews/<int:review_id>/complete": {"monthly_reviews_complete": {"POST", "OPTIONS"}},
}


def test_portfolio_blueprint_route_contract():
    app = Flask(__name__)
    app.register_blueprint(portfolio_bp)
    actual = {}
    for rule in app.url_map.iter_rules():
        if rule.endpoint.startswith("portfolio."):
            actual.setdefault(rule.rule, {})[rule.endpoint.removeprefix("portfolio.")] = set(rule.methods or ())
    assert actual == EXPECTED
