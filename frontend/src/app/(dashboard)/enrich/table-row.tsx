"use client";

import React, { useCallback, useEffect } from "react";
import { TableCell, TableRow as ShadTableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import { useInlineEdit } from "@/hooks/use-inline-edit";
import { calculateItemValue, getValueSource } from "@/lib/enrich-calc";
import { eur, shares as fmtShares } from "@/lib/format";
import type { EnrichItem, InvestmentType } from "@/types/enrich";

interface TableRowProps {
  item: EnrichItem;
  index: number;
  isSelected: boolean;
  portfolioOptions: string[];
  countryOptions: string[];
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

function RevertButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      className="ml-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 hover:text-cyan transition-colors shrink-0"
      title={title}
    >
      RESET
    </button>
  );
}

function SourceBadge({ source }: { source: EnrichItem["source"] }) {
  if (source === "manual") return <Badge variant="outline" className="text-[9px] px-1 py-0 mr-1">M</Badge>;
  if (source === "ibkr") return <Badge variant="outline" className="text-[9px] px-1 py-0 mr-1">IB</Badge>;
  return null;
}

export const TableRow = React.memo(function TableRow({
  item,
  index,
  isSelected,
  portfolioOptions,
  countryOptions,
  onToggleSelect,
  onSavePortfolio,
  onSaveIdentifier,
  onSaveSector,
  onSaveThesis,
  onSaveCompany,
  onSaveInvestmentType,
  onSaveCountry,
  onSaveShares,
  onSaveTotalValue,
  onResetIdentifier,
  onResetCountry,
  onResetShares,
  onResetCustomValue,
}: TableRowProps) {
  // Inline edit hooks
  const identifier = useInlineEdit(item.identifier ?? "", {
    onCommit: (v) => onSaveIdentifier(item.id, v),
  });

  const company = useInlineEdit(item.company ?? "", {
    onCommit: (v) => onSaveCompany(item.id, v),
  });

  const sector = useInlineEdit(item.sector ?? "", {
    onCommit: (v) => onSaveSector(item.id, v),
  });

  const thesis = useInlineEdit(item.thesis ?? "", {
    onCommit: (v) => onSaveThesis(item.id, v),
  });

  const shares = useInlineEdit(fmtShares(item.effective_shares ?? 0), {
    onCommit: (v) => onSaveShares(item.id, v),
  });

  const totalValue = useInlineEdit(
    getValueSource(item) === "custom" && item.custom_total_value != null
      ? fmtShares(item.custom_total_value)
      : "",
    {
      onCommit: (v) => onSaveTotalValue(item.id, v),
    }
  );

  // Sync when item changes from parent
  useEffect(() => { identifier.syncValue(item.identifier ?? ""); }, [item.identifier]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { company.syncValue(item.company ?? ""); }, [item.company]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { sector.syncValue(item.sector ?? ""); }, [item.sector]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { thesis.syncValue(item.thesis ?? ""); }, [item.thesis]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { shares.syncValue(fmtShares(item.effective_shares ?? 0)); }, [item.effective_shares]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = getValueSource(item) === "custom" && item.custom_total_value != null
      ? fmtShares(item.custom_total_value)
      : "";
    totalValue.syncValue(v);
  }, [item.custom_total_value, item.is_custom_value]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCheckbox = useCallback(
    (e: React.MouseEvent) => {
      onToggleSelect(item.id, index, e.shiftKey);
    },
    [item.id, index, onToggleSelect]
  );

  const valueSrc = getValueSource(item);
  const computedValue = calculateItemValue(item);

  return (
    <ShadTableRow className={isSelected ? "bg-muted/40" : undefined}>
      {/* Checkbox */}
      <TableCell onClick={handleCheckbox} className="cursor-pointer">
        <Checkbox checked={isSelected} tabIndex={-1} />
      </TableCell>

      {/* Identifier */}
      <TableCell>
        <div className="flex items-center">
          <SourceBadge source={item.source} />
          <Input
            className={`h-6 w-24 ${item.identifier_manually_edited ? "text-amber-400" : ""} ${identifier.isSaving ? "opacity-50" : ""}`}
            {...identifier.inputProps}
          />
          {item.identifier_manually_edited && (
            <RevertButton onClick={() => onResetIdentifier(item.id)} title="Reset to original" />
          )}
        </div>
      </TableCell>

      {/* Company */}
      <TableCell>
        {item.source === "manual" ? (
          <Input
            className={`h-6 w-32 ${company.isSaving ? "opacity-50" : ""}`}
            {...company.inputProps}
          />
        ) : (
          <span className="truncate max-w-32 block" title={item.company}>
            {item.company}
          </span>
        )}
      </TableCell>

      {/* Price */}
      <TableCell className="text-right">
        <SensitiveValue>
          <span
            className={`${
              valueSrc === "custom"
                ? "text-amber-400"
                : valueSrc === "none"
                  ? "text-red"
                  : ""
            }`}
          >
            {item.price_eur != null && item.price_eur > 0
              ? eur(item.price_eur)
              : valueSrc === "custom"
                ? eur(item.custom_price_eur ?? 0)
                : "No price"}
          </span>
        </SensitiveValue>
      </TableCell>

      {/* Portfolio */}
      <TableCell>
        <Select
          value={item.portfolio || "__none__"}
          onValueChange={(v) => {
            if (v) onSavePortfolio(item.id, v === "__none__" ? "-" : v);
          }}
        >
          <SelectTrigger className="h-6 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">-</SelectItem>
            {portfolioOptions.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Sector */}
      <TableCell>
        <Input
          className={`h-6 w-28 ${sector.isSaving ? "opacity-50" : ""}`}
          {...sector.inputProps}
        />
      </TableCell>

      {/* Thesis */}
      <TableCell>
        <Input
          className={`h-6 w-28 ${thesis.isSaving ? "opacity-50" : ""}`}
          {...thesis.inputProps}
        />
      </TableCell>

      {/* Investment Type */}
      <TableCell>
        <Select
          value={item.investment_type || "__none__"}
          onValueChange={(v) => {
            if (v && v !== "__none__") onSaveInvestmentType(item.id, v as InvestmentType);
          }}
        >
          <SelectTrigger className="h-6 w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">-</SelectItem>
            <SelectItem value="Stock">Stock</SelectItem>
            <SelectItem value="ETF">ETF</SelectItem>
            <SelectItem value="Crypto">Crypto</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>

      {/* Country */}
      <TableCell>
        <div className="flex items-center">
          <Select
            value={item.effective_country || "__none__"}
            onValueChange={(v) => {
              if (v && v !== "__none__") onSaveCountry(item.id, v);
            }}
          >
            <SelectTrigger className={`h-6 w-32 ${item.country_manually_edited ? "text-amber-400" : ""}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">-</SelectItem>
              {countryOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {item.country_manually_edited && (
            <RevertButton onClick={() => onResetCountry(item.id)} title="Reset country" />
          )}
        </div>
      </TableCell>

      {/* Shares */}
      <TableCell className="text-right">
        <div className="flex items-center justify-end">
          <Input
            className={`h-6 w-16 text-right ${
              item.csv_modified_after_edit
                ? "text-red"
                : item.is_manually_edited
                  ? "text-amber-400"
                  : ""
            } ${shares.isSaving ? "opacity-50" : ""}`}
            {...shares.inputProps}
            title={
              item.is_manually_edited
                ? `Original: ${fmtShares(item.shares)}${item.csv_modified_after_edit ? " (CSV modified after edit)" : ""}`
                : undefined
            }
          />
          {item.is_manually_edited && (
            <RevertButton onClick={() => onResetShares(item.id)} title="Reset shares" />
          )}
        </div>
      </TableCell>

      {/* Total Value */}
      <TableCell className="text-right">
        <div className="flex items-center justify-end">
          {valueSrc === "custom" ? (
            <>
              <SensitiveValue>
                <Input
                  className="h-6 w-20 text-right text-amber-400"
                  {...totalValue.inputProps}
                />
              </SensitiveValue>
              <RevertButton onClick={() => onResetCustomValue(item.id)} title="Reset to market" />
            </>
          ) : valueSrc === "market" ? (
            <SensitiveValue className="font-mono tabular-nums">
              {eur(computedValue)}
            </SensitiveValue>
          ) : (
            <SensitiveValue>
              <Input
                className="h-6 w-20 text-right text-red"
                placeholder="Enter value"
                {...totalValue.inputProps}
              />
            </SensitiveValue>
          )}
        </div>
      </TableCell>

      {/* Total Invested */}
      <TableCell className="text-right font-mono tabular-nums">
        <SensitiveValue>
          {item.total_invested != null ? eur(item.total_invested) : "-"}
        </SensitiveValue>
      </TableCell>
    </ShadTableRow>
  );
});
