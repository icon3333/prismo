"use client";

import { cn } from "@/lib/utils";

interface KickerProps {
  id?: string;
  label: string;
  meta?: string;
  className?: string;
}

export function Kicker({ id, label, meta, className }: KickerProps) {
  return (
    <div
      className={cn(
        "font-mono font-semibold text-[11px] uppercase tracking-[0.16em] text-cyan",
        className,
      )}
    >
      <span className="text-ink-2">{label}</span>
      {id && (
        <>
          <span className="text-ink-3"> · </span>
          <span className="text-cyan">{id}</span>
        </>
      )}
      {meta && (
        <>
          <span className="text-ink-3"> · </span>
          <span className="text-ink-3">{meta}</span>
        </>
      )}
    </div>
  );
}
