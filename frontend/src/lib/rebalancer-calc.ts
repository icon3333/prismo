import type {
  Portfolio,
  PortfolioPosition,
  PortfolioSector,
  BuilderPosition,
  RebalancedPortfolio,
  RebalanceMode,
  DetailedSector,
  DetailedRebalancing,
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

/**
 * Calculate detailed position-level rebalancing for a single portfolio.
 * Ports the 5-pass algorithm from static/js/rebalancer.js.
 */
export function calculateDetailedRebalancing(
  portfolio: Portfolio,
  portfolioActionAmount: number,
  mode: RebalanceMode
): DetailedRebalancing {
  const totalCurrentValue = portfolio.currentValue || 0;

  // Calculate distribution base and portfolio target value
  const portfolioTargetValue = totalCurrentValue + portfolioActionAmount;

  const sectors = portfolio.sectors ?? [];
  const builderPositions = portfolio.builderPositions ?? [];

  // Build lookup map for builder weights
  const builderWeightMap = new Map<string, number>();
  for (const bp of builderPositions) {
    if (!bp.isPlaceholder && bp.companyName) {
      builderWeightMap.set(bp.companyName, bp.weight ?? 0);
    }
  }

  // Find placeholder position for default weight
  const placeholderBP = builderPositions.find((p) => p.isPlaceholder);

  // === Pass 1: Count positions and gather allocations ===
  let totalPositionsCount = 0;
  let userDefinedCount = 0;
  let sumUserDefined = 0;

  for (const sector of sectors) {
    if (!sector.positions?.length) continue;
    if (sector.name === "Missing Positions") {
      const ph = sector.positions.find((p) => p.isPlaceholder);
      if (ph) totalPositionsCount += ph.positionsRemaining ?? 0;
    } else {
      for (const pos of sector.positions) {
        totalPositionsCount++;
        if (pos.targetAllocation > 0) {
          userDefinedCount++;
          sumUserDefined += pos.targetAllocation;
        }
      }
    }
  }

  // Calculate default allocation
  let defaultAllocation = 0;
  if (placeholderBP) {
    defaultAllocation = placeholderBP.weight ?? 0;
  } else if (sumUserDefined < 100) {
    const remaining = 100 - sumUserDefined;
    const withoutDefined = totalPositionsCount - userDefinedCount;
    defaultAllocation = withoutDefined > 0 ? remaining / withoutDefined : 0;
  }

  // === Pass 2: Should show missing positions? ===
  let shouldShowMissingPositions = false;
  const missingPositionsSector = sectors.find(
    (s) =>
      s.name === "Missing Positions" ||
      s.positions?.some((p) => p.isPlaceholder)
  );

  if (missingPositionsSector) {
    const realBP = builderPositions.filter((p) => !p.isPlaceholder);
    const totalRealWeight = realBP.reduce((s, p) => s + (p.weight ?? 0), 0);
    const effectivePositions =
      portfolio.effectivePositions ?? portfolio.minPositions ?? 0;
    const currentCount = sectors
      .filter((s) => s.name !== "Missing Positions")
      .reduce((s, sec) => s + (sec.positions?.length ?? 0), 0);

    shouldShowMissingPositions =
      currentCount < effectivePositions && Math.round(totalRealWeight) < 100;
  }

  // === Pass 3: Assign target allocations ===
  let totalTargetAllocation = 0;
  let hasBackendConstraints = false;

  // Deep-clone positions to avoid mutating original data
  interface WorkingSector {
    name: string;
    positions: PortfolioPosition[];
    isPlaceholder?: boolean;
    _currentValue: number;
    _targetAlloc: number;
    _calcTargetValue: number;
  }

  const workingSectors: WorkingSector[] = [];

  for (const sector of sectors) {
    if (!sector.positions?.length) continue;
    if (sector.name === "Missing Positions" && !shouldShowMissingPositions)
      continue;

    const clonedPositions = sector.positions.map((p) => ({ ...p }));
    workingSectors.push({
      name: sector.name,
      positions: clonedPositions,
      isPlaceholder: sector.isPlaceholder,
      _currentValue: 0,
      _targetAlloc: 0,
      _calcTargetValue: 0,
    });

    for (const pos of clonedPositions) {
      if (pos.targetValue != null) {
        hasBackendConstraints = true;
        const backendPct =
          portfolioTargetValue > 0
            ? (pos.targetValue / portfolioTargetValue) * 100
            : 0;
        totalTargetAllocation += backendPct;
      } else {
        if (!pos.targetAllocation || pos.targetAllocation <= 0) {
          const bw = builderWeightMap.get(pos.name);
          pos.targetAllocation = bw ?? defaultAllocation;
        }
        totalTargetAllocation += pos.targetAllocation;
      }
    }
  }

  // Normalization factor (skip if backend provided constraints)
  const normFactor =
    !hasBackendConstraints && totalTargetAllocation > 0
      ? 100 / totalTargetAllocation
      : 1;

  // === Pass 4: Normalize and calculate target values ===
  const normalizedMap = new Map<PortfolioPosition, number>();

  for (const ws of workingSectors) {
    let sectorCurrentValue = 0;
    let sectorTargetAlloc = 0;

    for (const pos of ws.positions) {
      sectorCurrentValue += pos.currentValue || 0;

      if (pos.targetValue != null) {
        pos.calculatedTargetValue = pos.targetValue;
        const backendAlloc =
          portfolioTargetValue > 0
            ? (pos.targetValue / portfolioTargetValue) * 100
            : 0;
        normalizedMap.set(pos, backendAlloc);
        sectorTargetAlloc += backendAlloc;
      } else {
        const normalizedAlloc = pos.targetAllocation * normFactor;
        normalizedMap.set(pos, normalizedAlloc);
        sectorTargetAlloc += normalizedAlloc;
        pos.calculatedTargetValue =
          (normalizedAlloc / 100) * portfolioTargetValue;
      }
    }

    ws._currentValue = sectorCurrentValue;
    ws._targetAlloc = sectorTargetAlloc;
    ws._calcTargetValue = (sectorTargetAlloc / 100) * portfolioTargetValue;
  }

  // === Pass 5: Unified allocation distribution ===
  const positiveGaps: Array<{ position: PortfolioPosition; gap: number }> = [];
  const negativeGaps: Array<{ position: PortfolioPosition; gap: number }> = [];
  let totalPositiveGap = 0;
  let totalNegativeGap = 0;

  for (const ws of workingSectors) {
    const sectorGap = ws._calcTargetValue - ws._currentValue;

    for (const pos of ws.positions) {
      const posCurrentValue = pos.currentValue || 0;
      const posTargetValue = pos.calculatedTargetValue || 0;
      const posGap = posTargetValue - posCurrentValue;
      pos.gap = posGap;

      if (Math.abs(posGap) < 0.01) {
        pos.excludedReason = "at_target";
        pos.action = 0;
        pos.valueAfter = posCurrentValue;
      } else if (sectorGap <= 0 && posGap > 0) {
        pos.excludedReason = "sector_above_target";
        pos.action = 0;
        pos.valueAfter = posCurrentValue;
      } else if (mode === "new-only" && posGap <= 0) {
        pos.excludedReason = "at_or_above_target";
        pos.action = 0;
        pos.valueAfter = posCurrentValue;
      } else if (mode === "existing-only" || mode === "new-with-sells") {
        if (posGap > 0) {
          positiveGaps.push({ position: pos, gap: posGap });
          totalPositiveGap += posGap;
        } else {
          negativeGaps.push({ position: pos, gap: Math.abs(posGap) });
          totalNegativeGap += Math.abs(posGap);
        }
      } else {
        // new-only with positive gap
        positiveGaps.push({ position: pos, gap: posGap });
        totalPositiveGap += posGap;
      }
    }
  }

  // Distribute capital based on mode
  if (mode === "new-only") {
    if (totalPositiveGap > 0 && portfolioActionAmount > 0) {
      const available = Math.max(0, portfolioActionAmount);
      for (const item of positiveGaps) {
        const share = item.gap / totalPositiveGap;
        const alloc = share * available;
        item.position.action = alloc;
        item.position.valueAfter = (item.position.currentValue || 0) + alloc;
      }
    }
  } else if (mode === "existing-only") {
    const rebalanceAmount = Math.min(totalPositiveGap, totalNegativeGap);
    if (rebalanceAmount > 0) {
      if (totalPositiveGap > 0) {
        for (const item of positiveGaps) {
          const share = item.gap / totalPositiveGap;
          const alloc = share * rebalanceAmount;
          item.position.action = alloc;
          item.position.valueAfter =
            (item.position.currentValue || 0) + alloc;
        }
      }
      if (totalNegativeGap > 0) {
        for (const item of negativeGaps) {
          const share = item.gap / totalNegativeGap;
          const alloc = share * rebalanceAmount;
          item.position.action = -alloc;
          item.position.valueAfter =
            (item.position.currentValue || 0) - alloc;
        }
      }
    }
  } else {
    // new-with-sells
    for (const item of positiveGaps) {
      item.position.action = item.gap;
      item.position.valueAfter =
        (item.position.currentValue || 0) + item.gap;
    }
    for (const item of negativeGaps) {
      item.position.action = -item.gap;
      item.position.valueAfter =
        (item.position.currentValue || 0) - item.gap;
    }
  }

  // Ensure all positions have defaults
  for (const ws of workingSectors) {
    for (const pos of ws.positions) {
      if (pos.action === undefined) {
        pos.action = 0;
        pos.valueAfter = pos.currentValue || 0;
      }
    }
  }

  // Build result sectors
  let totalAction = 0;
  let totalValueAfter = 0;
  let totalBuys = 0;
  let totalSells = 0;

  const detailedSectors: DetailedSector[] = workingSectors.map((ws) => {
    let actionSum = 0;
    let valueAfterSum = 0;
    let sectorCurrentValue = 0;

    for (const pos of ws.positions) {
      const act = pos.action ?? 0;
      const va = pos.valueAfter ?? pos.currentValue ?? 0;
      actionSum += act;
      valueAfterSum += va;
      sectorCurrentValue += pos.currentValue || 0;

      if (act > 0.01) totalBuys += act;
      else if (act < -0.01) totalSells += Math.abs(act);
    }

    totalAction += actionSum;
    totalValueAfter += valueAfterSum;

    return {
      name: ws.name,
      positions: ws.positions,
      currentValue: sectorCurrentValue,
      targetAllocation: ws._targetAlloc,
      calculatedTargetValue: ws._calcTargetValue,
      actionSum,
      valueAfterSum,
      isPlaceholder: ws.isPlaceholder,
    };
  });

  return {
    sectors: detailedSectors,
    shouldShowMissingPositions,
    portfolioTargetValue,
    totalCurrentValue,
    totalAction,
    totalValueAfter,
    totalBuys,
    totalSells,
  };
}
