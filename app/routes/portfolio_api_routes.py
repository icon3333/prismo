from app.routes.portfolio_account_api import (
    api_delete_account,
    api_delete_stocks_crypto,
    api_import_account_data,
    api_reset_account_settings,
    get_account_cash,
    get_account_info,
    set_account_cash,
    update_account_username,
)
from app.routes.portfolio_capacity_api import (
    get_country_capacity_data,
    get_effective_capacity_data,
    get_sector_capacity_data,
)
from app.routes.portfolio_company_api import manage_portfolios, update_portfolio_api
from app.routes.portfolio_data_api import (
    get_investment_type_distribution,
    get_portfolio_data_api,
    get_portfolio_metrics,
    get_portfolios_api,
    get_simulator_portfolio_data,
    get_single_portfolio_data_api,
)
from app.routes.portfolio_state_api import manage_state
from app.routes.portfolio_builder_api import builder_investment_targets
from app.routes.portfolio_manual_api import (
    add_company,
    delete_manual_companies,
    get_historical_prices_api,
    get_portfolios_for_dropdown,
    validate_identifier,
)
from app.routes.portfolio_simulator_api import (
    simulator_clone_portfolio,
    simulator_portfolio_allocations,
    simulator_search_investments,
    simulator_simulation_create,
    simulator_simulation_delete,
    simulator_simulation_get,
    simulator_simulation_update,
    simulator_simulations_list,
    simulator_ticker_lookup,
)
from app.routes.portfolio_updates import (
    bulk_update,
    get_portfolio_companies,
    price_fetch_progress,
    price_update_status,
    update_all_prices,
    update_price_api,
    update_selected_prices,
    update_single_portfolio_api,
)
from app.routes.simple_upload import upload_csv_simple, get_simple_upload_progress


def register_portfolio_api_routes(portfolio_bp):
    register_core_routes(portfolio_bp)
    register_upload_routes(portfolio_bp)
    register_price_update_routes(portfolio_bp)
    register_simulator_routes(portfolio_bp)
    register_builder_routes(portfolio_bp)
    register_manual_position_routes(portfolio_bp)
    register_account_routes(portfolio_bp)


def register_core_routes(portfolio_bp):
    portfolio_bp.add_url_rule(
        "/api/state", view_func=manage_state, methods=["GET", "POST"]
    )
    portfolio_bp.add_url_rule(
        "/api/portfolio_companies/<int:portfolio_id>",
        view_func=get_portfolio_companies,
    )
    portfolio_bp.add_url_rule(
        "/api/portfolio_data", view_func=get_portfolio_data_api, methods=["GET"]
    )
    portfolio_bp.add_url_rule("/api/portfolios", view_func=get_portfolios_api)
    portfolio_bp.add_url_rule(
        "/api/update_portfolio", view_func=update_portfolio_api, methods=["POST"]
    )
    portfolio_bp.add_url_rule(
        "/manage_portfolios", view_func=manage_portfolios, methods=["POST"]
    )
    portfolio_bp.add_url_rule(
        "/api/portfolio_metrics", view_func=get_portfolio_metrics, methods=["GET"]
    )
    portfolio_bp.add_url_rule(
        "/api/investment_type_distribution",
        view_func=get_investment_type_distribution,
        methods=["GET"],
    )
    portfolio_bp.add_url_rule(
        "/api/portfolio_data/<portfolio_id>",
        view_func=get_single_portfolio_data_api,
        methods=["GET"],
    )


def register_upload_routes(portfolio_bp):
    portfolio_bp.add_url_rule(
        "/upload", "upload_csv", upload_csv_simple, methods=["POST"]
    )
    portfolio_bp.add_url_rule(
        "/api/simple_upload_progress",
        "simple_upload_progress",
        get_simple_upload_progress,
        methods=["GET", "DELETE"],
    )


def register_price_update_routes(portfolio_bp):
    portfolio_bp.add_url_rule(
        "/api/update_price/<int:company_id>",
        view_func=update_price_api,
        methods=["POST"],
    )
    portfolio_bp.add_url_rule(
        "/api/update_portfolio/<int:company_id>",
        view_func=update_single_portfolio_api,
        methods=["POST"],
    )
    portfolio_bp.add_url_rule(
        "/api/bulk_update", view_func=bulk_update, methods=["POST"]
    )
    portfolio_bp.add_url_rule(
        "/api/update_all_prices", view_func=update_all_prices, methods=["POST"]
    )
    portfolio_bp.add_url_rule(
        "/api/update_selected_prices",
        view_func=update_selected_prices,
        methods=["POST"],
    )
    portfolio_bp.add_url_rule(
        "/api/price_fetch_progress", view_func=price_fetch_progress, methods=["GET"]
    )
    portfolio_bp.add_url_rule(
        "/api/price_update_status/<string:job_id>",
        view_func=price_update_status,
        methods=["GET"],
    )
    portfolio_bp.add_url_rule(
        "/api/historical_prices",
        view_func=get_historical_prices_api,
        methods=["GET"],
    )


