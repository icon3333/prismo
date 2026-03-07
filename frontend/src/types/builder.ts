export interface BudgetData {
  totalNetWorth: number;
  alreadyInvested: number;
  emergencyFund: number;
  totalInvestableCapital: number;
  availableToInvest: number;
}

export interface AllocationRules {
  maxPerStock: number;
  maxPerETF: number;
  maxPerCrypto: number;
  maxPerCategory: number;
  maxPerCountry: number;
}

export interface BuilderRealPosition {
  companyId: number;
  companyName: string;
  weight: number;
  isPlaceholder: false;
}

export interface BuilderPlaceholderPosition {
  companyId: null;
  companyName: string;
  weight: number;
  isPlaceholder: true;
  positionsRemaining: number;
  totalRemainingWeight: number;
}

export type BuilderPosition = BuilderRealPosition | BuilderPlaceholderPosition;

export interface BuilderPortfolio {
  id: string;
  name: string;
  allocation: number;
  positions: BuilderRealPosition[];
  evenSplit: boolean;
  desiredPositions: number | null;
  minPositions?: number;
  currentPositions?: number;
  selectedPosition?: string;
}

export interface PortfolioCompany {
  id: number;
  name: string;
}

export interface PortfolioMetrics {
  total_value: number;
  total_items: number;
  health: number;
  missing_prices: number;
  last_update: string | null;
}

export interface SortOptions {
  column: "name" | "weight" | "amount";
  direction: "asc" | "desc";
}

export interface PortfolioOption {
  id: string;
  name: string;
}
