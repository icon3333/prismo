import { describe, expect, it } from "vitest";
import { serializeReviewCsv } from "@/lib/monthly-review-export";
import type { ReviewAction } from "@/types/monthly-review";

const action = (overrides: Record<string, unknown> = {}): ReviewAction => ({
  key: "core|ABC|buy",
  portfolio: "Core",
  security: "ACME",
  identifier: "ABC",
  side: "buy",
  amount_eur: 100,
  estimated_units: 2.5,
  snapshot_price_eur: 40,
  decision: "accepted",
  note: "",
  ...overrides,
}) as ReviewAction;

describe("monthly review CSV export", () => {
  it("exports only persisted accepted or adjusted actions with adjusted amounts", () => {
    const csv = serializeReviewCsv([
      action(),
      action({ key: "adjusted", security: "Adjusted", decision: "adjusted", adjusted_amount: 75, estimated_units: 1.25, snapshot_price_eur: 20 }),
      action({ key: "deferred", decision: "deferred" }),
      action({ key: "dismissed", decision: "dismissed" }),
      action({ key: "proposed", decision: "undecided" }),
    ]);

    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain("Adjusted");
    expect(csv).toContain("75.00");
    expect(csv).toContain("Adjusted,ABC,buy,adjusted,75.00,3.75,");
    expect(csv).not.toContain("75.00,1.25");
    expect(csv).not.toContain("deferred");
    expect(csv).not.toContain("dismissed");
    expect(csv).not.toContain("proposed");
  });

  it("escapes CSV text and neutralizes spreadsheet formulas", () => {
    const csv = serializeReviewCsv([
      action({ security: '=SUM(1,2)\n"quoted"', note: "+run", portfolio: "@desk", identifier: "\tABC" }),
      action({ key: "second", security: "-danger", note: "\rhidden" }),
    ]);

    expect(csv).toContain('"\'=SUM(1,2)\n""quoted"""');
    expect(csv).toContain("'+run");
    expect(csv).toContain("'@desk");
    expect(csv).toContain("'\tABC");
    expect(csv).toContain("'-danger");
    expect(csv).toContain("'\rhidden");
  });

  it("rejects invalid numeric cells instead of serializing them", () => {
    expect(() => serializeReviewCsv([action({ amount_eur: Number.NaN })])).toThrow(/amount/i);
    expect(() => serializeReviewCsv([action({ estimated_units: Number.POSITIVE_INFINITY })])).toThrow(/units/i);
    expect(() => serializeReviewCsv([action({ decision: "adjusted", adjusted_amount: "75" })])).toThrow(/adjusted/i);
  });

  it("keeps accepted units and leaves adjusted units blank without a valid positive snapshot price", () => {
    const csv = serializeReviewCsv([
      action({ security: "Accepted", estimated_units: 2.5 }),
      action({ key: "zero", security: "Zero", decision: "adjusted", adjusted_amount: 75, snapshot_price_eur: 0 }),
      action({ key: "nan", security: "NaN", decision: "adjusted", adjusted_amount: 75, snapshot_price_eur: Number.NaN }),
      action({ key: "string", security: "String", decision: "adjusted", adjusted_amount: 75, snapshot_price_eur: "20" }),
    ]);

    const [, accepted, zero, nan, string] = csv.split("\n");
    expect(accepted).toContain("100.00,2.5,");
    expect(zero).toContain("75.00,,");
    expect(nan).toContain("75.00,,");
    expect(string).toContain("75.00,,");
  });

  it("serializes an empty or no-action review as a header only", () => {
    expect(serializeReviewCsv([]).split("\n")).toHaveLength(1);
    expect(serializeReviewCsv([action({ decision: "deferred" })]).split("\n")).toHaveLength(1);
  });
});
