"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApiQuery } from "@/lib/api-cache";
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

/** Debounce keystrokes in the amount field before they become a query key. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function useRebalancer(): UseRebalancerReturn {
  const searchParams = useSearchParams();
  // Picker writes `?portfolio=<id>`. The detailed-overview lookup expects
  // a portfolio name, so we translate against the fetched portfolio list.
  // Missing or "all" → no specific portfolio selected (empty state shown).
  const urlPortfolioId = searchParams.get("portfolio");

  const [mode, setMode] = useState<RebalanceMode>("existing-only");
  const [investmentAmount, setInvestmentAmount] = useState(0);
  const debouncedAmount = useDebouncedValue(investmentAmount, 400);

  // The capital-mode plan is computed server-side (rebalance_service) —
  // mode/amount are query params, each combination a cached key.
  const dataQuery = useApiQuery<PortfolioData>(
    `/simulator/portfolio-data?mode=${mode}&amount=${debouncedAmount}`
  );
  // Sidecar fetch with IDs — used only to translate URL `?portfolio=<id>`
  // into the portfolio name expected by the detailed view.
  const indexQuery = useApiQuery<PortfolioOption[]>(
    "/portfolios?include_ids=true&has_companies=true"
  );

  const portfolioData = dataQuery.data ?? null;

  // Keep showing the previous plan while a new mode/amount key loads, so
  // toggling the mode radio doesn't flash the page skeleton.
  const lastDataRef = useRef<PortfolioData | null>(null);
  if (portfolioData) lastDataRef.current = portfolioData;
  const effectiveData = portfolioData ?? lastDataRef.current;

  const selectedPortfolio = useMemo(() => {
    if (!urlPortfolioId || urlPortfolioId === "all") return "";
    const match = (indexQuery.data ?? []).find(
      (p) => String(p.id) === urlPortfolioId
    );
    return match?.name ?? "";
  }, [urlPortfolioId, indexQuery.data]);

  return {
    portfolioData: effectiveData,
    rebalanced: effectiveData?.rebalanced ?? [],
    mode,
    setMode,
    investmentAmount,
    setInvestmentAmount,
    selectedPortfolio,
    isLoading:
      (dataQuery.isLoading && !lastDataRef.current) || indexQuery.isLoading,
    error: dataQuery.error,
  };
}
