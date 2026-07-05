import { describe, it, expect } from "vitest";
import {
  calculatePositionValue,
  getPositionValueSource,
} from "@/lib/position-value";

describe("calculatePositionValue", () => {
  it("prefers backend current_value over everything else", () => {
    const item = {
      current_value: 1234,
      is_custom_value: true,
      custom_total_value: 999,
      price_eur: 10,
      shares: 5,
    };
    expect(calculatePositionValue(item)).toBe(1234);
  });

  it("falls back to custom value without a server current_value", () => {
    const item = {
      is_custom_value: true,
      custom_total_value: 999,
      price_eur: 10,
      shares: 5,
    };
    expect(calculatePositionValue(item)).toBe(999);
  });

  it("falls back to price_eur x effective_shares", () => {
    expect(
      calculatePositionValue({ price_eur: 10, effective_shares: 3, shares: 100 })
    ).toBe(30);
  });

  it("uses shares when effective_shares is missing", () => {
    expect(calculatePositionValue({ price_eur: 10, shares: 4 })).toBe(40);
  });

  it("coerces numeric strings from the API", () => {
    expect(
      calculatePositionValue({ price_eur: "10.5", shares: "2" })
    ).toBe(21);
  });

  it("treats malformed values as zero", () => {
    expect(calculatePositionValue({ price_eur: "abc", shares: 2 })).toBe(0);
    expect(calculatePositionValue({})).toBe(0);
  });

  it("current_value of 0 still counts as present (not a fallthrough)", () => {
    expect(
      calculatePositionValue({ current_value: 0, price_eur: 10, shares: 5 })
    ).toBe(0);
  });
});

describe("getPositionValueSource", () => {
  it("prefers the server-reported value_source", () => {
    expect(
      getPositionValueSource({ value_source: "custom", price_eur: 5 })
    ).toBe("custom");
    expect(
      getPositionValueSource({ value_source: "none", price_eur: 5 })
    ).toBe("none");
  });

  it("derives custom > market > none without a server source", () => {
    expect(
      getPositionValueSource({ is_custom_value: true, custom_total_value: 5 })
    ).toBe("custom");
    expect(getPositionValueSource({ price_eur: 5 })).toBe("market");
    expect(getPositionValueSource({})).toBe("none");
  });

  it("zero price is not a market source", () => {
    expect(getPositionValueSource({ price_eur: 0 })).toBe("none");
  });
});
