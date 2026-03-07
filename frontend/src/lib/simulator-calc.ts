import type {
  SimulatorItem,
  SimulatorMode,
  PortfolioData,
  CombinedAllocations,
  AllocationSummary,
  PositionDetail,
  CategoryMode,
  SimulatorScope,
} from "@/types/simulator";

// ---------------------------------------------------------------------------
// ID / Label helpers
// ---------------------------------------------------------------------------

export function generateItemId(): string {
  return "sim_" + Math.random().toString(36).substr(2, 9);
}

export function normalizeLabel(label: string): string {
  return (label || "").toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Value formatting (de-DE locale, matching Flask JS)
// ---------------------------------------------------------------------------

const deFormatter = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatSimValue(value: number): string {
  return deFormatter.format(value);
}

export function parseSimValue(str: string): number {
  if (!str) return 0;
  // Strip currency symbol, whitespace
  let cleaned = str.replace(/[€\s]/g, "");
  // European format: 1.000,50 → 1000.50
  cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return Math.max(0, Math.min(999_999_999, num));
}

export function formatCurrency(value: number): string {
  const num = value || 0;
  return (
    "€" +
    num.toLocaleString("de-DE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  );
}

// ---------------------------------------------------------------------------
// Baseline lookup
// ---------------------------------------------------------------------------

export function getBaselineForItem(
  item: SimulatorItem,
  portfolioData: PortfolioData | null,
  mode: SimulatorMode
): { baselineValue: number; baselineTotal: number } {
  if (mode === "portfolio") {
    return { baselineValue: 0, baselineTotal: 0 };
  }

  const portfolioTotal =
    portfolioData?.portfolio_total || portfolioData?.total_value || 0;
  let baselineValue = 0;

  if (item.source === "sector" && item.sector && item.sector !== "—") {
    const norm = item.sector.toLowerCase();
    const match = (portfolioData?.sectors || []).find(
      (c) => (c.name || "").toLowerCase() === norm
    );
    baselineValue = match?.value || 0;
  } else if (item.source === "thesis" && item.thesis && item.thesis !== "—") {
    const norm = item.thesis.toLowerCase();
    const match = (portfolioData?.theses || []).find(
      (c) => (c.name || "").toLowerCase() === norm
    );
    baselineValue = match?.value || 0;
  } else if (
    item.source === "country" &&
    item.country &&
    item.country !== "—"
  ) {
    const norm = item.country.toLowerCase();
    const match = (portfolioData?.countries || []).find(
      (c) => (c.name || "").toLowerCase() === norm
    );
    baselineValue = match?.value || 0;
  } else if (item.source === "ticker") {
    if (item.existsInPortfolio && item.portfolioData) {
      baselineValue = item.portfolioData.value || 0;
    }
  }

  return { baselineValue, baselineTotal: portfolioTotal };
}

// ---------------------------------------------------------------------------
// Overlay % → EUR: required addition to reach target %
// ---------------------------------------------------------------------------

export function recalculatePercentageItem(
  item: SimulatorItem,
  portfolioData: PortfolioData | null,
  mode: SimulatorMode
): SimulatorItem {
  if (!item.targetPercent) {
    return { ...item, targetWarning: null };
  }

  if (mode === "portfolio") {
    return { ...item, targetWarning: null };
  }

  const { baselineValue, baselineTotal } = getBaselineForItem(
    item,
    portfolioData,
    mode
  );
  const targetPercent = item.targetPercent;

  if (targetPercent >= 100) {
    return { ...item, value: 0, targetWarning: "Target cannot be 100% or more" };
  }
  if (targetPercent <= 0) {
    return { ...item, value: 0, targetWarning: null };
  }

  const currentPercent =
    baselineTotal > 0 ? (baselineValue / baselineTotal) * 100 : 0;

  if (targetPercent <= currentPercent && baselineValue > 0) {
    return {
      ...item,
      value: 0,
      targetWarning: `Already at ${currentPercent.toFixed(1)}%, can't add to reach ${targetPercent}%`,
    };
  }

  const targetFraction = targetPercent / 100;
  const numerator = targetFraction * baselineTotal - baselineValue;
  const denominator = 1 - targetFraction;

  if (denominator <= 0) {
    return { ...item, value: 0, targetWarning: "Invalid target percentage" };
  }

  const requiredAddition = numerator / denominator;

  if (requiredAddition < 0) {
    return {
      ...item,
      value: 0,
      targetWarning: `Would need to remove €${formatSimValue(Math.abs(requiredAddition))}`,
    };
  }

  return {
    ...item,
    value: Math.round(requiredAddition * 100) / 100,
    targetWarning: null,
  };
}

export function recalculateAllPercentageItems(
  items: SimulatorItem[],
  portfolioData: PortfolioData | null,
  mode: SimulatorMode
): SimulatorItem[] {
  if (mode === "portfolio") return items;
  return items.map((item) =>
    recalculatePercentageItem(item, portfolioData, mode)
  );
}

// ---------------------------------------------------------------------------
// Sandbox % ↔ EUR helpers
// ---------------------------------------------------------------------------

export function getPercentDenominator(
  mode: SimulatorMode,
  totalAmount: number,
  items: SimulatorItem[]
): number {
  if (mode === "portfolio" && totalAmount > 0) {
    return totalAmount;
  }
  return items.reduce((sum, item) => sum + (item.value || 0), 0);
}

export function derivePercentFromEur(
  value: number,
  denominator: number
): number {
  if (denominator <= 0) return 0;
  return parseFloat(((value / denominator) * 100).toFixed(1));
}

export function deriveEurFromPercent(
  percent: number,
  totalAmount: number
): number {
  return Math.round((percent / 100) * totalAmount * 100) / 100;
}

// ---------------------------------------------------------------------------
// Total amount transition
// ---------------------------------------------------------------------------

export function onTotalAmountChanged(
  items: SimulatorItem[],
  oldTotal: number,
  newTotal: number
): SimulatorItem[] {
  if (oldTotal === 0 && newTotal > 0) {
    // 0→non-zero: derive % from existing EUR values
    return items.map((item) => {
      const euroVal = item.value || 0;
      return {
        ...item,
        targetPercent:
          euroVal > 0
            ? parseFloat(((euroVal / newTotal) * 100).toFixed(1))
            : item.targetPercent || 0,
      };
    });
  } else if (newTotal > 0) {
    // non-zero→non-zero: derive EUR from %
    return items.map((item) => {
      const pct = item.targetPercent || 0;
      return {
        ...item,
        value: Math.round((pct / 100) * newTotal * 100) / 100,
      };
    });
  }
  // newTotal === 0: keep as-is
  return items;
}

// ---------------------------------------------------------------------------
// Backward-compat: ensure items have targetPercent
// ---------------------------------------------------------------------------

export function ensureItemPercentages(
  items: SimulatorItem[],
  totalAmount: number
): SimulatorItem[] {
  const denominator =
    totalAmount > 0
      ? totalAmount
      : items.reduce((sum, item) => sum + (item.value || 0), 0);

  return items.map((item) => {
    if (item.targetPercent === undefined || item.targetPercent === null) {
      const val = item.value || 0;
      return {
        ...item,
        targetPercent:
          denominator > 0
            ? parseFloat(((val / denominator) * 100).toFixed(1))
            : 0,
      };
    }
    return item;
  });
}

// ---------------------------------------------------------------------------
// Combined allocations (for charts)
// ---------------------------------------------------------------------------

export function calculateCombinedAllocations(
  items: SimulatorItem[],
  portfolioData: PortfolioData | null,
  mode: SimulatorMode,
  scope: SimulatorScope,
  portfolioId: number | null,
  totalAmount: number
): CombinedAllocations {
  const byCountry: Record<string, number> = {};
  const bySector: Record<string, number> = {};
  const byThesis: Record<string, number> = {};
  const baselineByCountry: Record<string, number> = {};
  const baselineBySector: Record<string, number> = {};
  const baselineByThesis: Record<string, number> = {};

  const includeBaseline = mode !== "portfolio";
  const portfolioTotal = includeBaseline
    ? portfolioData?.total_value || 0
    : 0;

  if (includeBaseline && portfolioData) {
    for (const c of portfolioData.countries || []) {
      const n = normalizeLabel(c.name || "unknown");
      baselineByCountry[n] = (baselineByCountry[n] || 0) + c.value;
      byCountry[n] = (byCountry[n] || 0) + c.value;
    }
    for (const c of portfolioData.sectors || []) {
      const n = normalizeLabel(c.name || "unknown");
      baselineBySector[n] = (baselineBySector[n] || 0) + c.value;
      bySector[n] = (bySector[n] || 0) + c.value;
    }
    for (const c of portfolioData.theses || []) {
      const n = normalizeLabel(c.name || "unassigned");
      baselineByThesis[n] = (baselineByThesis[n] || 0) + c.value;
      byThesis[n] = (byThesis[n] || 0) + c.value;
    }
  }

  let simulatedTotal = 0;
  for (const item of items) {
    if (mode !== "portfolio" && scope === "portfolio" && portfolioId) {
      if (item.portfolio_id !== portfolioId) continue;
    }

    const value = item.value || 0;
    simulatedTotal += value;

    const country =
      item.country === "—" || !item.country
        ? "unknown"
        : item.country.toLowerCase();
    byCountry[country] = (byCountry[country] || 0) + value;

    const sector =
      item.sector === "—" || !item.sector
        ? "unknown"
        : item.sector.toLowerCase();
    bySector[sector] = (bySector[sector] || 0) + value;

    const thesis =
      item.thesis === "—" || !item.thesis
        ? "unassigned"
        : item.thesis.toLowerCase();
    byThesis[thesis] = (byThesis[thesis] || 0) + value;
  }

  const isSandboxWithTotal = mode === "portfolio" && totalAmount > 0;
  const combinedTotal = isSandboxWithTotal
    ? totalAmount
    : portfolioTotal + simulatedTotal;

  return {
    byCountry,
    bySector,
    byThesis,
    baselineByCountry,
    baselineBySector,
    baselineByThesis,
    combinedTotal,
    baselineTotal: portfolioTotal,
    simulatedTotal,
  };
}

// ---------------------------------------------------------------------------
// Allocation summary (sandbox %)
// ---------------------------------------------------------------------------

export function calculateAllocationSummary(
  items: SimulatorItem[],
  mode: SimulatorMode,
  totalAmount: number
): AllocationSummary {
  const totalEur = items.reduce((sum, item) => sum + (item.value || 0), 0);

  if (mode !== "portfolio" || totalAmount <= 0) {
    return { totalPercent: 0, status: "under", totalEur };
  }

  const totalPercent = items.reduce(
    (sum, item) => sum + (item.targetPercent || 0),
    0
  );

  let status: AllocationSummary["status"] = "under";
  if (Math.abs(totalPercent - 100) < 0.1) status = "full";
  else if (totalPercent > 100) status = "over";

  return { totalPercent, status, totalEur };
}

// ---------------------------------------------------------------------------
// Position details for expanded chart bars
// ---------------------------------------------------------------------------

export function getPositionsForLabel(
  chartType: "country" | "sector",
  label: string,
  categoryMode: CategoryMode,
  items: SimulatorItem[],
  portfolioData: PortfolioData | null,
  mode: SimulatorMode,
  scope: SimulatorScope,
  portfolioId: number | null
): PositionDetail[] {
  const positions: PositionDetail[] = [];
  const normalizedLabel = normalizeLabel(label);

  const getMatchField = (pos: {
    country?: string;
    sector?: string;
    thesis?: string;
  }) => {
    if (chartType === "country") return pos.country;
    return categoryMode === "thesis" ? pos.thesis : pos.sector;
  };

  const getDefaultValue = () => {
    if (chartType === "country") return "unknown";
    return categoryMode === "thesis" ? "unassigned" : "unknown";
  };

  // Baseline positions (overlay only)
  if (mode !== "portfolio" && portfolioData?.positions) {
    for (const pos of portfolioData.positions) {
      const matchField = getMatchField(pos);
      const normalizedField = normalizeLabel(
        matchField || getDefaultValue()
      );
      if (normalizedField === normalizedLabel) {
        positions.push({
          ticker: pos.ticker || pos.identifier || "—",
          name: pos.name || "—",
          value: pos.value || 0,
          source: "portfolio",
        });
      }
    }
  }

  // Simulated items
  for (const item of items) {
    if (mode !== "portfolio" && scope === "portfolio" && portfolioId) {
      if (item.portfolio_id !== portfolioId) continue;
    }

    const matchField = getMatchField(item);
    const normalizedField =
      matchField === "—" || !matchField
        ? getDefaultValue()
        : normalizeLabel(matchField);

    if (normalizedField === normalizedLabel) {
      positions.push({
        ticker: item.ticker || "—",
        name: item.name || "—",
        value: item.value || 0,
        source: "simulated",
      });
    }
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Global total (for position detail % calculations)
// ---------------------------------------------------------------------------

export function getGlobalTotal(
  mode: SimulatorMode,
  totalAmount: number,
  items: SimulatorItem[],
  portfolios: { total_value?: number }[]
): number {
  if (mode === "portfolio") {
    if (totalAmount > 0) return totalAmount;
    return items.reduce((sum, item) => sum + (item.value || 0), 0);
  }
  const portfolioSum = portfolios.reduce(
    (sum, p) => sum + (p.total_value || 0),
    0
  );
  const simulatedSum = items.reduce(
    (sum, item) => sum + (item.value || 0),
    0
  );
  return portfolioSum + simulatedSum;
}

// ---------------------------------------------------------------------------
// DCA calculation (stored for Phase 2 UI, logic included)
// ---------------------------------------------------------------------------

export function calculateDCA(
  lumpSum: number,
  monthly: number,
  months: number
): { lumpPortion: number; monthlyInvestment: number; totalDeployed: number } {
  const safeMonths = Math.max(1, months);
  const lumpPortion = lumpSum / safeMonths;
  const monthlyInvestment = lumpPortion + monthly;
  const totalDeployed = monthlyInvestment * safeMonths;
  return { lumpPortion, monthlyInvestment, totalDeployed };
}
