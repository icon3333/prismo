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
  // Saved multi-select kept aside while a URL param is pending, so it can be
  // restored if the URL id doesn't resolve to a known portfolio.
  const persistedSelectionRef = useRef<string[] | null>(null);
  // null = URL id not yet checked against the portfolio list; true = matched
  // and applied; false = checked and unmatched (persisted filter may restore).
  const urlResolvedRef = useRef<boolean | null>(null);

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
      // Stash the parsed selection either way so the URL effect below can fall
      // back to it if the URL id turns out not to match any portfolio.
      if (savedState.selectedPortfolios) {
        try {
          const parsed = JSON.parse(savedState.selectedPortfolios);
          if (Array.isArray(parsed) && parsed.length > 0) {
            persistedSelectionRef.current = parsed;
            // Skip the restore only while a URL selection is pending or has
            // actually been applied — an unmatched URL id doesn't suppress it.
            if (!mountUrlParamRef.current || urlResolvedRef.current === false) {
              setSelectedPortfolios(new Set(parsed));
            }
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
        urlResolvedRef.current = true;
        setSelectedPortfolios(new Set());
        return;
      }
      if (!portfolioList) return;
      lastAppliedUrlId.current = portfolioIdFromUrl;
      const match = portfolioList.find((p) => String(p.id) === portfolioIdFromUrl);
      urlResolvedRef.current = match !== undefined;
      if (match) {
        setSelectedPortfolios(new Set([match.name]));
      } else if (persistedSelectionRef.current) {
        // The URL id doesn't resolve (deleted portfolio, or one without
        // companies) — fall back to the persisted filter it suppressed.
        setSelectedPortfolios(new Set(persistedSelectionRef.current));
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
