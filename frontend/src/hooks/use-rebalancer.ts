"use client";

import { useState, useEffect, useMemo } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { calculateRebalancing } from "@/lib/rebalancer-calc";
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
  const [selectedPortfolio, setSelectedPortfolio] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await apiFetch<PortfolioData>(
          "/simulator/portfolio-data"
        );
        if (!cancelled) {
          setPortfolioData(data);
          if (data.portfolios?.length) {
            const first = data.portfolios.find((p) => p.targetWeight > 0);
            if (first) setSelectedPortfolio(first.name);
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
