"use client";

import { cn } from "@/lib/utils";

export const oceanDepthChartColors = {
  primary: "#06B6D4",
  secondary: "#14B8A6",
  tertiary: "#F97316",
  quaternary: "#22D3EE",
  muted: "#94A3B8",
  danger: "#EF4444",
  series: ["#06B6D4", "#14B8A6", "#F97316", "#22D3EE", "#94A3B8"],
} as const;

export const oceanDepthChartTheme = {
  chart: {
    background: "transparent",
    foreColor: "#94A3B8",
    toolbar: { show: false },
  },
  grid: {
    borderColor: "rgba(255, 255, 255, 0.08)",
    strokeDashArray: 4,
  },
  tooltip: {
    theme: "dark",
    style: { fontSize: "12px" },
  },
  xaxis: {
    labels: { style: { colors: "#94A3B8", fontSize: "12px" } },
    axisBorder: { color: "rgba(255, 255, 255, 0.15)" },
  },
  yaxis: {
    labels: { style: { colors: "#94A3B8", fontSize: "12px" } },
  },
} as const;

export interface ChartWrapperProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function ChartWrapper({ title, children, className }: ChartWrapperProps) {
  return (
    <div className={cn("rounded-md border border-border bg-card p-4", className)}>
      {title && (
        <h4 className="text-base font-semibold mb-4">{title}</h4>
      )}
      <div>{children}</div>
    </div>
  );
}
