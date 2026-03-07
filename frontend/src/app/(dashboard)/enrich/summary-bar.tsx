"use client";

import { useState, useRef, useCallback } from "react";
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
import { RefreshCw, Plus, Download, Search, Hammer, Coins, Upload, Loader2 } from "lucide-react";
import { formatDateAgo, parseGermanNumber } from "@/lib/enrich-calc";
import type { EnrichMetrics } from "@/types/enrich";

const fmt = {
  currency: new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }),
};

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
  const [cashInput, setCashInput] = useState(fmt.currency.format(cashBalance));
  const cashOriginal = useRef(cashBalance);

  const handleCashFocus = useCallback(() => {
    cashOriginal.current = cashBalance;
    setCashInput(String(cashBalance));
  }, [cashBalance]);

  const handleCashBlur = useCallback(() => {
    const val = parseGermanNumber(cashInput);
    if (isNaN(val) || val < 0) {
      setCashInput(fmt.currency.format(cashBalance));
      return;
    }
    if (Math.abs(val - cashOriginal.current) < 0.01) {
      setCashInput(fmt.currency.format(cashBalance));
      return;
    }
    onSaveCash(val);
    setCashInput(fmt.currency.format(val));
  }, [cashInput, cashBalance, onSaveCash]);

  // Sync cash display when cashBalance prop changes
  const prevCash = useRef(cashBalance);
  if (prevCash.current !== cashBalance) {
    prevCash.current = cashBalance;
    setCashInput(fmt.currency.format(cashBalance));
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      {/* Row 1: Metrics */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div>
          <span className="text-muted-foreground">Positions</span>{" "}
          <span className="font-semibold">{metrics.total}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Holdings</span>{" "}
          <SensitiveValue className="font-semibold">
            {fmt.currency.format(metrics.totalValue)}
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
            <>
              <button
                onClick={onUseBuilderAsCash}
                className="text-muted-foreground hover:text-aqua-400 transition-colors"
                title={`Use ${fmt.currency.format(builderAvailable)} from Builder`}
              >
                <Coins className="size-3.5" />
              </button>
              <span title="Builder configured"><Hammer className="size-3 text-muted-foreground" /></span>
            </>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">Total</span>{" "}
          <SensitiveValue className="font-semibold">
            {fmt.currency.format(portfolioTotal)}
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
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            className="h-8 w-48 pl-8 text-xs"
            placeholder="Search company..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onUpdateAll} disabled={isPriceUpdating}>
            {isPriceUpdating ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5 mr-1.5" />
            )}
            {isPriceUpdating ? "Updating..." : "Update All"}
          </Button>
          {selectedCount > 0 && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onUpdateSelected}>
              <RefreshCw className="size-3.5 mr-1.5" />
              Update ({selectedCount})
            </Button>
          )}
          <Button size="sm" className="h-8 text-xs" onClick={onAddPosition}>
            <Plus className="size-3.5 mr-1.5" />
            Add Position
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={onCsvUpload}>
            <Upload className="size-3.5 mr-1.5" />
            Import CSV
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onDownloadCSV}>
            <Download className="size-3.5 mr-1.5" />
            Export
          </Button>
        </div>
      </div>
    </div>
  );
}
