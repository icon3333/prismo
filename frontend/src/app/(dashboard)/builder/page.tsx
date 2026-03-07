"use client";

import { useBuilder } from "@/hooks/use-builder";
import { BudgetSection } from "./budget-section";
import { RulesSection } from "./rules-section";
import { PortfolioList } from "./portfolio-list";
import { AllocationSummary } from "./allocation-summary";
import { Skeleton } from "@/components/ui/skeleton";

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}

export default function BuilderPage() {
  const builder = useBuilder();

  if (builder.isLoading) {
    return <LoadingSkeleton />;
  }

  if (builder.error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Builder</h1>
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-400">
          {builder.error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Builder</h1>
        {builder.isSaving && (
          <span className="text-xs text-muted-foreground animate-pulse">
            Saving...
          </span>
        )}
      </div>

      {/* Budget + Rules side by side on large screens */}
      <div className="grid gap-6 lg:grid-cols-2">
        <BudgetSection
          budget={builder.budget}
          setBudgetField={builder.setBudgetField}
          populateAlreadyInvested={builder.populateAlreadyInvested}
          portfolioMetrics={builder.portfolioMetrics}
        />
        <RulesSection rules={builder.rules} setRule={builder.setRule} />
      </div>

      {/* Portfolio list */}
      <PortfolioList
        portfolios={builder.portfolios}
        expandedPortfolios={builder.expandedPortfolios}
        totalInvestableCapital={builder.budget.totalInvestableCapital}
        totalAllocation={builder.totalAllocation}
        minPositions={builder.minPositions}
        effectivePositions={builder.effectivePositions}
        currentPositions={builder.currentPositionsMap}
        placeholders={builder.placeholders}
        availableCompanies={builder.availableCompanies}
        portfolioCompanies={builder.portfolioCompanies}
        sortOptions={builder.sortOptions}
        onSortChange={builder.setSortOptions}
        onToggleExpanded={builder.toggleExpanded}
        onSetAllocation={builder.setAllocation}
        onSetDesiredPositions={builder.setDesiredPositions}
        onSetEvenSplit={builder.setEvenSplit}
        onAddPosition={builder.addPosition}
        onRemovePosition={builder.removePosition}
        onSetPositionWeight={builder.setPositionWeight}
        onSetSelectedPosition={(portfolioId, value) => {
          builder.setPortfolios((prev) =>
            prev.map((p) =>
              p.id === portfolioId
                ? { ...p, selectedPosition: value }
                : p
            )
          );
        }}
      />

      {/* Allocation summary */}
      <AllocationSummary
        portfolios={builder.portfolios}
        totalInvestableCapital={builder.budget.totalInvestableCapital}
        totalAllocation={builder.totalAllocation}
        totalAllocatedAmount={builder.totalAllocatedAmount}
        currentPositions={builder.currentPositionsMap}
        effectivePositions={builder.effectivePositions}
        onExportCSV={builder.exportCSV}
        onExportPDF={builder.exportPDF}
      />
    </div>
  );
}
