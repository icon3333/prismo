"use client";

import { cn } from "@/lib/utils";
import type { Staleness } from "@/lib/staleness";

interface LiveDotProps {
  level?: Staleness;
  className?: string;
}

const LEVEL_BG: Record<Staleness, string> = {
  live: "bg-green",
  recent: "bg-cyan",
  stale: "bg-amber",
  disconnected: "bg-red",
};

export function LiveDot({ level = "live", className }: LiveDotProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block w-1.5 h-1.5 rounded-full align-middle",
        LEVEL_BG[level],
        level === "live" && "ptsim-live-dot",
        className,
      )}
    />
  );
}
