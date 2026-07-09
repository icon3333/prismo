"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import { date, eur, signedEur, signedPct } from "@/lib/format";
import { parseServerTimestampMs } from "@/lib/enrich-calc";
import type { PerformancePortfolioData } from "@/types/performance";

interface SummaryPanelProps {
  portfolioData: PerformancePortfolioData | null;
  cashBalance: number;
  includeCash: boolean;
  onIncludeCashChange: (v: boolean) => void;
}

function formatPnLSummary(
  abs: number | null,
  pct: number | null
): { text: string; className: string } {
  if (abs === null || abs === undefined) {
    return { text: "N/A", className: "text-muted-foreground" };
  }

  const colorClass =
    abs > 0
      ? "text-green"
      : abs < 0
        ? "text-red"
        : "text-muted-foreground";

  return {
    text: `${signedEur(abs)} (${signedPct(pct ?? 0)})`,
    className: colorClass,
  };
}

export function SummaryPanel({
  portfolioData,
  cashBalance,
  includeCash,
  onIncludeCashChange,
}: SummaryPanelProps) {
  const displayValue = portfolioData
    ? includeCash
      ? portfolioData.total_value + cashBalance
      : portfolioData.total_value
    : 0;

  const pnl = portfolioData
    ? formatPnLSummary(
        portfolioData.portfolio_pnl_absolute,
        portfolioData.portfolio_pnl_percentage
      )
    : null;

  const lastUpdatedMs = parseServerTimestampMs(portfolioData?.last_updated ?? null);
  const lastUpdated = lastUpdatedMs != null ? date(lastUpdatedMs) : "Never";

  return (
    <div className="border border-border bg-card p-4 space-y-4">
      {cashBalance > 0 && (
        <div className="flex items-center">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={includeCash}
              onCheckedChange={(v) => onIncludeCashChange(v === true)}
            />
            Cash
            <Badge variant="secondary" className="sensitive-value">
              {eur(cashBalance)}
            </Badge>
          </label>
        </div>
      )}

      {/* Summary stats */}
      {portfolioData && (
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Value
            </p>
            <p className="text-lg font-semibold font-mono tabular-nums">
              <SensitiveValue>
                {eur(displayValue)}
              </SensitiveValue>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              P&L
            </p>
            <p className={`text-lg font-semibold ${pnl?.className}`}>
              <SensitiveValue>{pnl?.text}</SensitiveValue>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Holdings
            </p>
            <p className="text-lg font-semibold">
              {portfolioData.num_holdings}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Updated
            </p>
            <p className="text-lg font-semibold">{lastUpdated}</p>
          </div>
        </div>
      )}
    </div>
  );
}
