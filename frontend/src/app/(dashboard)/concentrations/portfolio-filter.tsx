"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import { cn } from "@/lib/utils";
import { eur } from "@/lib/format";
import type { PortfolioOption } from "@/types/performance";

interface PortfolioFilterProps {
  portfolios: PortfolioOption[];
  selectedPortfolios: Set<string>;
  isAllSelected: boolean;
  onTogglePortfolio: (name: string) => void;
  onSelectAll: () => void;
  cashBalance: number;
  includeCash: boolean;
  onIncludeCashChange: (v: boolean) => void;
}

export function PortfolioFilter({
  portfolios,
  selectedPortfolios,
  isAllSelected,
  onTogglePortfolio,
  onSelectAll,
  cashBalance,
  includeCash,
  onIncludeCashChange,
}: PortfolioFilterProps) {
  return (
    <div className="border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground mr-1">
          Portfolios
        </span>

        <Button
          variant={isAllSelected ? "secondary" : "ghost"}
          size="sm"
          className={cn(
            "text-xs h-7 px-3 rounded-full",
            isAllSelected && "bg-cyan/20 text-cyan border border-cyan/30"
          )}
          onClick={onSelectAll}
        >
          All
        </Button>

        {portfolios.map((p) => {
          const isActive = selectedPortfolios.has(p.name);
          return (
            <Button
              key={p.id}
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "text-xs h-7 px-3 rounded-full",
                isActive && "bg-cyan/20 text-cyan border border-cyan/30"
              )}
              onClick={() => onTogglePortfolio(p.name)}
            >
              {p.name}
            </Button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          <Checkbox
            checked={includeCash}
            onCheckedChange={(checked) => onIncludeCashChange(checked === true)}
          />
          <label
            className="text-sm text-muted-foreground cursor-pointer select-none"
            onClick={() => onIncludeCashChange(!includeCash)}
          >
            Include Cash
          </label>
          {cashBalance > 0 && (
            <span className="text-xs text-cyan/80 font-mono tabular-nums">
              <SensitiveValue>({eur(cashBalance)})</SensitiveValue>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
