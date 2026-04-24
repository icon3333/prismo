"use client";

import { cn } from "@/lib/utils";

interface AllocBarProps {
  pct: number; // 0–100
  pctString: string;
  className?: string;
}

export function AllocBar({ pct, pctString, className }: AllocBarProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span className={cn("relative inline-block", className)}>
      {pctString}
      <span
        aria-hidden
        className="absolute right-0 -bottom-1 h-[2px] bg-cyan opacity-50"
        style={{ width: `${clamped}%` }}
      />
    </span>
  );
}
