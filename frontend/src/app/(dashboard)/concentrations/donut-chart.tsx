"use client";

import dynamic from "next/dynamic";
import { useChartTheme } from "@/components/domain/chart-wrapper";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

const donutPalette = [
  "#06B6D4", "#14B8A6", "#F97316", "#22D3EE", "#94A3B8",
  "#8B5CF6", "#EC4899", "#10B981", "#F59E0B", "#6366F1",
  "#EF4444", "#84CC16",
];

interface DonutChartProps {
  labels: string[];
  values: number[];
  height?: number;
}

export function DonutChart({ labels, values, height = 300 }: DonutChartProps) {
  const chartTheme = useChartTheme();

  if (labels.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ height }}
      >
        No data
      </div>
    );
  }

  const labelColor = chartTheme.chart.foreColor;

  const options: ApexCharts.ApexOptions = {
    chart: {
      ...chartTheme.chart,
      type: "donut",
      height,
      animations: { enabled: false },
    },
    labels,
    colors: donutPalette.slice(0, labels.length),
    plotOptions: {
      pie: {
        donut: {
          size: "55%",
          labels: {
            show: true,
            name: {
              show: true,
              color: labelColor,
              fontSize: "13px",
            },
            value: {
              show: true,
              color: labelColor,
              fontSize: "16px",
              formatter: (val: string) => `${parseFloat(val).toFixed(1)}%`,
            },
            total: {
              show: true,
              label: "Total",
              color: labelColor,
              formatter: () => `${labels.length} items`,
            },
          },
        },
      },
    },
    dataLabels: {
      enabled: false,
    },
    legend: {
      position: "bottom",
      labels: { colors: labelColor },
      fontSize: "12px",
    },
    tooltip: {
      ...chartTheme.tooltip,
      y: {
        formatter: (val: number) => `${val.toFixed(2)}%`,
      },
    },
    stroke: {
      width: 1,
      colors: [chartTheme.tooltip.theme === "dark" ? "#0F172A" : "#FFFFFF"],
    },
  };

  // Convert values to percentages for the donut
  const total = values.reduce((s, v) => s + v, 0);
  const percentages = total > 0 ? values.map((v) => (v / total) * 100) : values;

  return (
    <Chart options={options} series={percentages} type="donut" height={height} />
  );
}
