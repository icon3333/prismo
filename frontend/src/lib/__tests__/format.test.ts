import { describe, it, expect } from "vitest";
import { eur, signedEur, pct, signedPct, shares, int } from "@/lib/format";

// Intl output uses non-breaking / narrow no-break spaces; normalize for
// stable assertions across ICU versions.
const n = (s: string) => s.replace(/[  ]/g, " ");

describe("de-DE money formatting", () => {
  it("eur formats with German separators", () => {
    expect(n(eur(1234.56))).toBe("1.234,56 €");
  });

  it("negatives use the Latin minus sign", () => {
    expect(n(eur(-294))).toBe("−294,00 €");
  });

  it("null/NaN render as em-dash", () => {
    expect(eur(null)).toBe("—");
    expect(eur(NaN)).toBe("—");
    expect(pct(undefined)).toBe("—");
  });

  it("signedEur always carries a sign", () => {
    expect(n(signedEur(4215.2))).toBe("+4.215,20 €");
    expect(n(signedEur(-294))).toBe("−294,00 €");
    expect(n(signedEur(0))).toBe("+0,00 €");
  });
});

describe("percent and number formatting", () => {
  it("pct takes percent-scaled input", () => {
    expect(n(pct(12.4))).toBe("12,40 %");
  });

  it("signedPct", () => {
    expect(n(signedPct(2.8))).toBe("+2,80 %");
    expect(n(signedPct(-6.2))).toBe("−6,20 %");
  });

  it("shares shows up to 4 decimals", () => {
    expect(n(shares(257.64))).toBe("257,64");
    expect(n(shares(0.123456))).toBe("0,1235");
  });

  it("int rounds and adds thousands separators", () => {
    expect(n(int(12345.6))).toBe("12.346");
  });
});
