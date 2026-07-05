/**
 * Position value reader.
 *
 * The backend is the single source of truth for valuation: every holdings
 * endpoint returns `current_value` and `value_source`, computed by
 * app/utils/value_calculator.py (custom value → native price × FX → legacy
 * price_eur). This module reads those fields; the local price_eur × shares
 * derivation exists only as a fallback for items that don't carry a server
 * value yet (e.g. synthetic simulator rows).
 */

export interface PositionValueInput {
  current_value?: number | string | null;
  value_source?: PositionValueSource | null;
  is_custom_value?: boolean | null;
  custom_total_value?: number | string | null;
  price_eur?: number | string | null;
  effective_shares?: number | string | null;
  shares?: number | string | null;
}

export type PositionValueSource = "custom" | "market" | "none";

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculatePositionValue(item: PositionValueInput): number {
  if (item.current_value != null) {
    return toNumber(item.current_value);
  }

  if (item.is_custom_value && item.custom_total_value != null) {
    return toNumber(item.custom_total_value);
  }

  return toNumber(item.price_eur) * toNumber(item.effective_shares ?? item.shares);
}

export function getPositionValueSource(item: PositionValueInput): PositionValueSource {
  if (item.value_source != null) return item.value_source;
  if (item.is_custom_value && item.custom_total_value != null) return "custom";
  if (toNumber(item.price_eur) > 0) return "market";
  return "none";
}
