import { describe, it, expect } from "vitest";
import {
  buildAllocationRows,
  getSincePurchaseDateInfo,
  buildChartSeries,
  calculateExposureData,
} from "@/lib/performance-calc";
import type {
  PerformanceCompany,
  PerformancePortfolioData,
} from "@/types/performance";

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
    thesis: "growth",
    country: "USA",
    effective_country: "USA",
    pnl_absolute: null,
    pnl_percentage: null,
    total_invested: null,
    first_bought_date: null,
    investment_type: "Stock",
    ...overrides,
  };
}

describe("buildAllocationRows", () => {
  const data: PerformancePortfolioData = {
    total_value: 1000,
    companies: [company("A", 600), company("B", 400)],
    portfolios: [
      {
        name: "Main",
        total_value: 1000,
        pnl_absolute: null,
        pnl_percentage: null,
        total_invested: null,
        companies: [company("A", 600), company("B", 400)],
      },
    ],
    sectors: [
      {
        name: "Tech",
        total_value: 1000,
        pnl_absolute: null,
        pnl_percentage: null,
        total_invested: null,
        companies: [company("A", 600), company("B", 400)],
      },
    ],
    theses: [],
  } as unknown as PerformancePortfolioData;

  it("stocks mode: flat rows with percentages of total", () => {
    const rows = buildAllocationRows(data, "stocks", false, 0);
    expect(rows.map((r) => [r.name, r.percentage])).toEqual([
      ["A", 60],
      ["B", 40],
    ]);
  });

  it("cash inclusion changes the denominator and appends a cash row", () => {
    const rows = buildAllocationRows(data, "stocks", true, 1000);
    expect(rows.at(-1)).toMatchObject({ name: "Cash", isCash: true, percentage: 50 });
    expect(rows[0].percentage).toBe(30); // 600 / 2000
  });

  it("sector mode: children carry within-category percentage", () => {
    const rows = buildAllocationRows(data, "sector", false, 0);
    expect(rows[0].children![0]).toMatchObject({
      name: "A",
      percentage: 60, // of total
      categoryPercentage: 60, // of sector
    });
  });
});

describe("getSincePurchaseDateInfo", () => {
  it("collects earliest/latest purchase dates for selected identifiers", () => {
    const companies = [
      company("A", 1, { first_bought_date: "2021-03-01 00:00:00" }),
      company("B", 1, { first_bought_date: "2023-07-15 00:00:00" }),
      company("C", 1, { first_bought_date: "2020-01-01 00:00:00" }), // not selected
    ];
    const info = getSincePurchaseDateInfo(companies, ["A", "B"]);
    expect(info).toEqual({
      earliestDate: "2021-03-01",
      latestDate: "2023-07-15",
      purchaseDates: { A: "2021-03-01", B: "2023-07-15" },
    });
  });

  it("returns null when no selected company has a purchase date", () => {
    expect(getSincePurchaseDateInfo([company("A", 1)], ["A"])).toBeNull();
  });
});

