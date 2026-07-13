"use client";

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ItemsTableRow } from "./items-table-row";
import type { UseSimulatorReturn } from "@/hooks/use-simulator";
import { useVirtualRows } from "@/hooks/use-virtual-rows";

type SimItem = UseSimulatorReturn["items"][number];

interface Props {
  sim: UseSimulatorReturn;
}

export function ItemsTable({ sim }: Props) {
  // Hook must run unconditionally, before the empty-state early return.
  const { containerRef, enabled, items, paddingTop, paddingBottom } =
    useVirtualRows(sim.items.length);

  const isPortfolioMode = sim.mode === "portfolio";
  const showPortfolioCol =
    !isPortfolioMode && sim.scope === "portfolio" && sim.portfolios.length > 0;

  const renderRow = (item: SimItem) => (
    <ItemsTableRow
      key={item.id}
      item={item}
      showPortfolioCol={showPortfolioCol}
      portfolios={sim.portfolios}
      updateItem={sim.updateItem}
      updateItemValue={sim.updateItemValue}
      deleteItem={sim.deleteItem}
    />
  );

  if (sim.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 border border-border/50 bg-card/50 py-12 text-muted-foreground">
        <p className="text-sm">Add positions to build a simulated portfolio.</p>
      </div>
    );
  }

  // Fixed column widths (px) used only when virtualization engages, so windowed
  // rows keep stable columns. Order matches the header below.
  const colWidths = showPortfolioCol
    ? [100, 220, 140, 120, 120, 100, 120, 80, 40]
    : [100, 220, 120, 120, 100, 120, 80, 40];

  // Horizontal scroll comes from the Table's own overflow-x-auto container.
  return (
    <div
      ref={containerRef}
      className="border border-border/50 bg-card/50 overflow-hidden"
    >
      <Table className={enabled ? "[table-layout:fixed]" : ""}>
        {enabled && (
          <colgroup>
            {colWidths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
        )}
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
          {enabled ? (
            <>
              {paddingTop > 0 && (
                <tr data-spacer aria-hidden style={{ height: paddingTop }} />
              )}
              {items.map((vi) => renderRow(sim.items[vi.index]))}
              {paddingBottom > 0 && (
                <tr data-spacer aria-hidden style={{ height: paddingBottom }} />
              )}
            </>
          ) : (
            sim.items.map((item) => renderRow(item))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
