import type {
  PerformancePortfolioData,
  PerformanceCompany,
  AllocationRow,
  AllocationMode,
  ExposureData,
  HeatmapMode,
} from "@/types/performance";
import { cashSlice } from "./cash-inclusion";
import { rankTopItems } from "./aggregation-utils";

/**
 * Build allocation rows from portfolio data for any mode.
 */
export function buildAllocationRows(
  data: PerformancePortfolioData,
  mode: AllocationMode,
  includeCash: boolean,
  cashBalance: number
): AllocationRow[] {
  const { total: denominator } = cashSlice(data.total_value, includeCash, cashBalance);
  const pct = (value: number) => (denominator > 0 ? (value / denominator) * 100 : 0);

  let rows: AllocationRow[];

  if (mode === "stocks") {
    rows = (data.companies || []).map((c) => ({
      name: c.name,
      identifier: c.identifier,
      percentage: pct(c.current_value || 0),
      value: c.current_value || 0,
      sector: c.sector || "Unassigned",
      pnlAbsolute: c.pnl_absolute,
      pnlPercentage: c.pnl_percentage,
      totalInvested: c.total_invested,
    }));
  } else if (mode === "portfolios") {
    const source = data.portfolios || [];
    rows = source.map((portfolio) => ({
      name: portfolio.name,
      percentage: pct(portfolio.total_value || 0),
      value: portfolio.total_value || 0,
      pnlAbsolute: portfolio.pnl_absolute,
      pnlPercentage: portfolio.pnl_percentage,
      totalInvested: portfolio.total_invested,
      children: portfolio.companies.map((c) => ({
        name: c.name,
        identifier: c.identifier,
        percentage: pct(c.current_value || 0),
        value: c.current_value || 0,
        pnlAbsolute: c.pnl_absolute,
        pnlPercentage: c.pnl_percentage,
        totalInvested: c.total_invested,
      })),
    }));
  } else {
    // thesis or sector
    const source = mode === "thesis" ? data.theses : data.sectors;
    rows = (source || []).map((category) => {
      const categoryValue = category.total_value || 0;
      return {
        name: category.name,
        percentage: pct(categoryValue),
        value: categoryValue,
        pnlAbsolute: category.pnl_absolute,
        pnlPercentage: category.pnl_percentage,
        totalInvested: category.total_invested,
        children: category.companies.map((c) => {
          const companyValue = c.current_value || 0;
          const categoryPercent =
            categoryValue > 0 ? (companyValue / categoryValue) * 100 : 0;
          return {
            name: c.name,
            identifier: c.identifier,
            percentage: pct(companyValue),
            categoryPercentage: categoryPercent,
            value: companyValue,
            pnlAbsolute: c.pnl_absolute,
            pnlPercentage: c.pnl_percentage,
            totalInvested: c.total_invested,
          };
        }),
      };
    });
  }

  // Inject cash row
  if (includeCash && cashBalance > 0) {
    rows.push({
      name: "Cash",
      percentage: pct(cashBalance),
      value: cashBalance,
      pnlAbsolute: null,
      pnlPercentage: null,
      totalInvested: null,
      isCash: true,
      ...(mode === "stocks" ? { sector: "Cash" } : { children: [] }),
    });
  }

  return rows;
}

/**
 * Get since-purchase date info for a set of identifiers.
 */
export function getSincePurchaseDateInfo(
  companies: PerformanceCompany[],
  identifiers: string[]
): { earliestDate: string; latestDate: string; purchaseDates: Record<string, string> } | null {
  const identifierSet = new Set(identifiers);
  const purchaseDates: Record<string, string> = {};
  let earliestDate: string | null = null;
  let latestDate: string | null = null;

  for (const company of companies) {
    if (!company.identifier || !identifierSet.has(company.identifier)) continue;
    if (!company.first_bought_date) continue;

    const d = company.first_bought_date.substring(0, 10);
    purchaseDates[company.identifier] = d;

    if (!earliestDate || d < earliestDate) earliestDate = d;
    if (!latestDate || d > latestDate) latestDate = d;
  }

  if (!earliestDate) return null;
  return { earliestDate, latestDate: latestDate!, purchaseDates };
}

interface NormalizedSeries {
  name: string;
  identifier: string;
  value: number;
  purchaseDate: string | null;
  data: { x: number; y: number }[];
}

/**
 * ApexCharts renders every point it is given; multi-year daily series with
 * several positions can reach tens of thousands of points and make pan/zoom
 * sluggish. Above this cap, series are stride-downsampled for display.
 */
export const MAX_CHART_POINTS = 2000;

/** Pick every k-th point so length <= max, always keeping first and last. */
export function downsampleSeries(
  points: { x: number; y: number }[],
  max: number = MAX_CHART_POINTS
): { x: number; y: number }[] {
  if (points.length <= max) return points;
  const stride = Math.ceil((points.length - 1) / (max - 1));
  const sampled: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i += stride) sampled.push(points[i]);
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }
  return sampled;
}

