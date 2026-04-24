"use client";

import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: number;
  total: number;
  baseline: number;
  baselineTotal: number;
  showDelta: boolean;
  isExpanded: boolean;
  onClick: () => void;
}

export function AllocationBar({
  label,
  value,
  total,
  baseline,
  baselineTotal,
  showDelta,
  isExpanded,
  onClick,
}: Props) {
  const percentage = total > 0 ? (value / total) * 100 : 0;
  const isUnknown = label === "unknown";

  // Delta calculation (overlay mode)
  let deltaText = "";
  let deltaClass = "";
  if (showDelta) {
    const baselinePercentage =
      baselineTotal > 0 ? (baseline / baselineTotal) * 100 : 0;
    const delta = percentage - baselinePercentage;
    if (Math.abs(delta) >= 0.1) {
      deltaText = `(${delta > 0 ? "+" : ""}${delta.toFixed(1)}%)`;
      deltaClass = delta > 0 ? "text-emerald-400" : "text-red-400";
    }
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 py-1.5 px-1 text-left transition-colors hover:bg-muted/30",
        isExpanded && "bg-muted/30"
      )}
    >
      {/* Expand icon */}
      {isExpanded ? (
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}

      {/* Label */}
      <span className="text-sm truncate min-w-[80px] max-w-[120px]">
        {label}
      </span>

      {/* Bar track */}
      <div className="flex-1 h-3 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            isUnknown ? "bg-muted-foreground/30" : "bg-cyan-500/60"
          )}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>

      {/* Percentage + delta */}
      <span className="text-xs tabular-nums text-muted-foreground min-w-[40px] text-right">
        {percentage.toFixed(1)}%
      </span>
      {deltaText && (
        <span className={cn("text-xs tabular-nums min-w-[50px]", deltaClass)}>
          {deltaText}
        </span>
      )}
    </button>
  );
}
