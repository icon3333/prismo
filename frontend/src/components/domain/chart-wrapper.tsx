"use client";

import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

export const oceanDepthChartColors = {
  primary: "#06B6D4",
  secondary: "#14B8A6",
  tertiary: "#F97316",
  quaternary: "#22D3EE",
  muted: "#94A3B8",
  danger: "#EF4444",
  series: ["#06B6D4", "#14B8A6", "#F97316", "#22D3EE", "#94A3B8"],
} as const;

export function getChartTheme(isDark: boolean) {
  return {
    chart: {
      background: "transparent",
      foreColor: isDark ? "#94A3B8" : "#64748B",
      toolbar: { show: false },
    },
    grid: {
      borderColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
      strokeDashArray: 4,
    },
    tooltip: {
      theme: isDark ? "dark" as const : "light" as const,
      style: { fontSize: "12px" },
    },
    xaxis: {
      labels: { style: { colors: isDark ? "#94A3B8" : "#64748B", fontSize: "12px" } },
      axisBorder: { color: isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.10)" },
    },
    yaxis: {
      labels: { style: { colors: isDark ? "#94A3B8" : "#64748B", fontSize: "12px" } },
    },
  };
}

export const oceanDepthChartTheme = getChartTheme(true);

export function useChartTheme() {
  const { resolvedTheme } = useTheme();
  return getChartTheme(resolvedTheme === "dark");
}

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
