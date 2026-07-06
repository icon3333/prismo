import type { BuilderPortfolio } from "@/types/builder";

export interface BuilderPersistedState {
  budgetData?: string;
  rules?: string;
  portfolios?: string;
  expandedPortfolios?: string;
  sortOptions?: string;
}

export function tryParse<T>(json: string | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function stripRuntimeFields(
  portfolios: BuilderPortfolio[]
): Array<Omit<BuilderPortfolio, "minPositions" | "currentPositions" | "selectedPosition">> {
  return portfolios.map((portfolio) => {
    const persisted = { ...portfolio };
    delete persisted.minPositions;
    delete persisted.currentPositions;
    delete persisted.selectedPosition;
    return persisted;
  });
}
