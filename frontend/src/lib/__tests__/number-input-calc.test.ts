import { describe, it, expect } from "vitest";
import { resolveNumberCommit, formatNumberDisplay } from "../number-input-calc";

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

  // Non-finite input (parseFloat("Infinity")/"1e400") must not leak through a
  // field that has no max (e.g. Target) — treat as garbage -> 0 -> clamp.
  it("coerces Infinity to a finite clamped value on a min-only field", () => {
    expect(resolveNumberCommit("Infinity", { integer: true, min: 1, lastValue: 5 })).toBe(1);
  });

  it("coerces scientific-overflow (1e400 -> Infinity) to finite", () => {
    const out = resolveNumberCommit("1e400", { integer: true, min: 1, lastValue: 5 });
    expect(Number.isFinite(out)).toBe(true);
    expect(out).toBe(1);
  });

  it("coerces -Infinity to a finite clamped value", () => {
    const out = resolveNumberCommit("-Infinity", { decimal: true, min: 0, max: 100, lastValue: 4 });
    expect(Number.isFinite(out)).toBe(true);
    expect(out).toBe(0);
  });

  // Round and clamp combined in one call (round first, then floor to min)
  it("rounds then clamps (0.4 integer min 1 -> 0 -> 1)", () => {
    expect(resolveNumberCommit("0.4", { integer: true, min: 1, lastValue: 5 })).toBe(1);
  });
});

describe("formatNumberDisplay", () => {
  it("renders a committed 0 as blank when zeroAsEmpty", () => {
    expect(formatNumberDisplay(0, true)).toBe("");
  });

  it("renders 0 literally when not zeroAsEmpty", () => {
    expect(formatNumberDisplay(0, false)).toBe("0");
    expect(formatNumberDisplay(0)).toBe("0");
  });

  it("renders a non-zero value as its string regardless of zeroAsEmpty", () => {
    expect(formatNumberDisplay(25, true)).toBe("25");
    expect(formatNumberDisplay(5)).toBe("5");
  });
});
