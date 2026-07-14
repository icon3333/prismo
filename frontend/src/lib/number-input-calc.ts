import { parseNumericInput } from "./builder-calc";

export interface NumberCommitOptions {
  /** Lower clamp bound applied on commit. */
  min?: number;
  /** Upper clamp bound applied on commit. */
  max?: number;
  /** Round to the nearest integer on commit (round-half-up). */
  integer?: boolean;
  /** Treat a lone German comma as the decimal separator (de-DE input). */
  decimal?: boolean;
  /** Value to revert to when the field is left empty. */
  lastValue: number;
}

/**
 * Pure resolution of an edited draft string into the number to commit.
 *
 * Contract (see plan KTD4): only a truly empty/whitespace string reverts to
 * `lastValue`. Anything else is parsed (unparseable input coerces to 0 via
 * `parseNumericInput`), then rounded (integer fields) and clamped to
 * `[min, max]`. Never returns NaN.
 */
export function resolveNumberCommit(raw: string, opts: NumberCommitOptions): number {
  const { min, max, integer, decimal, lastValue } = opts;

  // Only an empty/whitespace field reverts — garbage ("abc") does not.
  if (raw.trim() === "") return lastValue;

  // De-DE decimal input: `parseNumericInput` strips "," as a thousands
  // separator, which turns "12,5" into 125. For decimal fields the comma is
  // the decimal point, so normalize it before parsing.
  const normalized = decimal ? raw.replace(/,/g, ".") : raw;

  let n = parseNumericInput(normalized); // coerces unparseable input to 0
  // parseFloat resolves "Infinity" / "1e400" to a non-finite number (not NaN),
  // which a field with no `max` (e.g. Target) would never clamp. Treat any
  // non-finite result as garbage -> 0, matching the unparseable case.
  if (!Number.isFinite(n)) n = 0;
  if (integer) n = Math.round(n);
  if (min !== undefined) n = Math.max(min, n);
  if (max !== undefined) n = Math.min(max, n);
  return n;
}

/**
 * Display string for a committed number. A committed 0 renders as an empty
 * field when `zeroAsEmpty` is set (matches the old `value || ""` convention).
 */
export function formatNumberDisplay(value: number, zeroAsEmpty?: boolean): string {
  return value === 0 && zeroAsEmpty ? "" : String(value);
}
