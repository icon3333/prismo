export interface PortfolioOption {
  id: string;
  name: string;
}

export interface PerformanceCompany {
  name: string;
  identifier: string | null;
  current_value: number;
  sector: string | null;
  thesis: string | null;
  country: string | null;
  effective_country: string | null;
  pnl_absolute: number | null;
  pnl_percentage: number | null;
  total_invested: number | null;
  first_bought_date: string | null;
  investment_type: "Stock" | "ETF" | "Crypto";
  portfolio_name?: string;
}

export interface PerformanceCategory {
  name: string;
  total_value: number;
  pnl_absolute: number | null;
  pnl_percentage: number | null;
  total_invested: number | null;
  companies: PerformanceCompany[];
}

export interface PerformancePortfolioData {
  portfolio_id: string;
  portfolio_name: string;
  total_value: number;
  num_holdings: number;
  last_updated: string | null;
  portfolio_pnl_absolute: number | null;
  portfolio_pnl_percentage: number | null;
  total_invested: number | null;
  companies: PerformanceCompany[];
  sectors: PerformanceCategory[];
  theses: PerformanceCategory[];
  portfolios?: PerformanceCategory[];
}

export interface AllocationRow {
  name: string;
  identifier?: string | null;
  percentage: number;
  categoryPercentage?: number;
  value: number;
  pnlAbsolute: number | null;
  pnlPercentage: number | null;
  totalInvested: number | null;
  sector?: string;
  children?: AllocationRow[];
  isCash?: boolean;
}

export interface HistoricalPoint {
  date: string;
  close: number;
}

export interface HistoricalPricesResponse {
  series: Record<string, HistoricalPoint[]>;
}

export interface ExposureData {
  countries: string[];
  dims: string[];
  z: number[][];
  companyDetails: Record<string, Record<string, CompanyDetail[]>>;
  metadata: {
    totalValue: number;
    countryPercentages: Record<string, number>;
    dimensionPercentages: Record<string, number>;
  };
}

export interface CompanyDetail {
  name: string;
  value: number;
  percentage: number;
}

export interface ChartSelection {
  identifiers: string[];
  names: string[];
  groupName: string;
  values: number[];
}

export type AllocationMode = "portfolios" | "thesis" | "sector" | "stocks";
export type ChartPeriod = "3y" | "5y" | "10y" | "max" | "since_purchase";
export type ChartMode = "aggregate" | "detail";
export type HeatmapMode = "sector" | "thesis";
