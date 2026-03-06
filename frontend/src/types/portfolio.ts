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

export interface PortfolioSector {
  name: string;
  companies: PortfolioCompany[];
  positionCount: number;
}

export interface Portfolio {
  name: string;
  currentValue: number;
  targetWeight: number;
  sectors: PortfolioSector[];
  minPositions?: number;
  desiredPositions?: number;
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
