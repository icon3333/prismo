export interface PortfolioMetrics {
  total_value: number;
  total_items: number;
  health: number;
  missing_prices: number;
  last_update?: string | null;
}

export interface AllocationRules {
  maxPerStock: number | null;
  maxPerETF: number | null;
  maxPerCrypto: number | null;
  maxPerCategory: number | null;
  maxPerCountry: number | null;
}

export interface Violation {
  type: "position" | "sector" | "country";
  name: string;
  currentPercentage: number;
  maxPercentage: number;
}

export interface MissingPortfolio {
  name: string;
  missing_count: number;
  surplus_count: number;
  current_positions: number;
  effective_positions: number;
}

export interface HealthStatus {
  icon: string;
  title: string;
  subtitle: string;
}

export interface PortfolioDataItem {
  company?: string;
  name?: string;
  sector?: string;
  country?: string;
  effective_country?: string;
  investment_type?: string;
  price_eur?: number;
  effective_shares?: number;
  is_custom_value?: boolean;
  custom_total_value?: number;
  current_value?: number;
  value_source?: "custom" | "market" | "none";
}

export interface RebalancerPosition {
  name: string;
  targetAllocation: number;
}

export interface RebalancerSector {
  name: string;
  positions: RebalancerPosition[];
}

export interface RebalancerPortfolio {
  name: string;
  sectors: RebalancerSector[];
  /**
   * Per-portfolio target position counts. Present in the raw
   * `/simulator/portfolio-data` payload (built server-side in
   * allocation_service); consumed here to detect over-target portfolios.
   */
  effectivePositions?: number;
  desiredPositions?: number;
  minPositions?: number;
}

export interface RebalancerData {
  portfolios: RebalancerPortfolio[];
}
