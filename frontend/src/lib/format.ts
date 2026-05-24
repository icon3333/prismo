// Number formatting — Terminal §12.2.
// All output uses de-DE locale and Latin minus (U+2212) on negatives.
// Built once, imported everywhere. Do NOT inline Intl.NumberFormat anywhere else.

const eurFmt = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const pctFmt = new Intl.NumberFormat("de-DE", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const shareFmt = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

const intFmt = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const longDateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const cetTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const MINUS = "−";
const DASH = "—";

const isFinite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

/** EUR currency. e.g. `1.234,56 €` / `−294,00 €`. Em-dash for null/undefined/NaN. */
export const eur = (n: number | null | undefined): string =>
  isFinite(n) ? eurFmt.format(n).replace("-", MINUS) : DASH;

/** Signed EUR currency. Always includes sign. e.g. `+4.215,20 €` / `−294,00 €`. */
export const signedEur = (n: number | null | undefined): string => {
  if (!isFinite(n)) return DASH;
  return (n >= 0 ? "+" : MINUS) + eurFmt.format(Math.abs(n));
};

/** Percentage from a percent-scaled number (e.g. `12.4` → `12,40 %`). */
export const pct = (n: number | null | undefined): string =>
  isFinite(n) ? pctFmt.format(n / 100).replace("-", MINUS) : DASH;

/** Signed percentage from a percent-scaled number. e.g. `+2,80 %` / `−6,20 %`. */
export const signedPct = (n: number | null | undefined): string => {
  if (!isFinite(n)) return DASH;
  return (n >= 0 ? "+" : MINUS) + pctFmt.format(Math.abs(n) / 100);
};

/** Share count, up to 4 decimals. e.g. `257,6400`. */
export const shares = (n: number | null | undefined): string =>
  isFinite(n) ? shareFmt.format(n) : DASH;

/** Plain integer with German thousands separator. e.g. `12.345`. */
export const int = (n: number | null | undefined): string =>
  isFinite(n) ? intFmt.format(n) : DASH;

type DateInput = Date | string | number | null | undefined;

const parseDate = (value: DateInput): Date | null => {
  if (value == null || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Compact date. e.g. `24.05.2026`. */
export const date = (value: DateInput): string => {
  const parsed = parseDate(value);
  return parsed ? dateFmt.format(parsed) : DASH;
};

/** Long document/report date. e.g. `May 24, 2026`. */
export const longDate = (value: DateInput): string => {
  const parsed = parseDate(value);
  return parsed ? longDateFmt.format(parsed) : DASH;
};

/** Compact date and time. e.g. `May 24, 2026, 02:32 PM`. */
export const dateTime = (value: DateInput): string => {
  const parsed = parseDate(value);
  return parsed ? dateTimeFmt.format(parsed) : DASH;
};

/** Berlin market-clock timestamp. e.g. `14:32:08 CET`. */
export const cetTime = (value: DateInput): string => {
  const parsed = parseDate(value);
  return parsed ? `${cetTimeFmt.format(parsed)} CET` : DASH;
};

// ---------- Legacy compat (rebalancer surfaces still import these) ----------

/** Use the new helpers above for new code. Kept so rebalancer pages compile. */
export const rebalancerFmt = {
  currency: eurFmt,
  percent: pctFmt,
};

/** Used by rebalancer to label buy / sell actions. Recolored to Terminal accents. */
export function formatAction(action: number) {
  if (Math.abs(action) < 0.01)
    return { text: "No action", className: "text-ink-2" };
  if (action > 0)
    return {
      text: `Buy ${eur(action)}`,
      className: "text-green",
    };
  return {
    text: `Sell ${eur(Math.abs(action))}`,
    className: "text-red",
  };
}
