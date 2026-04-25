"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import { cn } from "@/lib/utils";
import { eur, signedPct } from "@/lib/format";
import type { AllocationRow, AllocationMode, ChartSelection } from "@/types/performance";

interface AllocationTableProps {
  rows: AllocationRow[];
  mode: AllocationMode;
  onModeChange: (mode: AllocationMode) => void;
  isAllPortfolios: boolean;
  onRowClick: (selection: ChartSelection | null) => void;
  currentSelection: ChartSelection | null;
  initialSortField?: SortField | null;
  initialSortDir?: SortDir;
  initialExpanded?: Record<string, boolean>;
  onSortChange?: (field: SortField | null, dir: SortDir) => void;
  onExpandedChange?: (expanded: Record<string, boolean>) => void;
}

const fmtPercent = (v: number) => v.toFixed(1) + "%";

type SortField = "name" | "percentage" | "value" | "pnl-eur" | "pnl-pct";
type SortDir = "asc" | "desc";

function formatPnL(abs: number | null, pct: number | null, invested: number | null) {
  if (abs === null || abs === undefined) {
    return { text: "N/A", className: "text-muted-foreground", tooltip: "" };
  }

  const colorClass =
    abs > 0
      ? "text-emerald-400"
      : abs < 0
        ? "text-coral-500"
        : "text-muted-foreground";

  const tooltip =
    invested != null
      ? `Total Invested: ${eur(invested)}`
      : "";

  return {
    text: `${eur(abs)} (${signedPct(pct ?? 0)})`,
    className: colorClass,
    tooltip,
  };
}

const modeLabels: Record<AllocationMode, string> = {
  portfolios: "Portfolios",
  thesis: "Thesis",
  sector: "Sector",
  stocks: "Stocks",
};

