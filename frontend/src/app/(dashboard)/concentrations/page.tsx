"use client";

import { useConcentrations } from "@/hooks/use-concentrations";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartWrapper } from "@/components/domain/chart-wrapper";
import { ConcentrationHeatmap } from "@/app/(dashboard)/performance/concentration-heatmap";
import { PortfolioFilter } from "./portfolio-filter";
import { DistributionBar } from "./distribution-bar";
import { DonutChart } from "./donut-chart";

export default function ConcentrationsPage() {
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
    dataLoading,
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
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Concentrations</h1>
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

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Concentrations</h1>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Concentrations</h1>

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

      {dataLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
