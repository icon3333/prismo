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


def expect_chart_percentages(page, percentages):
    # Read percentages from rendered Apex SVG slices, not the coverage text
    # or hook inputs. A nonempty path verifies the slice was drawn.
    expect(page.get_by_role("img", name="Portfolio distribution chart")).to_be_visible()
    page.wait_for_function("""expected => {
      const paths = [...document.querySelectorAll(
        '[aria-label="Portfolio distribution chart"] path.apexcharts-pie-area')];
      const actual = paths.map(path => Number(path.getAttribute('data:value'))).sort((a,b) => a-b);
      return paths.length === expected.length && paths.every(path => path.getAttribute('d')) &&
        actual.every((value, i) => Math.abs(value - expected[i]) < 0.001);
    }""", arg=sorted(percentages), timeout=15000)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for mode in ("complete", "partial", "unvalued", "zero", "mixed-zero", "cash-pending",
                 "targets-failed", "targets-refresh-failed", "holdings-refresh-failed", "failed", "empty"):
        context = browser.new_context(viewport={"width": 1280, "height": 1000})
        page = context.new_page()
        errors = []
        pending_routes = []
        fail_targets = mode == "targets-failed"
        fail_holdings = False
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
                if mode == "failed" or fail_holdings:
                    route.fulfill(status=500, json={"error": "Synthetic holdings load failure"})
                    return
                data = [] if mode == "empty" else [holding(), holding(portfolio="Growth", current_value=300)]
                if mode == "partial":
                    data.append(holding(company="Unvalued", identifier="MISSING", current_value=0,
                                        value_source="none", sector=None, thesis=None, effective_country=None))
                if mode == "unvalued":
                    data = [holding(current_value=0, value_source="none")]
                if mode == "zero":
                    data = [holding(current_value=0, value_source="custom")]
                if mode == "mixed-zero":
                    data = [holding(), holding(company="Zero", identifier="ZERO", portfolio="Growth",
                                               current_value=0, value_source="custom")]
            elif path == "/api/portfolios":
                data = [{"id": "1", "name": "Core"}, {"id": "2", "name": "Growth"}]
            elif path == "/api/account/cash":
                if mode == "cash-pending":
                    pending_routes.append(route)
                    return
                data = {"cash": 100}
            elif path == "/api/state":
                if request.method != "GET":
                    data = {"success": True}
                elif parse_qs(url.query).get("page") == ["builder"]:
                    if fail_targets:
                        route.fulfill(status=500, json={"error": "Synthetic target load failure"})
                        return
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
                expect_chart_percentages(page, [25, 75])
                page.get_by_text("Saved portfolio targets —", exact=False).click()
                expect(coverage).to_contain_text("Core: target 0,00 %, actual 25,00 %, deviation +25,00 % points")
                page.get_by_text("Include Cash", exact=True).click()
                expect_chart_percentages(page, [20, 60, 20])
                expect(coverage).to_contain_text("Core: target 0,00 %, actual 25,00 %, deviation +25,00 % points")
                page.get_by_text("Include Cash", exact=True).click()
                page.get_by_role("button", name="Core", exact=True).click()
                expect(coverage).to_contain_text("1 of 1 selected positions valued", timeout=20000)
                expect_chart_percentages(page, [100])
                expect(page.get_by_role("img", name="Top holdings chart").locator(".apexcharts-datalabels text")).to_have_text(["100.0%"])
                expect(coverage).to_contain_text("actual 25,00 %")
                page.get_by_text("Include Cash", exact=True).click()
                expect_chart_percentages(page, [50, 50])
                expect(page.get_by_role("img", name="Top holdings chart").locator(".apexcharts-datalabels text")).to_have_text(["50.0%", "50.0%"])
                expect(coverage).to_contain_text("Core: target 0,00 %, actual 25,00 %, deviation +25,00 % points")
                expect(coverage).to_contain_text("whole account excluding cash")
                # Preserve the existing URL portfolio-selection check too.
                page.goto(BASE + "/concentrations?portfolio=1")
                coverage = page.get_by_role("region", name="Concentration data coverage")
                expect(coverage).to_contain_text("1 of 1 selected positions valued", timeout=20000)
                expect_chart_percentages(page, [100])
            elif mode == "partial":
                expect(coverage).to_contain_text("2 of 3 selected positions valued")
                page.get_by_text("Saved portfolio targets —", exact=False).click()
                expect(coverage).to_contain_text("actual unavailable")
                expect(coverage).to_contain_text("missing value is unknown, not zero")
            elif mode == "unvalued":
                expect(page.get_by_text("Valuation unavailable for all selected positions.", exact=False)).to_be_visible()
            elif mode == "zero":
                expect(coverage).to_contain_text("1 of 1 selected positions valued")
                expect(page.get_by_text("Known selected positions have zero value.", exact=False)).to_be_visible()
                expect(page.get_by_role("img", name="Portfolio distribution chart")).to_have_count(0)
                page.get_by_text("Saved portfolio targets —", exact=False).click()
                expect(coverage).to_contain_text("actual unavailable")
                expect(page.locator("body")).not_to_contain_text("NaN")
            elif mode == "mixed-zero":
                expect(coverage).to_contain_text("2 of 2 selected positions valued")
                page.get_by_text("Saved portfolio targets —", exact=False).click()
                expect(coverage).to_contain_text("Growth: target 60,00 %, actual 0,00 %, deviation −60,00 % points")
            elif mode == "cash-pending":
                expect(coverage).to_contain_text("2 of 2 selected positions valued")
                expect_chart_percentages(page, [25, 75])
            elif mode in ("targets-failed", "targets-refresh-failed"):
                if mode == "targets-refresh-failed":
                    page.get_by_text("Saved portfolio targets —", exact=False).click()
                    expect(coverage).to_contain_text("actual 25,00 %")
                    fail_targets = True
                    # Client navigation preserves the cache; returning revalidates it.
                    page.get_by_role("link", name="Performance", exact=True).click()
                    expect(page).to_have_url(BASE + "/performance")
                    page.get_by_role("link", name="Concentrations", exact=True).click()
                    expect(page).to_have_url(BASE + "/concentrations")
                expect(coverage.locator("summary")).to_contain_text("unavailable", timeout=20000)
                page.get_by_text("Saved portfolio targets —", exact=False).click()
                expect(coverage).to_contain_text("comparisons are unavailable")
                expect(coverage).not_to_contain_text("actual 25,00 %")
                expect_chart_percentages(page, [25, 75])
            elif mode == "holdings-refresh-failed":
                expect_chart_percentages(page, [25, 75])
                fail_holdings = True
                page.get_by_role("link", name="Performance", exact=True).click()
                expect(page).to_have_url(BASE + "/performance")
                page.get_by_role("link", name="Concentrations", exact=True).click()
                expect(page).to_have_url(BASE + "/concentrations")
                expect(page.get_by_text("Synthetic holdings load failure", exact=True)).to_be_visible(timeout=20000)
                expect(coverage).to_have_count(0)
                expect(page.get_by_role("img", name="Portfolio distribution chart")).to_have_count(0)
            elif mode == "empty":
                expect(page.get_by_text("No holdings in the selected portfolios.", exact=True)).to_be_visible()
            page.set_viewport_size({"width": 390, "height": 844})
            # Charts resize asynchronously after the viewport event.
            page.wait_for_function(
                "document.documentElement.scrollWidth <= window.innerWidth", timeout=5000
            )
        assert not errors, errors
        for route in pending_routes:
            route.abort()
        print(f"PASS {mode}: synthetic API interception, UI state and responsive layout")
        context.close()
    browser.close()
