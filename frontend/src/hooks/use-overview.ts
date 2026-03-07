"use client";

import { useState, useEffect, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import {
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
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  const [portfolios, setPortfolios] = useState<PortfolioOption[]>([]);
  const [cashBalance, setCashBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [portfolioItems, setPortfolioItems] = useState<PortfolioDataItem[]>([]);
  const [rules, setRules] = useState<AllocationRules | null>(null);
  const [rebalancerData, setRebalancerData] = useState<RebalancerData | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setIsLoading(true);
        setDataLoading(true);
        setError(null);

        // Fast phase
        const [metricsData, portfolioList, cashData] = await Promise.all([
          apiFetch<PortfolioMetrics>("/portfolio_metrics"),
          apiFetch<PortfolioOption[]>("/portfolios?include_ids=true&has_companies=true"),
          apiFetch<{ cash: number }>("/account/cash").catch(() => ({ cash: 0 })),
        ]);

        if (cancelled) return;

        setMetrics(metricsData);
        setPortfolios(portfolioList);
        setCashBalance(cashData.cash || 0);
        setIsLoading(false);

        // Data phase
        const [items, stateData, rebalData] = await Promise.all([
          apiFetch<PortfolioDataItem[]>("/portfolio_data").catch(() => []),
          apiFetch<{ rules?: string }>("/state?page=builder").catch((): { rules?: string } => ({})),
          apiFetch<RebalancerData>("/simulator/portfolio-data").catch(() => null),
        ]);

        if (cancelled) return;

        setPortfolioItems(items);
        setRebalancerData(rebalData);

        if (stateData?.rules) {
          try {
            setRules(JSON.parse(stateData.rules));
          } catch {
            // Invalid JSON
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load data");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setDataLoading(false);
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

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
    dataLoading,
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
