"use client";

import { useRebalancer } from "@/hooks/use-rebalancer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Globe, PieChart, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RebalanceMode, RebalancedPortfolio } from "@/types/portfolio";
import { DetailedOverview } from "./detailed-overview";
import { SummaryFooter } from "./summary-footer";

const fmt = {
  currency: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  percent: new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }),
};

function formatAction(action: number) {
  if (Math.abs(action) < 0.01)
    return { text: "No action", className: "text-muted-foreground" };
  if (action > 0)
    return {
      text: `Buy ${fmt.currency.format(action)}`,
      className: "text-emerald-400",
    };
  return {
    text: `Sell ${fmt.currency.format(Math.abs(action))}`,
    className: "text-coral-500",
  };
}

export default function RebalancerPage() {
  const {
    portfolioData,
    rebalanced,
    mode,
    setMode,
    investmentAmount,
    setInvestmentAmount,
    selectedPortfolio,
    setSelectedPortfolio,
    isLoading,
    error,
  } = useRebalancer();

  if (isLoading) return <RebalancerSkeleton />;

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Rebalancer</h1>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const totalCurrentValue = rebalanced.reduce(
    (sum, p) => sum + (p.currentValue || 0),
    0
  );
  const newTotalValue =
    mode === "existing-only"
      ? totalCurrentValue
      : totalCurrentValue + investmentAmount;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Rebalancer</h1>

      <Tabs defaultValue="global">
        <TabsList>
          <TabsTrigger value="global" className="gap-1.5">
            <Globe className="size-3.5" />
            Global Overview
          </TabsTrigger>
          <TabsTrigger value="detailed" className="gap-1.5">
            <PieChart className="size-3.5" />
            Detailed Overview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="global" className="space-y-4">
          {/* Rebalance Controls */}
          <div className="flex flex-wrap items-end gap-6 rounded-md border border-border bg-card p-4">
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as RebalanceMode)}
              className="flex flex-wrap gap-4"
            >
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="existing-only" />
                Rebalance Existing Capital
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="new-only" />
                New Capital Only
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="new-with-sells" />
                New Capital (with sales)
              </label>
            </RadioGroup>

            {mode !== "existing-only" && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Investment:
                </span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    &euro;
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step={100}
                    value={investmentAmount || ""}
                    onChange={(e) =>
                      setInvestmentAmount(parseFloat(e.target.value) || 0)
                    }
                    className="w-40 pl-7 sensitive-value"
                    placeholder="0"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Portfolio Table */}
          {rebalanced.length === 0 ? (
            <Alert>
              <AlertDescription>
                No portfolios with target allocations found. Configure
                allocations in the Builder first.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <PortfolioTable
                portfolios={rebalanced}
                totalCurrentValue={totalCurrentValue}
                newTotalValue={newTotalValue}
              />
              <SummaryFooter
                rebalanced={rebalanced}
                mode={mode}
                investmentAmount={investmentAmount}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="detailed">
          <DetailedOverview
            portfolioData={portfolioData}
            rebalanced={rebalanced}
            selectedPortfolio={selectedPortfolio}
            onSelectPortfolio={setSelectedPortfolio}
            mode={mode}
            investmentAmount={investmentAmount}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PortfolioTable({
  portfolios,
  totalCurrentValue,
  newTotalValue,
}: {
  portfolios: RebalancedPortfolio[];
  totalCurrentValue: number;
  newTotalValue: number;
}) {
  let totalBuys = 0;
  let totalSells = 0;

  return (
    <TooltipProvider>
    <div className="rounded-md border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted hover:bg-muted">
            <TableHead className="text-xs font-semibold uppercase tracking-wider">
              Portfolio
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
          {portfolios.map((p) => {
            const currentPct =
              totalCurrentValue > 0
                ? p.currentValue / totalCurrentValue
                : 0;
            const valueAfter = (p.currentValue || 0) + p.action;
            const afterPct =
              newTotalValue > 0 ? valueAfter / newTotalValue : 0;
            const { text, className } = formatAction(p.action);

            if (p.action > 0.01) totalBuys += p.action;
            else if (p.action < -0.01) totalSells += Math.abs(p.action);

            const desired = p.desiredPositions ?? p.minPositions ?? 0;
            const currentPositions = p.sectors
              ?.filter((s) => s.name !== "Missing Positions")
              .reduce((sum, s) => sum + (s.positions?.length ?? s.positionCount ?? 0), 0) ?? 0;
            const deficit = desired > 0 ? desired - currentPositions : 0;

            return (
              <TableRow
                key={p.name}
                className={cn(deficit > 0 && "border-l-2 border-l-amber-500")}
              >
                <TableCell className="font-medium">
                  <span className="flex items-center gap-1.5">
                    {p.name}
                    {(p.currentValue || 0) === 0 && (
                      <span className="text-xs text-aqua-400">
                        Empty - Needs Positions
                      </span>
                    )}
                    {deficit > 0 && (p.currentValue || 0) > 0 && (
                      <Tooltip>
                        <TooltipTrigger>
                          <AlertTriangle className="size-3.5 text-amber-400 shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent>
                          Needs {deficit} more position{deficit > 1 ? "s" : ""}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <SensitiveValue>
                    {fmt.currency.format(p.currentValue || 0)}
                  </SensitiveValue>
                </TableCell>
                <TableCell className="text-right">
                  {fmt.percent.format(currentPct)}
                </TableCell>
                <TableCell className="text-right">
                  {fmt.percent.format((p.targetWeight || 0) / 100)}
                </TableCell>
                <TableCell className="text-right">
                  <SensitiveValue>
                    {fmt.currency.format(p.targetValue)}
                  </SensitiveValue>
                </TableCell>
                <TableCell className={`text-right ${className}`}>
                  <SensitiveValue>{text}</SensitiveValue>
                </TableCell>
                <TableCell className="text-right">
                  <SensitiveValue>
                    {fmt.currency.format(valueAfter)}
                  </SensitiveValue>
                </TableCell>
                <TableCell className="text-right">
                  {fmt.percent.format(afterPct)}
                </TableCell>
              </TableRow>
            );
          })}

          {/* Totals row */}
          <TableRow className="bg-muted/50 font-semibold">
            <TableCell>Total</TableCell>
            <TableCell className="text-right">
              <SensitiveValue>
                {fmt.currency.format(totalCurrentValue)}
              </SensitiveValue>
            </TableCell>
            <TableCell className="text-right">100%</TableCell>
            <TableCell className="text-right">100%</TableCell>
            <TableCell className="text-right">
              <SensitiveValue>
                {fmt.currency.format(
                  portfolios.reduce((s, p) => s + p.targetValue, 0)
                )}
              </SensitiveValue>
            </TableCell>
            <TableCell className="text-right text-xs">
              {totalBuys > 0 && (
                <span className="text-emerald-400">
                  Buy:{" "}
                  <SensitiveValue>
                    {fmt.currency.format(totalBuys)}
                  </SensitiveValue>
                </span>
              )}
              {totalBuys > 0 && totalSells > 0 && <br />}
              {totalSells > 0 && (
                <span className="text-coral-500">
                  Sell:{" "}
                  <SensitiveValue>
                    {fmt.currency.format(totalSells)}
                  </SensitiveValue>
                </span>
              )}
              {totalBuys === 0 && totalSells === 0 && (
                <span className="text-muted-foreground">No action</span>
              )}
            </TableCell>
            <TableCell className="text-right">
              <SensitiveValue>
                {fmt.currency.format(newTotalValue)}
              </SensitiveValue>
            </TableCell>
            <TableCell className="text-right">100%</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    </TooltipProvider>
  );
}

function RebalancerSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
