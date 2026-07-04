import { describe, it, expect } from "vitest";
import {
  parseSimValue,
  formatSimValue,
  getBaselineForItem,
  recalculatePercentageItem,
  getPercentDenominator,
  derivePercentFromEur,
  deriveEurFromPercent,
  onTotalAmountChanged,
  ensureItemPercentages,
  calculateCombinedAllocations,
  calculateAllocationSummary,
  calculateDCA,
} from "@/lib/simulator-calc";
import type { SimulatorItem, PortfolioData } from "@/types/simulator";

function item(overrides: Partial<SimulatorItem> = {}): SimulatorItem {
  return {
    id: "sim_x",
    ticker: "TST",
    name: "Test",
    sector: "Tech",
    thesis: "growth",
    country: "USA",
    value: 0,
    targetPercent: 0,
    source: "ticker",
    portfolio_id: null,
    ...overrides,
  };
}

const portfolioData = {
  total_value: 10_000,
  portfolio_total: 10_000,
  sectors: [{ name: "Tech", value: 4000 }],
  theses: [{ name: "Growth", value: 2500 }],
  countries: [{ name: "USA", value: 6000 }],
  positions: [],
} as unknown as PortfolioData;

describe("parseSimValue / formatSimValue", () => {
  it("parses German-format input", () => {
    expect(parseSimValue("1.000,50")).toBe(1000.5);
    expect(parseSimValue("1.234,56 €")).toBe(1234.56);
  });

  it("clamps to [0, 999,999,999] and handles junk", () => {
    expect(parseSimValue("-5")).toBe(0);
    expect(parseSimValue("9999999999999")).toBe(999_999_999);
    expect(parseSimValue("abc")).toBe(0);
    expect(parseSimValue("")).toBe(0);
  });

  it("round-trips format -> parse", () => {
    expect(parseSimValue(formatSimValue(1234.56))).toBe(1234.56);
  });
});

describe("getBaselineForItem", () => {
  it("matches sector case-insensitively", () => {
    const result = getBaselineForItem(
      item({ source: "sector", sector: "tech" }),
      portfolioData,
      "overlay"
    );
    expect(result).toEqual({ baselineValue: 4000, baselineTotal: 10_000 });
  });

  it("ticker items use their portfolio position value", () => {
    const result = getBaselineForItem(
      item({ existsInPortfolio: true, portfolioData: { value: 1500 } }),
      portfolioData,
      "overlay"
    );
    expect(result.baselineValue).toBe(1500);
  });

  it("portfolio (sandbox) mode has no baseline", () => {
    const result = getBaselineForItem(
      item({ source: "sector", sector: "Tech" }),
      portfolioData,
      "portfolio"
    );
    expect(result).toEqual({ baselineValue: 0, baselineTotal: 0 });
  });
});

describe("recalculatePercentageItem", () => {
  it("computes required addition to reach target percent", () => {
    // Tech is 4000 of 10000 (40%). Target 50%:
    // x = (0.5*10000 - 4000) / (1 - 0.5) = 2000
    const result = recalculatePercentageItem(
      item({ source: "sector", sector: "Tech", targetPercent: 50 }),
      portfolioData,
      "overlay"
    );
    expect(result.value).toBe(2000);
    expect(result.targetWarning).toBeNull();
  });

  it("warns when target is at or above 100%", () => {
    const result = recalculatePercentageItem(
      item({ source: "sector", sector: "Tech", targetPercent: 100 }),
      portfolioData,
      "overlay"
    );
    expect(result.value).toBe(0);
    expect(result.targetWarning).toMatch(/100%/);
  });

  it("warns when already above target", () => {
    const result = recalculatePercentageItem(
      item({ source: "sector", sector: "Tech", targetPercent: 30 }),
      portfolioData,
      "overlay"
    );
    expect(result.value).toBe(0);
    expect(result.targetWarning).toMatch(/Already at 40.0%/);
  });
});

describe("sandbox % <-> EUR helpers", () => {
  it("denominator is totalAmount in sandbox, item sum otherwise", () => {
    const items = [item({ value: 300 }), item({ value: 200 })];
    expect(getPercentDenominator("portfolio", 1000, items)).toBe(1000);
    expect(getPercentDenominator("portfolio", 0, items)).toBe(500);
    expect(getPercentDenominator("overlay", 1000, items)).toBe(500);
  });

  it("derives percent (1 decimal) and EUR (2 decimals)", () => {
    expect(derivePercentFromEur(333, 1000)).toBe(33.3);
    expect(derivePercentFromEur(1, 0)).toBe(0);
    expect(deriveEurFromPercent(33.33, 1000)).toBe(333.3);
  });
});

