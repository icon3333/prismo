"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { ChevronDown, ChevronRight, Expand, Shrink } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  PortfolioData,
  RebalancedPortfolio,
  RebalanceMode,
} from "@/types/portfolio";

interface DetailedOverviewProps {
  portfolioData: PortfolioData | null;
  rebalanced: RebalancedPortfolio[];
  selectedPortfolio: string;
  onSelectPortfolio: (name: string) => void;
  mode: RebalanceMode;
  investmentAmount: number;
}

const fmt = {
  currency: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }),
};

export function DetailedOverview({
  portfolioData,
  rebalanced,
  selectedPortfolio,
  onSelectPortfolio,
}: DetailedOverviewProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const validPortfolios = rebalanced.filter(
    (p) =>
      p.targetWeight > 0 &&
      p.name &&
      !p.name.toLowerCase().includes("unknown")
  );

  const selected = portfolioData?.portfolios.find(
    (p) => p.name === selectedPortfolio
  );

  const sectors =
    selected?.sectors?.filter((s) => s.name !== "Missing Positions") ?? [];

  const toggleSector = (name: string) =>
    setExpanded((prev) => ({ ...prev, [name]: !(prev[name] ?? true) }));

  const expandAll = () =>
    setExpanded(Object.fromEntries(sectors.map((s) => [s.name, true])));

  const collapseAll = () =>
    setExpanded(Object.fromEntries(sectors.map((s) => [s.name, false])));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Select value={selectedPortfolio} onValueChange={(v) => { if (v) onSelectPortfolio(v); }}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select a portfolio" />
          </SelectTrigger>
          <SelectContent>
            {validPortfolios.map((p) => (
              <SelectItem key={p.name} value={p.name}>
                {p.name}
                {(p.currentValue || 0) === 0 ? " (Empty)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {sectors.length > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={expandAll}>
              <Expand className="size-3.5 mr-1" />
              Expand All
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>
              <Shrink className="size-3.5 mr-1" />
              Collapse All
            </Button>
          </div>
        )}
      </div>

      {selected && sectors.length > 0 ? (
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead className="text-xs font-semibold uppercase tracking-wider">
                  Position
                </TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                  Value
                </TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                  Type
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sectors.map((sector) => {
                const isExpanded = expanded[sector.name] ?? true;
                return (
                  <SectorGroup
                    key={sector.name}
                    name={sector.name}
                    companies={sector.companies}
                    isExpanded={isExpanded}
                    onToggle={() => toggleSector(sector.name)}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : selected ? (
        <p className="text-sm text-muted-foreground">
          No positions in this portfolio.
        </p>
      ) : null}
    </div>
  );
}

function SectorGroup({
  name,
  companies,
  isExpanded,
  onToggle,
}: {
  name: string;
  companies: {
    name: string;
    value_eur: number;
    investment_type: string;
  }[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow
        className="bg-muted/50 cursor-pointer hover:bg-muted"
        onClick={onToggle}
      >
        <TableCell colSpan={3} className="font-medium">
          <span className="flex items-center gap-1">
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            {name}
            <span className="text-xs text-muted-foreground ml-1">
              ({companies.length})
            </span>
          </span>
        </TableCell>
      </TableRow>
      {isExpanded &&
        companies.map((c) => (
          <TableRow key={c.name}>
            <TableCell className="pl-8">{c.name}</TableCell>
            <TableCell className="text-right">
              <SensitiveValue>
                {fmt.currency.format(c.value_eur || 0)}
              </SensitiveValue>
            </TableCell>
            <TableCell
              className={cn("text-right text-xs", {
                "text-aqua-400": c.investment_type === "ETF",
                "text-coral-500": c.investment_type === "Crypto",
              })}
            >
              {c.investment_type}
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}
