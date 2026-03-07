"use client";

import { PortfolioRow } from "./portfolio-row";
import type {
  BuilderPortfolio,
  BuilderPlaceholderPosition,
  PortfolioCompany,
  SortOptions,
} from "@/types/builder";

interface PortfolioListProps {
  portfolios: BuilderPortfolio[];
  expandedPortfolios: Record<string, boolean>;
  totalInvestableCapital: number;
  totalAllocation: number;
  minPositions: Record<string, number>;
  effectivePositions: Record<string, number>;
  currentPositions: Record<string, number>;
  placeholders: Record<string, BuilderPlaceholderPosition | null>;
  availableCompanies: Record<string, PortfolioCompany[]>;
  portfolioCompanies: Record<string, PortfolioCompany[]>;
  sortOptions: SortOptions;
  onSortChange: (opts: SortOptions) => void;
  onToggleExpanded: (portfolioId: string) => void;
  onSetAllocation: (portfolioId: string, value: number) => void;
  onSetDesiredPositions: (portfolioId: string, value: number) => void;
  onSetEvenSplit: (portfolioId: string, value: boolean) => void;
  onAddPosition: (portfolioId: string) => void;
  onRemovePosition: (portfolioId: string, companyId: number) => void;
  onSetPositionWeight: (portfolioId: string, companyId: number, weight: number) => void;
  onSetSelectedPosition: (portfolioId: string, value: string) => void;
}

export function PortfolioList({
  portfolios,
  expandedPortfolios,
  totalInvestableCapital,
  totalAllocation,
  minPositions,
  effectivePositions,
  currentPositions,
  placeholders,
  availableCompanies,
  sortOptions,
  onSortChange,
  onToggleExpanded,
  onSetAllocation,
  onSetDesiredPositions,
  onSetEvenSplit,
  onAddPosition,
  onRemovePosition,
  onSetPositionWeight,
  onSetSelectedPosition,
}: PortfolioListProps) {
  const rounded = Math.round(totalAllocation);
  let bannerClass: string;
  let bannerBorder: string;

  if (rounded === 100) {
    bannerClass = "bg-emerald-400/10 text-emerald-400";
    bannerBorder = "border-emerald-400/30";
  } else if (rounded < 100) {
    bannerClass = "bg-amber-400/10 text-amber-400";
    bannerBorder = "border-amber-400/30";
  } else {
    bannerClass = "bg-red-400/10 text-red-400";
    bannerBorder = "border-red-400/30";
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Portfolios</h2>

      {/* Allocation status banner */}
      <div
        className={`rounded-lg border px-4 py-2 text-sm font-medium ${bannerClass} ${bannerBorder}`}
      >
        Total allocation: {rounded}%
      </div>

      {/* Portfolio rows */}
      <div className="space-y-2">
        {portfolios.map((p) => (
          <PortfolioRow
            key={p.id}
            portfolio={p}
            expanded={expandedPortfolios[p.id] ?? false}
            onToggleExpanded={() => onToggleExpanded(p.id)}
            totalInvestableCapital={totalInvestableCapital}
            minPositions={minPositions[p.id] ?? 1}
            effectivePositions={effectivePositions[p.id] ?? 1}
            currentPositions={currentPositions[p.id] ?? 0}
            placeholder={placeholders[p.id] ?? null}
            availableCompanies={availableCompanies[p.id] ?? []}
            sortOptions={sortOptions}
            onSortChange={onSortChange}
            onSetAllocation={(v) => onSetAllocation(p.id, v)}
            onSetDesiredPositions={(v) => onSetDesiredPositions(p.id, v)}
            onSetEvenSplit={(v) => onSetEvenSplit(p.id, v)}
            onAddPosition={() => onAddPosition(p.id)}
            onRemovePosition={(companyId) => onRemovePosition(p.id, companyId)}
            onSetPositionWeight={(companyId, weight) =>
              onSetPositionWeight(p.id, companyId, weight)
            }
            onSetSelectedPosition={(v) => onSetSelectedPosition(p.id, v)}
          />
        ))}
      </div>
    </div>
  );
}
