import { describe, it, expect } from "vitest";
import { resolveNumberCommit } from "../number-input-calc";

describe("resolveNumberCommit", () => {
  // Happy path
  it("parses a plain integer", () => {
    expect(resolveNumberCommit("6", { integer: true, min: 1, lastValue: 1 })).toBe(6);
  });

  it("parses a plain decimal percentage", () => {
    expect(
      resolveNumberCommit("25", { decimal: true, min: 0, max: 100, lastValue: 10 })
    ).toBe(25);
  });

  // Revert on empty — the ONLY case that reverts (Covers R1 blur-while-empty)
  it("reverts to lastValue on an empty string", () => {
    expect(resolveNumberCommit("", { integer: true, min: 1, lastValue: 3 })).toBe(3);
  });

  it("reverts to lastValue on a whitespace-only string", () => {
    expect(resolveNumberCommit("   ", { integer: true, min: 1, lastValue: 3 })).toBe(3);
  });

  // Unparseable is NOT empty — garbage commits 0/min, does not revert
  it("treats unparseable input as 0 then clamps (integer/min 1 -> 1), not a revert", () => {
    expect(resolveNumberCommit("abc", { integer: true, min: 1, lastValue: 7 })).toBe(1);
  });

  it("treats unparseable input as 0 then clamps (decimal/min 0 -> 0), not a revert", () => {
    expect(
      resolveNumberCommit("abc", { decimal: true, min: 0, max: 100, lastValue: 7 })
    ).toBe(0);
  });

  // German decimal (Covers KTD2b) — comma is the decimal separator, not a thousands sep
  it("normalizes a German decimal comma for decimal fields", () => {
    expect(
      resolveNumberCommit("12,5", { decimal: true, min: 0, max: 100, lastValue: 1 })
    ).toBe(12.5);
  });

  it("normalizes 33,33 to 33.33 for decimal fields", () => {
    expect(
      resolveNumberCommit("33,33", { decimal: true, min: 0, max: 100, lastValue: 1 })
    ).toBeCloseTo(33.33, 5);
  });

  it("accepts a dot decimal for decimal fields", () => {
    expect(
      resolveNumberCommit("12.5", { decimal: true, min: 0, max: 100, lastValue: 1 })
    ).toBe(12.5);
  });

  // Clamp
  it("clamps below min up (integer min 1: 0 -> 1)", () => {
    expect(resolveNumberCommit("0", { integer: true, min: 1, lastValue: 5 })).toBe(1);
  });

  it("clamps above max down (max 100: 150 -> 100)", () => {
    expect(
      resolveNumberCommit("150", { decimal: true, min: 0, max: 100, lastValue: 1 })
    ).toBe(100);
  });

  it("clamps negative up to min 0 (-4 -> 0)", () => {
    expect(
      resolveNumberCommit("-4", { decimal: true, min: 0, max: 100, lastValue: 1 })
    ).toBe(0);
  });

  // Integer rounding (round-half-up per KTD4)
  it("rounds decimals for integer fields (3.7 -> 4)", () => {
    expect(resolveNumberCommit("3.7", { integer: true, min: 1, lastValue: 1 })).toBe(4);
  });

  it("rounds half up for integer fields (2.5 -> 3)", () => {
    expect(resolveNumberCommit("2.5", { integer: true, min: 1, lastValue: 1 })).toBe(3);
  });

  // Target may sit below minPositions — helper only floors at its own `min` (1)
  it("keeps a value below the portfolio min (floors at 1, not at minPositions)", () => {
    // min is 1 here, not the portfolio's computed minPositions, so 2 stays 2
    expect(resolveNumberCommit("2", { integer: true, min: 1, lastValue: 5 })).toBe(2);
  });

  // Never returns NaN
  it("never returns NaN for garbage decimal input", () => {
    const out = resolveNumberCommit("..", { decimal: true, min: 0, max: 100, lastValue: 4 });
    expect(Number.isNaN(out)).toBe(false);
  });
});
