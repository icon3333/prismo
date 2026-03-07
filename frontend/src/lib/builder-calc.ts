import type {
  BudgetData,
  BuilderRealPosition,
  BuilderPlaceholderPosition,
  BuilderPosition,
  BuilderPortfolio,
  SortOptions,
  PortfolioCompany,
  PortfolioOption,
} from "@/types/builder";

export function computeBudgetDerived(raw: {
  totalNetWorth: number;
  alreadyInvested: number;
  emergencyFund: number;
}): { totalInvestableCapital: number; availableToInvest: number } {
  const totalInvestableCapital = Math.max(
    0,
    raw.totalNetWorth - raw.emergencyFund
  );
  const availableToInvest = Math.max(
    0,
    totalInvestableCapital - raw.alreadyInvested
  );
  return { totalInvestableCapital, availableToInvest };
}

export function parseNumericInput(value: string | number): number {
  if (typeof value === "number") return isNaN(value) ? 0 : value;
  if (!value) return 0;
  const cleaned = String(value).replace(/[,%]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

export function computeMinPositions(
  allocationPct: number,
  maxPerStock: number
): number {
  if (maxPerStock <= 0) return 1;
  return Math.max(1, Math.ceil(allocationPct / maxPerStock));
}

export function computeEvenSplitWeight(effectivePositions: number): number {
  return parseFloat((100 / Math.max(1, effectivePositions)).toFixed(2));
}

export function computePlaceholder(
  realPositions: BuilderRealPosition[],
  currentPositions: number,
  effectivePositions: number
): BuilderPlaceholderPosition | null {
  const realCount = realPositions.length;
  const realWeight = realPositions.reduce((sum, p) => sum + (p.weight || 0), 0);

  if (realWeight >= 100) return null;

  const totalNeeded = Math.max(effectivePositions, currentPositions);
  const positionsRemaining = Math.max(0, totalNeeded - realCount);

  if (positionsRemaining <= 0) return null;

  const totalRemainingWeight = parseFloat(
    Math.max(0, 100 - realWeight).toFixed(2)
  );
  const weightPerPosition = parseFloat(
    (totalRemainingWeight / positionsRemaining).toFixed(2)
  );

  return {
    companyId: null,
    companyName:
      positionsRemaining === 1
        ? "1 open position"
        : `${positionsRemaining} open positions`,
    weight: weightPerPosition,
    isPlaceholder: true,
    positionsRemaining,
    totalRemainingWeight,
  };
}

export function sortPositions(
  realPositions: BuilderRealPosition[],
  placeholder: BuilderPlaceholderPosition | null,
  sort: SortOptions,
  portfolioAmount: number
): BuilderPosition[] {
  const sorted = [...realPositions].sort((a, b) => {
    let vA: string | number;
    let vB: string | number;

    switch (sort.column) {
      case "name":
        vA = a.companyName || "";
        vB = b.companyName || "";
        break;
      case "weight":
        vA = a.weight || 0;
        vB = b.weight || 0;
        break;
      case "amount":
        vA = (a.weight || 0) * portfolioAmount / 100;
        vB = (b.weight || 0) * portfolioAmount / 100;
        break;
      default:
        vA = 0;
        vB = 0;
    }

    const cmp = vA > vB ? 1 : vA < vB ? -1 : 0;
    return sort.direction === "asc" ? cmp : -cmp;
  });

  const result: BuilderPosition[] = sorted;
  if (placeholder) result.push(placeholder);
  return result;
}

export function computePortfolioAmount(
  allocationPct: number,
  totalInvestableCapital: number
): number {
  return totalInvestableCapital * (allocationPct / 100);
}

export function computePositionAmount(
  position: BuilderPosition,
  portfolioAmount: number
): number {
  if (position.isPlaceholder) {
    return portfolioAmount * (position.totalRemainingWeight / 100);
  }
  return portfolioAmount * ((position.weight || 0) / 100);
}

export function computeTotalAllocation(portfolios: BuilderPortfolio[]): number {
  return portfolios.reduce((sum, p) => sum + (p.allocation || 0), 0);
}

export function computeTotalAllocatedAmount(
  portfolios: BuilderPortfolio[],
  totalInvestableCapital: number
): number {
  const totalPct = computeTotalAllocation(portfolios);
  return totalInvestableCapital * (totalPct / 100);
}

export interface SummaryGroup {
  companyName: string;
  globalPct: number;
  portfolioPct: number;
  amount: number;
  isPlaceholder: boolean;
  eachSuffix: boolean;
}

export function computeSummaryGroups(
  portfolio: BuilderPortfolio,
  currentPositions: number,
  effectivePositions: number,
  totalInvestableCapital: number
): SummaryGroup[] {
  const portfolioAmount = computePortfolioAmount(
    portfolio.allocation,
    totalInvestableCapital
  );
  const realPositions = portfolio.positions.filter((p) => !p.isPlaceholder);
  const groups: SummaryGroup[] = [];

  if (realPositions.length > 0) {
    for (const pos of realPositions) {
      groups.push({
        companyName: pos.companyName || "Unknown",
        globalPct: (portfolio.allocation * pos.weight) / 100,
        portfolioPct: pos.weight,
        amount: portfolioAmount * (pos.weight / 100),
        isPlaceholder: false,
        eachSuffix: false,
      });
    }

    const realWeight = realPositions.reduce(
      (sum, p) => sum + (p.weight || 0),
      0
    );
    const totalNeeded = Math.max(effectivePositions, currentPositions);
    const remaining = totalNeeded - realPositions.length;

    if (remaining > 0 && realWeight < 100) {
      const remainingWeight = 100 - realWeight;
      const perPosWeight = remainingWeight / remaining;
      groups.push({
        companyName: `remaining position (${remaining})`,
        globalPct: (portfolio.allocation * perPosWeight) / 100,
        portfolioPct: perPosWeight,
        amount: portfolioAmount * (perPosWeight / 100),
        isPlaceholder: true,
        eachSuffix: true,
      });
    }
  } else {
    const totalNeeded = Math.max(effectivePositions, currentPositions);
    if (totalNeeded > 0) {
      const perPosWeight = 100 / totalNeeded;
      groups.push({
        companyName: `positions (${totalNeeded})`,
        globalPct: (portfolio.allocation * perPosWeight) / 100,
        portfolioPct: perPosWeight,
        amount: portfolioAmount * (perPosWeight / 100),
        isPlaceholder: true,
        eachSuffix: true,
      });
    }
  }

  return groups;
}

export function reconcilePortfolios(
  saved: BuilderPortfolio[],
  currentDb: PortfolioOption[]
): BuilderPortfolio[] {
  const dbByName = new Map(currentDb.map((p) => [p.name, p]));
  const processedNames = new Set<string>();
  const result: BuilderPortfolio[] = [];

  for (const sp of saved) {
    if (!sp.name || sp.name === "-") continue;
    const dbMatch = dbByName.get(sp.name);
    if (dbMatch) {
      result.push({ ...sp, id: dbMatch.id });
      processedNames.add(sp.name);
    }
  }

  for (const [name, portfolio] of dbByName) {
    if (!processedNames.has(name) && name !== "-") {
      result.push({
        id: portfolio.id,
        name: portfolio.name,
        allocation: 0,
        positions: [],
        evenSplit: false,
        desiredPositions: null,
      });
    }
  }

  return result;
}

export function buildCSVContent(
  portfolios: BuilderPortfolio[],
  portfolioCompanies: Record<string, PortfolioCompany[]>,
  currentPositions: Record<string, number>,
  effectivePositions: Record<string, number>,
  totalInvestableCapital: number
): string {
  const rows: string[][] = [
    ["Portfolio", "Position", "Global %", "Portfolio %", "To Be Invested"],
  ];

  for (const portfolio of portfolios) {
    const portfolioAmount = computePortfolioAmount(
      portfolio.allocation,
      totalInvestableCapital
    );

    rows.push([
      portfolio.name,
      "",
      `${portfolio.allocation.toFixed(1)}%`,
      "100%",
      formatCurrencyRaw(portfolioAmount),
    ]);

    const groups = computeSummaryGroups(
      portfolio,
      currentPositions[portfolio.id] ?? 0,
      effectivePositions[portfolio.id] ?? 0,
      totalInvestableCapital
    );

    for (const group of groups) {
      const suffix = group.eachSuffix ? " each" : "";
      rows.push([
        "",
        group.companyName,
        `${group.globalPct.toFixed(1)}%${suffix}`,
        `${group.portfolioPct.toFixed(1)}%${suffix}`,
        `${formatCurrencyRaw(group.amount)}${suffix}`,
      ]);
    }
  }

  const totalAlloc = computeTotalAllocation(portfolios);
  const totalAmount = computeTotalAllocatedAmount(
    portfolios,
    totalInvestableCapital
  );

  rows.push([
    "Total",
    "",
    `${totalAlloc.toFixed(1)}%`,
    "-",
    formatCurrencyRaw(totalAmount),
  ]);

  return rows
    .map((row) =>
      row.map((cell) => `"${cell.toString().replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
}

export function formatCurrencyRaw(amount: number): string {
  if (typeof amount !== "number" || isNaN(amount)) return "\u20AC0";
  if (Math.abs(amount) >= 100) {
    return `\u20AC${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return `\u20AC${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value: number): string {
  if (!value) return "";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}
