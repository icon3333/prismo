"use client";

import { useMemo } from "react";
import { useApiQuery } from "@/lib/api-cache";
import {
  computeMetricsFromItems,
  calculateViolations,
  getHealthStatus,
  extractMissingPositions,
} from "@/lib/overview-calc";
import type {
  PortfolioMetrics,
  AllocationRules,
  PortfolioDataItem,
  RebalancerData,
} from "@/types/overview";
import type { PortfolioOption } from "@/types/performance";

export function useOverview() {
  // Shared cached reads — instant render when another page already loaded
  // them, revalidated in the background.
  const itemsQuery = useApiQuery<PortfolioDataItem[]>("/portfolio_data");
  const portfoliosQuery = useApiQuery<PortfolioOption[]>(
    "/portfolios?include_ids=true&has_companies=true"
  );
  const cashQuery = useApiQuery<{ cash: number }>("/account/cash");
  const stateQuery = useApiQuery<{ rules?: string }>("/state?page=builder");
  const rebalQuery = useApiQuery<RebalancerData>("/simulator/portfolio-data");

  const isLoading =
    itemsQuery.isLoading ||
    portfoliosQuery.isLoading ||
    cashQuery.isLoading ||
    stateQuery.isLoading ||
    rebalQuery.isLoading;

  // Only the portfolio list fetch surfaces as a page error (matching the
  // previous behavior where the other fetches had empty fallbacks).
  const error = portfoliosQuery.error;

  const portfolioItems = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const portfolios = useMemo(() => portfoliosQuery.data ?? [], [portfoliosQuery.data]);
  const cashBalance = cashQuery.data?.cash ?? 0;
  const rebalancerData = rebalQuery.data ?? null;

  const metrics = useMemo<PortfolioMetrics | null>(
    () => (isLoading ? null : computeMetricsFromItems(portfolioItems)),
    [isLoading, portfolioItems]
  );

  const rules = useMemo<AllocationRules | null>(() => {
    if (!stateQuery.data?.rules) return null;
    try {
      return JSON.parse(stateQuery.data.rules);
    } catch {
      return null; // Invalid JSON
    }
  }, [stateQuery.data]);

  const violations = useMemo(
    () => calculateViolations(portfolioItems, rules),
    [portfolioItems, rules]
  );

  const healthStatus = useMemo(
    () => getHealthStatus(violations, rules),
    [violations, rules]
  );

  const missingPositions = useMemo(
    () => extractMissingPositions(rebalancerData),
    [rebalancerData]
  );

  const stockViolations = useMemo(
    () => violations.filter((v) => v.type === "stock"),
    [violations]
  );
  const sectorViolations = useMemo(
    () => violations.filter((v) => v.type === "sector"),
    [violations]
  );
  const countryViolations = useMemo(
    () => violations.filter((v) => v.type === "country"),
    [violations]
  );

  return {
    metrics,
    portfolios,
    cashBalance,
    isLoading,
    error,
    violations,
    healthStatus,
    missingPositions,
    stockViolations,
    sectorViolations,
    countryViolations,
    rules,
  };
}
