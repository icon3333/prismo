"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import type {
  PortfolioOption,
  PerformancePortfolioData,
} from "@/types/performance";

interface SummaryPanelProps {
  portfolios: PortfolioOption[];
  selectedPortfolioId: string;
  onSelectPortfolio: (id: string) => void;
  portfolioData: PerformancePortfolioData | null;
  cashBalance: number;
  includeCash: boolean;
  onIncludeCashChange: (v: boolean) => void;
}

const fmt = {
  currency: new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }),
};

function formatPnLSummary(
  abs: number | null,
  pct: number | null
): { text: string; className: string } {
  if (abs === null || abs === undefined) {
    return { text: "N/A", className: "text-muted-foreground" };
  }

  const absVal = abs;
  const pctVal = pct ?? 0;
  const sign = absVal > 0 ? "+" : "";
  const colorClass =
    absVal > 0
      ? "text-emerald-400"
      : absVal < 0
        ? "text-coral-500"
        : "text-muted-foreground";

  return {
    text: `${sign}€${fmt.currency.format(Math.abs(absVal))} (${sign}${Math.abs(pctVal).toFixed(1)}%)`,
    className: colorClass,
  };
}

export function SummaryPanel({
  portfolios,
  selectedPortfolioId,
  onSelectPortfolio,
  portfolioData,
  cashBalance,
  includeCash,
  onIncludeCashChange,
}: SummaryPanelProps) {
  if (!portfolios.length) {
    return (
      <Alert>
        <AlertDescription>
          <strong>No portfolios with holdings found.</strong>
          <br />
          Import holdings via CSV on the Overview page.
        </AlertDescription>
      </Alert>
    );
  }

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

  const lastUpdated = portfolioData?.last_updated
    ? new Date(portfolioData.last_updated).toLocaleDateString()
    : "Never";

  return (
    <div className="border border-border bg-card p-4 space-y-4">
      {/* Top row: selector + cash toggle */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Portfolio</span>
          <Select
            value={selectedPortfolioId}
            onValueChange={(v) => {
              if (v) onSelectPortfolio(v);
            }}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select a portfolio">
                {selectedPortfolioId === "all"
                  ? "All Portfolios"
                  : portfolios.find((p) => String(p.id) === selectedPortfolioId)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {portfolios.length >= 2 && (
                <SelectItem value="all">All Portfolios</SelectItem>
              )}
              {portfolios.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {cashBalance > 0 && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={includeCash}
              onCheckedChange={(v) => onIncludeCashChange(v === true)}
            />
            Cash
            <Badge variant="secondary" className="sensitive-value">
              €{fmt.currency.format(cashBalance)}
            </Badge>
          </label>
        )}
      </div>

      {/* Summary stats */}
      {portfolioData && (
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Value
            </p>
            <p className="text-lg font-semibold">
              <SensitiveValue>
                €{fmt.currency.format(displayValue)}
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