/**
 * Build chart series from historical data. Normalizes to base 100.
 * Display series longer than MAX_CHART_POINTS are downsampled.
 */
export function buildChartSeries(
  seriesData: Record<string, { date: string; close: number }[]>,
  identifiers: string[],
  names: string[],
  values: number[],
  mode: "aggregate" | "detail",
  sincePurchaseInfo: ReturnType<typeof getSincePurchaseDateInfo>
): { name: string; data: { x: number; y: number }[] }[] {
  const allSeries: NormalizedSeries[] = [];

  for (let i = 0; i < identifiers.length; i++) {
    const id = identifiers[i];
    const name = names[i] || id;
    let points = seriesData[id];
    if (!points || points.length === 0) continue;

    let purchaseDate: string | null = null;
    if (sincePurchaseInfo?.purchaseDates[id]) {
      purchaseDate = sincePurchaseInfo.purchaseDates[id];
      const cutoff = new Date(purchaseDate).getTime();
      points = points.filter((p) => new Date(p.date).getTime() >= cutoff);
      if (points.length === 0) continue;
    }

    const basePrice = points[0].close;
    if (basePrice === 0) continue;

    allSeries.push({
      name,
      identifier: id,
      value: values[i] || 0,
      purchaseDate,
      data: points.map((p) => ({
        x: new Date(p.date).getTime(),
        y: parseFloat(((p.close / basePrice) * 100).toFixed(2)),
      })),
    });
  }

  if (allSeries.length === 0) return [];

  const displaySeries: { name: string; data: { x: number; y: number }[] }[] = [];

  if (mode === "detail") {
    for (const s of allSeries) {
      displaySeries.push({ name: s.name, data: s.data });
    }
  }

  if (allSeries.length > 1) {
    const aggSeries = sincePurchaseInfo
      ? computeChainLinkedAggregate(allSeries)
      : computeSimpleAggregate(allSeries);
    if (aggSeries) displaySeries.push(aggSeries);
  } else if (mode === "aggregate") {
    displaySeries.push({ name: allSeries[0].name, data: allSeries[0].data });
  }

  return displaySeries.map((s) => ({ ...s, data: downsampleSeries(s.data) }));
}

/**
 * Weighted average aggregate, forward-filling gaps.
 */
function computeSimpleAggregate(
  allSeries: NormalizedSeries[]
): { name: string; data: { x: number; y: number }[] } | null {
  const totalValue = allSeries.reduce((sum, s) => sum + (s.value || 1), 0);
  const weights = allSeries.map((s) =>
    totalValue > 0 ? (s.value || 1) / totalValue : 1 / allSeries.length
  );

  const dateMap = new Map<number, (number | null)[]>();
  allSeries.forEach((s, idx) => {
    s.data.forEach((point) => {
      if (!dateMap.has(point.x)) {
        dateMap.set(point.x, new Array(allSeries.length).fill(null));
      }
      dateMap.get(point.x)![idx] = point.y;
    });
  });

  const sortedDates = Array.from(dateMap.keys()).sort((a, b) => a - b);
  const lastKnown = new Array(allSeries.length).fill(100);
  const hasData = new Array(allSeries.length).fill(false);
  const aggData: { x: number; y: number }[] = [];

  for (const date of sortedDates) {
    const vals = dateMap.get(date)!;
    let weightedSum = 0;
    let weightSum = 0;

    for (let i = 0; i < vals.length; i++) {
      if (vals[i] !== null) {
        lastKnown[i] = vals[i];
        hasData[i] = true;
      }
      if (!hasData[i]) continue;
      weightedSum += lastKnown[i] * weights[i];
      weightSum += weights[i];
    }

    aggData.push({
      x: date,
      y: parseFloat((weightedSum / weightSum).toFixed(2)),
    });
  }

  return { name: "Weighted Avg", data: aggData };
}

/**
 * Chain-linked aggregate for since-purchase mode with staggered entry dates.
 */
