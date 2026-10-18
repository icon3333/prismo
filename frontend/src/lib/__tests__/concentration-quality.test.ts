import { describe, it, expect } from "vitest";
import {
  concentrationCompanies, concentrationQuality, targetCoverage,
  type ConcentrationRow,
} from "@/lib/concentration-quality";
import { filterByPortfolios, groupByDimension } from "@/lib/concentrations-calc";

const now = Date.parse("2026-10-18T12:00:00Z");
function row(overrides: Partial<ConcentrationRow> = {}): ConcentrationRow {
  return {
    company: "Example", identifier: "EX", portfolio: "Core", current_value: 100,
    value_source: "market", investment_type: "Stock", sector: "Tech", thesis: "Quality",
    effective_country: "DE", country: "US", last_updated: "2026-10-18 10:00:00",
    ...overrides,
  };
}

describe("concentration input and coverage", () => {
  it("retains canonical per-portfolio rows, manual values and effective countries", () => {
    const companies = concentrationCompanies([
      row(), row({ portfolio: "Growth", current_value: 300, value_source: "custom" }),
    ]);
    expect(companies).toHaveLength(2);
    const filtered = filterByPortfolios(companies, new Set(["Core"]));
    expect(groupByDimension(filtered, "country", true, 100)).toEqual([
      { name: "DE", value: 100, percentage: 50 },
      { name: "Cash", value: 100, percentage: 50 },
    ]);
    expect(concentrationQuality(companies, now).knownValue).toBe(400);
  });

  it("discloses partial and all-missing valuation without counting fake zero exposure", () => {
    const companies = concentrationCompanies([
      row(), row({ current_value: 0, value_source: "none", sector: null, thesis: "", effective_country: null }),
      row({ current_value: Infinity }),
    ]);
    const quality = concentrationQuality(companies, now);
    expect(quality.missingValuations).toBe(2);
    expect(quality.knownValue).toBe(100);
    expect(quality.valuedCompanies).toHaveLength(1);
    expect(quality.unknownSector).toBe(1);
    expect(quality.unknownThesis).toBe(1);
    expect(quality.unknownCountry).toBe(1);
    expect(concentrationQuality(concentrationCompanies([row({ value_source: "none" })]), now).valuedCompanies).toEqual([]);
  });

  it("uses custom timestamps and does not treat unknown freshness as fresh", () => {
    const quality = concentrationQuality(concentrationCompanies([
      row({ value_source: "custom", custom_value_date: "2026-01-01", last_updated: "2026-10-18" }),
      row({ last_updated: null }),
      row({ investment_type: "Crypto", effective_country: null }),
    ]), now);
    expect(quality.staleValuations).toBe(1);
    expect(quality.unknownPriceAge).toBe(1);
    expect(quality.unknownCountry).toBe(0);
    expect(quality.oldestValuation).toBe("2026-01-01");
  });
});

describe("raw target coverage", () => {
  it("keeps explicit zero distinct from null and never normalizes raw totals", () => {
    const coverage = targetCoverage(JSON.stringify([
      { name: "Core", allocation: 0 }, { name: "Growth", allocation: 40 },
      { name: "Unknown", allocation: null },
    ]), ["Core", "Growth", "Unknown", "Unassigned"]);
    expect(coverage.entries.map((entry) => entry.target)).toEqual([0, 40, null, null]);
    expect(coverage.rawTotal).toBe(40);
    expect(coverage.missing).toBe(2);
  });
  it("reports missing/malformed persisted state as unavailable, not a zero target", () => {
    for (const state of [undefined, "", "broken", "{}", '[{"name":"Core","allocation":""}]']) {
      const result = targetCoverage(state, ["Core"]);
      expect(result.entries[0].target).toBeNull();
      expect(result.rawTotal).toBeNull();
    }
  });
  it("retains over-100 totals and whole-account targets under a view filter", () => {
    const result = targetCoverage('[{"name":"Core","allocation":70},{"name":"Growth","allocation":60}]', ["Core"]);
    expect(result.rawTotal).toBe(130);
    expect(result.entries).toEqual([{ name: "Core", target: 70 }]);
  });
});
