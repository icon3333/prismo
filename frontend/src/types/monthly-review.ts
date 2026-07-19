export type ReviewStatus = "draft" | "completed";
export type ReviewDecision =
  | "undecided"
  | "accepted"
  | "adjusted"
  | "deferred"
  | "dismissed";

export interface MonthlyReviewSummary {
  id: number;
  account_id: number;
  source_job_id: string | null;
  period: string;
  previous_review_id: number | null;
  status: ReviewStatus;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ReviewNotice {
  code: string;
  message: string;
  holding?: string;
  currency?: string;
  age_days?: number;
  items?: unknown[];
}

export interface ReviewContributor {
  name: string;
  value: number;
}

export interface ReviewBreach {
  key: string;
  kind: string;
  name: string;
  percentage: number;
  limit: number;
  excess_percentage_points: number;
  contributors: ReviewContributor[];
}

export interface ReviewAction {
  key: string;
  portfolio: string;
  security: string;
  identifier?: string | null;
  side: "buy" | "sell";
  amount_eur: number;
  estimated_units?: number | null;
  snapshot_price_eur?: number | null;
  snapshot_price_time?: string | null;
  post_action_allocation?: number | null;
  decision: ReviewDecision;
  adjusted_amount?: number;
  note: string;
}

export interface ReviewCashSummary {
  current_cash: number;
  contribution: number;
  accepted_sales: number;
  accepted_buys: number;
  remaining_cash: number;
}

export interface ReviewGap {
  portfolio?: string;
  sector?: string;
  security?: string;
  identifier?: string | null;
  reason: string;
}

export interface MonthlyReviewPayload {
  payload_version: number;
  snapshot: {
    captured_at: string;
    receipt: Record<string, unknown> | null;
    cash: number;
    breaches: ReviewBreach[];
    readiness: {
      blocking: ReviewNotice[];
      warnings: ReviewNotice[];
    };
  };
  comparison: {
    baseline: boolean;
    disclaimer: string;
    added: unknown[];
    closed: unknown[];
    renamed: unknown[];
    moved: unknown[];
    share_changes: unknown[];
    value_changes: unknown[];
    allocation_changes: unknown[];
    cash_change: number;
    rules_changed: boolean;
    targets_changed: boolean;
    new_breaches: unknown[];
    resolved_breaches: unknown[];
  };
  reconciliation: {
    items: unknown[];
    disclaimer: string;
  };
  inputs: {
    mode: string;
    contribution: number;
    contribution_label: string;
    readiness_override: boolean;
  };
  recommendations: {
    mode: string;
    actions: ReviewAction[];
    unresolved_gaps: ReviewGap[];
  };
  cash_summary: ReviewCashSummary;
  completed_at?: string;
}

export interface MonthlyReview extends MonthlyReviewSummary {
  payload: MonthlyReviewPayload;
}

export interface ReviewListResponse {
  success: boolean;
  data: { reviews: MonthlyReviewSummary[] };
}

export interface ReviewResponse {
  success: boolean;
  data: { review: MonthlyReview };
}

export type ReviewChange =
  | { mode: string }
  | { contribution: number }
  | { readiness_override: boolean }
  | {
      action_decision: {
        key: string;
        decision: Exclude<ReviewDecision, "undecided">;
        adjusted_amount?: number;
        note?: string;
      };
    };
