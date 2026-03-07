"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getPositionsForLabel,
  getGlobalTotal,
  formatSimValue,
} from "@/lib/simulator-calc";
import type { UseSimulatorReturn } from "@/hooks/use-simulator";

interface Props {
  chartType: "country" | "sector";
  label: string;
  sim: UseSimulatorReturn;
}

export function PositionDetailsPanel({ chartType, label, sim }: Props) {
  const positions = useMemo(
    () =>
      getPositionsForLabel(
        chartType,
        label,
        sim.categoryMode,
        sim.items,
        sim.portfolioData,
        sim.mode,
        sim.scope,
        sim.portfolioId
      ).sort((a, b) => b.value - a.value),
    [chartType, label, sim.categoryMode, sim.items, sim.portfolioData, sim.mode, sim.scope, sim.portfolioId]
  );

  const segmentTotal = positions.reduce((sum, p) => sum + p.value, 0);
  const globalTotal = sim.globalTotal;
  const portfolioTotal = sim.combinedAllocations.combinedTotal;
  const isGlobalScope = sim.scope === "global" || sim.mode === "portfolio";

  if (positions.length === 0) {
    return (
      <div className="ml-5 py-2 text-xs text-muted-foreground">
        No positions found
      </div>
    );
  }

  return (
    <div className="ml-5 mb-2 rounded-lg border border-border/30 bg-muted/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/20 text-xs text-muted-foreground">
        <span>
          {positions.length} position{positions.length !== 1 ? "s" : ""}
        </span>
        <span>€{formatSimValue(segmentTotal)}</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border/10">
        {positions.map((pos, i) => {
          const pctSegment =
            segmentTotal > 0
              ? ((pos.value / segmentTotal) * 100).toFixed(1)
              : "0.0";
          const pctPortfolio =
            portfolioTotal > 0
              ? ((pos.value / portfolioTotal) * 100).toFixed(1)
              : "0.0";
          const pctGlobal =
            globalTotal > 0
              ? ((pos.value / globalTotal) * 100).toFixed(1)
              : "0.0";
          const isSimulated = pos.source === "simulated";

          return (
            <div
              key={`${pos.ticker}-${i}`}
              className={cn(
                "grid gap-2 px-3 py-1.5 text-xs items-center",
                isGlobalScope
                  ? "grid-cols-[auto_1fr_auto_auto_auto]"
                  : "grid-cols-[auto_1fr_auto_auto_auto_auto]"
              )}
            >
              {/* Ticker / Simulated badge */}
              {isSimulated ? (
                <Badge
                  variant="outline"
                  className="text-[10px] border-cyan-400/30 text-cyan-400"
                >
                  + Sim
                </Badge>
              ) : (
                <span className="font-mono text-muted-foreground">
                  {pos.ticker}
                </span>
              )}

              {/* Name */}
              <span className="truncate">{pos.name}</span>

              {/* Value */}
              <span className="tabular-nums text-muted-foreground text-right">
                €{formatSimValue(pos.value)}
              </span>

              {/* Segment % */}
              <span className="tabular-nums font-medium text-right min-w-[40px]">
                {pctSegment}%
              </span>

              {/* Portfolio % (only in portfolio scope overlay) */}
              {!isGlobalScope && (
                <span className="tabular-nums text-muted-foreground text-right min-w-[40px]">
                  {pctPortfolio}%
                </span>
              )}

              {/* Global % */}
              <span className="tabular-nums text-muted-foreground/60 text-right min-w-[40px]">
                {pctGlobal}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
