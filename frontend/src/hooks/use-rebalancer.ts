"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useApiQuery } from "@/lib/api-cache";
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

  // Shared cached reads — instant render when cached, background revalidate.
  const dataQuery = useApiQuery<PortfolioData>("/simulator/portfolio-data");
  // Sidecar fetch with IDs — used only to translate URL `?portfolio=<id>`
  // into the portfolio name expected by the rebalancer's calc layer.
  const indexQuery = useApiQuery<PortfolioOption[]>(
    "/portfolios?include_ids=true&has_companies=true"
  );

  const [mode, setMode] = useState<RebalanceMode>("existing-only");
  const [investmentAmount, setInvestmentAmount] = useState(0);

  const portfolioData = dataQuery.data ?? null;

  const selectedPortfolio = useMemo(() => {
    if (!urlPortfolioId || urlPortfolioId === "all") return "";
    const match = (indexQuery.data ?? []).find(
      (p) => String(p.id) === urlPortfolioId
    );
    return match?.name ?? "";
  }, [urlPortfolioId, indexQuery.data]);

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
    isLoading: dataQuery.isLoading || indexQuery.isLoading,
    error: dataQuery.error,
  };
}
