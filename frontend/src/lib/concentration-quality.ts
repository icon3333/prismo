import type { PerformanceCompany } from "@/types/performance";

/** Canonical /portfolio_data rows, before identifier deduplication. */
export interface ConcentrationRow {
  company: string;
  identifier: string | null;
  portfolio: string;
  current_value: number;
  value_source: "market" | "custom" | "none";
  investment_type: PerformanceCompany["investment_type"];
  sector?: string | null;
  thesis?: string | null;
  country?: string | null;
  effective_country?: string | null;
  last_updated?: string | null;
  custom_value_date?: string | null;
  total_invested?: number | null;
  first_bought_date?: string | null;
}

export interface ConcentrationCompany extends PerformanceCompany {
  value_source: ConcentrationRow["value_source"];
  valuation_date?: string | null;
}

export function concentrationCompanies(rows: ConcentrationRow[]): ConcentrationCompany[] {
  return rows.map((row) => ({
    name: row.company,
    identifier: row.identifier,
    portfolio_name: row.portfolio,
    current_value: row.current_value,
    value_source: row.value_source,
    valuation_date: row.value_source === "custom" ? row.custom_value_date : row.last_updated,
    investment_type: row.investment_type,
    sector: row.sector ?? null,
    thesis: row.thesis ?? null,
    country: row.country ?? null,
    effective_country: row.effective_country ?? null,
    total_invested: row.total_invested ?? null,
    first_bought_date: row.first_bought_date ?? null,
    pnl_absolute: null,
    pnl_percentage: null,
  }));
}

export function concentrationQuality(companies: ConcentrationCompany[], now = Date.now()) {
  const valuedCompanies = companies.filter(
    (company) => company.value_source !== "none" && Number.isFinite(company.current_value) && company.current_value > 0,
  );
  const unknown = (value: string | null) => !value?.trim() || value.trim().toLowerCase() === "unknown";
  let staleValuations = 0;
  let unknownPriceAge = 0;
  let oldestValuation: string | null = null;
  let oldestTimestamp = Infinity;
  for (const company of valuedCompanies) {
    const date = company.valuation_date;
    // Server timestamps without offsets are UTC, not browser-local wall time.
    const timestamp = date ? Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(date) ? date : `${date.replace(" ", "T")}Z`) : NaN;
    if (!Number.isFinite(timestamp) || timestamp > now) {
      unknownPriceAge++;
      continue;
    }
    if (now - timestamp >= 90 * 86400000) staleValuations++;
    if (timestamp < oldestTimestamp) {
      oldestTimestamp = timestamp;
      oldestValuation = date!.slice(0, 10);
    }
  }
  return {
    holdingCount: companies.length,
    knownValue: valuedCompanies.reduce((sum, company) => sum + company.current_value, 0),
    missingValuations: companies.length - valuedCompanies.length,
    unknownSector: companies.filter((company) => unknown(company.sector)).length,
    unknownThesis: companies.filter((company) => unknown(company.thesis)).length,
    unknownCountry: companies.filter((company) => company.investment_type !== "Crypto" && unknown(company.effective_country)).length,
    staleValuations,
    unknownPriceAge,
    oldestValuation,
    valuedCompanies,
  };
}

/** Read the user's raw saved Builder allocations, never inferred/default weights. */
export function targetCoverage(saved: string | undefined, portfolioNames: string[]) {
  let rows: { name: string; allocation?: unknown }[] = [];
  try {
    const parsed: unknown = JSON.parse(saved ?? "null");
    if (Array.isArray(parsed)) rows = parsed.filter((row) => row && typeof row.name === "string");
  } catch { /* Unavailable is deliberately not zero. */ }
  const allocation = (name: string): number | null => {
    const matches = rows.filter((row) => row.name === name);
    const value = matches.length === 1 ? matches[0].allocation : null;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const entries = portfolioNames.map((name) => ({ name, target: allocation(name) }));
  const raw = rows.map((row) => allocation(row.name)).filter((value): value is number => value !== null);
  return {
    entries,
    missing: entries.filter((entry) => entry.target === null).length,
    rawTotal: raw.length ? raw.reduce((sum, value) => sum + value, 0) : null,
  };
}
