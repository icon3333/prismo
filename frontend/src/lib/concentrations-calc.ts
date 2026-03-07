import type { PerformanceCompany } from "@/types/performance";

export interface DistributionItem {
  name: string;
  value: number;
  percentage: number;
}

/**
 * Filter companies by selected portfolio names.
 */
export function filterByPortfolios(
  companies: PerformanceCompany[],
  selectedNames: Set<string>
): PerformanceCompany[] {
  if (selectedNames.size === 0) return companies;
  return companies.filter((c) => c.portfolio_name && selectedNames.has(c.portfolio_name));
}

function getDisplayCountry(company: PerformanceCompany): string {
  if (company.investment_type === "Crypto") return "Crypto";
  return (company.effective_country || "").trim() || "Unknown";
}

/**
 * Group companies by a dimension (sector, country, thesis, investment_type).
 * Returns sorted desc, top 8 + >=1% threshold, "Unknown" last.
 */
export function groupByDimension(
  companies: PerformanceCompany[],
  field: "sector" | "country" | "thesis" | "investment_type",
  includeCash: boolean,
  cashBalance: number
): DistributionItem[] {
  const totalHoldings = companies.reduce((s, c) => s + (c.current_value || 0), 0);
  const cash = includeCash && cashBalance > 0 ? cashBalance : 0;
  const total = totalHoldings + cash;
  if (total <= 0) return [];

  const groups: Record<string, number> = {};
  for (const c of companies) {
    let key: string;
    if (field === "country") {
      key = getDisplayCountry(c);
    } else {
      key = ((c[field] as string) || "").trim() || "Unknown";
    }
    groups[key] = (groups[key] || 0) + (c.current_value || 0);
  }

  if (cash > 0) {
    groups["Cash"] = (groups["Cash"] || 0) + cash;
  }

  let items = Object.entries(groups)
    .map(([name, value]) => ({
      name,
      value,
      percentage: (value / total) * 100,
    }))
    .sort((a, b) => b.value - a.value);

  // Top 8 + any >= 1%, Unknown/Cash last
  const top8 = new Set(items.slice(0, 8).map((i) => i.name));
  items = items.filter((i) => top8.has(i.name) || i.percentage >= 1);

  // Move Unknown to end
  const unknownIdx = items.findIndex((i) => i.name === "Unknown");
  if (unknownIdx > 0) {
    const [unknown] = items.splice(unknownIdx, 1);
    items.push(unknown);
  }

  return items;
}

/**
 * Top N holdings sorted by value.
 */
export function topHoldings(
  companies: PerformanceCompany[],
  count: number,
  includeCash: boolean,
  cashBalance: number
): DistributionItem[] {
  const totalHoldings = companies.reduce((s, c) => s + (c.current_value || 0), 0);
  const cash = includeCash && cashBalance > 0 ? cashBalance : 0;
  const total = totalHoldings + cash;
  if (total <= 0) return [];

  const sorted = [...companies].sort(
    (a, b) => (b.current_value || 0) - (a.current_value || 0)
  );

  const items: DistributionItem[] = sorted.slice(0, count).map((c) => ({
    name: c.name,
    value: c.current_value || 0,
    percentage: ((c.current_value || 0) / total) * 100,
  }));

  if (cash > 0) {
    items.push({
      name: "Cash",
      value: cash,
      percentage: (cash / total) * 100,
    });
    items.sort((a, b) => b.value - a.value);
  }

  return items;
}

/**
 * Group companies by portfolio_name for portfolio distribution donut.
 */
export function portfolioDistribution(
  companies: PerformanceCompany[],
  includeCash: boolean,
  cashBalance: number
): DistributionItem[] {
  const totalHoldings = companies.reduce((s, c) => s + (c.current_value || 0), 0);
  const cash = includeCash && cashBalance > 0 ? cashBalance : 0;
  const total = totalHoldings + cash;
  if (total <= 0) return [];

  const groups: Record<string, number> = {};
  for (const c of companies) {
    const key = c.portfolio_name || "Unknown";
    groups[key] = (groups[key] || 0) + (c.current_value || 0);
  }

  if (cash > 0) {
    groups["Cash"] = (groups["Cash"] || 0) + cash;
  }

  return Object.entries(groups)
    .map(([name, value]) => ({
      name,
      value,
      percentage: (value / total) * 100,
    }))
    .sort((a, b) => b.value - a.value);
}