describe("buildChartSeries", () => {
  const seriesData = {
    A: [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-02", close: 110 },
    ],
    B: [
      { date: "2024-01-01", close: 50 },
      { date: "2024-01-02", close: 45 },
    ],
  };

  it("normalizes each series to base 100", () => {
    const result = buildChartSeries(
      seriesData,
      ["A"],
      ["Alpha"],
      [1000],
      "detail",
      null
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha");
    expect(result[0].data.map((p) => p.y)).toEqual([100, 110]);
  });

  it("aggregate mode with multiple series adds a value-weighted average", () => {
    const result = buildChartSeries(
      seriesData,
      ["A", "B"],
      ["Alpha", "Beta"],
      [750, 250],
      "aggregate",
      null
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Weighted Avg");
    // day1: 100; day2: 0.75*110 + 0.25*90 = 105
    expect(result[0].data.map((p) => p.y)).toEqual([100, 105]);
  });

  it("detail mode includes each series plus the aggregate", () => {
    const result = buildChartSeries(
      seriesData,
      ["A", "B"],
      ["Alpha", "Beta"],
      [500, 500],
      "detail",
      null
    );
    expect(result.map((s) => s.name)).toEqual(["Alpha", "Beta", "Weighted Avg"]);
  });

  it("skips series with no data and zero base price", () => {
    const result = buildChartSeries(
      { A: [], B: [{ date: "2024-01-01", close: 0 }] },
      ["A", "B"],
      ["Alpha", "Beta"],
      [1, 1],
      "detail",
      null
    );
    expect(result).toEqual([]);
  });
});

describe("calculateExposureData", () => {
  const companies = [
    company("A", 600, { sector: "Tech", effective_country: "USA" }),
    company("B", 300, { sector: "Health", effective_country: "Germany" }),
    company("C", 100, { sector: "Tech", effective_country: "Germany" }),
  ];

  it("builds country x dimension percentage matrix", () => {
    const result = calculateExposureData(companies, "sector", false, 0);
    expect(result.countries).toEqual(["USA", "Germany"]);
    expect(result.dims).toEqual(["Tech", "Health"]);
    // z[country][dim] as % of total (1000)
    expect(result.z).toEqual([
      [60, 0],
      [10, 30],
    ]);
    expect(result.metadata.totalValue).toBe(1000);
    expect(result.metadata.countryPercentages).toEqual({ USA: 60, Germany: 40 });
    expect(result.metadata.dimensionPercentages).toEqual({ Tech: 70, Health: 30 });
  });

  it("company details are sorted by value with per-company percentages", () => {
    const result = calculateExposureData(companies, "sector", false, 0);
    const usaTech = result.companyDetails["USA"]["Tech"];
    expect(usaTech).toEqual([{ name: "A", value: 600, percentage: 60 }]);
    const deTech = result.companyDetails["Germany"]["Tech"];
    expect(deTech[0].percentage).toBe(10);
  });

  it("thesis dimension groups by thesis", () => {
    const mixed = [
      company("A", 500, { thesis: "value" }),
      company("B", 500, { thesis: "" }), // blank -> Unknown
    ];
    const result = calculateExposureData(mixed, "thesis", false, 0);
    expect(result.dims).toContain("value");
    expect(result.dims.at(-1)).toBe("Unknown"); // Unknown moved last
  });

  it("crypto is bucketed under the Crypto country", () => {
    const mixed = [
      company("BTC", 100, { investment_type: "Crypto", effective_country: "" }),
      company("A", 900),
    ];
    const result = calculateExposureData(mixed, "sector", false, 0);
    expect(result.countries).toContain("Crypto");
  });

  it("cash appears as its own country/sector when included", () => {
    const result = calculateExposureData(companies, "sector", true, 1000);
    expect(result.countries).toContain("Cash");
    expect(result.dims).toContain("Cash");
    expect(result.metadata.totalValue).toBe(2000);
    expect(result.metadata.countryPercentages["Cash"]).toBe(50);
  });

  it("keeps top 8 countries plus anything >= 1%", () => {
    const many = [
      ...Array.from({ length: 9 }, (_, i) =>
        company(`C${i}`, 1000, { effective_country: `Country${i}` })
      ),
      company("Tiny", 5, { effective_country: "TinyLand" }), // ~0.05%
    ];
    const result = calculateExposureData(many, "sector", false, 0);
    expect(result.countries).not.toContain("TinyLand");
    expect(result.countries).toHaveLength(9);
  });

  it("empty input yields the empty shape", () => {
    const result = calculateExposureData([], "sector", false, 0);
    expect(result.countries).toEqual([]);
    expect(result.z).toEqual([]);
    expect(result.metadata.totalValue).toBe(0);
  });

  it("does not mutate the input companies", () => {
    const input = [company("A", 100)];
    const snapshot = JSON.parse(JSON.stringify(input));
    calculateExposureData(input, "sector", true, 50);
    expect(input).toEqual(snapshot);
    expect(input).toHaveLength(1); // virtual cash row must not leak in
  });
});
