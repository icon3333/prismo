"use client";

import { useMemo } from "react";
import { Target, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/simulator-calc";
import type { UseSimulatorReturn } from "@/hooks/use-simulator";

interface Props {
  sim: UseSimulatorReturn;
}

export function InvestmentProgress({ sim }: Props) {
  // Only show in overlay mode
  if (sim.mode === "portfolio") return null;

  const targets = sim.portfolioData?.investmentTargets;

  if (!targets) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/50 p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="h-4 w-4" />
          <span>
            Set up your investment targets in the{" "}
            <a
              href="/builder"
              className="text-cyan-400 hover:underline"
            >
              Builder
            </a>{" "}
            to see your progress here.
          </span>
        </div>
      </div>
    );
  }

  return <ProgressBar sim={sim} targets={targets} />;
}

function ProgressBar({
  sim,
  targets,
}: {
  sim: UseSimulatorReturn;
  targets: NonNullable<UseSimulatorReturn["portfolioData"]>["investmentTargets"] & {};
}) {
  const currentValue = sim.portfolioData?.total_value || 0;
  const targetAmount = targets.targetAmount || 0;

  // Calculate simulated total (scope-aware)
  const simulatedTotal = useMemo(() => {
    let total = 0;
    for (const item of sim.items) {
      if (sim.scope === "portfolio" && sim.portfolioId) {
        if (item.portfolio_id !== sim.portfolioId) continue;
      }
      total += item.value || 0;
    }
    return total;
  }, [sim.items, sim.scope, sim.portfolioId]);

  const projectedValue = currentValue + simulatedTotal;
  const percentComplete =
    targetAmount > 0 ? Math.min(100, (currentValue / targetAmount) * 100) : 0;
  const projectedPercent =
    targetAmount > 0 ? (projectedValue / targetAmount) * 100 : 0;
  const isOverTarget = currentValue > targetAmount;
  const projectedOverTarget = projectedValue > targetAmount;

  const clampedExisting = Math.min(100, percentComplete);
  const simulatedPercent =
    targetAmount > 0
      ? Math.min(100 - clampedExisting, (simulatedTotal / targetAmount) * 100)
      : 0;
  const remainingPercent = Math.max(0, 100 - clampedExisting - simulatedPercent);

  let scopeLabel = "Global";
  let allocationInfo = "";
  if (sim.scope === "portfolio" && targets.portfolioName) {
    scopeLabel = targets.portfolioName;
    if (targets.allocationPercent) {
      allocationInfo = ` (${targets.allocationPercent}%)`;
    }
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-medium">Investment Progress</span>
          <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
            {scopeLabel}
            {allocationInfo}
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <span>{formatCurrency(currentValue)}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">
            {formatCurrency(targetAmount)}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="relative h-3 rounded-full bg-muted/50 overflow-hidden">
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-all",
              isOverTarget ? "bg-amber-400" : "bg-cyan-500"
            )}
            style={{ width: `${clampedExisting}%` }}
          />
          {simulatedTotal > 0 && !isOverTarget && (
            <div
              className="absolute inset-y-0 bg-cyan-500/40 rounded-r-full transition-all"
              style={{
                left: `${clampedExisting}%`,
                width: `${simulatedPercent}%`,
              }}
            />
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isOverTarget ? "bg-amber-400" : "bg-cyan-500"
              )}
            />
            <span className="text-muted-foreground">
              Existing {clampedExisting.toFixed(1)}%
            </span>
          </div>
          {simulatedTotal > 0 && !isOverTarget && (
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-cyan-500/40" />
              <span className="text-muted-foreground">
                Simulated +{simulatedPercent.toFixed(1)}%
              </span>
            </div>
          )}
          {!isOverTarget && remainingPercent > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-muted/50" />
              <span className="text-muted-foreground">
                Remaining {remainingPercent.toFixed(1)}%
              </span>
            </div>
          )}
          {isOverTarget && (
            <span className="text-amber-400">
              {formatCurrency(currentValue - targetAmount)} over target
            </span>
          )}
        </div>
      </div>

      {/* Simulated impact */}
      {simulatedTotal > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>With simulated additions:</span>
          <span className="font-medium text-foreground">
            {formatCurrency(projectedValue)}
          </span>
          <span>({projectedPercent.toFixed(1)}%)</span>
          {!projectedOverTarget && projectedValue < targetAmount && (
            <span>
              — {formatCurrency(targetAmount - projectedValue)} still needed
            </span>
          )}
          {projectedOverTarget && (
            <span className="text-amber-400">— exceeds target</span>
          )}
        </div>
      )}
    </div>
  );
}