def register_simulator_routes(portfolio_bp):
    portfolio_bp.add_url_rule(
        "/api/simulator/portfolio-data", view_func=get_simulator_portfolio_data
    )
    portfolio_bp.add_url_rule(
        "/api/simulator/country-capacity", view_func=get_country_capacity_data
    )
    portfolio_bp.add_url_rule(
        "/api/simulator/sector-capacity", view_func=get_sector_capacity_data
    )
    portfolio_bp.add_url_rule(
        "/api/simulator/effective-capacity", view_func=get_effective_capacity_data
    )
    portfolio_bp.add_url_rule(
        "/api/simulator/ticker-lookup",
        view_func=simulator_ticker_lookup,
        methods=["POST"],
    )
    portfolio_bp.add_url_rule(
        "/api/simulator/portfolio-allocations",
        view_func=simulator_portfolio_allocations,
        methods=["GET"],
    )
    portfolio_bp.add_url_rule(
        "/api/simulator/simulations",
        view_func=simulator_simulations_list,
        methods=["GET"],
    )
    portfolio_bp.add_url_rule(
        "/api/simulator/simulations",
        view_func=simulator_simulation_create,
        methods=["POST"],
    )
    portfolio_bp.add_url_rule(
        "/api/simulator/simulations/<int:simulation_id>",
        view_func=simulator_simulation_get,
        methods=["GET"],
    )
    portfolio_bp.add_url_rule(
        "/api/simulator/simulations/<int:simulation_id>",
        view_func=simulator_simulation_update,
        methods=["PUT"],
    )
    portfolio_bp.add_url_rule(
        "/api/simulator/simulations/<int:simulation_id>",
        view_func=simulator_simulation_delete,
        methods=["DELETE"],
    )
    portfolio_bp.add_url_rule(
        "/api/simulator/search-investments",
        view_func=simulator_search_investments,
        methods=["GET"],
    )
    portfolio_bp.add_url_rule(
        "/api/simulator/clone-portfolio",
        view_func=simulator_clone_portfolio,
        methods=["POST"],
    )


def register_builder_routes(portfolio_bp):
    portfolio_bp.add_url_rule(
        "/api/builder/investment-targets",
        view_func=builder_investment_targets,
        methods=["GET"],
    )


def register_manual_position_routes(portfolio_bp):
    portfolio_bp.add_url_rule(
        "/api/add_company", view_func=add_company, methods=["POST"]
    )
    portfolio_bp.add_url_rule(
        "/api/validate_identifier", view_func=validate_identifier, methods=["GET"]
    )
    portfolio_bp.add_url_rule(
        "/api/delete_companies",
        view_func=delete_manual_companies,
        methods=["POST"],
    )
    portfolio_bp.add_url_rule(
        "/api/portfolios_dropdown",
        view_func=get_portfolios_for_dropdown,
        methods=["GET"],
    )


def register_account_routes(portfolio_bp):
    portfolio_bp.add_url_rule(
        "/api/account/cash", view_func=get_account_cash, methods=["GET"]
    )
    portfolio_bp.add_url_rule(
        "/api/account/cash", view_func=set_account_cash, methods=["POST"]
    )
    portfolio_bp.add_url_rule(
        "/api/account", view_func=get_account_info, methods=["GET"]
    )
    portfolio_bp.add_url_rule(
        "/api/account/username",
        view_func=update_account_username,
        methods=["PUT"],
    )
    portfolio_bp.add_url_rule(
        "/api/account/reset-settings",
        view_func=api_reset_account_settings,
        methods=["POST"],
    )
    portfolio_bp.add_url_rule(
        "/api/account/delete-stocks-crypto",
        view_func=api_delete_stocks_crypto,
        methods=["POST"],
    )
    portfolio_bp.add_url_rule(
        "/api/account/delete", view_func=api_delete_account, methods=["POST"]
    )
    portfolio_bp.add_url_rule(
        "/api/account/import", view_func=api_import_account_data, methods=["POST"]
    )
