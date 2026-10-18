"""Synthetic-only browser QA. Start frontend on 127.0.0.1:3301, no Flask.

Run: uv run --no-project --with playwright python tests/browser_concentrations.py
Every auth/API request is intercepted; no live accounts, data or writes.
"""
import json
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:3301"


def holding(**changes):
    result = dict(company="Example", identifier="EX", portfolio="Core", current_value=100,
                  value_source="market", investment_type="Stock", sector="Tech", thesis="Quality",
                  country="US", effective_country="DE", last_updated="2026-10-18 10:00:00")
    result.update(changes)
    return result


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for mode in ("complete", "partial", "unvalued", "failed", "empty"):
        context = browser.new_context(viewport={"width": 1280, "height": 1000})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def intercept(route):
            request = route.request
            url = urlparse(request.url)
            if not request.url.startswith(BASE):
                route.abort()
                return
            path = url.path
            if path == "/auth/accounts":
                data = {"accounts": [{"id": 1, "username": "Synthetic QA"}], "current_account_id": 1}
            elif path == "/api/portfolio_data":
                if mode == "failed":
                    route.fulfill(status=500, json={"error": "Synthetic holdings load failure"})
                    return
                data = [] if mode == "empty" else [holding(), holding(portfolio="Growth", current_value=300)]
                if mode == "partial":
                    data.append(holding(company="Unvalued", identifier="MISSING", current_value=0,
                                        value_source="none", sector=None, thesis=None, effective_country=None))
                if mode == "unvalued":
                    data = [holding(current_value=0, value_source="none")]
            elif path == "/api/portfolios":
                data = [{"id": "1", "name": "Core"}, {"id": "2", "name": "Growth"}]
            elif path == "/api/account/cash":
                data = {"cash": 100}
            elif path == "/api/state":
                if request.method != "GET":
                    data = {"success": True}
                elif parse_qs(url.query).get("page") == ["builder"]:
                    data = {"portfolios": json.dumps([{"name": "Core", "allocation": 0}, {"name": "Growth", "allocation": 60}])}
                else:
                    data = {}
            elif path.startswith(("/api/", "/auth/", "/csv-upload", "/account/")):
                route.fulfill(status=500, json={"error": "Unmocked synthetic API route"})
                return
            else:
                route.continue_()
                return
            route.fulfill(json=data)

        page.route("**/*", intercept)
        page.goto(BASE + "/concentrations", timeout=180000)
        if mode == "failed":
            expect(page.get_by_text("Synthetic holdings load failure", exact=True)).to_be_visible(timeout=20000)
        else:
            coverage = page.get_by_role("region", name="Concentration data coverage")
            expect(coverage).to_be_visible(timeout=30000)
            if mode == "complete":
                expect(coverage).to_contain_text("2 of 2 selected positions valued")
                page.get_by_text("Saved portfolio targets —", exact=False).click()
                expect(coverage).to_contain_text("Core: target 0,00 %, actual 25,00 %, deviation +25,00 % points")
                page.goto(BASE + "/concentrations?portfolio=1")
                coverage = page.get_by_role("region", name="Concentration data coverage")
                expect(coverage).to_contain_text("1 of 1 selected positions valued", timeout=20000)
                expect(coverage).to_contain_text("100,00")
                page.get_by_text("Saved portfolio targets —", exact=False).click()
                expect(coverage).to_contain_text("actual 25,00 %")
            elif mode == "partial":
                expect(coverage).to_contain_text("2 of 3 selected positions valued")
                page.get_by_text("Saved portfolio targets —", exact=False).click()
                expect(coverage).to_contain_text("actual unavailable")
                expect(coverage).to_contain_text("missing value is unknown, not zero")
            elif mode == "unvalued":
                expect(page.get_by_text("Valuation unavailable for all selected positions.", exact=False)).to_be_visible()
            elif mode == "empty":
                expect(page.get_by_text("No holdings in the selected portfolios.", exact=True)).to_be_visible()
            page.set_viewport_size({"width": 390, "height": 844})
            # Charts resize asynchronously after the viewport event.
            page.wait_for_function(
                "document.documentElement.scrollWidth <= window.innerWidth", timeout=5000
            )
        assert not errors, errors
        print(f"PASS {mode}: synthetic API interception, UI state and responsive layout")
        context.close()
    browser.close()
