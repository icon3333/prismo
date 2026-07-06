"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useApiQuery } from "@/lib/api-cache";
import { buildAllocationRows } from "@/lib/performance-calc";
import { usePagePersistence } from "@/hooks/use-page-persistence";
import type {
  PortfolioOption,
  PerformancePortfolioData,
  AllocationRow,
  AllocationMode,
} from "@/types/performance";

type SortField = "name" | "percentage" | "value" | "pnl-eur" | "pnl-pct";
type SortDir = "asc" | "desc";

interface AllPersistedFields {
  includeCash?: string;
  selectedPortfolio?: string;
  allocationMode?: string;
  sortField?: string;
  sortDir?: string;
  expandedRows?: string;
}

interface UsePerformanceReturn {
  portfolios: PortfolioOption[];
  selectedPortfolioId: string;
  portfolioData: PerformancePortfolioData | null;
  cashBalance: number;
  includeCash: boolean;
  setIncludeCash: (v: boolean) => void;
  allocationMode: AllocationMode;
  setAllocationMode: (mode: AllocationMode) => void;
  allocationRows: AllocationRow[];
  isAllPortfolios: boolean;
  isLoading: boolean;
  error: string | null;
  // Persisted table state
  initialSortField: SortField | null;
  initialSortDir: SortDir;
  initialExpanded: Record<string, boolean>;
  onSortChange: (field: SortField | null, dir: SortDir) => void;
  onExpandedChange: (expanded: Record<string, boolean>) => void;
}

