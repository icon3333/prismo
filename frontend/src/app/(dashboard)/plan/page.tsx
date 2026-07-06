"use client";

import { Suspense } from "react";
import { useBuilder } from "@/hooks/use-builder";
import { BudgetSection } from "./budget-section";
import { RulesSection } from "@/components/domain/rules-section";
import { PortfolioList } from "./portfolio-list";
import { AllocationSummary } from "./allocation-summary";
import { RebalancePlan } from "./rebalance-plan";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shell/page-header";

// Plan = targets (former Builder) + the trades they imply (former
// Rebalancer), on one page so edits show their consequences without a
// page switch. RebalancePlan reads useSearchParams via useRebalancer,
// which suspends during prerender — hence the Suspense wrapper.

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeader title="Plan" showPortfolioPicker={false} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-48" />
      <Skeleton className="h-48" />
    </div>
  );
}

export default function PlanPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <PlanPageInner />
    </Suspense>
  );
}

function PlanPageInner() {
  const builder = useBuilder();

  if (builder.isLoading) {
    return <LoadingSkeleton />;
  }

  if (builder.error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Plan" showPortfolioPicker={false} />
        <Alert variant="destructive">
          <AlertDescription>{builder.error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan"
        showPortfolioPicker
        right={
          builder.isSaving ? (
            <span className="text-xs text-muted-foreground animate-pulse">
              Saving...
            </span>
          ) : undefined
        }
      />

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

      {/* The trades implied by the targets above */}
      <RebalancePlan />
    </div>
  );
}
