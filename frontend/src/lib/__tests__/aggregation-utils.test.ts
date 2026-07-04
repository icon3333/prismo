import { describe, it, expect } from "vitest";
import { groupAndAggregate } from "@/lib/aggregation-utils";
import { cashSlice } from "@/lib/cash-inclusion";

const items = [
  { sector: "Tech", value: 600 },
  { sector: "Health", value: 300 },
  { sector: "Tech", value: 100 },
];

describe("groupAndAggregate", () => {
  it("groups by key, sums values, sorts descending", () => {
    const result = groupAndAggregate(
      items,
      (i) => i.sector,
      (i) => i.value,
      1000
    );
    expect(result).toEqual([
      { name: "Tech", value: 700, percentage: 70 },
      { name: "Health", value: 300, percentage: 30 },
    ]);
  });

  it("computes percentages against the caller-supplied total, not the group sum", () => {
    const result = groupAndAggregate(
      items,
      (i) => i.sector,
      (i) => i.value,
      2000 // e.g. total including cash
    );
    expect(result[0].percentage).toBe(35);
  });

  it("returns zero percentages when total <= 0", () => {
    const result = groupAndAggregate(
      items,
      (i) => i.sector,
      (i) => i.value,
      0
    );
    for (const entry of result) expect(entry.percentage).toBe(0);
  });

  it("handles empty input", () => {
    expect(groupAndAggregate([], () => "x", () => 1, 100)).toEqual([]);
  });
});

describe("cashSlice", () => {
  it("includes cash in the total when enabled", () => {
    expect(cashSlice(900, true, 100)).toEqual({ cash: 100, total: 1000 });
  });

  it("excludes cash when disabled", () => {
    expect(cashSlice(900, false, 100)).toEqual({ cash: 0, total: 900 });
  });

  it("ignores negative cash balances", () => {
    expect(cashSlice(900, true, -50)).toEqual({ cash: 0, total: 900 });
  });
});
