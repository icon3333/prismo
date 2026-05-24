import type {
  AllocationRules,
  BudgetData,
  BuilderPortfolio,
  SortOptions,
} from "@/types/builder";

export interface BuilderPersistedState {
  budgetData?: string;
  rules?: string;
  portfolios?: string;
  expandedPortfolios?: string;
  sortOptions?: string;
}

export interface BuilderPendingState {
  budget: BudgetData;
  rules: AllocationRules;
  portfolios: BuilderPortfolio[];
  expandedPortfolios: Record<string, boolean>;
  sortOptions: SortOptions;
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

export function serializeBuilderState(payload: BuilderPendingState) {
  return {
    page: "builder",
    budgetData: JSON.stringify(payload.budget),
    rules: JSON.stringify(payload.rules),
    portfolios: JSON.stringify(stripRuntimeFields(payload.portfolios)),
    expandedPortfolios: JSON.stringify(payload.expandedPortfolios),
    sortOptions: JSON.stringify(payload.sortOptions),
  };
}
