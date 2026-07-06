import { describe, it, expect } from "vitest";
import {
  resolveTargetPortfolioId,
  computeAppliedPositions,
  applyPositionsToBuilderPortfolios,
} from "@/lib/apply-to-plan";

describe("resolveTargetPortfolioId", () => {
  it("prefers cloned_from_portfolio_id when set", () => {
    expect(
      resolveTargetPortfolioId(7, [{ portfolio_id: 3 }, { portfolio_id: 4 }])
    ).toBe(7);
  });

  it("falls back to a common non-null portfolio_id", () => {
    expect(
      resolveTargetPortfolioId(null, [{ portfolio_id: 3 }, { portfolio_id: 3 }])
    ).toBe(3);
  });

  it("returns null for mixed portfolio_ids", () => {
    expect(
      resolveTargetPortfolioId(null, [{ portfolio_id: 3 }, { portfolio_id: 4 }])
    ).toBeNull();
  });

  it("returns null when items have null portfolio_id", () => {
    expect(
      resolveTargetPortfolioId(null, [{ portfolio_id: null }, { portfolio_id: 3 }])
    ).toBeNull();
  });

  it("returns null for empty items and no clone source", () => {
    expect(resolveTargetPortfolioId(undefined, [])).toBeNull();
  });
});

describe("computeAppliedPositions", () => {
  it("normalizes weights to 100% over positive values, 2 decimals", () => {
    const { applied, skipped } = computeAppliedPositions([
      { name: "A", value: 100, portfolioData: { id: 1, value: 100 } },
      { name: "B", value: 200, portfolioData: null },
      { name: "C", value: 0, portfolioData: null },
    ]);
    expect(skipped).toEqual(["C"]);
    expect(applied).toEqual([
      { companyId: 1, companyName: "A", weight: 33.33 },
      { companyId: null, companyName: "B", weight: 66.67 },
    ]);
  });

  it("skips negative values", () => {
    const { applied, skipped } = computeAppliedPositions([
      { name: "A", value: 50, portfolioData: null },
      { name: "B", value: -10, portfolioData: null },
    ]);
    expect(skipped).toEqual(["B"]);
    expect(applied).toEqual([
      { companyId: null, companyName: "A", weight: 100 },
    ]);
  });

  it("handles all non-positive values", () => {
    const { applied, skipped } = computeAppliedPositions([
      { name: "A", value: 0, portfolioData: null },
    ]);
    expect(applied).toEqual([]);
    expect(skipped).toEqual(["A"]);
  });
});

describe("applyPositionsToBuilderPortfolios", () => {
  const portfolios = [
    {
      id: "5",
      name: "Growth",
      allocation: 60,
      positions: [
        { companyId: 9, companyName: "Old", weight: 100, isPlaceholder: false },
      ],
      evenSplit: true,
      desiredPositions: 10,
    },
    {
      id: "6",
      name: "Core",
      allocation: 40,
      positions: [],
      evenSplit: false,
      desiredPositions: null,
    },
  ];

  it("replaces target positions with loose id matching (number vs string)", () => {
    const result = applyPositionsToBuilderPortfolios(
      JSON.stringify(portfolios),
      5,
      [{ companyId: 1, companyName: "A", weight: 100 }]
    );
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed[0].positions).toEqual([
      { companyId: 1, companyName: "A", weight: 100, isPlaceholder: false },
    ]);
    expect(parsed[0].evenSplit).toBe(false);
    expect(parsed[0].desiredPositions).toBe(1);
    // Other portfolio untouched
    expect(parsed[1]).toEqual(portfolios[1]);
  });

  it("returns null when target portfolio is missing", () => {
    expect(
      applyPositionsToBuilderPortfolios(JSON.stringify(portfolios), 99, [])
    ).toBeNull();
  });

  it("returns null for missing or invalid JSON", () => {
    expect(applyPositionsToBuilderPortfolios(undefined, 5, [])).toBeNull();
    expect(applyPositionsToBuilderPortfolios("not json", 5, [])).toBeNull();
    expect(applyPositionsToBuilderPortfolios("{}", 5, [])).toBeNull();
  });
});
