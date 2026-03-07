import type {
  PortfolioDataItem,
  AllocationRules,
  Violation,
  HealthStatus,
  MissingPortfolio,
  RebalancerData,
} from "@/types/overview";

function calculateItemValue(item: PortfolioDataItem): number {
  if (item.current_value != null) return item.current_value;
  if (item.is_custom_value && item.custom_total_value != null) {
    return Number(item.custom_total_value) || 0;
  }
  return (Number(item.price_eur) || 0) * (Number(item.effective_shares) || 0);
}

export function calculateViolations(
  items: PortfolioDataItem[],
  rules: AllocationRules | null
): Violation[] {
  if (!rules || !items.length) return [];

  const totalValue = items.reduce((s, i) => s + calculateItemValue(i), 0);
  if (totalValue === 0) return [];

  const violations: Violation[] = [];

  if (rules.maxPerStock && rules.maxPerStock > 0) {
    const groups: Record<string, number> = {};
    for (const item of items) {
      const name = item.company || item.name || "Unknown";
      groups[name] = (groups[name] || 0) + calculateItemValue(item);
    }
    for (const [name, value] of Object.entries(groups)) {
      const pct = (value / totalValue) * 100;
      if (pct > rules.maxPerStock) {
        violations.push({
          type: "stock",
          name,
          currentPercentage: pct,
          maxPercentage: rules.maxPerStock,
        });
      }
    }
  }

  if (rules.maxPerSector && rules.maxPerSector > 0) {
    const groups: Record<string, number> = {};
    for (const item of items) {
      const key = item.sector || "Unknown";
      groups[key] = (groups[key] || 0) + calculateItemValue(item);
    }
    for (const [name, value] of Object.entries(groups)) {
      const pct = (value / totalValue) * 100;
      if (pct > rules.maxPerSector) {
        violations.push({
          type: "sector",
          name,
          currentPercentage: pct,
          maxPercentage: rules.maxPerSector,
        });
      }
    }
  }

  if (rules.maxPerCountry && rules.maxPerCountry > 0) {
    const groups: Record<string, number> = {};
    for (const item of items) {
      const key = item.country || "Unknown";
      groups[key] = (groups[key] || 0) + calculateItemValue(item);
    }
    for (const [name, value] of Object.entries(groups)) {
      const pct = (value / totalValue) * 100;
      if (pct > rules.maxPerCountry) {
        violations.push({
          type: "country",
          name,
          currentPercentage: pct,
          maxPercentage: rules.maxPerCountry,
        });
      }
    }
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
