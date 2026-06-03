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
