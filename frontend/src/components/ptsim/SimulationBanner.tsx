"use client";

import { cn } from "@/lib/utils";

interface SimulationBannerProps {
  message?: string;
  className?: string;
}

const DEFAULT_MESSAGE =
  "Hypothetical scenario — not your live portfolio. Changes here do not affect real holdings.";

export function SimulationBanner({
  message = DEFAULT_MESSAGE,
  className,
}: SimulationBannerProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2 border-l-2 border-amber",
        className,
      )}
      style={{ background: "rgba(255,176,32,0.08)" }}
    >
      <span className="font-mono uppercase text-[10px] tracking-[0.12em] text-amber">
        SIMULATION MODE
      </span>
      <span className="text-[12px] text-ink-1">{message}</span>
    </div>
  );
}
