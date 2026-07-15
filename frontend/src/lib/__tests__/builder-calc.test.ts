import { describe, it, expect } from "vitest";
import {
  computeBudgetDerived,
  parseNumericInput,
  computeMinPositions,
  computePositionDeviation,
  computeEvenSplitWeight,
  computePlaceholder,
  computePortfolioAmount,
  computePositionAmount,
  computeTotalAllocation,
  computeTotalAllocatedAmount,
  computeSummaryGroups,
  reconcilePortfolios,
  buildCSVContent,
} from "@/lib/builder-calc";
import type { BuilderPortfolio, BuilderRealPosition } from "@/types/builder";

const realPos = (name: string, weight: number): BuilderRealPosition => ({
  companyId: 1,
  companyName: name,
  weight,
  isPlaceholder: false,
});

describe("computeBudgetDerived", () => {
  it("subtracts emergency fund, then already-invested", () => {
    expect(
      computeBudgetDerived({
        totalNetWorth: 100_000,
        alreadyInvested: 60_000,
        emergencyFund: 20_000,
      })
    ).toEqual({ totalInvestableCapital: 80_000, availableToInvest: 20_000 });
  });

  it("clamps both derived values at zero", () => {
    expect(
      computeBudgetDerived({
        totalNetWorth: 10_000,
        alreadyInvested: 50_000,
        emergencyFund: 20_000,
      })
    ).toEqual({ totalInvestableCapital: 0, availableToInvest: 0 });
  });
});

describe("parseNumericInput", () => {
  it("strips commas and percent signs", () => {
    expect(parseNumericInput("1,250")).toBe(1250);
    expect(parseNumericInput("12.5%")).toBe(12.5);
  });

  it("returns 0 for junk", () => {
    expect(parseNumericInput("")).toBe(0);
    expect(parseNumericInput("abc")).toBe(0);
    expect(parseNumericInput(NaN)).toBe(0);
  });
});

describe("computeMinPositions", () => {
  it("is ceil(allocation / maxPerStock), at least 1", () => {
    expect(computeMinPositions(10, 2)).toBe(5);
    expect(computeMinPositions(11, 2)).toBe(6);
    expect(computeMinPositions(1, 2)).toBe(1);
  });

  it("guards against zero max", () => {
    expect(computeMinPositions(10, 0)).toBe(1);
  });
});

describe("computePositionDeviation", () => {
  it("flags a deficit when current is under target", () => {
    expect(computePositionDeviation(15, 7)).toEqual({
      deficit: 8,
      surplus: 0,
      offTarget: true,
    });
  });

  it("flags a surplus when current is over target", () => {
    expect(computePositionDeviation(1, 6)).toEqual({
      deficit: 0,
      surplus: 5,
      offTarget: true,
    });
  });

  it("is calm on an exact match", () => {
    expect(computePositionDeviation(10, 10)).toEqual({
      deficit: 0,
      surplus: 0,
      offTarget: false,
    });
  });

  it("treats a zero, null, or undefined target as no target set", () => {
    const none = { deficit: 0, surplus: 0, offTarget: false };
    expect(computePositionDeviation(0, 6)).toEqual(none);
    expect(computePositionDeviation(null, 6)).toEqual(none);
    expect(computePositionDeviation(undefined, 3)).toEqual(none);
  });

  it("flags a full deficit when current is zero", () => {
    expect(computePositionDeviation(5, 0)).toEqual({
      deficit: 5,
      surplus: 0,
      offTarget: true,
    });
  });
});

describe("computeEvenSplitWeight", () => {
  it("splits 100% across effective positions, 2 decimals", () => {
    expect(computeEvenSplitWeight(3)).toBe(33.33);
    expect(computeEvenSplitWeight(0)).toBe(100);
  });
});

describe("computePlaceholder", () => {
  it("spreads remaining weight across remaining slots", () => {
    const placeholder = computePlaceholder([realPos("A", 40)], 1, 3);
    expect(placeholder).not.toBeNull();
    expect(placeholder!.positionsRemaining).toBe(2);
    expect(placeholder!.totalRemainingWeight).toBe(60);
    expect(placeholder!.weight).toBe(30);
  });

  it("returns null when real weights reach 100%", () => {
    expect(computePlaceholder([realPos("A", 100)], 1, 3)).toBeNull();
  });

  it("returns null when no slots remain", () => {
    expect(computePlaceholder([realPos("A", 50)], 1, 1)).toBeNull();
  });
});

