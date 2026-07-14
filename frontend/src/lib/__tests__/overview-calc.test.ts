import { describe, it, expect } from "vitest";
import { extractPositionDeviations } from "@/lib/overview-calc";
import type { RebalancerData } from "@/types/overview";

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
