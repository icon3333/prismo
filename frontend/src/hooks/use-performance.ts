"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
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

  const [portfolios, setPortfolios] = useState<PortfolioOption[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioIdState] = useState("");
  const [portfolioData, setPortfolioData] =
    useState<PerformancePortfolioData | null>(null);
  const [cashBalance, setCashBalance] = useState(0);
  const [includeCash, setIncludeCashState] = useState(false);
  const [allocationMode, setAllocationModeState] = useState<AllocationMode>("thesis");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Resolve the effective portfolio id from URL > persisted > default.
  // Re-runs when the URL flips (PortfolioPicker writes to `?portfolio=`).
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

  const fetchPortfolioData = useCallback(async (id: string) => {
    if (!id) {
      setPortfolioData(null);
      return;
    }
    try {
      setIsLoading(true);
      const data = await apiFetch<PerformancePortfolioData>(
        `/portfolio_data/${id}`,
      );
      setPortfolioData(data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load portfolio data",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load: portfolios + cash + persisted UI state
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setIsLoading(true);
        setError(null);

        const [rawPortfolioList, cashData, savedState] = await Promise.all([
          apiFetch<PortfolioOption[]>(
            "/portfolios?include_ids=true&has_companies=true"
          ),
          apiFetch<{ cash: number }>("/account/cash").catch(() => ({ cash: 0 })),
          apiFetch<AllPersistedFields>("/state?page=performance").catch(
            () => ({} as AllPersistedFields)
          ),
        ]);

        if (cancelled) return;

        // Ensure IDs are strings for downstream comparison
        const portfolioList = rawPortfolioList.map((p) => ({
          ...p,
          id: String(p.id),
        }));
        setPortfolios(portfolioList);
        setCashBalance(cashData.cash || 0);

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

        // Resolve initial portfolio: URL wins, else server-persisted, else default
        const targetId = resolveEffectiveId(
          portfolioList,
          urlPortfolioId,
          savedState.selectedPortfolio,
        );
        if (targetId) {
          setSelectedPortfolioIdState(targetId);
          await fetchPortfolioData(targetId);
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

    init();
    return () => {
      cancelled = true;
    };
    // Intentionally excludes urlPortfolioId — initial mount only. Subsequent
    // URL changes are handled by the separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrate, resolveEffectiveId, fetchPortfolioData]);

  // Respond to URL `?portfolio=` flips after mount (picker → router.push).
  useEffect(() => {
    if (!portfolios.length) return;
    const next = resolveEffectiveId(portfolios, urlPortfolioId, undefined);
    if (next && next !== selectedPortfolioId) {
      setSelectedPortfolioIdState(next);
      persistState({ selectedPortfolio: next });
      void fetchPortfolioData(next);
    }
  }, [
    urlPortfolioId,
    portfolios,
    selectedPortfolioId,
    persistState,
    resolveEffectiveId,
    fetchPortfolioData,
  ]);

  const isAllPortfolios = portfolioData?.portfolio_id === "all";

  // Reset to thesis if leaving "All Portfolios" while in portfolios mode
  useEffect(() => {
    if (!isAllPortfolios && allocationMode === "portfolios") {
      setAllocationModeState("thesis");
    }
  }, [isAllPortfolios, allocationMode]);

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
