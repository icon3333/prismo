"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import {
  filterByPortfolios,
  groupByDimension,
  topHoldings,
  portfolioDistribution,
} from "@/lib/concentrations-calc";
import type {
  PortfolioOption,
  PerformanceCompany,
  PerformancePortfolioData,
} from "@/types/performance";

interface PersistedFields {
  includeCash?: string;
  selectedPortfolios?: string;
}

export function useConcentrations() {
  const [portfolios, setPortfolios] = useState<PortfolioOption[]>([]);
  const [allCompanies, setAllCompanies] = useState<PerformanceCompany[]>([]);
  const [selectedPortfolios, setSelectedPortfolios] = useState<Set<string>>(new Set());
  const [cashBalance, setCashBalance] = useState(0);
  const [includeCash, setIncludeCashState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stateRef = useRef<PersistedFields>({});

  const persistState = useCallback((partial: Partial<PersistedFields>) => {
    stateRef.current = { ...stateRef.current, ...partial };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await apiFetch("/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            page: "risk_overview",
            ...stateRef.current,
          }),
        });
      } catch {
        // Silently fail
      }
    }, 500);
  }, []);

  const setIncludeCash = useCallback(
    (v: boolean) => {
      setIncludeCashState(v);
      persistState({ includeCash: v.toString() });
    },
    [persistState]
  );

  const togglePortfolio = useCallback(
    (name: string) => {
      setSelectedPortfolios((prev) => {
        const next = new Set(prev);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        persistState({ selectedPortfolios: JSON.stringify([...next]) });
        return next;
      });
    },
    [persistState]
  );

  const selectAll = useCallback(() => {
    setSelectedPortfolios(new Set());
    persistState({ selectedPortfolios: "[]" });
  }, [persistState]);

  // Initial load
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setIsLoading(true);
        setDataLoading(true);
        setError(null);

        // Fast phase: portfolios list, cash, saved state
        const [portfolioList, cashData, savedState] = await Promise.all([
          apiFetch<PortfolioOption[]>("/portfolios?include_ids=true&has_companies=true"),
          apiFetch<{ cash: number }>("/account/cash").catch(() => ({ cash: 0 })),
          apiFetch<PersistedFields>("/state?page=risk_overview").catch(
            () => ({} as PersistedFields)
          ),
        ]);

        if (cancelled) return;

        setPortfolios(portfolioList);
        setCashBalance(cashData.cash || 0);

        stateRef.current = { ...savedState };

        if (savedState.includeCash !== undefined) {
          setIncludeCashState(savedState.includeCash === "true");
        }

        if (savedState.selectedPortfolios) {
          try {
            const parsed = JSON.parse(savedState.selectedPortfolios);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setSelectedPortfolios(new Set(parsed));
            }
          } catch {
            // Invalid JSON
          }
        }

        setIsLoading(false);

        // Data phase: slow portfolio data call
        const allData = await apiFetch<PerformancePortfolioData>("/portfolio_data/all");

        if (cancelled) return;

        setAllCompanies(allData.companies || []);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load portfolio data"
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setDataLoading(false);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const isAllSelected = selectedPortfolios.size === 0;

  const filteredCompanies = useMemo(
    () => (isAllSelected ? allCompanies : filterByPortfolios(allCompanies, selectedPortfolios)),
    [allCompanies, selectedPortfolios, isAllSelected]
  );

  const sectorData = useMemo(
    () => groupByDimension(filteredCompanies, "sector", includeCash, cashBalance),
    [filteredCompanies, includeCash, cashBalance]
  );

  const countryData = useMemo(
    () => groupByDimension(filteredCompanies, "country", includeCash, cashBalance),
    [filteredCompanies, includeCash, cashBalance]
  );

  const thesisData = useMemo(
    () => groupByDimension(filteredCompanies, "thesis", includeCash, cashBalance),
    [filteredCompanies, includeCash, cashBalance]
  );

  const typeData = useMemo(
    () => groupByDimension(filteredCompanies, "investment_type", includeCash, cashBalance),
    [filteredCompanies, includeCash, cashBalance]
  );

  const holdingsData = useMemo(
    () => topHoldings(filteredCompanies, 15, includeCash, cashBalance),
    [filteredCompanies, includeCash, cashBalance]
  );

  const portfolioDistData = useMemo(
    () => portfolioDistribution(filteredCompanies, includeCash, cashBalance),
    [filteredCompanies, includeCash, cashBalance]
  );

  const heatmapCompanies = filteredCompanies;

  return {
    portfolios,
    selectedPortfolios,
    isAllSelected,
    togglePortfolio,
    selectAll,
    cashBalance,
    includeCash,
    setIncludeCash,
    isLoading,
    dataLoading,
    error,
    // Chart data
    sectorData,
    countryData,
    thesisData,
    typeData,
    holdingsData,
    portfolioDistData,
    // Heatmap
    heatmapCompanies,
  };
}
