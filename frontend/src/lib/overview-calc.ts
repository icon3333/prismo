import type {
  PortfolioMetrics,
  PortfolioDataItem,
  AllocationRules,
  Violation,
  HealthStatus,
  MissingPortfolio,
  RebalancerData,
} from "@/types/overview";
import { calculatePositionValue, getPositionValueSource } from "@/lib/position-value";
import { groupAndAggregate } from "@/lib/aggregation-utils";
import { computePositionDeviation } from "@/lib/builder-calc";

function calculateItemValue(item: PortfolioDataItem): number {
  return calculatePositionValue(item);
}

export function computeMetricsFromItems(items: PortfolioDataItem[]): PortfolioMetrics {
  const total_items = items.length;
  const total_value = items.reduce((s, i) => s + calculateItemValue(i), 0);
  // Mirrors the backend's has_price_or_custom_value(): an item is "missing"
  // exactly when the server reports no valuation source for it.
  const missing_prices = items.filter(
    (item) => getPositionValueSource(item) === "none"
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

  const allocationItems = items.filter(
    (item) => item.investment_type?.trim().toLowerCase() !== "cash",
  );
  const totalValue = allocationItems.reduce((s, i) => s + calculateItemValue(i), 0);
  if (totalValue === 0) return [];

  const violations: Violation[] = [];

  const collect = (
    type: Violation["type"],
    limit: number,
    keyFn: (item: PortfolioDataItem) => string,
  ) => {
    const aggregated = groupAndAggregate(
      allocationItems,
      keyFn,
      calculateItemValue,
      totalValue,
    );
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

  const positionRules: Array<[string, number | null]> = [
    ["stock", rules.maxPerStock],
    ["etf", rules.maxPerETF],
    ["crypto", rules.maxPerCrypto],
  ];
  for (const [investmentType, limit] of positionRules) {
    if (!limit || limit <= 0) continue;
    const matchingItems = allocationItems.filter(
      (item) =>
        (item.investment_type?.trim().toLowerCase() || "stock") === investmentType,
    );
    const aggregated = groupAndAggregate(
      matchingItems,
      (item) => item.company || item.name || "Unknown",
      calculateItemValue,
      totalValue,
    );
    for (const { name, percentage } of aggregated) {
      if (percentage > limit) {
        violations.push({
          type: "position",
          name,
          currentPercentage: percentage,
          maxPercentage: limit,
        });
      }
    }
  }

  if (rules.maxPerCategory && rules.maxPerCategory > 0) {
    collect("sector", rules.maxPerCategory, (item) => item.sector || "Unknown");
  }

  if (rules.maxPerCountry && rules.maxPerCountry > 0) {
    collect(
      "country",
      rules.maxPerCountry,
      (item) => item.effective_country?.trim() || item.country?.trim() || "Unknown",
    );
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
  if (
    !rules ||
    ![
      rules.maxPerStock,
      rules.maxPerETF,
      rules.maxPerCrypto,
      rules.maxPerCategory,
      rules.maxPerCountry,
    ].some((limit) => limit != null && limit > 0)
  ) {
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

export function hydrateAllocationRules(value: unknown): AllocationRules | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const readRule = (key: string): number | null => {
    const rule = record[key];
    return typeof rule === "number" && Number.isFinite(rule) ? rule : null;
  };

  return {
    maxPerStock: readRule("maxPerStock"),
    maxPerETF: readRule("maxPerETF"),
    maxPerCrypto: readRule("maxPerCrypto"),
    maxPerCategory: readRule("maxPerCategory") ?? readRule("maxPerSector"),
    maxPerCountry: readRule("maxPerCountry"),
  };
}

export function extractPositionDeviations(
  data: RebalancerData | null
): MissingPortfolio[] {
  if (!data?.portfolios) return [];

  const result: MissingPortfolio[] = [];

  for (const portfolio of data.portfolios) {
    const sectors = portfolio.sectors || [];
    const currentPositions = sectors.reduce(
      (sum, s) =>
        s.name === "Missing Positions" ? sum : sum + (s.positions || []).length,
      0
    );

    // Under target: preserve the server-driven "Missing Positions" detection,
    // so deficit behavior is unchanged.
    const missingSector = sectors.find((s) => s.name === "Missing Positions");
    const missingPositions = missingSector?.positions ?? [];
    const hasMissing = missingPositions.some((p) => p.targetAllocation > 0);
    if (missingSector && missingPositions.length > 0 && hasMissing) {
      result.push({
        name: portfolio.name,
        missing_count: missingPositions.length,
        surplus_count: 0,
        current_positions: currentPositions,
        effective_positions: currentPositions + missingPositions.length,
      });
      continue; // a portfolio is under OR over target, never both
    }

    // Over target: flag when current exceeds the server-provided effective
    // target. `effectivePositions` is absent when the portfolio has no plan
    // target, in which case the shared helper reports no deviation.
    const { surplus } = computePositionDeviation(
      portfolio.effectivePositions,
      currentPositions
    );
    if (surplus > 0) {
      result.push({
        name: portfolio.name,
        missing_count: 0,
        surplus_count: surplus,
        current_positions: currentPositions,
        effective_positions: portfolio.effectivePositions ?? currentPositions,
      });
    }
  }

  return result;
}
