import type {
  PortfolioMetrics,
  PortfolioDataItem,
  AllocationRules,
  Violation,
  HealthStatus,
  MissingPortfolio,
  RebalancerData,
} from "@/types/overview";
import { calculatePositionValue } from "@/lib/position-value";
import { groupAndAggregate } from "@/lib/aggregation-utils";

function calculateItemValue(item: PortfolioDataItem): number {
  return calculatePositionValue(item);
}

export function computeMetricsFromItems(items: PortfolioDataItem[]): PortfolioMetrics {
  const total_items = items.length;
  const total_value = items.reduce((s, i) => s + calculateItemValue(i), 0);
  const missing_prices = items.filter(
    (item) =>
      !item.current_value &&
      !(item.is_custom_value && item.custom_total_value != null) &&
      (!item.price_eur || item.price_eur === 0)
  ).length;
  const health =
    total_items > 0
      ? Math.round(((total_items - missing_prices) / total_items) * 100)
      : 100;
  return { total_value, total_items, health, missing_prices };
}

export function calculateViolations(
  items: PortfolioDataItem[],
  rules: AllocationRules | null
): Violation[] {
  if (!rules || !items.length) return [];

  const totalValue = items.reduce((s, i) => s + calculateItemValue(i), 0);
  if (totalValue === 0) return [];

  const violations: Violation[] = [];

  const collect = (
    type: Violation["type"],
    limit: number,
    keyFn: (item: PortfolioDataItem) => string,
  ) => {
    const aggregated = groupAndAggregate(items, keyFn, calculateItemValue, totalValue);
    for (const { name, percentage } of aggregated) {
      if (percentage > limit) {
        violations.push({
          type,
          name,
          currentPercentage: percentage,
          maxPercentage: limit,
        });
      }
    }
  };

  if (rules.maxPerStock && rules.maxPerStock > 0) {
    collect("stock", rules.maxPerStock, (item) => item.company || item.name || "Unknown");
  }

  if (rules.maxPerSector && rules.maxPerSector > 0) {
    collect("sector", rules.maxPerSector, (item) => item.sector || "Unknown");
  }

  if (rules.maxPerCountry && rules.maxPerCountry > 0) {
    collect("country", rules.maxPerCountry, (item) => item.country || "Unknown");
  }

  violations.sort(
    (a, b) =>
      b.currentPercentage - b.maxPercentage - (a.currentPercentage - a.maxPercentage)
  );
  return violations;
}

export function getHealthStatus(
  violations: Violation[],
  rules: AllocationRules | null
): HealthStatus {
  if (!rules || (!rules.maxPerStock && !rules.maxPerSector && !rules.maxPerCountry)) {
    return { icon: "wrench", title: "No Rules Configured", subtitle: "Set allocation rules to monitor portfolio risk" };
  }
  if (violations.length === 0) {
    return { icon: "check", title: "Low Risk", subtitle: "All allocation rules are being followed" };
  }
  if (violations.length <= 3) {
    return {
      icon: "warning",
      title: "Medium Risk",
      subtitle: `${violations.length} rule${violations.length > 1 ? "s" : ""} violated`,
    };
  }
  return {
    icon: "alert",
    title: "High Risk",
    subtitle: `${violations.length} rules violated`,
  };
}

export function extractMissingPositions(data: RebalancerData | null): MissingPortfolio[] {
  if (!data?.portfolios) return [];

  const result: MissingPortfolio[] = [];

  for (const portfolio of data.portfolios) {
    const sectors = portfolio.sectors || [];
    const missingSector = sectors.find((s) => s.name === "Missing Positions");
    if (!missingSector) continue;

    const missingPositions = missingSector.positions || [];
    const hasMissing = missingPositions.some((p) => p.targetAllocation > 0);
    if (missingPositions.length === 0 || !hasMissing) continue;

    let currentPositions = 0;
    for (const sector of sectors) {
      if (sector.name !== "Missing Positions") {
        currentPositions += (sector.positions || []).length;
      }
    }

    result.push({
      name: portfolio.name,
      missing_count: missingPositions.length,
      current_positions: currentPositions,
      effective_positions: currentPositions + missingPositions.length,
    });
  }

  return result;
}
