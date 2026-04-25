"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import { formatDateAgo, parseGermanNumber } from "@/lib/enrich-calc";
import { eur } from "@/lib/format";
import type { EnrichMetrics } from "@/types/enrich";

interface SummaryBarProps {
  metrics: EnrichMetrics;
  cashBalance: number;
  portfolioTotal: number;
  builderAvailable: number | null;
  portfolioOptions: string[];
  selectedPortfolio: string | null;
  onSelectPortfolio: (v: string | null) => void;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  selectedCount: number;
  isPriceUpdating: boolean;
  onUpdateAll: () => void;
  onUpdateSelected: () => void;
  onAddPosition: () => void;
  onCsvUpload: () => void;
  onDownloadCSV: () => void;
  onSaveCash: (amount: number) => void;
  onUseBuilderAsCash: () => void;
}

export function SummaryBar({
  metrics,
  cashBalance,
  portfolioTotal,
  builderAvailable,
  portfolioOptions,
  selectedPortfolio,
  onSelectPortfolio,
  searchQuery,
  onSearchChange,
  selectedCount,
  isPriceUpdating,
  onUpdateAll,
  onUpdateSelected,
  onAddPosition,
  onCsvUpload,
  onDownloadCSV,
  onSaveCash,
  onUseBuilderAsCash,
}: SummaryBarProps) {
  const [cashInput, setCashInput] = useState(eur(cashBalance));
  const cashOriginal = useRef(cashBalance);

  const handleCashFocus = useCallback(() => {
    cashOriginal.current = cashBalance;
    setCashInput(String(cashBalance));
  }, [cashBalance]);

  const handleCashBlur = useCallback(() => {
    const val = parseGermanNumber(cashInput);
    if (isNaN(val) || val < 0) {
      setCashInput(eur(cashBalance));
      return;
    }
    if (Math.abs(val - cashOriginal.current) < 0.01) {
      setCashInput(eur(cashBalance));
      return;
    }
    onSaveCash(val);
    setCashInput(eur(val));
  }, [cashInput, cashBalance, onSaveCash]);

  // Sync cash display when cashBalance prop changes
  const prevCash = useRef(cashBalance);
  useEffect(() => {
    const sync = () => {
      if (prevCash.current !== cashBalance) {
        prevCash.current = cashBalance;
        setCashInput(eur(cashBalance));
      }
    };
    sync();
  }, [cashBalance]);

  return (
    <div className="space-y-3 border border-border bg-card p-4">
      {/* Row 1: Metrics */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div>
          <span className="text-muted-foreground">Positions</span>{" "}
          <span className="font-semibold">{metrics.total}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Holdings</span>{" "}
          <SensitiveValue className="font-semibold">
            {eur(metrics.totalValue)}
          </SensitiveValue>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Cash</span>
          <SensitiveValue>
            <Input
              className="h-7 w-28 text-xs sensitive-value"
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              onFocus={handleCashFocus}
              onBlur={handleCashBlur}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).blur()}
            />
          </SensitiveValue>
          {builderAvailable != null && (
            <button
              onClick={onUseBuilderAsCash}
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 hover:text-cyan transition-colors"
              title={`Use ${eur(builderAvailable)} from Builder`}
            >
              USE BUILDER
            </button>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">Total</span>{" "}
          <SensitiveValue className="font-semibold">
            {eur(portfolioTotal)}
          </SensitiveValue>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          Updated {formatDateAgo(metrics.lastUpdate)}
        </div>
      </div>

      {/* Row 2: Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selectedPortfolio ?? "__all__"}
          onValueChange={(v) => onSelectPortfolio(v === "__all__" ? null : v)}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="All Portfolios" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Portfolios</SelectItem>
            {portfolioOptions.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative">
          <Input
            className="h-8 w-48 text-xs"
            placeholder="Search company..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onUpdateAll} disabled={isPriceUpdating}>
            {isPriceUpdating ? "Updating..." : "Update All"}
          </Button>
          {selectedCount > 0 && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onUpdateSelected}>
              Update ({selectedCount})
            </Button>
          )}
          <Button size="sm" className="h-8 text-xs" onClick={onAddPosition}>
            + Add Position
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={onCsvUpload}>
            Import CSV
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onDownloadCSV}>
            Export
          </Button>
        </div>
      </div>
    </div>
  );
}
