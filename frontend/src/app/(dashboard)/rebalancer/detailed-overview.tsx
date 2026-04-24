"use client";

import { useState, useMemo } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import {
  ChevronDown,
  ChevronRight,
  Expand,
  Shrink,
  Lock,
  PlusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { calculateDetailedRebalancing } from "@/lib/rebalancer-calc";
import type {
  PortfolioData,
  RebalancedPortfolio,
  RebalanceMode,
  DetailedSector,
  PortfolioPosition,
} from "@/types/portfolio";
import { rebalancerFmt as fmt, formatAction } from "@/lib/format";

interface DetailedOverviewProps {
  portfolioData: PortfolioData | null;
  rebalanced: RebalancedPortfolio[];
  selectedPortfolio: string;
  onSelectPortfolio: (name: string) => void;
  mode: RebalanceMode;
  investmentAmount: number;
}

export function DetailedOverview({
  portfolioData,
  rebalanced,
  selectedPortfolio,
  onSelectPortfolio,
  mode,
  investmentAmount,
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

  // Find the matching rebalanced portfolio to get the action amount
  const rebalancedPortfolio = rebalanced.find(
    (p) => p.name === selectedPortfolio
  );
  const portfolioActionAmount = rebalancedPortfolio?.action ?? 0;

  // Calculate detailed rebalancing
  const detailed = useMemo(() => {
    if (!selected) return null;
    return calculateDetailedRebalancing(selected, portfolioActionAmount, mode);
  }, [selected, portfolioActionAmount, mode]);

  const sectors = detailed?.sectors ?? [];

  const toggleSector = (name: string) =>
    setExpanded((prev) => ({ ...prev, [name]: !(prev[name] ?? true) }));

  const expandAll = () =>
    setExpanded(Object.fromEntries(sectors.map((s) => [s.name, true])));

  const collapseAll = () =>
    setExpanded(Object.fromEntries(sectors.map((s) => [s.name, false])));

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Select
            value={selectedPortfolio}
            onValueChange={(v) => {
              if (v) onSelectPortfolio(v);
            }}
          >
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

        {selected && sectors.length > 0 && detailed ? (
          <div className="border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider">
                    Position
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                    Type
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                    Current
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                    Current %
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                    Target %
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                    Target
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                    Action
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                    After
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">
                    After %
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sectors.map((sector) => {
                  const isExpanded = expanded[sector.name] ?? true;
                  return (
                    <SectorGroup
                      key={sector.name}
                      sector={sector}
                      isExpanded={isExpanded}
                      onToggle={() => toggleSector(sector.name)}
                      portfolioTargetValue={detailed.portfolioTargetValue}
                      totalValueAfter={detailed.totalValueAfter}
                    />
                  );
                })}

                {/* Portfolio Total Row */}
                <TableRow className="bg-muted/50 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right">
                    <SensitiveValue>
                      {fmt.currency.format(detailed.totalCurrentValue)}
                    </SensitiveValue>
                  </TableCell>
                  <TableCell className="text-right">100.0%</TableCell>
                  <TableCell className="text-right">100.0%</TableCell>
                  <TableCell className="text-right">
                    <SensitiveValue>
                      {fmt.currency.format(detailed.portfolioTargetValue)}
                    </SensitiveValue>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {detailed.totalBuys > 0 && (
                      <span className="text-emerald-400">
                        Buy:{" "}
                        <SensitiveValue>
                          {fmt.currency.format(detailed.totalBuys)}
                        </SensitiveValue>
                      </span>
                    )}
                    {detailed.totalBuys > 0 && detailed.totalSells > 0 && (
                      <br />
                    )}
                    {detailed.totalSells > 0 && (
                      <span className="text-coral-500">
                        Sell:{" "}
                        <SensitiveValue>
                          {fmt.currency.format(detailed.totalSells)}
                        </SensitiveValue>
                      </span>
                    )}
                    {detailed.totalBuys === 0 && detailed.totalSells === 0 && (
                      <span className="text-muted-foreground">No action</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <SensitiveValue>
                      {fmt.currency.format(detailed.totalValueAfter)}
                    </SensitiveValue>
                  </TableCell>
                  <TableCell className="text-right">100.0%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        ) : selected ? (
          <p className="text-sm text-muted-foreground">
            No positions in this portfolio.
          </p>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function SectorGroup({
  sector,
  isExpanded,
  onToggle,
  portfolioTargetValue,
  totalValueAfter,
}: {
  sector: DetailedSector;
  isExpanded: boolean;
  onToggle: () => void;
  portfolioTargetValue: number;
  totalValueAfter: number;
}) {
  const isMissing = sector.name === "Missing Positions";
  const sectorCurrentPct =
    portfolioTargetValue > 0
      ? sector.currentValue / portfolioTargetValue
      : 0;
  const sectorTargetPct =
    portfolioTargetValue > 0
      ? sector.calculatedTargetValue / portfolioTargetValue
      : 0;
  const sectorAfterPct =
    totalValueAfter > 0 ? sector.valueAfterSum / totalValueAfter : 0;
  const { text: actionText, className: actionClass } = formatAction(
    sector.actionSum
  );

  return (
    <>
      {/* Sector header row */}
      <TableRow
        className={cn(
          "bg-muted/50 cursor-pointer hover:bg-muted",
          isMissing && "border-l-2 border-l-amber-500"
        )}
        onClick={onToggle}
      >
        <TableCell className="font-medium">
          <span className="flex items-center gap-1">
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            {sector.name}
            <span className="text-xs text-muted-foreground ml-1">
              ({sector.positions.length})
            </span>
          </span>
        </TableCell>
        <TableCell />
        <TableCell className="text-right text-sm">
          <SensitiveValue>
            {fmt.currency.format(sector.currentValue)}
          </SensitiveValue>
        </TableCell>
        <TableCell className="text-right text-sm">
          {fmt.percent.format(sectorCurrentPct)}
        </TableCell>
        <TableCell className="text-right text-sm">
          {fmt.percent.format(sectorTargetPct)}
        </TableCell>
        <TableCell className="text-right text-sm">
          <SensitiveValue>
            {fmt.currency.format(sector.calculatedTargetValue)}
          </SensitiveValue>
        </TableCell>
        <TableCell className={cn("text-right text-sm", actionClass)}>
          <SensitiveValue>{actionText}</SensitiveValue>
        </TableCell>
        <TableCell className="text-right text-sm">
          <SensitiveValue>
            {fmt.currency.format(sector.valueAfterSum)}
          </SensitiveValue>
        </TableCell>
        <TableCell className="text-right text-sm">
          {fmt.percent.format(sectorAfterPct)}
        </TableCell>
      </TableRow>

      {/* Position rows */}
      {isExpanded &&
        sector.positions.map((pos, idx) => (
          <PositionRow
            key={pos.name + idx}
            position={pos}
            portfolioTargetValue={portfolioTargetValue}
            totalValueAfter={totalValueAfter}
          />
        ))}
    </>
  );
}

function PositionRow({
  position,
  portfolioTargetValue,
  totalValueAfter,
}: {
  position: PortfolioPosition;
  portfolioTargetValue: number;
  totalValueAfter: number;
}) {
  const isPlaceholder = position.isPlaceholder;
  const posCurrentValue = position.currentValue || 0;
  const posTargetValue = position.calculatedTargetValue || 0;
  const posAction = position.action ?? 0;
  const posValueAfter = position.valueAfter ?? posCurrentValue;

  const currentPct =
    portfolioTargetValue > 0 ? posCurrentValue / portfolioTargetValue : 0;
  const targetPct =
    portfolioTargetValue > 0 ? posTargetValue / portfolioTargetValue : 0;
  const afterPct = totalValueAfter > 0 ? posValueAfter / totalValueAfter : 0;

  const { text: actionText, className: actionClass } = formatAction(posAction);

  const typeColors: Record<string, string> = {
    ETF: "text-aqua-400",
    Crypto: "text-coral-500",
    Stock: "",
  };

  return (
    <TableRow
      className={cn(isPlaceholder && "italic text-muted-foreground")}
    >
      <TableCell className="pl-8">
        <span className="flex items-center gap-1.5">
          {isPlaceholder && <PlusCircle className="size-3.5 shrink-0" />}
          <span>{position.name}</span>
          {position.is_capped && (
            <Tooltip>
              <TooltipTrigger>
                <Lock className="size-3 text-amber-400 shrink-0" />
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  Capped by {position.applicable_rule ?? "type"} rule.
                  {position.unconstrained_target_value != null && (
                    <>
                      {" "}
                      Unconstrained:{" "}
                      {fmt.percent.format(
                        portfolioTargetValue > 0
                          ? position.unconstrained_target_value /
                              portfolioTargetValue
                          : 0
                      )}
                    </>
                  )}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      </TableCell>
      <TableCell
        className={cn(
          "text-right text-xs",
          typeColors[position.investment_type] ?? ""
        )}
      >
        {position.investment_type}
      </TableCell>
      <TableCell className="text-right">
        <SensitiveValue>
          {fmt.currency.format(posCurrentValue)}
        </SensitiveValue>
      </TableCell>
      <TableCell className="text-right">
        {fmt.percent.format(currentPct)}
      </TableCell>
      <TableCell className="text-right">
        {fmt.percent.format(targetPct)}
      </TableCell>
      <TableCell className="text-right">
        <SensitiveValue>
          {fmt.currency.format(posTargetValue)}
        </SensitiveValue>
      </TableCell>
      <TableCell className={cn("text-right", actionClass)}>
        <SensitiveValue>{actionText}</SensitiveValue>
      </TableCell>
      <TableCell className="text-right">
        <SensitiveValue>
          {fmt.currency.format(posValueAfter)}
        </SensitiveValue>
      </TableCell>
      <TableCell className="text-right">
        {fmt.percent.format(afterPct)}
      </TableCell>
    </TableRow>
  );
}
