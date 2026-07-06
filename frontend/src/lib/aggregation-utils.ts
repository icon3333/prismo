export interface AggregateItem {
  name: string;
  value: number;
  percentage: number;
}

/**
 * Group items by a key, sum a numeric field, return entries sorted by value
 * descending with percentages computed from `total`. Caller decides `total`
 * (so it can include cash, scope by portfolio, etc.).
 *
 * If `total <= 0` all percentages are zero.
 */
export function groupAndAggregate<T>(
  items: T[],
  keyFn: (item: T) => string,
  valueFn: (item: T) => number,
  total: number,
): AggregateItem[] {
  const groups: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    groups[key] = (groups[key] || 0) + valueFn(item);
  }
  return Object.entries(groups)
    .map(([name, value]) => ({
      name,
      value,
      percentage: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Append a "Cash" slice when `cash > 0` and re-sort descending by value.
 * Mutates and returns `items` for convenient chaining.
 */
export function appendCashItem(
  items: AggregateItem[],
  cash: number,
  total: number,
): AggregateItem[] {
  if (cash > 0) {
    items.push({ name: "Cash", value: cash, percentage: (cash / total) * 100 });
    items.sort((a, b) => b.value - a.value);
  }
  return items;
}

/**
 * Ranking rule shared by the distribution donuts and the exposure heatmap
 * axes: keep the top 8 plus anything >= 1%, preserving the incoming
 * (descending) order, with "Unknown" moved to the end.
 */
export function rankTopItems(items: AggregateItem[]): AggregateItem[] {
  const top8 = new Set(items.slice(0, 8).map((i) => i.name));
  const kept = items.filter((i) => top8.has(i.name) || i.percentage >= 1);
  const unknownIdx = kept.findIndex((i) => i.name === "Unknown");
  if (unknownIdx !== -1) {
    const [unknown] = kept.splice(unknownIdx, 1);
    kept.push(unknown);
  }
  return kept;
}
