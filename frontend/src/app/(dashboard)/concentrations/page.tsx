"use client";

import { Suspense } from "react";
import { useConcentrations } from "@/hooks/use-concentrations";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartWrapper } from "@/components/domain/chart-wrapper";
import { ConcentrationHeatmap } from "@/components/domain/concentration-heatmap";
import { PageHeader } from "@/components/shell/page-header";
import { PortfolioFilter } from "./portfolio-filter";
import { LimitsPanel } from "./limits-panel";
import { DistributionBar } from "./distribution-bar";
import { DonutChart } from "./donut-chart";

// useConcentrations reads useSearchParams (to seed the filter from
// ?portfolio=), which suspends during prerender.
export default function ConcentrationsPage() {
  return (
    <Suspense fallback={<ConcentrationsSkeleton />}>
      <ConcentrationsPageInner />
    </Suspense>
  );
}

function ConcentrationsSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeader title="Concentrations" showPortfolioPicker={false} />
      <Skeleton className="h-16 w-full" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

function ConcentrationsPageInner() {
  const {
    portfolios,
    selectedPortfolios,
    isAllSelected,
    togglePortfolio,
    selectAll,
    cashBalance,
    includeCash,
    setIncludeCash,
    isLoading,
    error,
    sectorData,
    countryData,
    thesisData,
    typeData,
    holdingsData,
    portfolioDistData,
    heatmapCompanies,
  } = useConcentrations();

  if (isLoading) {
    return <ConcentrationsSkeleton />;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Concentrations" showPortfolioPicker={false} />
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Concentrations" showPortfolioPicker={false} />

      <PortfolioFilter
        portfolios={portfolios}
        selectedPortfolios={selectedPortfolios}
        isAllSelected={isAllSelected}
        onTogglePortfolio={togglePortfolio}
        onSelectAll={selectAll}
        cashBalance={cashBalance}
        includeCash={includeCash}
        onIncludeCashChange={setIncludeCash}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartWrapper title="Portfolio Distribution">
          <DonutChart
            labels={portfolioDistData.map((d) => d.name)}
            values={portfolioDistData.map((d) => d.value)}
          />
        </ChartWrapper>

        <ChartWrapper title="Top 15 Holdings">
          <DistributionBar data={holdingsData} height={380} />
        </ChartWrapper>

        <ChartWrapper title="Sector Distribution">
          <DistributionBar data={sectorData} />
        </ChartWrapper>

        <ChartWrapper title="Geographic Spread">
          <DistributionBar data={countryData} />
        </ChartWrapper>

        <ChartWrapper title="Investment Types">
          <DonutChart
            labels={typeData.map((d) => d.name)}
            values={typeData.map((d) => d.value)}
          />
        </ChartWrapper>

        <ChartWrapper title="Thesis Distribution">
          <DistributionBar data={thesisData} />
        </ChartWrapper>
      </div>

      <ConcentrationHeatmap
        companies={heatmapCompanies}
        includeCash={includeCash}
        cashBalance={cashBalance}
      />

      {/* The limits monitored above are edited here too — same rules the
          Builder and the Overview violation panels use. */}
      <LimitsPanel />
    </div>
  );
}
