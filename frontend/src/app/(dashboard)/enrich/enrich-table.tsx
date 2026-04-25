"use client";

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow as ShadTableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { getHealthColorClass } from "@/lib/enrich-calc";
import type { EnrichItem, SortState, SortColumn, ColumnHealth } from "@/types/enrich";
import { TableRow } from "./table-row";

interface EnrichTableProps {
  items: EnrichItem[];
  sort: SortState;
  columnHealth: ColumnHealth;
  selectedIds: Set<number>;
  portfolioOptions: string[];
  countryOptions: string[];
  allSelected: boolean;
  someSelected: boolean;
  onToggleSort: (col: SortColumn) => void;
  onToggleSelectAll: () => void;
  onToggleSelect: (id: number, index: number, shiftKey: boolean) => void;
  onSavePortfolio: (id: number, value: string) => void;
  onSaveIdentifier: (id: number, value: string) => Promise<void>;
  onSaveSector: (id: number, value: string) => Promise<void>;
  onSaveThesis: (id: number, value: string) => Promise<void>;
  onSaveCompany: (id: number, value: string) => Promise<void>;
  onSaveInvestmentType: (id: number, value: string) => void;
  onSaveCountry: (id: number, value: string) => void;
  onSaveShares: (id: number, value: string) => Promise<void>;
  onSaveTotalValue: (id: number, value: string) => Promise<void>;
  onResetIdentifier: (id: number) => void;
  onResetCountry: (id: number) => void;
  onResetShares: (id: number) => void;
  onResetCustomValue: (id: number) => void;
}

const COLUMNS: { key: SortColumn; label: string; healthKey?: keyof ColumnHealth; align?: string }[] = [
  { key: "identifier", label: "Identifier" },
  { key: "company", label: "Company" },
  { key: "price_eur", label: "Price", align: "text-right" },
  { key: "portfolio", label: "Portfolio", healthKey: "portfolio" },
  { key: "sector", label: "Sector", healthKey: "sector" },
  { key: "thesis", label: "Thesis", healthKey: "thesis" },
  { key: "investment_type", label: "Type", healthKey: "investmentType" },
  { key: "country", label: "Country", healthKey: "country" },
  { key: "shares", label: "Shares", align: "text-right" },
  { key: "total_value", label: "Total Value", align: "text-right", healthKey: "value" },
  { key: "total_invested", label: "Invested", align: "text-right" },
];

function SortIcon({ column, sort }: { column: SortColumn; sort: SortState }) {
  const active = sort.column === column;
  const glyph = active && sort.direction === "desc" ? "▼" : "▲";
  const cls = active
    ? "text-cyan"
    : "text-ink-3 opacity-0 group-hover:opacity-100";
  return <span aria-hidden className={`text-[10px] leading-none ${cls}`}>{glyph}</span>;
}

export function EnrichTable({
  items,
  sort,
  columnHealth,
  selectedIds,
  portfolioOptions,
  countryOptions,
  allSelected,
  someSelected,
  onToggleSort,
  onToggleSelectAll,
  onToggleSelect,
  ...saveProps
}: EnrichTableProps) {
  return (
    <div className="border border-border overflow-auto">
      <Table className="[&_input]:[font-size:inherit] [&_[data-slot=select-trigger]]:[font-size:inherit]">
        <TableHeader>
          <ShadTableRow className="bg-muted hover:bg-muted">
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && someSelected}
                onCheckedChange={onToggleSelectAll}
              />
            </TableHead>
            {COLUMNS.map((col) => (
              <TableHead
                key={col.key}
                className={`cursor-pointer select-none group ${col.align ?? ""}`}
                onClick={() => onToggleSort(col.key)}
              >
                <div className={`flex items-center gap-1 ${col.align === "text-right" ? "justify-end" : ""}`}>
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    {col.label}
                  </span>
                  <SortIcon column={col.key} sort={sort} />
                  {col.healthKey && (
                    <span
                      className={`ml-1 text-[10px] font-medium ${getHealthColorClass(columnHealth[col.healthKey])}`}
                    >
                      {columnHealth[col.healthKey]}%
                    </span>
                  )}
                </div>
              </TableHead>
            ))}
          </ShadTableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => (
            <TableRow
              key={item.id}
              item={item}
              index={index}
              isSelected={selectedIds.has(item.id)}
              portfolioOptions={portfolioOptions}
              countryOptions={countryOptions}
              onToggleSelect={onToggleSelect}
              {...saveProps}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
