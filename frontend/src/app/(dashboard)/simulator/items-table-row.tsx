"use client";

import { useState, useRef, useCallback } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSimValue, parseSimValue } from "@/lib/simulator-calc";
import type { SimulatorItem } from "@/types/simulator";
import type { UseSimulatorReturn } from "@/hooks/use-simulator";

interface Props {
  item: SimulatorItem;
  sim: UseSimulatorReturn;
  showPortfolioCol: boolean;
}

export function ItemsTableRow({ item, sim, showPortfolioCol }: Props) {
  return (
    <TableRow className="group">
      {/* Ticker */}
      <TableCell>
        <div className="flex items-center gap-1.5">
          {item.ticker !== "—" ? (
            <Badge
              variant="outline"
              className="font-mono text-xs text-cyan-400 border-cyan-400/30"
            >
              {item.ticker}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
          {item.existsInPortfolio && (
            <span className="text-[10px] text-muted-foreground" title="Exists in portfolio">
              ●
            </span>
          )}
        </div>
      </TableCell>

      {/* Name */}
      <TableCell>
        <InlineTextInput
          value={item.name}
          placeholder="Name"
          onCommit={(v) => sim.updateItem(item.id, { name: v })}
        />
      </TableCell>

      {/* Portfolio */}
      {showPortfolioCol && (
        <TableCell>
          <Select
            value={item.portfolio_id ? String(item.portfolio_id) : "none"}
            onValueChange={(v) => {
              if (!v) return;
              sim.updateItem(item.id, {
                portfolio_id: v === "none" ? null : parseInt(v),
              });
            }}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {sim.portfolios.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
      )}

      {/* Sector */}
      <TableCell>
        <InlineTextInput
          value={item.sector === "—" ? "" : item.sector}
          placeholder="—"
          onCommit={(v) => sim.updateItem(item.id, { sector: v || "—" })}
        />
      </TableCell>

      {/* Thesis */}
      <TableCell>
        <InlineTextInput
          value={item.thesis === "—" ? "" : item.thesis}
          placeholder="—"
          onCommit={(v) => sim.updateItem(item.id, { thesis: v || "—" })}
        />
      </TableCell>

      {/* Country */}
      <TableCell>
        <InlineTextInput
          value={item.country === "—" ? "" : item.country}
          placeholder="—"
          onCommit={(v) => sim.updateItem(item.id, { country: v || "—" })}
        />
      </TableCell>

      {/* EUR */}
      <TableCell className="text-right">
        <InlineNumberInput
          value={item.value}
          prefix="€"
          onCommit={(v) => sim.updateItemValue(item.id, "value", v)}
        />
      </TableCell>

      {/* % */}
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {item.targetWarning && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <AlertTriangle className="h-3 w-3 text-amber-400" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[200px]">
                  <p className="text-xs">{item.targetWarning}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <InlineNumberInput
            value={item.targetPercent}
            suffix="%"
            decimals={1}
            onCommit={(v) => sim.updateItemValue(item.id, "targetPercent", v)}
          />
        </div>
      </TableCell>

      {/* Delete */}
      <TableCell>
        <button
          onClick={() => sim.deleteItem(item.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Inline text input
// ---------------------------------------------------------------------------

function InlineTextInput({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback(() => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  }, [draft, value, onCommit]);

  if (!editing) {
    return (
      <span
        className={cn(
          "text-sm cursor-pointer hover:text-foreground truncate block max-w-[150px]",
          !value && "text-muted-foreground"
        )}
        onClick={() => {
          setDraft(value);
          setEditing(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        {value || placeholder}
      </span>
    );
  }

  return (
    <Input
      ref={inputRef}
      className="h-7 text-sm"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Inline number input (EUR / %)
// ---------------------------------------------------------------------------

function InlineNumberInput({
  value,
  prefix,
  suffix,
  decimals = 2,
  onCommit,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  onCommit: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const display =
    value > 0
      ? `${prefix || ""}${formatSimValue(value)}${suffix || ""}`
      : `${prefix || ""}0${suffix || ""}`;

  const commit = useCallback(() => {
    setEditing(false);
    const parsed = parseSimValue(draft);
    if (parsed !== value) onCommit(parsed);
  }, [draft, value, onCommit]);

  if (!editing) {
    return (
      <span
        className="text-sm cursor-pointer hover:text-foreground tabular-nums"
        onClick={() => {
          setDraft(value > 0 ? formatSimValue(value) : "");
          setEditing(true);
          setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
          }, 0);
        }}
      >
        {display}
      </span>
    );
  }

  return (
    <Input
      ref={inputRef}
      className="h-7 text-sm text-right w-[90px]"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setEditing(false);
        }
      }}
    />
  );
}
