"use client";

import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import {
  computeSummaryGroups,
  computePortfolioAmount,
  formatCurrencyRaw,
} from "@/lib/builder-calc";
import type { BuilderPortfolio } from "@/types/builder";

interface AllocationSummaryProps {
  portfolios: BuilderPortfolio[];
  totalInvestableCapital: number;
  totalAllocation: number;
  totalAllocatedAmount: number;
  currentPositions: Record<string, number>;
  effectivePositions: Record<string, number>;
  onExportCSV: () => void;
  onExportPDF: () => void;
}

export function AllocationSummary({
  portfolios,
  totalInvestableCapital,
  totalAllocation,
  totalAllocatedAmount,
  currentPositions,
  effectivePositions,
  onExportCSV,
  onExportPDF,
}: AllocationSummaryProps) {
  const summaryData = useMemo(() => {
    return portfolios.map((p) => ({
      portfolio: p,
      amount: computePortfolioAmount(p.allocation, totalInvestableCapital),
      groups: computeSummaryGroups(
        p,
        currentPositions[p.id] ?? 0,
        effectivePositions[p.id] ?? 0,
        totalInvestableCapital
      ),
    }));
  }, [portfolios, totalInvestableCapital, currentPositions, effectivePositions]);

  const noPortfolios = portfolios.length === 0;

  return (
    <div className="border border-border/50 bg-slate-900/50 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Allocation Summary</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={noPortfolios}
            onClick={onExportCSV}
          >
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={noPortfolios}
            onClick={onExportPDF}
          >
            PDF
          </Button>
        </div>
      </div>

      {noPortfolios ? (
        <p className="text-sm text-muted-foreground">
          No portfolios configured.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-border/30">
              <TableHead>Portfolio</TableHead>
              <TableHead>Position</TableHead>
              <TableHead className="text-right">Global %</TableHead>
              <TableHead className="text-right">Portfolio %</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summaryData.map(({ portfolio, amount, groups }) => (
              <PortfolioSummaryBlock
                key={portfolio.id}
                name={portfolio.name}
                allocation={portfolio.allocation}
                amount={amount}
                groups={groups}
              />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="font-bold">
                Total
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {totalAllocation.toFixed(1)}%
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                &mdash;
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                <SensitiveValue>
                  {formatCurrencyRaw(totalAllocatedAmount)}
                </SensitiveValue>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  );
}

function PortfolioSummaryBlock({
  name,
  allocation,
  amount,
  groups,
}: {
  name: string;
  allocation: number;
  amount: number;
  groups: ReturnType<typeof computeSummaryGroups>;
}) {
  return (
    <>
      {/* Portfolio header row */}
      <TableRow className="border-border/20 bg-slate-800/40">
        <TableCell className="font-semibold">{name}</TableCell>
        <TableCell />
        <TableCell className="text-right font-semibold tabular-nums">
          {allocation.toFixed(1)}%
        </TableCell>
        <TableCell className="text-right text-muted-foreground">100%</TableCell>
        <TableCell className="text-right font-semibold tabular-nums">
          <SensitiveValue>{formatCurrencyRaw(amount)}</SensitiveValue>
        </TableCell>
      </TableRow>

      {/* Position rows */}
      {groups.map((group, i) => (
        <TableRow key={i} className="border-border/10">
          <TableCell />
          <TableCell
            className={`text-sm ${group.isPlaceholder ? "italic text-muted-foreground" : ""}`}
          >
            {group.companyName}
          </TableCell>
          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
            {group.globalPct.toFixed(1)}%{group.eachSuffix ? " each" : ""}
          </TableCell>
          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
            {group.portfolioPct.toFixed(1)}%{group.eachSuffix ? " each" : ""}
          </TableCell>
          <TableCell className="text-right text-sm tabular-nums">
            <SensitiveValue>
              {formatCurrencyRaw(group.amount)}
              {group.eachSuffix ? " each" : ""}
            </SensitiveValue>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
