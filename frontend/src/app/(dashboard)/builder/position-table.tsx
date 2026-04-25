"use client";

import { useState, useMemo } from "react";
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
import { Input } from "@/components/ui/input";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import {
  sortPositions,
  computePortfolioAmount,
  computePositionAmount,
  formatCurrencyRaw,
} from "@/lib/builder-calc";
import type {
  BuilderRealPosition,
  BuilderPlaceholderPosition,
  BuilderPosition,
  SortOptions,
} from "@/types/builder";

interface PositionTableProps {
  positions: BuilderRealPosition[];
  placeholder: BuilderPlaceholderPosition | null;
  allocation: number;
  totalInvestableCapital: number;
  evenSplit: boolean;
  sortOptions: SortOptions;
  onSortChange: (opts: SortOptions) => void;
  onRemove: (companyId: number) => void;
  onWeightChange: (companyId: number, weight: number) => void;
}

function SortIcon({ column, sort }: { column: string; sort: SortOptions }) {
  const active = sort.column === column;
  const glyph = active && sort.direction === "desc" ? "▼" : "▲";
  const cls = active ? "text-cyan" : "text-ink-3";
  return <span aria-hidden className={`text-[10px] leading-none ${cls}`}>{glyph}</span>;
}

export function PositionTable({
  positions,
  placeholder,
  allocation,
  totalInvestableCapital,
  evenSplit,
  sortOptions,
  onSortChange,
  onRemove,
  onWeightChange,
}: PositionTableProps) {
  const portfolioAmount = computePortfolioAmount(allocation, totalInvestableCapital);

  const sortedPositions = useMemo(
    () => sortPositions(positions, placeholder, sortOptions, portfolioAmount),
    [positions, placeholder, sortOptions, portfolioAmount]
  );

  const totalWeight = useMemo(() => {
    let sum = positions.reduce((s, p) => s + (p.weight || 0), 0);
    if (placeholder) sum += placeholder.totalRemainingWeight;
    return sum;
  }, [positions, placeholder]);

  const totalAmount = useMemo(() => {
    let sum = positions.reduce(
      (s, p) => s + portfolioAmount * ((p.weight || 0) / 100),
      0
    );
    if (placeholder) {
      sum += portfolioAmount * (placeholder.totalRemainingWeight / 100);
    }
    return sum;
  }, [positions, placeholder, portfolioAmount]);

  function handleSort(column: SortOptions["column"]) {
    if (sortOptions.column === column) {
      onSortChange({
        column,
        direction: sortOptions.direction === "asc" ? "desc" : "asc",
      });
    } else {
      onSortChange({
        column,
        direction: column === "name" ? "asc" : "desc",
      });
    }
  }

  if (sortedPositions.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No positions yet. Select a company and click Add.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-border/30">
          <TableHead>
            <button
              type="button"
              onClick={() => handleSort("name")}
              className="flex items-center gap-1"
            >
              Company <SortIcon column="name" sort={sortOptions} />
            </button>
          </TableHead>
          <TableHead className="text-right">
            <button
              type="button"
              onClick={() => handleSort("weight")}
              className="ml-auto flex items-center gap-1"
            >
              Weight % <SortIcon column="weight" sort={sortOptions} />
            </button>
          </TableHead>
          <TableHead className="text-right">
            <button
              type="button"
              onClick={() => handleSort("amount")}
              className="ml-auto flex items-center gap-1"
            >
              Amount <SortIcon column="amount" sort={sortOptions} />
            </button>
          </TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedPositions.map((pos) =>
          pos.isPlaceholder ? (
            <PlaceholderRow
              key={`placeholder-${pos.positionsRemaining}`}
              position={pos}
              portfolioAmount={portfolioAmount}
            />
          ) : (
            <RealPositionRow
              key={pos.companyId}
              position={pos}
              portfolioAmount={portfolioAmount}
              evenSplit={evenSplit}
              onRemove={onRemove}
              onWeightChange={onWeightChange}
            />
          )
        )}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-semibold">Total</TableCell>
          <TableCell className="text-right font-semibold tabular-nums">
            {totalWeight.toFixed(1)}%
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums">
            <SensitiveValue>{formatCurrencyRaw(totalAmount)}</SensitiveValue>
          </TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
}

function RealPositionRow({
  position,
  portfolioAmount,
  evenSplit,
  onRemove,
  onWeightChange,
}: {
  position: BuilderRealPosition;
  portfolioAmount: number;
  evenSplit: boolean;
  onRemove: (companyId: number) => void;
  onWeightChange: (companyId: number, weight: number) => void;
}) {
  const [editValue, setEditValue] = useState<string | null>(null);
  const amount = computePositionAmount(position, portfolioAmount);

  return (
    <TableRow className="border-border/20">
      <TableCell className="text-sm">{position.companyName}</TableCell>
      <TableCell className="text-right">
        <Input
          className="ml-auto w-20 text-right text-sm"
          disabled={evenSplit}
          value={
            editValue !== null
              ? editValue
              : position.weight
                ? position.weight.toFixed(1)
                : "0"
          }
          onFocus={() =>
            setEditValue(position.weight ? String(position.weight) : "")
          }
          onBlur={() => {
            const v = parseFloat((editValue ?? "").replace("%", ""));
            if (!isNaN(v)) onWeightChange(position.companyId, v);
            setEditValue(null);
          }}
          onChange={(e) => setEditValue(e.target.value)}
        />
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        <SensitiveValue>{formatCurrencyRaw(amount)}</SensitiveValue>
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Remove"
          className="size-7 text-ink-2 hover:text-ink leading-none text-[14px]"
          onClick={() => onRemove(position.companyId)}
        >
          ×
        </Button>
      </TableCell>
    </TableRow>
  );
}

function PlaceholderRow({
  position,
  portfolioAmount,
}: {
  position: BuilderPlaceholderPosition;
  portfolioAmount: number;
}) {
  const totalAmount = computePositionAmount(position, portfolioAmount);
  const perPositionAmount = totalAmount / Math.max(1, position.positionsRemaining);

  return (
    <TableRow className="border-border/20 text-muted-foreground italic">
      <TableCell className="text-sm">{position.companyName}</TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {position.weight.toFixed(1)}% each
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        <SensitiveValue>
          {formatCurrencyRaw(perPositionAmount)} each
        </SensitiveValue>
      </TableCell>
      <TableCell />
    </TableRow>
  );
}