describe("onTotalAmountChanged", () => {
  it("0 -> non-zero derives percents from existing EUR values", () => {
    const result = onTotalAmountChanged([item({ value: 250 })], 0, 1000);
    expect(result[0].targetPercent).toBe(25);
  });

  it("non-zero -> non-zero re-derives EUR from percents", () => {
    const result = onTotalAmountChanged(
      [item({ targetPercent: 25, value: 250 })],
      1000,
      2000
    );
    expect(result[0].value).toBe(500);
  });

  it("-> zero leaves items untouched", () => {
    const items = [item({ value: 250, targetPercent: 25 })];
    expect(onTotalAmountChanged(items, 1000, 0)).toBe(items);
  });
});

describe("ensureItemPercentages", () => {
  it("backfills missing percents from values", () => {
    const legacy = item({ value: 500 });
    // @ts-expect-error simulate legacy saved item without targetPercent
    delete legacy.targetPercent;
    const result = ensureItemPercentages([legacy], 2000);
    expect(result[0].targetPercent).toBe(25);
  });

  it("leaves existing percents alone", () => {
    const result = ensureItemPercentages([item({ targetPercent: 10, value: 500 })], 2000);
    expect(result[0].targetPercent).toBe(10);
  });
});

describe("calculateCombinedAllocations", () => {
  it("overlay: merges baseline categories with simulated items", () => {
    const items = [item({ value: 1000, sector: "Tech", country: "USA", thesis: "Growth" })];
    const result = calculateCombinedAllocations(
      items,
      portfolioData,
      "overlay",
      "global",
      null,
      0
    );
    expect(result.bySector["tech"]).toBe(5000); // 4000 baseline + 1000 sim
    expect(result.baselineBySector["tech"]).toBe(4000);
    expect(result.combinedTotal).toBe(11_000);
    expect(result.simulatedTotal).toBe(1000);
  });

  it("sandbox: no baseline, combinedTotal is totalAmount when set", () => {
    const items = [item({ value: 600 })];
    const result = calculateCombinedAllocations(
      items,
      portfolioData,
      "portfolio",
      "global",
      null,
      2000
    );
    expect(result.baselineTotal).toBe(0);
    expect(result.combinedTotal).toBe(2000);
    expect(result.bySector["tech"]).toBe(600);
  });

  it("portfolio scope filters items by portfolio_id", () => {
    const items = [
      item({ value: 100, portfolio_id: 1 }),
      item({ value: 900, portfolio_id: 2 }),
    ];
    const result = calculateCombinedAllocations(
      items,
      portfolioData,
      "overlay",
      "portfolio",
      1,
      0
    );
    expect(result.simulatedTotal).toBe(100);
  });

  it("em-dash placeholders bucket as unknown/unassigned", () => {
    const items = [item({ value: 100, sector: "—", country: "—", thesis: "—" })];
    const result = calculateCombinedAllocations(items, null, "portfolio", "global", null, 0);
    expect(result.bySector["unknown"]).toBe(100);
    expect(result.byThesis["unassigned"]).toBe(100);
  });
});

describe("calculateAllocationSummary", () => {
  it("sandbox with total: sums percents and reports status", () => {
    const items = [item({ targetPercent: 60 }), item({ targetPercent: 40 })];
    expect(calculateAllocationSummary(items, "portfolio", 1000)).toMatchObject({
      totalPercent: 100,
      status: "full",
    });
    expect(
      calculateAllocationSummary([item({ targetPercent: 120 })], "portfolio", 1000).status
    ).toBe("over");
  });

  it("overlay mode only reports EUR total", () => {
    const result = calculateAllocationSummary([item({ value: 500 })], "overlay", 1000);
    expect(result).toEqual({ totalPercent: 0, status: "under", totalEur: 500 });
  });
});

describe("calculateDCA", () => {
  it("spreads lump sum across months and adds monthly amount", () => {
    expect(calculateDCA(1200, 100, 12)).toEqual({
      lumpPortion: 100,
      monthlyInvestment: 200,
      totalDeployed: 2400,
    });
  });

  it("guards against zero months", () => {
    expect(calculateDCA(100, 0, 0).lumpPortion).toBe(100);
  });
});
