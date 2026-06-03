/**
 * Compute the cash slice and the total denominator (holdings + cash) used
 * across allocation/concentration percentage calculations.
 */
export function cashSlice(
  holdingsValue: number,
  includeCash: boolean,
  cashBalance: number,
): { cash: number; total: number } {
  const cash = includeCash && cashBalance > 0 ? cashBalance : 0;
  return { cash, total: holdingsValue + cash };
}
