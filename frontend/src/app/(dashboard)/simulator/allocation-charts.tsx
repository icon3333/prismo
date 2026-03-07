"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { AllocationBar } from "./allocation-bar";
import { PositionDetailsPanel } from "./position-details-panel";
import type { UseSimulatorReturn } from "@/hooks/use-simulator";

interface Props {
  sim: UseSimulatorReturn;
}

export function AllocationCharts({ sim }: Props) {
  const alloc = sim.combinedAllocations;
  const isPortfolioMode = sim.mode === "portfolio";

  const countryEntries = useMemo(
    () =>
      Object.entries(alloc.byCountry)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]),
    [alloc.byCountry]
  );

  const categoryData =
    sim.categoryMode === "thesis" ? alloc.byThesis : alloc.bySector;
  const categoryBaseline =
    sim.categoryMode === "thesis"
      ? alloc.baselineByThesis
      : alloc.baselineBySector;
  const categoryEntries = useMemo(
    () =>
      Object.entries(categoryData)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]),
    [categoryData]
  );

  const isEmpty =
    countryEntries.length === 0 && categoryEntries.length === 0;

  if (isEmpty) {
    return null;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Country chart */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Country</h3>
        <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-1">
          {countryEntries.length === 0 ? (
            <EmptyChart mode={isPortfolioMode} />
          ) : (
            countryEntries.map(([label, value]) => {
              const isExpanded = sim.expandedCountryBar === label;
              return (
                <div key={label}>
                  <AllocationBar
                    label={label}
                    value={value}
                    total={alloc.combinedTotal}
                    baseline={alloc.baselineByCountry[label] || 0}
                    baselineTotal={alloc.baselineTotal}
                    showDelta={!isPortfolioMode}
                    isExpanded={isExpanded}
                    onClick={() =>
                      sim.setExpandedCountryBar(
                        isExpanded ? null : label
                      )
                    }
                  />
                  {isExpanded && (
                    <PositionDetailsPanel
                      chartType="country"
                      label={label}
                      sim={sim}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Sector / Thesis chart */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border/50 bg-muted/30 p-0.5">
            <button
              onClick={() => sim.setCategoryMode("thesis")}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                sim.categoryMode === "thesis"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Thesis
            </button>
            <button
              onClick={() => sim.setCategoryMode("sector")}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                sim.categoryMode === "sector"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Sector
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-1">
          {categoryEntries.length === 0 ? (
            <EmptyChart mode={isPortfolioMode} />
          ) : (
            categoryEntries.map(([label, value]) => {
              const isExpanded = sim.expandedSectorBar === label;
              return (
                <div key={label}>
                  <AllocationBar
                    label={label}
                    value={value}
                    total={alloc.combinedTotal}
                    baseline={categoryBaseline[label] || 0}
                    baselineTotal={alloc.baselineTotal}
                    showDelta={!isPortfolioMode}
                    isExpanded={isExpanded}
                    onClick={() =>
                      sim.setExpandedSectorBar(
                        isExpanded ? null : label
                      )
                    }
                  />
                  {isExpanded && (
                    <PositionDetailsPanel
                      chartType="sector"
                      label={label}
                      sim={sim}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyChart({ mode }: { mode: boolean }) {
  return (
    <p className="text-xs text-muted-foreground text-center py-4">
      {mode
        ? "Add positions to see allocations"
        : "No data to display"}
    </p>
  );
}
