import type { ReviewAction } from "@/types/monthly-review";

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function safeText(value: string | null | undefined): string {
  const text = value ?? "";
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number before export`);
  }
  return value;
}

export function serializeReviewCsv(actions: ReviewAction[]): string {
  const header = [
    "portfolio",
    "security",
    "identifier",
    "side",
    "decision",
    "amount_eur",
    "estimated_units",
    "note",
  ];
  const rows = actions
    .filter((action) => action.decision === "accepted" || action.decision === "adjusted")
    .map((action) => {
      const amount =
        action.decision === "adjusted"
          ? finite(action.adjusted_amount, "Adjusted amount")
          : finite(action.amount_eur, "Amount");
      const units =
        action.estimated_units == null
          ? ""
          : finite(action.estimated_units, "Estimated units").toString();
      return [
        safeText(action.portfolio),
        safeText(action.security),
        safeText(action.identifier),
        safeText(action.side),
        safeText(action.decision),
        amount.toFixed(2),
        units,
        safeText(action.note),
      ];
    });

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