export function AllocationTable({
  rows,
  mode,
  onModeChange,
  isAllPortfolios,
  onRowClick,
  currentSelection,
  initialSortField,
  initialSortDir,
  initialExpanded,
  onSortChange,
  onExpandedChange,
}: AllocationTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    initialExpanded ?? {}
  );
  const [sortField, setSortField] = useState<SortField | null>(
    initialSortField ?? null
  );
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir ?? "desc");

  const isTreeMode = mode !== "stocks";

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = { ...prev, [name]: !(prev[name] ?? false) };
      onExpandedChange?.(next);
      return next;
    });
  };

  const handleSort = (field: SortField) => {
    let newField: SortField | null = field;
    let newDir: SortDir;
    if (sortField === field) {
      newDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      newDir = field === "name" ? "asc" : "desc";
    }
    setSortField(newField);
    setSortDir(newDir);
    onSortChange?.(newField, newDir);
  };

  const sortedRows = useMemo(() => {
    if (!sortField) return rows;

    const sorted = [...rows];
    sorted.sort((a, b) => {
      // Keep cash at the bottom
      if (a.isCash) return 1;
      if (b.isCash) return -1;

      let aVal: number | string;
      let bVal: number | string;

      switch (sortField) {
        case "name":
          aVal = a.name;
          bVal = b.name;
          return sortDir === "asc"
            ? (aVal as string).localeCompare(bVal as string)
            : (bVal as string).localeCompare(aVal as string);
        case "percentage":
          aVal = a.percentage;
          bVal = b.percentage;
          break;
        case "value":
          aVal = a.value;
          bVal = b.value;
          break;
        case "pnl-eur":
          aVal = a.pnlAbsolute ?? -Infinity;
          bVal = b.pnlAbsolute ?? -Infinity;
          break;
        case "pnl-pct":
          aVal = a.pnlPercentage ?? -Infinity;
          bVal = b.pnlPercentage ?? -Infinity;
          break;
        default:
          return 0;
      }

      return sortDir === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
    return sorted;
  }, [rows, sortField, sortDir]);

  const handleRowClick = (row: AllocationRow, isParent: boolean) => {
    if (row.isCash) return;

    // Toggle off if clicking the same selection
    if (currentSelection?.groupName === row.name) {
      onRowClick(null);
      return;
    }

    if (isParent && row.children) {
      const withIds = row.children.filter((c) => c.identifier);
      if (withIds.length > 0) {
        onRowClick({
          identifiers: withIds.map((c) => c.identifier!),
          names: withIds.map((c) => c.name),
          groupName: row.name,
          values: withIds.map((c) => c.value),
        });
      } else {
        onRowClick(null);
      }
    } else if (row.identifier) {
      onRowClick({
        identifiers: [row.identifier],
        names: [row.name],
        groupName: row.name,
        values: [row.value],
      });
    }
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  const modes: AllocationMode[] = isAllPortfolios
    ? ["portfolios", "thesis", "sector", "stocks"]
    : ["thesis", "sector", "stocks"];

  return (
    <div className="border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold">
          {modeLabels[mode]} Allocation
        </h3>
        <div className="flex gap-0.5 border border-border bg-muted p-0.5">
          {modes.map((m) => (
            <Button
              key={m}
              variant={mode === m ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "text-xs h-7 px-2.5",
                mode === m && "bg-background"
              )}
              onClick={() => onModeChange(m)}
            >
              {modeLabels[m]}
            </Button>
          ))}
        </div>
      </div>

      <div className="border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead
                className="text-xs font-semibold uppercase tracking-wider cursor-pointer select-none"
                onClick={() => handleSort("name")}
              >
                {mode === "stocks" ? "Company" : modeLabels[mode]}
                {sortIcon("name")}
              </TableHead>
              {mode === "stocks" && (
                <TableHead className="text-xs font-semibold uppercase tracking-wider">
                  Sector
                </TableHead>
              )}
              <TableHead
                className="text-right text-xs font-semibold uppercase tracking-wider cursor-pointer select-none"
                onClick={() => handleSort("percentage")}
              >
                %{sortIcon("percentage")}
              </TableHead>
              <TableHead
                className="text-right text-xs font-semibold uppercase tracking-wider cursor-pointer select-none"
                onClick={() => handleSort("value")}
              >
                Value{sortIcon("value")}
              </TableHead>
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                P&L{" "}
                <span
                  className={cn(
                    "cursor-pointer text-[10px] hover:text-foreground",
                    sortField === "pnl-eur"
                      ? "text-aqua-400 font-bold"
                      : "text-muted-foreground"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSort("pnl-eur");
                  }}
                >
                  €{sortIcon("pnl-eur")}
                </span>{" "}
                /{" "}
                <span
                  className={cn(
                    "cursor-pointer text-[10px] hover:text-foreground",
                    sortField === "pnl-pct"
                      ? "text-aqua-400 font-bold"
                      : "text-muted-foreground"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSort("pnl-pct");
                  }}
                >
                  %{sortIcon("pnl-pct")}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={mode === "stocks" ? 5 : 4}
                  className="text-center text-muted-foreground py-8"
                >
                  {mode === "thesis"
                    ? "No thesis data. Add thesis in Enrich page."
                    : "No data"}
                </TableCell>
              </TableRow>
            )}
            {sortedRows.map((row) => {
              const isSelected = currentSelection?.groupName === row.name;

              if (isTreeMode && row.children) {
                const isOpen = expanded[row.name] ?? false;
                return (
                  <TreeRow
                    key={row.name}
                    row={row}
                    isOpen={isOpen}
                    isSelected={isSelected}
                    mode={mode}
                    onToggle={() => toggleExpand(row.name)}
                    onRowClick={handleRowClick}
                    currentSelection={currentSelection}
                  />
                );
              }

              // Flat row (stocks mode)
              const pnl = formatPnL(
                row.pnlAbsolute,
                row.pnlPercentage,
                row.totalInvested
              );
              return (
                <TableRow
                  key={row.name}
                  className={cn(
                    "cursor-pointer",
                    isSelected && "bg-aqua-400/10"
                  )}
                  onClick={() => handleRowClick(row, false)}
                >
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.sector}
                  </TableCell>
                  <TableCell className="text-right">
                    {fmtPercent(row.percentage)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <SensitiveValue>
                      {eur(row.value)}
                    </SensitiveValue>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={pnl.className} title={pnl.tooltip}>
                      <SensitiveValue>{pnl.text}</SensitiveValue>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function TreeRow({
  row,
  isOpen,
  isSelected,
  mode,
  onToggle,
  onRowClick,
  currentSelection,
}: {
  row: AllocationRow;
  isOpen: boolean;
  isSelected: boolean;
  mode: AllocationMode;
  onToggle: () => void;
  onRowClick: (row: AllocationRow, isParent: boolean) => void;
  currentSelection: ChartSelection | null;
}) {
  const pnl = formatPnL(row.pnlAbsolute, row.pnlPercentage, row.totalInvested);
  const children = row.children || [];
  const isCash = row.isCash;

  return (
    <>
      {/* Parent row */}
      <TableRow
        className={cn(
          "bg-muted/30 cursor-pointer hover:bg-muted/50",
          isSelected && "bg-aqua-400/10"
        )}
        onClick={() => {
          if (isCash) return;
          onRowClick(row, true);
        }}
      >
        <TableCell className="font-medium">
          <span className="flex items-center gap-1">
            {children.length > 0 ? (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
                className="p-0.5 text-ink-2 leading-none w-3 inline-block"
                aria-hidden
              >
                {isOpen ? "▴" : "▾"}
              </span>
            ) : (
              <span className="w-5" />
            )}
            {row.name}
            {children.length > 0 && (
              <span className="text-xs text-muted-foreground ml-1">
                ({children.length})
              </span>
            )}
          </span>
        </TableCell>
        <TableCell className="text-right">
          {fmtPercent(row.percentage)}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          <SensitiveValue>{eur(row.value)}</SensitiveValue>
        </TableCell>
        <TableCell className="text-right">
          <span className={pnl.className} title={pnl.tooltip}>
            <SensitiveValue>{pnl.text}</SensitiveValue>
          </span>
        </TableCell>
      </TableRow>

      {/* Children */}
      {isOpen &&
        children.map((child) => {
          const childPnl = formatPnL(
            child.pnlAbsolute,
            child.pnlPercentage,
            child.totalInvested
          );
          const childSelected =
            currentSelection?.groupName === child.name;

          // Percentage display: in thesis/sector show "catPct% (totalPct% total)", in portfolios just show totalPct%
          const pctDisplay =
            mode === "portfolios" ? (
              <span className="text-muted-foreground">
                {fmtPercent(child.percentage)}
              </span>
            ) : (
              <>
                {fmtPercent(child.categoryPercentage ?? 0)}{" "}
                <span className="text-muted-foreground text-xs">
                  ({fmtPercent(child.percentage)} total)
                </span>
              </>
            );

          return (
            <TableRow
              key={child.name}
              className={cn(
                "cursor-pointer",
                childSelected && "bg-aqua-400/10"
              )}
              onClick={() => onRowClick(child, false)}
            >
              <TableCell className="pl-8">{child.name}</TableCell>
              <TableCell className="text-right text-sm">{pctDisplay}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                <SensitiveValue>
                  {eur(child.value)}
                </SensitiveValue>
              </TableCell>
              <TableCell className="text-right">
                <span className={childPnl.className} title={childPnl.tooltip}>
                  <SensitiveValue>{childPnl.text}</SensitiveValue>
                </span>
              </TableCell>
            </TableRow>
          );
        })}
    </>
  );
}