export function usePerformance(): UsePerformanceReturn {
  const searchParams = useSearchParams();
  // Picker writes `?portfolio=<id>` (or "all"). Missing param means the
  // hook auto-defaults: server-persisted last choice, or "all"/first.
  const urlPortfolioId = searchParams.get("portfolio");

  // Shared cached reads.
  const portfoliosQuery = useApiQuery<PortfolioOption[]>(
    "/portfolios?include_ids=true&has_companies=true"
  );
  const cashQuery = useApiQuery<{ cash: number }>("/account/cash");

  // Ensure IDs are strings for downstream comparison
  const portfolios = useMemo(
    () => (portfoliosQuery.data ?? []).map((p) => ({ ...p, id: String(p.id) })),
    [portfoliosQuery.data]
  );

  const [selectedPortfolioId, setSelectedPortfolioIdState] = useState("");
  const [includeCash, setIncludeCashState] = useState(false);
  const [allocationMode, setAllocationModeState] = useState<AllocationMode>("thesis");
  const [stateLoaded, setStateLoaded] = useState(false);
  const savedPortfolioRef = useRef<string | undefined>(undefined);

  // Table state restored from server
  const [initialSortField, setInitialSortField] = useState<SortField | null>(null);
  const [initialSortDir, setInitialSortDir] = useState<SortDir>("desc");
  const [initialExpanded, setInitialExpanded] = useState<Record<string, boolean>>({});

  const { persistState, hydrate } = usePagePersistence<AllPersistedFields>("performance");

  const setIncludeCash = useCallback(
    (v: boolean) => {
      setIncludeCashState(v);
      persistState({ includeCash: v.toString() });
    },
    [persistState]
  );

  const setAllocationMode = useCallback(
    (mode: AllocationMode) => {
      setAllocationModeState(mode);
      persistState({ allocationMode: mode });
    },
    [persistState]
  );

  const onSortChange = useCallback(
    (field: SortField | null, dir: SortDir) => {
      persistState({
        sortField: field ?? "",
        sortDir: dir,
      });
    },
    [persistState]
  );

  const onExpandedChange = useCallback(
    (expanded: Record<string, boolean>) => {
      persistState({
        expandedRows: JSON.stringify(expanded),
      });
    },
    [persistState]
  );

  // One-shot restore of persisted UI state. Not a shared cached read —
  // rehydrating after every write would clobber in-flight user toggles.
  useEffect(() => {
    let cancelled = false;

    async function loadSaved() {
      const savedState = await apiFetch<AllPersistedFields>("/state?page=performance").catch(
        () => ({} as AllPersistedFields)
      );
      if (cancelled) return;

      // Seed accumulated state with everything from server so future POSTs include all keys
      hydrate(savedState);

      // Restore UI state (not the portfolio selection — that's URL-driven now)
      if (savedState.includeCash !== undefined) {
        setIncludeCashState(savedState.includeCash === "true");
      }
      if (savedState.allocationMode) {
        setAllocationModeState(savedState.allocationMode as AllocationMode);
      }
      if (savedState.sortField) {
        setInitialSortField(savedState.sortField as SortField);
      }
      if (savedState.sortDir) {
        setInitialSortDir(savedState.sortDir as SortDir);
      }
      if (savedState.expandedRows) {
        try {
          setInitialExpanded(JSON.parse(savedState.expandedRows));
        } catch {
          // Invalid JSON, ignore
        }
      }

      savedPortfolioRef.current = savedState.selectedPortfolio;
      setStateLoaded(true);
    }

    loadSaved();
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  // Resolve the effective portfolio id from URL > persisted > default.
  const resolveEffectiveId = useCallback(
    (
      list: PortfolioOption[],
      urlId: string | null,
      saved: string | undefined,
    ): string => {
      const isKnown = (id: string) =>
        id === "all" || list.some((p) => p.id === id);
      if (urlId && isKnown(urlId)) return urlId;
      if (saved && isKnown(saved)) return saved;
      return list.length >= 2 ? "all" : list[0]?.id ?? "";
    },
    [],
  );

  // Re-resolve whenever the URL flips or the inputs finish loading. The
  // server-persisted choice only seeds the very first resolution; later
  // resolutions persist the new choice instead.
  const portfoliosReady = !portfoliosQuery.isLoading;
  const initialResolvedRef = useRef(false);
  useEffect(() => {
    const resolve = () => {
      if (!stateLoaded || !portfoliosReady) return;
      const saved = initialResolvedRef.current ? undefined : savedPortfolioRef.current;
      const isInitial = !initialResolvedRef.current;
      initialResolvedRef.current = true;
      const next = resolveEffectiveId(portfolios, urlPortfolioId, saved);
      if (next && next !== selectedPortfolioId) {
        setSelectedPortfolioIdState(next);
        if (!isInitial) persistState({ selectedPortfolio: next });
      }
    };
    resolve();
  }, [
    stateLoaded,
    portfoliosReady,
    portfolios,
    urlPortfolioId,
    selectedPortfolioId,
    resolveEffectiveId,
    persistState,
  ]);

  // Per-portfolio holdings — shared cached read keyed by the selected id, so
  // flipping back to a previously viewed portfolio renders instantly.
  const dataQuery = useApiQuery<PerformancePortfolioData>(
    selectedPortfolioId ? `/portfolio_data/${selectedPortfolioId}` : null
  );
  const portfolioData = dataQuery.data ?? null;
  const cashBalance = cashQuery.data?.cash ?? 0;

  const isLoading =
    !stateLoaded ||
    portfoliosQuery.isLoading ||
    (selectedPortfolioId !== "" && dataQuery.isLoading);

  const error = portfoliosQuery.error ?? dataQuery.error;

  const isAllPortfolios = portfolioData?.portfolio_id === "all";

  // Reset to thesis if leaving "All Portfolios" while in portfolios mode.
  // React 19 "adjusting state while rendering" pattern — the guard flips
  // false right after the set, so this cannot loop.
  if (!isAllPortfolios && allocationMode === "portfolios" && portfolioData) {
    setAllocationModeState("thesis");
  }

  const allocationRows = useMemo(() => {
    if (!portfolioData) return [];
    return buildAllocationRows(portfolioData, allocationMode, includeCash, cashBalance);
  }, [portfolioData, allocationMode, includeCash, cashBalance]);

  return {
    portfolios,
    selectedPortfolioId,
    portfolioData,
    cashBalance,
    includeCash,
    setIncludeCash,
    allocationMode,
    setAllocationMode,
    allocationRows,
    isAllPortfolios,
    isLoading,
    error,
    initialSortField,
    initialSortDir,
    initialExpanded,
    onSortChange,
    onExpandedChange,
  };
}
