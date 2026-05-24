export interface PositionValueInput {
  current_value?: number | string | null;
  is_custom_value?: boolean | null;
  custom_total_value?: number | string | null;
  price_eur?: number | string | null;
  effective_shares?: number | string | null;
  shares?: number | string | null;
}

export type PositionValueSource = "current" | "custom" | "market" | "none";

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculatePositionValue(
  item: PositionValueInput,
  options: { preferCurrentValue?: boolean } = {}
): number {
  const preferCurrentValue = options.preferCurrentValue ?? true;

  if (preferCurrentValue && item.current_value != null) {
    return toNumber(item.current_value);
  }

  if (item.is_custom_value && item.custom_total_value != null) {
    return toNumber(item.custom_total_value);
  }

  return toNumber(item.price_eur) * toNumber(item.effective_shares ?? item.shares);
}

export function getPositionValueSource(
  item: PositionValueInput,
  options: { preferCurrentValue?: boolean } = {}
): PositionValueSource {
  const preferCurrentValue = options.preferCurrentValue ?? true;

  if (preferCurrentValue && item.current_value != null) return "current";
  if (item.is_custom_value && item.custom_total_value != null) return "custom";
  if (toNumber(item.price_eur) > 0) return "market";
  return "none";
}