function computeChainLinkedAggregate(
  allSeries: NormalizedSeries[]
): { name: string; data: { x: number; y: number }[] } | null {
  const seriesLookups = allSeries.map((s) => {
    const map = new Map<number, number>();
    s.data.forEach((p) => map.set(p.x, p.y));
    return map;
  });

  const seriesStartDates = allSeries.map((s) => s.data[0].x);

  const allDatesSet = new Set<number>();
  allSeries.forEach((s) => s.data.forEach((p) => allDatesSet.add(p.x)));
  const sortedDates = Array.from(allDatesSet).sort((a, b) => a - b);

  if (sortedDates.length === 0) return null;

  const totalValue = allSeries.reduce((sum, s) => sum + (s.value || 1), 0);
  const weights = allSeries.map((s) =>
    totalValue > 0 ? (s.value || 1) / totalValue : 1 / allSeries.length
  );

  const prevLevel = new Array<number | null>(allSeries.length).fill(null);
  let aggregateLevel = 100;
  const aggData: { x: number; y: number }[] = [];

  for (const date of sortedDates) {
    let totalActiveWeight = 0;
    let weightedReturn = 0;

    for (let i = 0; i < allSeries.length; i++) {
      if (date < seriesStartDates[i]) continue;

      const val = seriesLookups[i].get(date);
      if (val == null) continue;

      if (prevLevel[i] == null) {
        prevLevel[i] = val;
      } else {
        const periodReturn = (val - prevLevel[i]!) / prevLevel[i]!;
        weightedReturn += periodReturn * weights[i];
        totalActiveWeight += weights[i];
        prevLevel[i] = val;
      }
    }

    if (totalActiveWeight > 0) {
      const normalizedReturn = weightedReturn / totalActiveWeight;
      aggregateLevel *= 1 + normalizedReturn;
    }

    aggData.push({
      x: date,
      y: parseFloat(aggregateLevel.toFixed(2)),
    });
  }

  return { name: "Weighted Avg", data: aggData };
}

/** Keep top 8 + anything >= 1%, sorted desc, "Unknown" moved to the end. */
function rankAxis(percentages: Record<string, number>): string[] {
  const items = Object.entries(percentages)
    .map(([name, percentage]) => ({ name, value: percentage, percentage }))
    .sort((a, b) => b.value - a.value);
  return rankTopItems(items).map((i) => i.name);
}

/**
 * Calculate exposure data for the heatmap.
 *
 * Single pass over the companies: totals, the country x dimension exposure
 * matrix, and per-cell company details are all accumulated in one loop
 * (this re-runs on every filter change, so it stays O(n) with no
 * intermediate per-row allocations).
 */
export function calculateExposureData(
  companies: PerformanceCompany[],
  dimension: HeatmapMode,
  includeCash: boolean,
  cashBalance: number
): ExposureData {
  const empty: ExposureData = {
    countries: [],
    dims: [],
    z: [],
    companyDetails: {},
    metadata: { totalValue: 0, countryPercentages: {}, dimensionPercentages: {} },
  };

  const exposure: Record<string, Record<string, number>> = {};
  const countryTotals: Record<string, number> = {};
  const dimensionTotals: Record<string, number> = {};
  const companyDetails: Record<string, Record<string, { name: string; value: number; percentage: number }[]>> = {};
  let totalValue = 0;

  const accumulate = (name: string, country: string, dimValue: string, value: number) => {
    totalValue += value;
    (exposure[country] ??= {})[dimValue] = (exposure[country][dimValue] || 0) + value;
    countryTotals[country] = (countryTotals[country] || 0) + value;
    dimensionTotals[dimValue] = (dimensionTotals[dimValue] || 0) + value;
    ((companyDetails[country] ??= {})[dimValue] ??= []).push({ name, value, percentage: 0 });
  };

  for (const c of companies) {
    const country =
      c.investment_type === "Crypto"
        ? "Crypto"
        : (c.effective_country || c.country || "").trim() || "Unknown";
    const dimValue = ((c[dimension] as string) || "").trim() || "Unknown";
    accumulate(c.name, country, dimValue, c.current_value || 0);
  }

  if (includeCash && cashBalance > 0) {
    accumulate("Cash", "Cash", "Cash", cashBalance);
  }

  if (Object.keys(exposure).length === 0) return empty;

  const toPct = (value: number) => (totalValue > 0 ? (value / totalValue) * 100 : 0);

  const countryPercentages: Record<string, number> = {};
  for (const country in countryTotals) {
    countryPercentages[country] = toPct(countryTotals[country]);
  }
  const dimensionPercentages: Record<string, number> = {};
  for (const dim in dimensionTotals) {
    dimensionPercentages[dim] = toPct(dimensionTotals[dim]);
  }

  for (const country in companyDetails) {
    for (const dim in companyDetails[country]) {
      for (const c of companyDetails[country][dim]) c.percentage = toPct(c.value);
      companyDetails[country][dim].sort((a, b) => b.value - a.value);
    }
  }

  const sortedCountries = rankAxis(countryPercentages);
  const sortedDimensions = rankAxis(dimensionPercentages);

  const z = sortedCountries.map((country) =>
    sortedDimensions.map((dim) => toPct(exposure[country]?.[dim] || 0))
  );

  if (z.length === 0 || z[0].length === 0) return empty;

  return {
    countries: sortedCountries,
    dims: sortedDimensions,
    z,
    companyDetails,
    metadata: { totalValue, countryPercentages, dimensionPercentages },
  };
}
