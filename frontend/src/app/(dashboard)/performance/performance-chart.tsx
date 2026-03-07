"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import {
  buildChartSeries,
  getSincePurchaseDateInfo,
} from "@/lib/performance-calc";
import { oceanDepthChartColors, useChartTheme } from "@/components/domain/chart-wrapper";
import type {
  ChartPeriod,
  ChartMode,
  ChartSelection,
  PerformanceCompany,
  HistoricalPricesResponse,
} from "@/types/performance";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface PerformanceChartProps {
  companies: PerformanceCompany[];
  selection: ChartSelection | null;
  portfolioId: string;
}

const periods: { label: string; value: ChartPeriod }[] = [
  { label: "3Y", value: "3y" },
  { label: "5Y", value: "5y" },
  { label: "10Y", value: "10y" },
  { label: "MAX", value: "max" },
  { label: "Since Purchase", value: "since_purchase" },
];

const palette = [
  oceanDepthChartColors.primary,
  oceanDepthChartColors.secondary,
  oceanDepthChartColors.tertiary,
  oceanDepthChartColors.quaternary,
  oceanDepthChartColors.muted,
  "#A78BFA",
  "#F472B6",
  "#34D399",
];

export function PerformanceChart({
  companies,
  selection,
  portfolioId,
}: PerformanceChartProps) {
  const chartTheme = useChartTheme();
  const [period, setPeriod] = useState<ChartPeriod>("5y");
  const [chartMode, setChartMode] = useState<ChartMode>("aggregate");
  const [isLoading, setIsLoading] = useState(false);
  const [displaySeries, setDisplaySeries] = useState<
    { name: string; data: { x: number; y: number }[] }[]
  >([]);
  const [noData, setNoData] = useState<string | null>(null);

  const cacheRef = useRef<Map<string, HistoricalPricesResponse>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  // Clear cache on portfolio change
  useEffect(() => {
    cacheRef.current.clear();
  }, [portfolioId]);

  const loadChart = useCallback(
    async (sel: ChartSelection, p: ChartPeriod, mode: ChartMode) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setNoData(null);

      // Resolve since_purchase
      let effectivePeriod = p;
      let startDate: string | null = null;
      let sincePurchaseInfo = getSincePurchaseDateInfo(
        companies,
        sel.identifiers
      );

      if (p === "since_purchase") {
        if (sincePurchaseInfo) {
          const daysSince =
            (Date.now() - new Date(sincePurchaseInfo.earliestDate).getTime()) /
            86400000;
          if (daysSince < 30) {
            sincePurchaseInfo = null;
            effectivePeriod = "5y";
          } else {
            startDate = sincePurchaseInfo.earliestDate;
          }
        } else {
          effectivePeriod = "5y";
        }
      }

      const cacheKeyPart = startDate
        ? "sd:" + startDate
        : effectivePeriod;
      const cacheKey =
        sel.identifiers.slice().sort().join(",") + "|" + cacheKeyPart;

      if (cacheRef.current.has(cacheKey)) {
        const data = cacheRef.current.get(cacheKey)!;
        const series = buildChartSeries(
          data.series,
          sel.identifiers,
          sel.names,
          sel.values,
          mode,
          sincePurchaseInfo
        );
        if (series.length === 0) {
          setNoData(`No historical data available for ${sel.groupName}`);
          setDisplaySeries([]);
        } else {
          setDisplaySeries(series);
        }
        return;
      }

      setIsLoading(true);

      try {
        const params = new URLSearchParams({
          identifiers: sel.identifiers.join(","),
        });
        if (startDate) {
          params.set("start_date", startDate);
        } else {
          params.set("period", effectivePeriod);
        }

        const data = await apiFetch<HistoricalPricesResponse>(
          `/historical_prices?${params}`,
          { signal: controller.signal }
        );

        cacheRef.current.set(cacheKey, data);

        const series = buildChartSeries(
          data.series,
          sel.identifiers,
          sel.names,
          sel.values,
          mode,
          sincePurchaseInfo
        );

        if (series.length === 0) {
          setNoData(`No historical data available for ${sel.groupName}`);
          setDisplaySeries([]);
        } else {
          setDisplaySeries(series);
          setNoData(null);
        }
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        setNoData("Failed to load historical data");
        setDisplaySeries([]);
      } finally {
        setIsLoading(false);
      }
    },
    [companies]
  );

  // Reload chart when selection, period, or mode changes
  useEffect(() => {
    if (!selection) {
      setDisplaySeries([]);
      setNoData(null);
      return;
    }
    loadChart(selection, period, chartMode);
  }, [selection, period, chartMode, loadChart]);

  // Build chart options
  const sincePurchaseInfo =
    selection && period === "since_purchase"
      ? getSincePurchaseDateInfo(companies, selection.identifiers)
      : null;

  const colors = displaySeries.map((s, i) =>
    s.name === "Weighted Avg" ? "#eab308" : palette[i % palette.length]
  );
  const strokeWidths = displaySeries.map((s) =>
    s.name === "Weighted Avg" ? 3 : displaySeries.length > 8 ? 1.5 : 2
  );
  const dashArray = displaySeries.map((s) =>
    s.name === "Weighted Avg" ? 5 : 0
  );

  const options: ApexCharts.ApexOptions = {
    chart: {
      type: "area",
      height: 350,
      fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      toolbar: { show: false },
      zoom: { enabled: false },
      background: "transparent",
      animations: { enabled: false },
    },
    colors,
    stroke: { width: strokeWidths, curve: "smooth", dashArray },
    fill: {
      type: chartMode === "aggregate" ? "solid" : "gradient",
      opacity: chartMode === "aggregate" ? 0 : 0.05,
      gradient: {
        shade: "light",
        type: "vertical",
        opacityFrom: 0.08,
        opacityTo: 0.01,
      },
    },
    dataLabels: { enabled: false },
    grid: {
      show: true,
      borderColor: chartTheme.grid.borderColor,
      strokeDashArray: 4,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
    },
    xaxis: {
      type: "datetime",
      labels: {
        style: { colors: chartTheme.chart.foreColor, fontSize: "11px" },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: { colors: chartTheme.chart.foreColor, fontSize: "11px" },
        formatter: (v: number) => v.toFixed(0),
        offsetX: -8,
      },
    },
    tooltip: {
      theme: chartTheme.tooltip.theme,
      x: { format: sincePurchaseInfo ? "dd MMM yyyy" : "MMM yyyy" },
      y: {
        formatter: (val: number) => {
          const change = val - 100;
          const sign = change >= 0 ? "+" : "";
          return val.toFixed(1) + " (" + sign + change.toFixed(1) + "%)";
        },
      },
    },
    legend: {
      show: chartMode === "detail" && displaySeries.length > 1,
      position: "top",
      horizontalAlign: "left",
      labels: { colors: chartTheme.chart.foreColor },
      fontSize: "11px",
      markers: { size: 4 },
      itemMargin: { horizontal: 8 },
    },
    annotations: {
      yaxis: [
        {
          y: 100,
          borderColor: "rgba(148, 163, 184, 0.25)",
          strokeDashArray: 2,
          label: { text: "" },
        },
      ],
    },
  };

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3">
        <h3 className="text-base font-semibold mb-2">
          {selection ? `${selection.groupName} Returns` : "Returns"}
        </h3>
        <div className="flex flex-wrap gap-2">
          {/* Chart mode toggle */}
          <div className="flex gap-0.5 rounded-md border border-border bg-muted p-0.5">
            {(["aggregate", "detail"] as ChartMode[]).map((m) => (
              <Button
                key={m}
                variant={chartMode === m ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "text-xs h-7 px-2.5 capitalize",
                  chartMode === m && "bg-background shadow-sm"
                )}
                onClick={() => setChartMode(m)}
              >
                {m}
              </Button>
            ))}
          </div>

          {/* Period toggle */}
          <div className="flex gap-0.5 rounded-md border border-border bg-muted p-0.5">
            {periods.map((p) => (
              <Button
                key={p.value}
                variant={period === p.value ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "text-xs h-7 px-2.5",
                  period === p.value && "bg-background shadow-sm"
                )}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart content */}
      {isLoading ? (
        <Skeleton className="h-[350px] w-full" />
      ) : !selection ? (
        <div className="h-[350px] flex items-center justify-center text-muted-foreground">
          Click a row to see performance over time
        </div>
      ) : noData ? (
        <div className="h-[350px] flex items-center justify-center text-muted-foreground">
          {noData}
        </div>
      ) : (
        <Chart
          options={options}
          series={displaySeries}
          type="area"
          height={350}
        />
      )}
    </div>
  );
}
