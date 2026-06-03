"use client";

import { Suspense, useState } from "react";
import { usePerformance } from "@/hooks/use-performance";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shell/page-header";
import { PanelLayout } from "@/components/domain/panel-layout";
import { SummaryPanel } from "./summary-panel";
import { AllocationTable } from "./allocation-table";
import { PerformanceChart } from "./performance-chart";
import type { ChartSelection } from "@/types/performance";

export default function PerformancePage() {
  return (
    <Suspense fallback={<PerformanceSkeleton />}>
      <PerformancePageInner />
    </Suspense>
  );
}

function PerformanceSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeader title="Performance" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function PerformancePageInner() {
  const {
    selectedPortfolioId,
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

  // Reset chart selection when the active portfolio flips. The picker writes
  // ?portfolio= → usePerformance updates selectedPortfolioId → we observe the
  // change here. Uses React 19's "adjusting state while rendering" pattern
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // to avoid the set-state-in-effect lint rule.
  const [trackedPortfolioId, setTrackedPortfolioId] =
    useState(selectedPortfolioId);
  if (selectedPortfolioId !== trackedPortfolioId) {
    setTrackedPortfolioId(selectedPortfolioId);
    setChartSelection(null);
  }

  // Clear chart selection on mode change
  const handleModeChange = (mode: typeof allocationMode) => {
    setChartSelection(null);
    setAllocationMode(mode);
  };

  if (isLoading && !portfolioData) {
    return <PerformanceSkeleton />;
  }

  if (error && !portfolioData) {
    return (
      <div className="space-y-4">
        <PageHeader title="Performance" />
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Performance" />

      <SummaryPanel
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
        </>
      )}
    </div>
  );
}
