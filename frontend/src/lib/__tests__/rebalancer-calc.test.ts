import { describe, it, expect } from "vitest";
import {
  calculateRebalancing,
  calculateDetailedRebalancing,
} from "@/lib/rebalancer-calc";
import type { Portfolio, PortfolioPosition, PortfolioSector } from "@/types/portfolio";

function portfolio(
  name: string,
  currentValue: number,
  targetWeight: number,
  extra: Partial<Portfolio> = {}
): Portfolio {
  return { name, currentValue, targetWeight, sectors: [], ...extra };
}

function position(
  name: string,
  currentValue: number,
  targetAllocation: number,
  extra: Partial<PortfolioPosition> = {}
): PortfolioPosition {
  return { name, investment_type: "Stock", currentValue, targetAllocation, ...extra };
}

function sector(name: string, positions: PortfolioPosition[]): PortfolioSector {
  return { name, companies: [], positionCount: positions.length, positions };
}

describe("calculateRebalancing (portfolio level)", () => {
  const portfolios = [
    portfolio("Over", 700, 50),
    portfolio("Under", 300, 50),
    portfolio("Ignored", 100, 0), // zero target weight -> filtered out
  ];

  it("filters zero-weight portfolios and normalizes weights", () => {
    const result = calculateRebalancing(portfolios, "new-with-sells", 0);
    expect(result.map((p) => p.name)).toEqual(["Over", "Under"]);
    expect(result[0].targetValue).toBe(500);
    expect(result[1].targetValue).toBe(500);
  });

  it("existing-only: sells overweight to fund underweight, no new money", () => {
    const result = calculateRebalancing(portfolios, "existing-only", 0);
    const over = result.find((p) => p.name === "Over")!;
    const under = result.find((p) => p.name === "Under")!;
    expect(over.action).toBeCloseTo(-200);
    expect(under.action).toBeCloseTo(200);
    expect(over.action + under.action).toBeCloseTo(0);
  });

  it("new-only: distributes fresh capital to underweight only", () => {
    const result = calculateRebalancing(portfolios, "new-only", 500);
    const over = result.find((p) => p.name === "Over")!;
    const under = result.find((p) => p.name === "Under")!;
    // new total 1500 -> targets 750 each; gaps are +50 and +450, and the
    // 500 of new money is split proportionally to the gaps
    expect(over.action).toBeCloseTo(50);
    expect(under.action).toBeCloseTo(450);
    expect(over.action + under.action).toBeCloseTo(500);
  });

  it("new-with-sells: action equals the full discrepancy", () => {
    const result = calculateRebalancing(portfolios, "new-with-sells", 500);
    const over = result.find((p) => p.name === "Over")!;
    expect(over.action).toBeCloseTo(750 - 700);
  });

  it("empty input returns empty", () => {
    expect(calculateRebalancing([], "new-only", 100)).toEqual([]);
  });
});

