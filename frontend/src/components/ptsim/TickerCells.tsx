"use client";

import { cn } from "@/lib/utils";

export interface TickerCell {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
  pulse?: boolean;
  sparkline?: number[];
}

interface TickerCellsProps {
  cells: TickerCell[];
  className?: string;
}

const TONE: Record<NonNullable<TickerCell["deltaTone"]>, string> = {
  up: "text-green",
  down: "text-red",
  neutral: "text-ink-2",
};

function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return null;
  const max = Math.max(...values, 0.0001);
  const barCount = values.length;
  const barWidth = 4;
  const gap = 2;
  const height = 22;
  const totalWidth = barCount * barWidth + (barCount - 1) * gap;

  return (
    <svg
      width={totalWidth}
      height={height}
      viewBox={`0 0 ${totalWidth} ${height}`}
      aria-hidden
      className="text-cyan"
    >
      {values.map((v, i) => {
        const h = Math.max(1, (v / max) * height);
        const x = i * (barWidth + gap);
        const y = height - h;
        const isLast = i === values.length - 1;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={h}
            fill="currentColor"
            opacity={isLast ? 1 : 0.6}
          />
        );
      })}
    </svg>
  );
}

export function TickerCells({ cells, className }: TickerCellsProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-px bg-rule",
        className,
      )}
    >
      {cells.map((cell, idx) => {
        const isHero = idx === 0;
        return (
          <div
            key={`${cell.label}-${idx}`}
            className="bg-bg-2 p-4 flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono uppercase text-[10px] tracking-[0.12em] text-ink-2">
                {cell.label}
              </span>
              {cell.pulse && (
                <span
                  aria-hidden
                  className="inline-block w-1.5 h-1.5 rounded-full bg-green ptsim-live-dot"
                />
              )}
            </div>
            <div
              className={cn(
                "font-mono leading-none tracking-[-0.02em] text-ink",
                isHero ? "text-[40px]" : "text-[22px] text-ink-1",
              )}
            >
              {cell.value}
            </div>
            <div className="flex items-center justify-between gap-3">
              {cell.delta ? (
                <span
                  className={cn(
                    "font-mono text-[12px]",
                    TONE[cell.deltaTone ?? "neutral"],
                  )}
                >
                  {cell.delta}
                </span>
              ) : (
                <span />
              )}
              {isHero && cell.sparkline && cell.sparkline.length > 0 && (
                <Sparkline values={cell.sparkline} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
