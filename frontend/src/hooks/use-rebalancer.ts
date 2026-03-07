"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { calculateRebalancing } from "@/lib/rebalancer-calc";
import { PortfolioState } from "@/lib/portfolio-state";
import type {
  PortfolioData,
  RebalanceMode,
  RebalancedPortfolio,
} from "@/types/portfolio";

interface UseRebalancerReturn {
  portfolioData: PortfolioData | null;
  rebalanced: RebalancedPortfolio[];
  mode: RebalanceMode;
  setMode: (mode: RebalanceMode) => void;
  investmentAmount: number;
  setInvestmentAmount: (amount: number) => void;
  selectedPortfolio: string;
  setSelectedPortfolio: (name: string) => void;
  isLoading: boolean;
  error: string | null;
}

export function useRebalancer(): UseRebalancerReturn {
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(
    null
  );
  const [mode, setMode] = useState<RebalanceMode>("existing-only");
  const [investmentAmount, setInvestmentAmount] = useState(0);
  const [selectedPortfolio, setSelectedPortfolioState] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSelectedPortfolio = useCallback((name: string) => {
    setSelectedPortfolioState(name);
    // Persist cross-page selection
    PortfolioState.set(name);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        setIsLoading(true);
        setError(null);

        const [data, savedId] = await Promise.all([
          apiFetch<PortfolioData>("/simulator/portfolio-data"),
          PortfolioState.get(),
        ]);

        if (!cancelled) {
          setPortfolioData(data);
          if (data.portfolios?.length) {
            // Try to restore cross-page selection
            const restored = savedId
              ? data.portfolios.find(
                  (p) => p.name === savedId && p.targetWeight > 0
                )
              : null;
            const first =
              restored ?? data.portfolios.find((p) => p.targetWeight > 0);
            if (first) setSelectedPortfolioState(first.name);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load portfolio data"
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  const rebalanced = useMemo(() => {
    if (!portfolioData?.portfolios) return [];
    return calculateRebalancing(portfolioData.portfolios, mode, investmentAmount);
  }, [portfolioData, mode, investmentAmount]);

  return {
    portfolioData,
    rebalanced,
    mode,
    setMode,
    investmentAmount,
    setInvestmentAmount,
    selectedPortfolio,
    setSelectedPortfolio,
    isLoading,
    error,
  };
}
