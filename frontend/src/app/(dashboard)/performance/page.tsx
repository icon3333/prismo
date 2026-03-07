"use client";

import { useState } from "react";
import { usePerformance } from "@/hooks/use-performance";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelLayout } from "@/components/domain/panel-layout";
import { SummaryPanel } from "./summary-panel";
import { AllocationTable } from "./allocation-table";
import { PerformanceChart } from "./performance-chart";
import { ConcentrationHeatmap } from "./concentration-heatmap";
import type { ChartSelection } from "@/types/performance";

export default function PerformancePage() {
  const {
    portfolios,
    selectedPortfolioId,
    setSelectedPortfolioId,
    portfolioData,
    cashBalance,
    includeCash,
    setIncludeCash,
    allocationMode,
    setAllocationMode,
    allocationRows,
    isAllPortfolios,
    isLoading,
    error,
    initialSortField,
    initialSortDir,
    initialExpanded,
    onSortChange,
    onExpandedChange,
  } = usePerformance();

  const [chartSelection, setChartSelection] = useState<ChartSelection | null>(
    null
  );

  // Clear chart selection on mode change
  const handleModeChange = (mode: typeof allocationMode) => {
    setChartSelection(null);
    setAllocationMode(mode);
  };

  // Clear chart selection on portfolio change
  const handlePortfolioChange = (id: string) => {
    setChartSelection(null);
    setSelectedPortfolioId(id);
  };

  if (isLoading && !portfolioData) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Performance</h1>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !portfolioData) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Performance</h1>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Performance</h1>

      <SummaryPanel
        portfolios={portfolios}
        selectedPortfolioId={selectedPortfolioId}
        onSelectPortfolio={handlePortfolioChange}
        portfolioData={portfolioData}
        cashBalance={cashBalance}
        includeCash={includeCash}
        onIncludeCashChange={setIncludeCash}
      />

      {portfolioData && (
        <>
          <PanelLayout>
            <AllocationTable
              rows={allocationRows}
              mode={allocationMode}
              onModeChange={handleModeChange}
              isAllPortfolios={isAllPortfolios}
              onRowClick={setChartSelection}
              currentSelection={chartSelection}
              initialSortField={initialSortField}
              initialSortDir={initialSortDir}
              initialExpanded={initialExpanded}
              onSortChange={onSortChange}
              onExpandedChange={onExpandedChange}
            />
            <PerformanceChart
              companies={portfolioData.companies}
              selection={chartSelection}
              portfolioId={selectedPortfolioId}
            />
          </PanelLayout>

          <ConcentrationHeatmap
            companies={portfolioData.companies}
            includeCash={includeCash}
            cashBalance={cashBalance}
          />
        </>
      )}
    </div>
  );
}
