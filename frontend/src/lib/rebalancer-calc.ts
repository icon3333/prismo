import type {
  Portfolio,
  RebalancedPortfolio,
  RebalanceMode,
} from "@/types/portfolio";

export function calculateRebalancing(
  portfolios: Portfolio[],
  mode: RebalanceMode,
  investmentAmount: number
): RebalancedPortfolio[] {
  const filtered = portfolios.filter((p) => p.targetWeight > 0);
  if (filtered.length === 0) return [];

  const totalCurrentValue = filtered.reduce(
    (sum, p) => sum + (p.currentValue || 0),
    0
  );

  const newTotalValue =
    mode === "existing-only"
      ? totalCurrentValue
      : totalCurrentValue + investmentAmount;

  const totalTargetWeight = filtered.reduce(
    (sum, p) => sum + (p.targetWeight || 0),
    0
  );

  const result: RebalancedPortfolio[] = filtered.map((p) => {
    const normalizedWeight =
      totalTargetWeight > 0 ? (p.targetWeight / totalTargetWeight) * 100 : 0;
    const targetValue = (normalizedWeight / 100) * newTotalValue;
    return {
      ...p,
      targetValue,
      discrepancy: targetValue - (p.currentValue || 0),
      action: 0,
    };
  });

  applyRebalancingActions(result, mode, investmentAmount);
  return result;
}

function applyRebalancingActions(
  portfolios: RebalancedPortfolio[],
  mode: RebalanceMode,
  investmentAmount: number
) {
  if (mode === "existing-only") {
    const positiveGaps: RebalancedPortfolio[] = [];
    const negativeGaps: RebalancedPortfolio[] = [];
    let totalPositiveGap = 0;
    let totalNegativeGap = 0;

    for (const p of portfolios) {
      if (Math.abs(p.discrepancy) < 0.01) {
        p.action = 0;
      } else if (p.discrepancy > 0) {
        positiveGaps.push(p);
        totalPositiveGap += p.discrepancy;
      } else {
        negativeGaps.push(p);
        totalNegativeGap += Math.abs(p.discrepancy);
      }
    }

    const rebalanceAmount = Math.min(totalPositiveGap, totalNegativeGap);

    for (const p of positiveGaps) {
      p.action = (p.discrepancy / totalPositiveGap) * rebalanceAmount;
    }
    for (const p of negativeGaps) {
      p.action =
        -1 * (Math.abs(p.discrepancy) / totalNegativeGap) * rebalanceAmount;
    }
  } else if (mode === "new-only") {
    let totalGap = 0;
    const eligible: RebalancedPortfolio[] = [];

    for (const p of portfolios) {
      if (p.discrepancy <= 0) {
        p.action = 0;
      } else {
        eligible.push(p);
        totalGap += p.discrepancy;
      }
    }

    if (investmentAmount > 0 && totalGap > 0) {
      for (const p of eligible) {
        p.action = (p.discrepancy / totalGap) * investmentAmount;
      }
    }
  } else {
    // new-with-sells
    for (const p of portfolios) {
      p.action = Math.abs(p.discrepancy) < 0.01 ? 0 : p.discrepancy;
    }
  }
}
