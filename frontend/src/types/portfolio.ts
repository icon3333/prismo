export interface PortfolioCompany {
  name: string;
  identifier: string | null;
  investment_type: "Stock" | "ETF" | "Crypto";
  value_eur: number;
  target_weight: number;
  shares: number;
  sector: string | null;
  thesis: string | null;
  country: string | null;
}

export interface PortfolioPosition {
  name: string;
  identifier?: string | null;
  investment_type: "Stock" | "ETF" | "Crypto";
  currentValue: number;
  targetAllocation: number;
  targetValue?: number | null;
  calculatedTargetValue?: number;
  is_capped?: boolean;
  unconstrained_target_value?: number;
  applicable_rule?: string;
  isPlaceholder?: boolean;
  positionSlot?: number;
  positionsRemaining?: number;
  gap?: number;
  action?: number;
  valueAfter?: number;
  excludedReason?: string;
}

export interface PortfolioSector {
  name: string;
  companies: PortfolioCompany[];
  positionCount: number;
  positions?: PortfolioPosition[];
  currentValue?: number;
  targetAllocation?: number;
  targetValue?: number;
  targetWeight?: number;
  calculatedTargetValue?: number;
  isPlaceholder?: boolean;
}

export interface BuilderPosition {
  companyName?: string;
  weight?: number;
  isPlaceholder?: boolean;
}

export interface Portfolio {
  name: string;
  currentValue: number;
  targetWeight: number;
  sectors: PortfolioSector[];
  minPositions?: number;
  desiredPositions?: number;
  effectivePositions?: number;
  builderPositions?: BuilderPosition[];
}

export interface PortfolioData {
  portfolios: Portfolio[];
  total_value: number;
}

export type RebalanceMode = "existing-only" | "new-only" | "new-with-sells";

export interface RebalancedPortfolio extends Portfolio {
  targetValue: number;
  discrepancy: number;
  action: number;
}

export interface DetailedSector {
  name: string;
  positions: PortfolioPosition[];
  currentValue: number;
  targetAllocation: number;
  calculatedTargetValue: number;
  actionSum: number;
  valueAfterSum: number;
  isPlaceholder?: boolean;
}

export interface DetailedRebalancing {
  sectors: DetailedSector[];
  shouldShowMissingPositions: boolean;
  portfolioTargetValue: number;
  totalCurrentValue: number;
  totalAction: number;
  totalValueAfter: number;
  totalBuys: number;
  totalSells: number;
}
