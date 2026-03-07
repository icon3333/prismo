"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import {
  computePortfolioAmount,
  computeEvenSplitWeight,
  formatCurrencyRaw,
} from "@/lib/builder-calc";
import { PositionTable } from "./position-table";
import type {
  BuilderPortfolio,
  BuilderRealPosition,
  BuilderPlaceholderPosition,
  PortfolioCompany,
  SortOptions,
} from "@/types/builder";
import { ChevronRight, ChevronDown, Plus } from "lucide-react";

interface PortfolioRowProps {
  portfolio: BuilderPortfolio;
  expanded: boolean;
  onToggleExpanded: () => void;
  totalInvestableCapital: number;
  minPositions: number;
  effectivePositions: number;
  currentPositions: number;
  placeholder: BuilderPlaceholderPosition | null;
  availableCompanies: PortfolioCompany[];
  sortOptions: SortOptions;
  onSortChange: (opts: SortOptions) => void;
  onSetAllocation: (value: number) => void;
  onSetDesiredPositions: (value: number) => void;
  onSetEvenSplit: (value: boolean) => void;
  onAddPosition: () => void;
  onRemovePosition: (companyId: number) => void;
  onSetPositionWeight: (companyId: number, weight: number) => void;
  onSetSelectedPosition: (value: string) => void;
}

export function PortfolioRow({
  portfolio,
  expanded,
  onToggleExpanded,
  totalInvestableCapital,
  minPositions,
  effectivePositions,
  currentPositions,
  placeholder,
  availableCompanies,
  sortOptions,
  onSortChange,
  onSetAllocation,
  onSetDesiredPositions,
  onSetEvenSplit,
  onAddPosition,
  onRemovePosition,
  onSetPositionWeight,
  onSetSelectedPosition,
}: PortfolioRowProps) {
  const selectedCompany = portfolio.selectedPosition ?? "";
  const portfolioAmount = computePortfolioAmount(
    portfolio.allocation,
    totalInvestableCapital
  );

  const desiredBelow = (portfolio.desiredPositions ?? minPositions) < minPositions;
  const currentBelow = currentPositions < effectivePositions;

  const realPositions = useMemo(
    () =>
      portfolio.positions.filter(
        (p): p is BuilderRealPosition => !p.isPlaceholder
      ),
    [portfolio.positions]
  );

  return (
    <div className="rounded-xl border border-border/50 bg-slate-900/50 overflow-hidden">
      {/* Collapsed strip */}
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 font-medium text-sm">{portfolio.name}</span>

        <div className="flex items-center gap-4 text-sm tabular-nums">
          {/* Allocation % */}
          <div
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              type="number"
              min={0}
              max={100}
              className="w-16 text-right text-sm"
              value={portfolio.allocation || ""}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) onSetAllocation(v);
              }}
            />
            <span className="text-muted-foreground">%</span>
          </div>

          {/* Amount */}
          <span className="w-24 text-right text-muted-foreground">
            <SensitiveValue>{formatCurrencyRaw(portfolioAmount)}</SensitiveValue>
          </span>

          {/* Desired Positions */}
          <div
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-xs text-muted-foreground">Target:</span>
            <Input
              type="number"
              min={1}
              className={`w-14 text-right text-sm ${desiredBelow ? "border-amber-400/50 text-amber-400" : ""}`}
              value={portfolio.desiredPositions ?? minPositions}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0) onSetDesiredPositions(v);
              }}
            />
          </div>

          {/* Current Positions */}
          <span
            className={`text-xs ${currentBelow ? "text-red-400" : "text-muted-foreground"}`}
          >
            {currentPositions} current
          </span>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/30 px-4 py-4 space-y-4">
          {/* Add position row */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Select
                value={selectedCompany}
                onValueChange={(v) => {
                  if (v) onSetSelectedPosition(v);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a company to add..." />
                </SelectTrigger>
                <SelectContent>
                  {availableCompanies.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedCompany}
              onClick={() => onAddPosition()}
            >
              <Plus className="size-3.5 mr-1" />
              Add
            </Button>
          </div>

          {/* Even split checkbox */}
          <div className="flex items-center gap-2">
            <Checkbox
              checked={portfolio.evenSplit}
              onCheckedChange={(checked) => onSetEvenSplit(checked === true)}
            />
            <label className="text-sm text-muted-foreground">
              Even split
              {portfolio.evenSplit && (
                <span className="ml-1 text-xs text-aqua-400">
                  (max {computeEvenSplitWeight(effectivePositions).toFixed(1)}%
                  per position)
                </span>
              )}
            </label>
          </div>

          {/* Position table */}
          <PositionTable
            positions={realPositions}
            placeholder={placeholder}
            allocation={portfolio.allocation}
            totalInvestableCapital={totalInvestableCapital}
            evenSplit={portfolio.evenSplit}
            sortOptions={sortOptions}
            onSortChange={onSortChange}
            onRemove={onRemovePosition}
            onWeightChange={onSetPositionWeight}
          />
        </div>
      )}
    </div>
  );
}
