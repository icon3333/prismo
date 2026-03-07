export type InvestmentType = "Stock" | "ETF" | "Crypto";

export type SortColumn =
  | "identifier"
  | "company"
  | "price_eur"
  | "portfolio"
  | "sector"
  | "thesis"
  | "investment_type"
  | "country"
  | "shares"
  | "total_value"
  | "total_invested"
  | "last_updated";

export interface SortState {
  column: SortColumn | null;
  direction: "asc" | "desc";
}

export interface EnrichItem {
  id: number;
  company: string;
  identifier: string | null;
  source: "parqet" | "ibkr" | "manual";
  portfolio: string | null;
  portfolio_id: number | null;
  sector: string | null;
  thesis: string | null;
  investment_type: InvestmentType | null;
  country: string | null;
  effective_country: string;
  shares: number;
  effective_shares: number;
  price_eur: number | null;
  custom_price_eur: number | null;
  custom_total_value: number | null;
  is_custom_value: boolean;
  total_value: number;
  total_invested: number | null;
  last_updated: string | null;
  first_bought_date: string | null;
  is_manually_edited: boolean;
  csv_modified_after_edit: boolean;
  identifier_manually_edited: boolean;
  identifier_manual_edit_date: string | null;
  country_manually_edited: boolean;
  country_manual_edit_date: string | null;
  override_identifier: string | null;
  override_country: string | null;
  override_share: number | null;
  manual_edit_date: string | null;
}

export interface EnrichMetrics {
  total: number;
  totalValue: number;
  lastUpdate: string | null;
}

export interface ColumnHealth {
  portfolio: number;
  sector: number;
  thesis: number;
  investmentType: number;
  price: number;
  country: number;
  value: number;
}

export interface BulkEditValues {
  portfolio: string;
  sector: string;
  thesis: string;
  country: string;
  investmentType: string;
}

export interface AddPositionForm {
  identifier: string;
  name: string;
  portfolio_id: number | null;
  sector: string;
  investment_type: InvestmentType | null;
  country: string;
  shares: string;
  total_value: string;
  total_invested: string;
}

export interface IdentifierValidation {
  loading: boolean;
  status: "valid" | "invalid" | null;
  priceData: {
    price_eur: number;
    name?: string;
    sector?: string;
    investment_type?: InvestmentType;
    country?: string;
  } | null;
}

export interface PortfolioDropdownItem {
  id: number;
  name: string;
}