describe("amount helpers", () => {
  const portfolios: BuilderPortfolio[] = [
    {
      id: "1",
      name: "Growth",
      allocation: 40,
      positions: [realPos("A", 50)],
      evenSplit: false,
      desiredPositions: null,
    },
    {
      id: "2",
      name: "Core",
      allocation: 35,
      positions: [],
      evenSplit: false,
      desiredPositions: null,
    },
  ];

  it("computePortfolioAmount applies allocation percent", () => {
    expect(computePortfolioAmount(40, 100_000)).toBe(40_000);
  });

  it("computePositionAmount for real and placeholder positions", () => {
    expect(computePositionAmount(realPos("A", 50), 40_000)).toBe(20_000);
    const placeholder = computePlaceholder([realPos("A", 40)], 1, 3)!;
    expect(computePositionAmount(placeholder, 10_000)).toBeCloseTo(6000);
  });

  it("computeTotalAllocation and amount", () => {
    expect(computeTotalAllocation(portfolios)).toBe(75);
    expect(computeTotalAllocatedAmount(portfolios, 100_000)).toBe(75_000);
  });
});

describe("computeSummaryGroups", () => {
  const portfolio: BuilderPortfolio = {
    id: "1",
    name: "Growth",
    allocation: 40,
    positions: [realPos("A", 30)],
    evenSplit: false,
    desiredPositions: null,
  };

  it("emits real positions plus a remaining-position group", () => {
    const groups = computeSummaryGroups(portfolio, 1, 3, 100_000);
    expect(groups).toHaveLength(2);
    const [a, rest] = groups;
    expect(a.companyName).toBe("A");
    expect(a.globalPct).toBeCloseTo(12); // 40% x 30%
    expect(a.amount).toBeCloseTo(12_000);
    expect(rest.isPlaceholder).toBe(true);
    expect(rest.portfolioPct).toBeCloseTo(35); // (100-30)/2 per slot
    expect(rest.eachSuffix).toBe(true);
  });

  it("with no real positions, splits evenly across needed slots", () => {
    const empty = { ...portfolio, positions: [] };
    const groups = computeSummaryGroups(empty, 0, 4, 100_000);
    expect(groups).toHaveLength(1);
    expect(groups[0].portfolioPct).toBe(25);
    expect(groups[0].amount).toBeCloseTo(10_000);
  });
});

describe("reconcilePortfolios", () => {
  it("rebinds saved portfolios to current DB ids by name", () => {
    const saved: BuilderPortfolio[] = [
      {
        id: "99", // stale id
        name: "Growth",
        allocation: 40,
        positions: [],
        evenSplit: false,
        desiredPositions: null,
      },
    ];
    const result = reconcilePortfolios(saved, [
      { id: "7", name: "Growth" },
      { id: "8", name: "Fresh" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "7", name: "Growth", allocation: 40 });
    expect(result[1]).toMatchObject({ id: "8", name: "Fresh", allocation: 0 });
  });

  it("drops saved portfolios that no longer exist and the '-' default", () => {
    const saved: BuilderPortfolio[] = [
      { id: "1", name: "Gone", allocation: 10, positions: [], evenSplit: false, desiredPositions: null },
      { id: "2", name: "-", allocation: 5, positions: [], evenSplit: false, desiredPositions: null },
    ];
    const result = reconcilePortfolios(saved, [{ id: "3", name: "-" }]);
    expect(result).toEqual([]);
  });
});

describe("buildCSVContent", () => {
  it("produces quoted rows with header, per-portfolio blocks and total", () => {
    const portfolios: BuilderPortfolio[] = [
      {
        id: "1",
        name: "Growth",
        allocation: 50,
        positions: [realPos("A", 100)],
        evenSplit: false,
        desiredPositions: null,
      },
    ];
    const csv = buildCSVContent(portfolios, {}, { "1": 1 }, { "1": 1 }, 10_000);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      '"Portfolio","Position","Global %","Portfolio %","To Be Invested"'
    );
    expect(lines[1]).toContain('"Growth"');
    expect(lines[2]).toContain('"A"');
    expect(lines.at(-1)).toContain('"Total"');
  });
});
