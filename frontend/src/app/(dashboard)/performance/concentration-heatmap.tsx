"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChartTheme } from "@/components/domain/chart-wrapper";
import { calculateExposureData } from "@/lib/performance-calc";
import type { PerformanceCompany, HeatmapMode } from "@/types/performance";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface ConcentrationHeatmapProps {
  companies: PerformanceCompany[];
  includeCash: boolean;
  cashBalance: number;
}

export function ConcentrationHeatmap({
  companies,
  includeCash,
  cashBalance,
}: ConcentrationHeatmapProps) {
  const chartTheme = useChartTheme();
  const isDark = chartTheme.tooltip.theme === "dark";
  const [mode, setMode] = useState<HeatmapMode>("sector");

  const data = useMemo(
    () => calculateExposureData(companies, mode, includeCash, cashBalance),
    [companies, mode, includeCash, cashBalance]
  );

  const title = mode === "sector" ? "Sector vs Country" : "Thesis vs Country";

  if (data.countries.length === 0 || data.dims.length === 0) {
    return (
      <div className="border border-border bg-card p-4">
        <h3 className="text-base font-semibold mb-3">{title}</h3>
        <div className="h-40 flex items-center justify-center text-muted-foreground">
          No data to display
        </div>
      </div>
    );
  }

  const series = data.countries.map((country, index) => ({
    name: country,
    data: data.z[index].map((v) => parseFloat(v.toFixed(2))),
  }));

  const options: ApexCharts.ApexOptions = {
    chart: {
      height: 450,
      type: "heatmap",
      background: "transparent",
      toolbar: { show: true },
      animations: { enabled: false },
    },
    dataLabels: { enabled: false },
    stroke: { width: 1, colors: [isDark ? "#0F172A" : "#FFFFFF"] },
    colors: ["#06B6D4"],
    plotOptions: {
      heatmap: {
        shadeIntensity: 0.9,
        colorScale: {
          ranges: [
            { from: 0, to: 0, name: "Empty", color: isDark ? "#0F172A" : "#F1F5F9" },
            { from: 0.01, to: 5, name: "Low", color: "#155E75" },
            { from: 5, to: 15, name: "Medium", color: "#0891B2" },
            { from: 15, to: 30, name: "High", color: "#06B6D4" },
            { from: 30, to: 100, name: "Very High", color: "#22D3EE" },
          ],
        },
      },
    },
    xaxis: {
      type: "category",
      categories: data.dims,
      labels: {
        rotate: -45,
        rotateAlways: true,
        trim: true,
        style: { fontSize: "10px", colors: chartTheme.chart.foreColor },
      },
    },
    yaxis: {
      labels: {
        style: { colors: chartTheme.chart.foreColor },
      },
    },
    tooltip: {
      custom: function ({
        seriesIndex,
        dataPointIndex,
      }: {
        series: number[][];
        seriesIndex: number;
        dataPointIndex: number;
        w: unknown;
      }) {
        const country = data.countries[seriesIndex] || "Unknown";
        const dimension = data.dims[dataPointIndex] || "Unknown";
        const value = data.z[seriesIndex]?.[dataPointIndex] || 0;
        const cellCompanies =
          data.companyDetails?.[country]?.[dimension] || [];

        let companyList = "";
        if (cellCompanies.length > 0) {
          const displayCount = Math.min(cellCompanies.length, 10);
          companyList = cellCompanies
            .slice(0, displayCount)
            .map(
              (c) =>
                `<div style="margin:2px 0;display:flex;justify-content:space-between;">` +
                `<span style="margin-right:8px;">${c.name}</span>` +
                `<span style="font-weight:bold;">${c.percentage.toFixed(2)}%</span></div>`
            )
            .join("");
          if (cellCompanies.length > displayCount) {
            companyList += `<div style="margin-top:4px;font-style:italic;color:#888;">... and ${cellCompanies.length - displayCount} more</div>`;
          }
        } else {
          companyList =
            '<div style="font-style:italic;color:#888;">No companies</div>';
        }

        return (
          `<div style="padding:12px;background:rgba(0,0,0,0.85);color:white;border-radius:8px;font-size:12px;max-width:300px;">` +
          `<div style="font-weight:bold;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.3);padding-bottom:4px;">${country} × ${dimension}</div>` +
          `<div style="margin-bottom:8px;"><strong>Total Allocation: ${value.toFixed(2)}%</strong></div>` +
          `<div style="margin-bottom:4px;font-weight:bold;">Companies (${cellCompanies.length}):</div>` +
          `<div style="max-height:200px;overflow-y:auto;">${companyList}</div></div>`
        );
      },
    },
  };

  return (
    <div className="border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold">{title}</h3>
        <div className="flex gap-0.5 border border-border bg-muted p-0.5">
          {(["sector", "thesis"] as HeatmapMode[]).map((m) => (
            <Button
              key={m}
              variant={mode === m ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "text-xs h-7 px-2.5 capitalize",
                mode === m && "bg-background"
              )}
              onClick={() => setMode(m)}
            >
              {m}
            </Button>
          ))}
        </div>
      </div>

      <Chart options={options} series={series} type="heatmap" height={450} />
    </div>
  );
}
