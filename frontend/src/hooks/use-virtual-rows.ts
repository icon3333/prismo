"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

/**
 * Below this row count, plain rendering is cheaper than the virtualizer's
 * bookkeeping — render every row and skip windowing entirely.
 */
export const VIRTUALIZE_THRESHOLD = 60;

const FALLBACK_ROW_PX = 45;
const OVERSCAN = 12;

/**
 * Window-scroll virtualization for a semantic <table>, using the spacer-row
 * technique (top/bottom padding <tr>s) rather than absolute positioning — so
 * the visible <tr>s stay in normal table flow and, combined with
 * `table-layout: fixed` + a <colgroup> on the caller's table, column widths
 * never shift as rows scroll in and out.
 *
 * Rows are assumed uniform height (single-line cells); the hook measures one
 * real rendered row and feeds that back as the exact estimate, so spacer
 * heights are correct without any hard-coded pixel constant. Off-screen rows
 * are never mounted, which is the win for tables of heavy interactive cells.
 *
 * Usage:
 *   const v = useVirtualRows(rows.length);
 *   <div ref={v.containerRef}>
 *     <Table className="[table-layout:fixed]">
 *       <colgroup>…widths…</colgroup>
 *       <TableHeader/>
 *       <TableBody>
 *         {v.enabled
 *           ? <>
 *               {v.paddingTop > 0 && <tr data-spacer style={{ height: v.paddingTop }} aria-hidden />}
 *               {v.items.map((vi) => renderRow(rows[vi.index], vi.index))}
 *               {v.paddingBottom > 0 && <tr data-spacer style={{ height: v.paddingBottom }} aria-hidden />}
 *             </>
 *           : rows.map((row, i) => renderRow(row, i))}
 *       </TableBody>
 *     </Table>
 *   </div>
 */
export function useVirtualRows(count: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [rowPx, setRowPx] = useState(FALLBACK_ROW_PX);

  const enabled = count >= VIRTUALIZE_THRESHOLD;

  // Distance from document top to the table container — the scroll offset the
  // window virtualizer measures rows against. Re-measured on resize since
  // layout above the table can reflow. The same measurement pass also
  // self-calibrates the uniform row height from a real rendered (non-spacer)
  // row, so spacer padding is exact regardless of font/theme/density — no
  // hard-coded pixel constant.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
      const row = el.querySelector<HTMLElement>("tbody tr:not([data-spacer])");
      const h = row?.offsetHeight;
      if (h) setRowPx((prev) => (Math.abs(prev - h) > 1 ? h : prev));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled, count]);

  const virtualizer = useWindowVirtualizer({
    count: enabled ? count : 0,
    estimateSize: () => rowPx,
    overscan: OVERSCAN,
    scrollMargin,
  });

  const items = enabled ? virtualizer.getVirtualItems() : [];
  const first = items[0];
  const last = items[items.length - 1];
  const paddingTop = first ? first.start - scrollMargin : 0;
  const paddingBottom = last
    ? virtualizer.getTotalSize() - (last.end - scrollMargin)
    : 0;

  return {
    containerRef,
    enabled,
    items,
    paddingTop,
    paddingBottom,
  };
}
