"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useApiQuery } from "@/lib/api-cache";
import { usePagePersistence } from "@/hooks/use-page-persistence";
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
  // Shared cached reads — instant render when cached, background revalidate.
  const allQuery = useApiQuery<PerformancePortfolioData>(
    "/portfolio_data/all?fields=companies"
  );
  const portfoliosQuery = useApiQuery<PortfolioOption[]>(
    "/portfolios?include_ids=true&has_companies=true"
  );
  const cashQuery = useApiQuery<{ cash: number }>("/account/cash");

  const [selectedPortfolios, setSelectedPortfolios] = useState<Set<string>>(new Set());
  const [includeCash, setIncludeCashState] = useState(false);
  const [stateLoaded, setStateLoaded] = useState(false);

  const { persistState, hydrate } = usePagePersistence<PersistedFields>("risk_overview");

  // `?portfolio=` carried over from other pages' picker wins over the
  // persisted multi-select. The mount-time value is captured in a ref so the
  // one-shot state restore below can check it without re-running.
  const searchParams = useSearchParams();
  const portfolioIdFromUrl = searchParams.get("portfolio");
  const mountUrlParamRef = useRef(portfolioIdFromUrl);

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

  // One-shot restore of persisted filter state. Not a shared cached read —
  // rehydrating after every write would clobber in-flight user toggles.
  useEffect(() => {
    let cancelled = false;

    async function loadSaved() {
      const savedState = await apiFetch<PersistedFields>("/state?page=risk_overview").catch(
        () => ({} as PersistedFields)
      );
      if (cancelled) return;

      hydrate(savedState);

      if (savedState.includeCash !== undefined) {
        setIncludeCashState(savedState.includeCash === "true");
      }

      // A ?portfolio= URL selection takes precedence over the saved filter.
      if (savedState.selectedPortfolios && !mountUrlParamRef.current) {
        try {
          const parsed = JSON.parse(savedState.selectedPortfolios);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSelectedPortfolios(new Set(parsed));
          }
        } catch {
          // Invalid JSON
        }
      }

      setStateLoaded(true);
    }

    loadSaved();
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  // Apply the URL portfolio selection once the portfolio list is known.
  const portfolioList = portfoliosQuery.data;
  const lastAppliedUrlId = useRef<string | null>(null);
  useEffect(() => {
    const applyUrlSelection = () => {
      if (!portfolioIdFromUrl || portfolioIdFromUrl === lastAppliedUrlId.current) return;
      if (portfolioIdFromUrl === "all") {
        lastAppliedUrlId.current = portfolioIdFromUrl;
        setSelectedPortfolios(new Set());
        return;
      }
      if (!portfolioList) return;
      const match = portfolioList.find((p) => String(p.id) === portfolioIdFromUrl);
      if (match) {
        lastAppliedUrlId.current = portfolioIdFromUrl;
        setSelectedPortfolios(new Set([match.name]));
      }
    };
    applyUrlSelection();
  }, [portfolioIdFromUrl, portfolioList]);

  const isLoading = allQuery.isLoading || !stateLoaded;
  const dataLoading = isLoading;
  const error = allQuery.error;

  const allCompanies = useMemo<PerformanceCompany[]>(
    () => allQuery.data?.companies ?? [],
    [allQuery.data]
  );
  const portfolios = useMemo(() => portfolioList ?? [], [portfolioList]);
  const cashBalance = cashQuery.data?.cash ?? 0;

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
