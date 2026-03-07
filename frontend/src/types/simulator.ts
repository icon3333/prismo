export type SimulatorMode = "overlay" | "portfolio";
export type SimulatorScope = "global" | "portfolio";
export type ItemSource = "ticker" | "sector" | "thesis" | "country";
export type CategoryMode = "sector" | "thesis";
export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";
export type CloneValueMode = "with-values" | "zeroed";

export interface SimulatorItem {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  thesis: string;
  country: string;
  value: number;
  targetPercent: number;
  source: ItemSource;
  portfolio_id: number | null;
  existsInPortfolio?: boolean;
  portfolioData?: { value: number } | null;
  targetWarning?: string | null;
}

export interface SimulationSummary {
  id: number;
  name: string;
  type: "overlay" | "portfolio";
  scope: string;
  portfolio_id: number | null;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface SimulationFull extends SimulationSummary {
  items: SimulatorItem[];
  global_value_mode: string;
  total_amount: number;
  cloned_from_name: string | null;
  deploy_lump_sum: number;
  deploy_monthly: number;
  deploy_months: number;
  deploy_manual_mode: boolean;
  deploy_manual_items: DeployManualItem[];
}

export interface DeployManualItem {
  name: string;
  ticker: string;
  percent: number;
}

export interface PortfolioOption {
  id: number;
  name: string;
  total_value?: number;
}

export interface BaselineDimension {
  name: string;
  value: number;
}

export interface BaselinePosition {
  ticker?: string;
  identifier?: string;
  name: string;
  value: number;
  country?: string;
  sector?: string;
  thesis?: string;
  portfolio_id?: number;
}

export interface PortfolioData {
  countries: BaselineDimension[];
  sectors: BaselineDimension[];
  theses: BaselineDimension[];
  positions: BaselinePosition[];
  total_value: number;
  portfolio_total: number;
  investmentTargets?: InvestmentTargets | null;
}

export interface InvestmentTargets {
  targetAmount: number;
  portfolioName?: string;
  allocationPercent?: number;
}

export interface CombinedAllocations {
  byCountry: Record<string, number>;
  bySector: Record<string, number>;
  byThesis: Record<string, number>;
  baselineByCountry: Record<string, number>;
  baselineBySector: Record<string, number>;
  baselineByThesis: Record<string, number>;
  combinedTotal: number;
  baselineTotal: number;
  simulatedTotal: number;
}

export interface AllocationSummary {
  totalPercent: number;
  status: "under" | "full" | "over";
  totalEur: number;
}

export interface PositionDetail {
  ticker: string;
  name: string;
  value: number;
  source: "portfolio" | "simulated";
}

export interface PersistedState {
  mode: SimulatorMode;
  scope: SimulatorScope;
  portfolioId: number | null;
  overlaySimulationId: number | null;
  portfolioSimulationId: number | null;
}

export interface TickerLookupResult {
  ticker: string;
  name: string;
  sector: string;
  thesis: string;
  country: string;
  existsInPortfolio: boolean;
  portfolioData: { value: number } | null;
}

export interface SearchResult {
  ticker: string;
  name: string;
  sector?: string;
  thesis?: string;
  country?: string;
}
