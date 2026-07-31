import { describe, it, expect } from "vitest";
import {
  calculateViolations,
  extractPositionDeviations,
  getHealthStatus,
  hydrateAllocationRules,
} from "@/lib/overview-calc";
import type {
  AllocationRules,
  PortfolioDataItem,
  RebalancerData,
} from "@/types/overview";

const rules = (overrides: Partial<AllocationRules> = {}): AllocationRules => ({
  maxPerStock: null,
  maxPerETF: null,
  maxPerCrypto: null,
  maxPerCategory: null,
  maxPerCountry: null,
  ...overrides,
});

const holding = (
  company: string,
  value: number,
  overrides: Partial<PortfolioDataItem> = {},
): PortfolioDataItem => ({
  company,
  current_value: value,
  value_source: "market",
  investment_type: "Stock",
  ...overrides,
});

describe("calculateViolations", () => {
  it("uses the Stock, ETF, and Crypto position caps independently", () => {
    const items = [
      holding("Stock", 40),
      holding("ETF", 35, { investment_type: "ETF" }),
      holding("Crypto", 25, { investment_type: "Crypto" }),
    ];

    expect(
      calculateViolations(
        items,
        rules({ maxPerStock: 39, maxPerETF: 34, maxPerCrypto: 24 }),
      ),
    ).toEqual([
      expect.objectContaining({ type: "position", name: "Stock", maxPercentage: 39 }),
      expect.objectContaining({ type: "position", name: "ETF", maxPercentage: 34 }),
      expect.objectContaining({ type: "position", name: "Crypto", maxPercentage: 24 }),
    ]);
  });

  it("uses maxPerCategory for sector breaches", () => {
    const violations = calculateViolations(
      [holding("A", 60, { sector: "Tech" }), holding("B", 40, { sector: "Health" })],
      rules({ maxPerCategory: 50 }),
    );

    expect(violations).toEqual([
      expect.objectContaining({ type: "sector", name: "Tech", maxPercentage: 50 }),
    ]);
  });

  it("hydrates legacy maxPerSector as maxPerCategory", () => {
    expect(hydrateAllocationRules({ maxPerSector: 30 })).toEqual(
      rules({ maxPerCategory: 30 }),
    );
  });

  it("prefers effective country to the raw country", () => {
    const violations = calculateViolations(
      [
        holding("A", 60, { country: "US", effective_country: "Germany" }),
        holding("B", 40, { country: "US", effective_country: "France" }),
      ],
      rules({ maxPerCountry: 50 }),
    );

    expect(violations).toEqual([
      expect.objectContaining({ type: "country", name: "Germany" }),
    ]);
  });

  it("keeps cash outside the allocation denominator", () => {
    const violations = calculateViolations(
      [
        holding("A", 60),
        holding("B", 40),
        holding("Cash", 900, { investment_type: "Cash" }),
      ],
      rules({ maxPerStock: 50 }),
    );

    expect(violations[0]).toEqual(
      expect.objectContaining({ name: "A", currentPercentage: 60 }),
    );
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
  ])("treats %s investment types as Stock for position caps", (_label, investmentType) => {
    const violations = calculateViolations(
      [
        holding("Unclassified", 60, { investment_type: investmentType }),
        holding("Explicit ETF", 40, { investment_type: "ETF" }),
      ],
      rules({ maxPerStock: 50, maxPerETF: 50 }),
    );

    expect(violations).toEqual([
      expect.objectContaining({
        type: "position",
        name: "Unclassified",
        currentPercentage: 60,
        maxPercentage: 50,
      }),
    ]);
  });
});

describe("getHealthStatus", () => {
  it("recognizes none, some, and all of the five persisted rules", () => {
    expect(getHealthStatus([], rules())).toMatchObject({ title: "No Rules Configured" });
    expect(getHealthStatus([], rules({ maxPerETF: 10 }))).toMatchObject({ title: "Low Risk" });
    expect(
      getHealthStatus(
        [],
        rules({
          maxPerStock: 10,
          maxPerETF: 10,
          maxPerCrypto: 10,
          maxPerCategory: 20,
          maxPerCountry: 30,
        }),
      ),
    ).toMatchObject({ title: "Low Risk" });
  });
});

const sector = (name: string, count: number) => ({
  name,
  positions: Array.from({ length: count }, (_, i) => ({
    name: `${name}-${i}`,
    targetAllocation: 5,
  })),
});

describe("extractPositionDeviations", () => {
  it("returns [] for null data", () => {
    expect(extractPositionDeviations(null)).toEqual([]);
  });

  it("flags an under-target portfolio from the Missing Positions sector", () => {
    const data: RebalancerData = {
      portfolios: [
        {
          name: "Growth",
          sectors: [sector("Tech", 3), sector("Missing Positions", 2)],
        },
      ],
    };
    expect(extractPositionDeviations(data)).toEqual([
      {
        name: "Growth",
        missing_count: 2,
        surplus_count: 0,
        current_positions: 3,
        effective_positions: 5,
      },
    ]);
  });

  it("flags an over-target portfolio from effectivePositions", () => {
    const data: RebalancerData = {
      portfolios: [
        { name: "Core", sectors: [sector("Tech", 6)], effectivePositions: 1 },
      ],
    };
    expect(extractPositionDeviations(data)).toEqual([
      {
        name: "Core",
        missing_count: 0,
        surplus_count: 5,
        current_positions: 6,
        effective_positions: 1,
      },
    ]);
  });

  it("does not flag a portfolio exactly on target", () => {
    const data: RebalancerData = {
      portfolios: [
        { name: "Even", sectors: [sector("Tech", 3)], effectivePositions: 3 },
      ],
    };
    expect(extractPositionDeviations(data)).toEqual([]);
  });

  it("does not flag over-target when no effective target is present", () => {
    const data: RebalancerData = {
      portfolios: [{ name: "Untargeted", sectors: [sector("Tech", 6)] }],
    };
    expect(extractPositionDeviations(data)).toEqual([]);
  });

  it("skips a Missing Positions sector with no real target", () => {
    const data: RebalancerData = {
      portfolios: [
        {
          name: "Ghost",
          sectors: [
            sector("Tech", 2),
            {
              name: "Missing Positions",
              positions: [{ name: "x", targetAllocation: 0 }],
            },
          ],
        },
      ],
    };
    expect(extractPositionDeviations(data)).toEqual([]);
  });
});
