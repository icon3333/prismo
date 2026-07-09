import type { EnrichItem, EnrichMetrics, ColumnHealth, SortState } from "@/types/enrich";
import {
  calculatePositionValue,
  getPositionValueSource,
} from "@/lib/position-value";
import { date as formatDate } from "@/lib/format";

// --- Value calculations ---

export function calculateItemValue(item: EnrichItem): number {
  return calculatePositionValue(item);
}

export function calculatePortfolioTotal(items: EnrichItem[]): number {
  return items.reduce((sum, item) => sum + calculateItemValue(item), 0);
}

export function getValueSource(item: EnrichItem): "custom" | "market" | "none" {
  return getPositionValueSource(item);
}

// --- Health calculations ---

function healthPct(items: EnrichItem[], predicate: (item: EnrichItem) => boolean): number {
  if (items.length === 0) return 0;
  return Math.round((items.filter(predicate).length / items.length) * 100);
}

export function computeColumnHealth(items: EnrichItem[]): ColumnHealth {
  return {
    portfolio: healthPct(items, (i) => !!i.portfolio && i.portfolio.trim() !== "" && i.portfolio !== "-"),
    sector: healthPct(items, (i) => !!i.sector && i.sector.trim() !== ""),
    thesis: healthPct(items, (i) => !!i.thesis && i.thesis.trim() !== ""),
    investmentType: healthPct(items, (i) => i.investment_type === "Stock" || i.investment_type === "ETF" || i.investment_type === "Crypto"),
    price: healthPct(items, (i) => {
      if (i.is_custom_value && i.custom_price_eur && i.custom_price_eur > 0) return true;
      return i.price_eur != null && i.price_eur > 0;
    }),
    country: healthPct(items, (i) => !!i.effective_country && i.effective_country.trim() !== "" && i.effective_country !== "N/A"),
    value: healthPct(items, (i) => {
      if (i.is_custom_value && i.custom_total_value != null && i.custom_total_value > 0) return true;
      return i.price_eur != null && i.price_eur > 0;
    }),
  };
}

// --- Metrics ---

export function computeMetrics(items: EnrichItem[]): EnrichMetrics {
  let lastUpdate: string | null = null;
  for (const item of items) {
    if (item.last_updated && (!lastUpdate || item.last_updated > lastUpdate)) {
      lastUpdate = item.last_updated;
    }
  }
  return {
    total: items.length,
    totalValue: calculatePortfolioTotal(items),
    lastUpdate,
  };
}

// --- Sorting ---

export function sortItems(items: EnrichItem[], sort: SortState): EnrichItem[] {
  if (!sort.column) return items;

  const dir = sort.direction === "asc" ? 1 : -1;
  const col = sort.column;

  return [...items].sort((a, b) => {
    if (col === "total_value") {
      return dir * (calculateItemValue(a) - calculateItemValue(b));
    }

    if (col === "shares" || col === "price_eur" || col === "total_invested") {
      const aVal = parseFloat(String(a[col])) || 0;
      const bVal = parseFloat(String(b[col])) || 0;
      return dir * (aVal - bVal);
    }

    if (col === "last_updated") {
      const aDate = parseServerTimestampMs(a.last_updated) ?? 0;
      const bDate = parseServerTimestampMs(b.last_updated) ?? 0;
      return dir * (aDate - bDate);
    }

    if (col === "country") {
      const normalize = (c: string | null | undefined) => {
        if (!c || c === "N/A" || c === "") return "ZZZ_Unknown";
        if (c === "(crypto)") return "AAA_Crypto";
        return c.trim();
      };
      return dir * normalize(a.effective_country).localeCompare(normalize(b.effective_country));
    }

    // Text fields
    const aVal = String((a as unknown as Record<string, unknown>)[col] ?? "");
    const bVal = String((b as unknown as Record<string, unknown>)[col] ?? "");
    return dir * aVal.localeCompare(bVal);
  });
}

// --- Filtering ---

export function filterItems(items: EnrichItem[], portfolio: string | null, search: string): EnrichItem[] {
  let filtered = items;
  if (portfolio) {
    filtered = filtered.filter((i) => i.portfolio === portfolio);
  }
  if (search.trim()) {
    const q = search.toLowerCase().trim();
    filtered = filtered.filter(
      (i) => i.company?.toLowerCase().includes(q) || i.identifier?.toLowerCase().includes(q)
    );
  }
  return filtered;
}

// --- Formatting ---

// Server timestamps are UTC. Current backend rows carry an explicit +00:00
// offset, but legacy rows are timezone-less ("2026-07-03T11:30:00" or
// "2026-07-03 11:30:00") — new Date() would parse those as browser-local,
// shifting ages by the UTC offset. Treat missing offsets as UTC.
export function parseServerTimestampMs(value: string | null): number | null {
  if (!value) return null;
  let iso = value.replace(" ", "T");
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += "Z";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function formatDateAgo(value: string | null): string {
  if (!value) return "Never";
  const ms = parseServerTimestampMs(value);
  if (ms == null) return "Never";
  const d = new Date(ms);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(d);
}

export function getHealthColorClass(pct: number): string {
  if (pct >= 100) return "text-green";
  if (pct >= 70) return "text-amber-400";
  return "text-red";
}

export function parseGermanNumber(value: string): number {
  if (!value || typeof value !== "string") return NaN;
  // Remove currency symbols, spaces
  const cleaned = value.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned);
}

export function escapeCSVField(field: unknown): string {
  if (field === null || field === undefined) return "";
  const str = String(field);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
