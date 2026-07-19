import type {
  ReviewAction,
  ReviewBreach,
  ReviewCashSummary,
  ReviewDecision,
} from "@/types/monthly-review";

const DECISIONS: ReviewDecision[] = [
  "undecided",
  "accepted",
  "adjusted",
  "deferred",
  "dismissed",
];

export function firstUndecidedActionKey(actions: ReviewAction[]): string | null {
  return actions.find((action) => action.decision === "undecided")?.key ?? null;
}

export function groupReviewPresentation({
  breaches,
  actions,
  cash,
}: {
  breaches: ReviewBreach[];
  actions: ReviewAction[];
  cash: ReviewCashSummary;
}) {
  const decisions = Object.fromEntries(DECISIONS.map((decision) => [decision, 0])) as Record<
    ReviewDecision,
    number
  >;
  for (const action of actions) decisions[action.decision]++;

  return {
    breaches: [...breaches].sort(
      (a, b) =>
        b.excess_percentage_points - a.excess_percentage_points ||
        a.name.localeCompare(b.name) ||
        a.key.localeCompare(b.key),
    ),
    actions: [...actions].sort(
      (a, b) =>
        b.amount_eur - a.amount_eur ||
        a.security.localeCompare(b.security) ||
        a.portfolio.localeCompare(b.portfolio) ||
        a.side.localeCompare(b.side) ||
        a.key.localeCompare(b.key),
    ),
    decisions,
    // Server totals are deliberately passed through unchanged. The client is
    // presentation-only and never creates a second source of portfolio math.
    cash,
  };
}
