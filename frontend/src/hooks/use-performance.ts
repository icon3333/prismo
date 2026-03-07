"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { buildAllocationRows } from "@/lib/performance-calc";
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
  setSelectedPortfolioId: (id: string) => void;
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

  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stateRef = useRef<AllPersistedFields>({});

  // Debounced persist — merges partial into stateRef, POSTs ALL keys
  const persistState = useCallback((partial: Partial<AllPersistedFields>) => {
    stateRef.current = { ...stateRef.current, ...partial };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await apiFetch("/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            page: "performance",
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

  // Load portfolio data when selection changes
  const setSelectedPortfolioId = useCallback(
    async (id: string) => {
      setSelectedPortfolioIdState(id);
      if (!id) {
        setPortfolioData(null);
        return;
      }

      try {
        setIsLoading(true);
        const data = await apiFetch<PerformancePortfolioData>(
          `/portfolio_data/${id}`
        );
        setPortfolioData(data);
        setError(null);
        persistState({ selectedPortfolio: id });
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "Failed to load portfolio data"
        );
      } finally {
        setIsLoading(false);
      }
    },
    [persistState]
  );

  // Initial load: portfolios + cash + persisted state
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setIsLoading(true);
        setError(null);

        const [portfolioList, cashData, savedState] = await Promise.all([
          apiFetch<PortfolioOption[]>(
            "/portfolios?include_ids=true&has_companies=true"
          ),
          apiFetch<{ cash: number }>("/account/cash").catch(() => ({ cash: 0 })),
          apiFetch<AllPersistedFields>("/state?page=performance").catch(
            () => ({} as AllPersistedFields)
          ),
        ]);

        if (cancelled) return;

        setPortfolios(portfolioList);
        setCashBalance(cashData.cash || 0);

        // Seed stateRef with everything from server so future POSTs include all keys
        stateRef.current = { ...savedState };

        // Restore includeCash
        if (savedState.includeCash !== undefined) {
          setIncludeCashState(savedState.includeCash === "true");
        }

        // Restore allocationMode
        if (savedState.allocationMode) {
          setAllocationModeState(savedState.allocationMode as AllocationMode);
        }

        // Restore sort state
        if (savedState.sortField) {
          setInitialSortField(savedState.sortField as SortField);
        }
        if (savedState.sortDir) {
          setInitialSortDir(savedState.sortDir as SortDir);
        }

        // Restore expanded rows
        if (savedState.expandedRows) {
          try {
            setInitialExpanded(JSON.parse(savedState.expandedRows));
          } catch {
            // Invalid JSON, ignore
          }
        }

        // Auto-load saved portfolio
        const savedId = savedState.selectedPortfolio;
        if (
          savedId &&
          portfolioList.some((p) => p.id === savedId || savedId === "all")
        ) {
          setSelectedPortfolioIdState(savedId);
          try {
            const data = await apiFetch<PerformancePortfolioData>(
              `/portfolio_data/${savedId}`
            );
            if (!cancelled) setPortfolioData(data);
          } catch {
            // Portfolio may have been deleted
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

    init();
    return () => {
      cancelled = true;
    };
  }, []);

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
    setSelectedPortfolioId,
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