describe("calculateDetailedRebalancing (position level)", () => {
  it("normalizes target allocations to 100% and computes gaps", () => {
    const p = portfolio("P", 1000, 100, {
      sectors: [
        // targets sum to 50 -> normalized x2 (i.e. 50% each)
        sector("Tech", [position("A", 700, 25)]),
        sector("Health", [position("B", 300, 25)]),
      ],
    });
    const result = calculateDetailedRebalancing(p, 0, "existing-only");
    const positions = result.sectors.flatMap((s) => s.positions);
    const a = positions.find((x) => x.name === "A")!;
    const b = positions.find((x) => x.name === "B")!;
    expect(a.calculatedTargetValue).toBeCloseTo(500);
    expect(b.calculatedTargetValue).toBeCloseTo(500);
    expect(a.action).toBeCloseTo(-200);
    expect(b.action).toBeCloseTo(200);
    expect(result.totalBuys).toBeCloseTo(200);
    expect(result.totalSells).toBeCloseTo(200);
  });

  it("backend targetValue constraints bypass normalization", () => {
    const p = portfolio("P", 1000, 100, {
      sectors: [
        sector("Tech", [position("A", 700, 0, { targetValue: 400 })]),
        sector("Health", [position("B", 300, 0, { targetValue: 600 })]),
      ],
    });
    const result = calculateDetailedRebalancing(p, 0, "new-with-sells");
    const positions = result.sectors.flatMap((s) => s.positions);
    const a = positions.find((x) => x.name === "A")!;
    expect(a.calculatedTargetValue).toBe(400);
    expect(a.action).toBeCloseTo(-300);
  });

  it("new-only: positions at/above target are excluded with a reason", () => {
    const p = portfolio("P", 1500, 100, {
      sectors: [
        sector("Tech", [position("A", 1400, 50)]),
        sector("Health", [position("B", 100, 50)]),
      ],
    });
    // portfolioTargetValue 2000 -> both target 1000. A is 400 over.
    const result = calculateDetailedRebalancing(p, 500, "new-only");
    const positions = result.sectors.flatMap((s) => s.positions);
    const a = positions.find((x) => x.name === "A")!;
    const b = positions.find((x) => x.name === "B")!;
    expect(a.excludedReason).toBe("at_or_above_target");
    expect(a.action).toBe(0);
    // B is the only positive gap, so it receives all new money
    expect(b.action).toBeCloseTo(500);
    expect(b.valueAfter).toBeCloseTo(600);
  });

  it("intra-sector rebalancing is blocked when the sector is at target", () => {
    // Characterization: buys are suppressed for positions whose sector has
    // no positive gap, so existing-only cannot shift money between two
    // positions of the SAME sector — the sector-level guard wins.
    const p = portfolio("P", 1000, 100, {
      sectors: [
        sector("Tech", [position("A", 700, 50), position("B", 300, 50)]),
      ],
    });
    const result = calculateDetailedRebalancing(p, 0, "existing-only");
    const b = result.sectors[0].positions.find((x) => x.name === "B")!;
    expect(b.excludedReason).toBe("sector_above_target");
    expect(b.action).toBe(0);
  });

  it("positions within 1 cent of target are marked at_target", () => {
    const p = portfolio("P", 1000, 100, {
      sectors: [
        sector("Tech", [position("A", 500, 50), position("B", 500, 50)]),
      ],
    });
    const result = calculateDetailedRebalancing(p, 0, "existing-only");
    for (const pos of result.sectors[0].positions) {
      expect(pos.excludedReason).toBe("at_target");
      expect(pos.action).toBe(0);
    }
  });

  it("does not mutate the input portfolio", () => {
    const p = portfolio("P", 1000, 100, {
      sectors: [
        sector("Tech", [position("A", 700, 50), position("B", 300, 50)]),
      ],
    });
    const snapshot = JSON.parse(JSON.stringify(p));
    calculateDetailedRebalancing(p, 100, "new-only");
    expect(p).toEqual(snapshot);
  });

  it("builder weights fill in missing target allocations", () => {
    const p = portfolio("P", 1000, 100, {
      builderPositions: [
        { companyName: "A", weight: 70 },
        { companyName: "B", weight: 30 },
      ],
      sectors: [
        sector("Tech", [position("A", 500, 0), position("B", 500, 0)]),
      ],
    });
    const result = calculateDetailedRebalancing(p, 0, "new-with-sells");
    const a = result.sectors[0].positions.find((x) => x.name === "A")!;
    expect(a.calculatedTargetValue).toBeCloseTo(700);
  });

  it("summary totals reconcile with position actions", () => {
    const p = portfolio("P", 1000, 100, {
      sectors: [
        sector("Tech", [position("A", 700, 50), position("B", 300, 50)]),
      ],
    });
    const result = calculateDetailedRebalancing(p, 200, "new-with-sells");
    const positions = result.sectors.flatMap((s) => s.positions);
    const actionSum = positions.reduce((s, x) => s + (x.action ?? 0), 0);
    expect(result.totalAction).toBeCloseTo(actionSum);
    expect(result.portfolioTargetValue).toBe(1200);
  });
});
