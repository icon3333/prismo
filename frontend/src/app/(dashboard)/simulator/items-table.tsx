"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Briefcase } from "lucide-react";
import { ItemsTableRow } from "./items-table-row";
import type { UseSimulatorReturn } from "@/hooks/use-simulator";

interface Props {
  sim: UseSimulatorReturn;
}

export function ItemsTable({ sim }: Props) {
  if (sim.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 border border-border/50 bg-card/50 py-12 text-muted-foreground">
        <Briefcase className="h-8 w-8 opacity-50" />
        <p className="text-sm">Add positions to build a simulated portfolio.</p>
      </div>
    );
  }

  const isPortfolioMode = sim.mode === "portfolio";
  const showPortfolioCol =
    !isPortfolioMode && sim.scope === "portfolio" && sim.portfolios.length > 0;

  return (
    <div className="border border-border/50 bg-card/50 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">Ticker</TableHead>
            <TableHead>Name</TableHead>
            {showPortfolioCol && (
              <TableHead className="w-[140px]">Portfolio</TableHead>
            )}
            <TableHead className="w-[120px]">Sector</TableHead>
            <TableHead className="w-[120px]">Thesis</TableHead>
            <TableHead className="w-[100px]">Country</TableHead>
            <TableHead className="w-[120px] text-right">EUR</TableHead>
            <TableHead className="w-[80px] text-right">%</TableHead>
            <TableHead className="w-[40px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sim.items.map((item) => (
            <ItemsTableRow
              key={item.id}
              item={item}
              sim={sim}
              showPortfolioCol={showPortfolioCol}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
