"use client";

import { SensitiveValue } from "@/components/domain/anonymous-mode";
import type { RebalancedPortfolio, RebalanceMode } from "@/types/portfolio";

interface SummaryFooterProps {
  rebalanced: RebalancedPortfolio[];
  mode: RebalanceMode;
  investmentAmount: number;
}

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

export function SummaryFooter({
  rebalanced,
  mode,
  investmentAmount,
}: SummaryFooterProps) {
  if (rebalanced.length === 0) return null;

  const totalCurrentValue = rebalanced.reduce(
    (sum, p) => sum + (p.currentValue || 0),
    0
  );

  let totalBuys = 0;
  let totalSells = 0;
  for (const p of rebalanced) {
    if (p.action > 0.01) totalBuys += p.action;
    else if (p.action < -0.01) totalSells += Math.abs(p.action);
  }

  const netCapital = totalBuys - totalSells;
  const newTotalValue =
    mode === "existing-only"
      ? totalCurrentValue
      : totalCurrentValue + investmentAmount;

  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-1.5 text-sm">
      <Row label="Portfolio Value">
        <SensitiveValue>{fmt.format(totalCurrentValue)}</SensitiveValue>
      </Row>

      {netCapital > 0 && (
        <Row label="New Capital Required">
          <span className="text-emerald-400">
            <SensitiveValue>{fmt.format(netCapital)}</SensitiveValue>
          </span>
        </Row>
      )}

      <Row label="New Portfolio Value">
        <SensitiveValue>{fmt.format(newTotalValue)}</SensitiveValue>
      </Row>

      {(totalBuys > 0 || totalSells > 0) && (
        <Row label="Total Transactions">
          {totalBuys > 0 && (
            <span className="text-emerald-400">
              Buy: <SensitiveValue>{fmt.format(totalBuys)}</SensitiveValue>
            </span>
          )}
          {totalBuys > 0 && totalSells > 0 && (
            <span className="text-muted-foreground mx-1">|</span>
          )}
          {totalSells > 0 && (
            <span className="text-coral-500">
              Sell: <SensitiveValue>{fmt.format(totalSells)}</SensitiveValue>
            </span>
          )}
        </Row>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
