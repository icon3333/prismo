import { describe, expect, it } from "vitest";
import {
  firstUndecidedActionKey,
  groupReviewPresentation,
} from "@/lib/monthly-review-calc";

describe("monthly review presentation", () => {
  it("sorts breaches and actions deterministically without changing server totals", () => {
    const cash = {
      current_cash: 100,
      contribution: 25,
      accepted_sales: 15,
      accepted_buys: 80,
      remaining_cash: 60,
    };
    const result = groupReviewPresentation({
      breaches: [
        { key: "b", name: "Zulu", kind: "position", percentage: 11, limit: 10, excess_percentage_points: 1, contributors: [] },
        { key: "a", name: "Alpha", kind: "sector", percentage: 30, limit: 20, excess_percentage_points: 10, contributors: [] },
        { key: "c", name: "Beta", kind: "country", percentage: 11, limit: 10, excess_percentage_points: 1, contributors: [] },
      ],
      actions: [
        { key: "2", portfolio: "Core", security: "Zulu", side: "buy", amount_eur: 50, decision: "accepted", note: "" },
        { key: "1", portfolio: "Core", security: "Alpha", side: "sell", amount_eur: 100, decision: "undecided", note: "" },
        { key: "3", portfolio: "Satellite", security: "Alpha", side: "buy", amount_eur: 50, decision: "dismissed", note: "" },
      ],
      cash,
    });

    expect(result.breaches.map((item) => item.key)).toEqual(["a", "c", "b"]);
    expect(result.actions.map((item) => item.key)).toEqual(["1", "3", "2"]);
    expect(result.decisions).toEqual({ undecided: 1, accepted: 1, adjusted: 0, deferred: 0, dismissed: 1 });
    expect(result.cash).toBe(cash);
  });

  it("finds the first undecided action and handles an empty review", () => {
    expect(firstUndecidedActionKey([
      { key: "done", portfolio: "Core", security: "A", side: "buy", amount_eur: 1, decision: "accepted", note: "" },
      { key: "next", portfolio: "Core", security: "B", side: "buy", amount_eur: 1, decision: "undecided", note: "" },
    ])).toBe("next");
    expect(firstUndecidedActionKey([])).toBeNull();
  });
});
