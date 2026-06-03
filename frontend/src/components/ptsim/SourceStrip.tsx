"use client";

import { cn } from "@/lib/utils";

interface SourceStripProps {
  source?: "csv" | "manual";
  className?: string;
}

export function SourceStrip({ source = "csv", className }: SourceStripProps) {
  return (
    <span
      aria-hidden
      className={cn("inline-block w-[3px] h-4 align-middle", className)}
      style={{
        background: source === "csv" ? "var(--cyan)" : "var(--amber)",
      }}
    />
  );
}
