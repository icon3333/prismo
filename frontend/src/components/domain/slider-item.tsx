"use client";

import { cn } from "@/lib/utils";
import { int } from "@/lib/format";

export interface SliderItemProps {
  name: string;
  value: number;
  maxValue: number;
  currentValue?: number;
  constraint?: { max: number; label: string };
  isOverLimit?: boolean;
  formatValue?: (value: number) => string;
  onChange?: (value: number) => void;
}

export function SliderItem({
  name,
  value,
  maxValue,
  currentValue,
  constraint,
  isOverLimit = false,
  formatValue = int,
  onChange,
}: SliderItemProps) {
  const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;

  return (
    <div
      className={cn(
        "border px-4 py-2 transition-colors",
        isOverLimit
          ? "border-destructive bg-[var(--danger-light)]"
          : "border-border bg-cyan/5 hover:bg-cyan/10"
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-foreground">{name}</span>
        <span className="text-sm text-foreground font-mono tabular-nums">{formatValue(value)}</span>
      </div>

      <div className="relative h-2 overflow-hidden bg-muted">
        <div
          className={cn(
            "absolute inset-y-0 left-0 transition-[width] duration-300",
            isOverLimit ? "bg-destructive" : "bg-aqua-500"
          )}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>

      {(constraint || currentValue !== undefined) && (
        <div className="flex items-center justify-between mt-1">
          {constraint && (
            <span
              className={cn(
                "text-xs",
                isOverLimit ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {constraint.label}
            </span>
          )}
          {currentValue !== undefined && (
            <span className="text-xs text-muted-foreground ml-auto">
              Current: {formatValue(currentValue)}
            </span>
          )}
        </div>
      )}

      {onChange && (
        <input
          type="range"
          min={0}
          max={maxValue}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="sr-only"
        />
      )}
    </div>
  );
}
