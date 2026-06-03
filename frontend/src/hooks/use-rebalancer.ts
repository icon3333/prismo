"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { calculateRebalancing } from "@/lib/rebalancer-calc";
import type {
  PortfolioData,
  RebalanceMode,
  RebalancedPortfolio,
} from "@/types/portfolio";
import type { PortfolioOption } from "@/types/performance";

interface UseRebalancerReturn {
  portfolioData: PortfolioData | null;
  rebalanced: RebalancedPortfolio[];
  mode: RebalanceMode;
  setMode: (mode: RebalanceMode) => void;
  investmentAmount: number;
  setInvestmentAmount: (amount: number) => void;
  selectedPortfolio: string;
  isLoading: boolean;
  error: string | null;
}

export function useRebalancer(): UseRebalancerReturn {
  const searchParams = useSearchParams();
  // Picker writes `?portfolio=<id>`. The detailed-overview lookup expects
  // a portfolio name, so we translate against the fetched portfolio list.
  // Missing or "all" → no specific portfolio selected (empty state shown).
  const urlPortfolioId = searchParams.get("portfolio");

  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(
    null
  );
  // Sidecar fetch with IDs — used only to translate URL `?portfolio=<id>`
  // into the portfolio name expected by the rebalancer's calc layer.
  const [portfolioIndex, setPortfolioIndex] = useState<PortfolioOption[]>([]);
  const [mode, setMode] = useState<RebalanceMode>("existing-only");
  const [investmentAmount, setInvestmentAmount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        setIsLoading(true);
        setError(null);
        const [data, index] = await Promise.all([
          apiFetch<PortfolioData>("/simulator/portfolio-data"),
          apiFetch<PortfolioOption[]>(
            "/portfolios?include_ids=true&has_companies=true"
          ).catch(() => [] as PortfolioOption[]),
        ]);
        if (!cancelled) {
          setPortfolioData(data);
          setPortfolioIndex(index);
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

  const selectedPortfolio = useMemo(() => {
    if (!urlPortfolioId || urlPortfolioId === "all") return "";
    const match = portfolioIndex.find(
      (p) => String(p.id) === urlPortfolioId
    );
    return match?.name ?? "";
  }, [urlPortfolioId, portfolioIndex]);

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
    isLoading,
    error,
  };
}
