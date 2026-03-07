"use client";

import dynamic from "next/dynamic";
import { useChartTheme } from "@/components/domain/chart-wrapper";
import type { DistributionItem } from "@/lib/concentrations-calc";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

const barPalette = [
  "#06B6D4", "#14B8A6", "#F97316", "#22D3EE", "#94A3B8",
  "#8B5CF6", "#EC4899", "#10B981", "#F59E0B", "#6366F1",
  "#EF4444", "#84CC16", "#06B6D4", "#14B8A6", "#F97316",
];

interface DistributionBarProps {
  data: DistributionItem[];
  height?: number;
}

export function DistributionBar({ data, height = 300 }: DistributionBarProps) {
  const chartTheme = useChartTheme();

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ height }}
      >
        No data
      </div>
    );
  }

  const series = [
    {
      name: "Allocation",
      data: data.map((d) => parseFloat(d.percentage.toFixed(2))),
    },
  ];

  const labelColor = chartTheme.chart.foreColor;

  const options: ApexCharts.ApexOptions = {
    chart: {
      ...chartTheme.chart,
      type: "bar",
      height,
      animations: { enabled: false },
    },
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 3,
        barHeight: "65%",
        distributed: true,
      },
    },
    colors: barPalette.slice(0, data.length),
    dataLabels: {
      enabled: true,
      formatter: (val: number) => `${val.toFixed(1)}%`,
      style: {
        fontSize: "11px",
        colors: [labelColor],
      },
      offsetX: 4,
    },
    xaxis: {
      categories: data.map((d) => d.name),
      labels: {
        ...chartTheme.xaxis.labels,
        formatter: (val: string) => `${parseFloat(val).toFixed(0)}%`,
      },
    },
    yaxis: {
      labels: {
        ...chartTheme.yaxis.labels,
        maxWidth: 120,
      },
    },
    grid: chartTheme.grid,
    tooltip: {
      ...chartTheme.tooltip,
      y: {
        formatter: (val: number) => `${val.toFixed(2)}%`,
      },
    },
    legend: { show: false },
  };

  return <Chart options={options} series={series} type="bar" height={height} />;
}
