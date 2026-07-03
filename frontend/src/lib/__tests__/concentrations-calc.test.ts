import { describe, it, expect } from "vitest";
import {
  filterByPortfolios,
  groupByDimension,
  topHoldings,
  portfolioDistribution,
} from "@/lib/concentrations-calc";
import type { PerformanceCompany } from "@/types/performance";

function company(
  name: string,
  value: number,
  overrides: Partial<PerformanceCompany> = {}
): PerformanceCompany {
  return {
    name,
    identifier: name,
    current_value: value,
    sector: "Tech",
    thesis: null,
    country: "USA",
    effective_country: "USA",
    pnl_absolute: null,
    pnl_percentage: null,
    total_invested: null,
    first_bought_date: null,
    investment_type: "Stock",
    portfolio_name: "Main",
    ...overrides,
  };
}

describe("filterByPortfolios", () => {
  it("empty selection means all companies", () => {
    const companies = [company("A", 1), company("B", 2)];
    expect(filterByPortfolios(companies, new Set())).toHaveLength(2);
  });

  it("filters by portfolio name", () => {
    const companies = [
      company("A", 1, { portfolio_name: "Growth" }),
      company("B", 2, { portfolio_name: "Core" }),
    ];
    expect(filterByPortfolios(companies, new Set(["Core"]))).toEqual([companies[1]]);
  });
});

describe("groupByDimension", () => {
  it("groups by sector with percentages of total", () => {
    const companies = [
      company("A", 600, { sector: "Tech" }),
      company("B", 300, { sector: "Health" }),
      company("C", 100, { sector: "Tech" }),
    ];
    const result = groupByDimension(companies, "sector", false, 0);
    expect(result[0]).toEqual({ name: "Tech", value: 700, percentage: 70 });
    expect(result[1]).toEqual({ name: "Health", value: 300, percentage: 30 });
  });

  it("crypto positions are grouped under 'Crypto' country regardless of effective_country", () => {
    const companies = [
      company("BTC", 100, { investment_type: "Crypto", effective_country: "" }),
      company("A", 900),
    ];
    const result = groupByDimension(companies, "country", false, 0);
    expect(result.map((r) => r.name)).toContain("Crypto");
  });

  it("blank dimension becomes 'Unknown' and is moved to the end", () => {
    const companies = [
      company("A", 100, { sector: "" }),
      company("B", 900, { sector: "Tech" }),
    ];
    const result = groupByDimension(companies, "sector", false, 0);
    expect(result.at(-1)!.name).toBe("Unknown");
  });

  it("includes cash as its own slice and denominator", () => {
    const companies = [company("A", 900)];
    const result = groupByDimension(companies, "sector", true, 100);
    const cash = result.find((r) => r.name === "Cash");
    expect(cash).toBeDefined();
    expect(cash!.percentage).toBeCloseTo(10);
    const tech = result.find((r) => r.name === "Tech")!;
    expect(tech.percentage).toBeCloseTo(90);
  });

  it("keeps top 8 plus anything >= 1%, drops small tail", () => {
    const companies = [
      ...Array.from({ length: 9 }, (_, i) =>
        company(`Big${i}`, 1000, { sector: `S${i}` })
      ),
      company("Tiny", 10, { sector: "TinySector" }), // ~0.1% -> dropped
    ];
    const result = groupByDimension(companies, "sector", false, 0);
    const names = result.map((r) => r.name);
    expect(names).not.toContain("TinySector");
    expect(names).toContain("S8"); // 9th sector ~11% -> kept by 1% rule
  });

  it("empty portfolio yields empty result", () => {
    expect(groupByDimension([], "sector", false, 0)).toEqual([]);
  });
});

describe("topHoldings", () => {
  it("returns the N largest holdings with percentages", () => {
    const companies = [company("A", 100), company("B", 500), company("C", 400)];
    const result = topHoldings(companies, 2, false, 0);
    expect(result.map((r) => r.name)).toEqual(["B", "C"]);
    expect(result[0].percentage).toBeCloseTo(50);
  });

  it("cash competes for ranking when included", () => {
    const companies = [company("A", 100)];
    const result = topHoldings(companies, 1, true, 900);
    expect(result[0].name).toBe("Cash");
    expect(result[0].percentage).toBeCloseTo(90);
  });
});

describe("portfolioDistribution", () => {
  it("groups by portfolio name", () => {
    const companies = [
      company("A", 600, { portfolio_name: "Growth" }),
      company("B", 400, { portfolio_name: "Core" }),
    ];
    const result = portfolioDistribution(companies, false, 0);
    expect(result[0]).toEqual({ name: "Growth", value: 600, percentage: 60 });
    expect(result[1]).toEqual({ name: "Core", value: 400, percentage: 40 });
  });
});
