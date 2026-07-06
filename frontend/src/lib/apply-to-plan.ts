import type { SimulatorItem } from "@/types/simulator";
import type { BuilderPortfolio, BuilderRealPosition } from "@/types/builder";

/**
 * Pure logic for the simulator's "Apply to Plan" action: turn a sandbox
 * simulation's EUR values into builder position weights and splice them
 * into the persisted builder `portfolios` state.
 */

/**
 * Resolve the single target portfolio a sandbox simulation applies to.
 * `cloned_from_portfolio_id` wins; otherwise all items must share the same
 * non-null `portfolio_id`. Mixed or missing → null (not applicable).
 */
export function resolveTargetPortfolioId(
  clonedFromPortfolioId: number | null | undefined,
  items: Pick<SimulatorItem, "portfolio_id">[]
): number | null {
  if (clonedFromPortfolioId != null) return clonedFromPortfolioId;
  if (items.length === 0) return null;
  const first = items[0].portfolio_id;
  if (first == null) return null;
  return items.every((i) => i.portfolio_id === first) ? first : null;
}

export interface AppliedPosition {
  /**
   * Real company id when the item is already held; otherwise a synthetic
   * unique negative id. The Plan UI keys, edits and removes positions by
   * companyId, so null would collide across all not-yet-held items.
   */
  companyId: number;
  companyName: string;
  weight: number;
}

export interface ApplyMapping {
  applied: AppliedPosition[];
  /** Names of items with value <= 0, which are not applied. */
  skipped: string[];
}

/**
 * Map simulation items to builder positions. Weight = item value as a share
 * of the sum of positive values, in percent, rounded to 2 decimals. Items
 * with non-positive value are skipped.
 */
export function computeAppliedPositions(
  items: Pick<SimulatorItem, "name" | "value" | "portfolioData">[]
): ApplyMapping {
  const positive = items.filter((i) => (i.value || 0) > 0);
  const skipped = items
    .filter((i) => (i.value || 0) <= 0)
    .map((i) => i.name);
  const total = positive.reduce((sum, i) => sum + i.value, 0);
  const applied = positive.map((i, idx) => ({
    // Synthetic negative ids keep not-yet-held items individually
    // addressable in the Plan UI (real DB ids are positive).
    companyId: i.portfolioData?.id ?? -(idx + 1),
    companyName: i.name,
    weight: total > 0 ? Math.round((i.value / total) * 10000) / 100 : 0,
  }));
  return { applied, skipped };
}

/**
 * Replace the positions of the builder portfolio matching `targetPortfolioId`
 * (loose id comparison — builder ids are strings, portfolio ids numbers) in
 * the persisted `portfolios` JSON. Returns the re-serialized JSON, or null if
 * the JSON is missing/invalid or no portfolio matches.
 */
export function applyPositionsToBuilderPortfolios(
  portfoliosJson: string | undefined | null,
  targetPortfolioId: number,
  applied: AppliedPosition[]
): string | null {
  if (!portfoliosJson) return null;
  let portfolios: BuilderPortfolio[];
  try {
    portfolios = JSON.parse(portfoliosJson);
  } catch {
    return null;
  }
  if (!Array.isArray(portfolios)) return null;

  const idx = portfolios.findIndex(
    (p) => String(p.id) === String(targetPortfolioId)
  );
  if (idx === -1) return null;

  const positions: BuilderRealPosition[] = applied.map((a) => ({
    companyId: a.companyId,
    companyName: a.companyName,
    weight: a.weight,
    isPlaceholder: false as const,
  }));

  portfolios[idx] = {
    ...portfolios[idx],
    positions,
    evenSplit: false,
    desiredPositions: applied.length,
  };
  return JSON.stringify(portfolios);
}
