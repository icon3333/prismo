"use client";

import { Suspense } from "react";
import { useConcentrations } from "@/hooks/use-concentrations";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartWrapper } from "@/components/domain/chart-wrapper";
import { ConcentrationHeatmap } from "@/components/domain/concentration-heatmap";
import { PageHeader } from "@/components/shell/page-header";
import { PortfolioFilter } from "./portfolio-filter";
import { DistributionBar } from "./distribution-bar";
import { DonutChart } from "./donut-chart";
import * as fmt from "@/lib/format";

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
    quality,
    targets,
    targetsLoading,
    targetsError,
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

      <section aria-label="Concentration data coverage" className="border border-border bg-card p-4 space-y-2 text-sm">
        <h2 className="font-medium">
          {quality.missingValuations > 0 ? "Partial valuation coverage" : "Valuation coverage"}
        </h2>
        <p>
          {quality.valuedCompanies.length} of {quality.holdingCount} selected positions valued.
          {" "}Known holdings value: {fmt.eur(quality.knownValue)}.
          {quality.missingValuations > 0 && " Unvalued positions are excluded from chart percentages; their missing value is unknown, not zero."}
        </p>
        <p>
          Unknown classifications: {quality.unknownCountry} country, {quality.unknownSector} sector,
          {" "}{quality.unknownThesis} thesis. Countries describe issuer domicile, not revenue exposure.
          {" "}ETFs are not looked through to underlying holdings.
        </p>
        <p>
          Oldest known valuation: {quality.oldestValuation ?? "unavailable"}.
          {" "}{quality.staleValuations} valuations at least 90 days old;
          {" "}{quality.unknownPriceAge} with unknown age. Manual values use their own timestamp.
          {" "}FX freshness is not provided by this view.
          {" "}Valuation dates do not date the CSV import. Full transaction history is required;
          failed imports retain previous holdings, and omitted history cannot be recovered.
        </p>
        <p>
          {includeCash ? "Account-wide cash is included" : "Cash is excluded"}
          {includeCash && !isAllSelected ? "; it is not assigned to the selected virtual portfolios" : ""}.
          {" "}Percentages use known selected holdings{includeCash ? " plus account-wide cash" : ""}.
        </p>
        <details>
          <summary className="cursor-pointer">
            Saved portfolio targets — {targetsLoading ? "loading" : targetsError ? "unavailable" : `${targets.missing} selected portfolios without a target`} (raw, not normalized)
          </summary>
          {targetsLoading ? <p>Loading target coverage…</p> : targetsError ? (
            <p>Target coverage unavailable. Saved targets could not be loaded.</p>
          ) : (
            <div className="mt-2 space-y-1">
              <p>Known saved account targets total: {targets.rawTotal === null ? "unavailable" : fmt.pct(targets.rawTotal)}.
                {" "}{targets.missing} selected portfolios without an explicit target.</p>
              <ul className="space-y-1">
                {targets.entries.map((entry) => (
                  <li key={entry.name}>
                    {entry.name}: target {entry.target === null ? "Not set" : fmt.pct(entry.target)},
                    {" "}actual {entry.actual === null ? "unavailable" : fmt.pct(entry.actual)},
                    {" "}deviation {entry.deviation === null ? "unavailable" : `${fmt.signedPct(entry.deviation)} points`}
                  </li>
                ))}
              </ul>
              <p>Explicit 0% is a saved zero target. Missing targets are not inferred; filtered targets are not rescaled.</p>
              <p>Actual target comparison uses the whole account{includeCash ? " including cash" : " excluding cash"}, not the filtered chart denominator.
                {" "}Deviations are unavailable when account valuations are incomplete.</p>
            </div>
          )}
        </details>
      </section>

      {quality.knownValue > 0 || (includeCash && cashBalance > 0) ? <>
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

        <ChartWrapper title="Issuer Domicile (not Revenue Exposure)">
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
      </> : (
        <Alert>
          <AlertDescription>
            {quality.holdingCount > 0 ? "Valuation unavailable for all selected positions. No concentration percentages can be calculated." : "No holdings in the selected portfolios."}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
