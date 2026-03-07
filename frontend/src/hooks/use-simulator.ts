"use client";

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import {
  generateItemId,
  normalizeLabel,
  recalculateAllPercentageItems,
  recalculatePercentageItem,
  ensureItemPercentages,
  onTotalAmountChanged,
  calculateCombinedAllocations,
  calculateAllocationSummary,
  getPercentDenominator,
  derivePercentFromEur,
  deriveEurFromPercent,
  getGlobalTotal,
} from "@/lib/simulator-calc";
import type {
  SimulatorItem,
  SimulatorMode,
  SimulatorScope,
  CategoryMode,
  AutoSaveStatus,
  SimulationSummary,
  SimulationFull,
  PortfolioData,
  PortfolioOption,
  PersistedState,
  TickerLookupResult,
  DeployManualItem,
} from "@/types/simulator";

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_KEY = "simulator_state";

function loadPersistedState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePersistedState(state: PersistedState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSimulator() {
  // --- Core state ---
  const [mode, setModeState] = useState<SimulatorMode>("overlay");
  const [scope, setScopeState] = useState<SimulatorScope>("global");
  const [portfolioId, setPortfolioIdState] = useState<number | null>(null);
  const [items, setItems] = useState<SimulatorItem[]>([]);
  const [totalAmount, setTotalAmountState] = useState(0);
  const [categoryMode, setCategoryMode] = useState<CategoryMode>("thesis");

  // --- Simulation state ---
  const [simulations, setSimulations] = useState<SimulationSummary[]>([]);
  const [currentSimulationId, setCurrentSimulationId] = useState<number | null>(null);
  const [currentSimulationName, setCurrentSimulationName] = useState<string | null>(null);
  const [currentSimulationType, setCurrentSimulationType] = useState<"overlay" | "portfolio" | null>(null);
  const [currentClonedFromName, setCurrentClonedFromName] = useState<string | null>(null);

  // --- Baseline state ---
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [portfolios, setPortfolios] = useState<PortfolioOption[]>([]);

  // --- UI state ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("idle");
  const [expandedCountryBar, setExpandedCountryBar] = useState<string | null>(null);
  const [expandedSectorBar, setExpandedSectorBar] = useState<string | null>(null);

  // --- Deploy state (stored, not rendered in Phase 1) ---
  const deployRef = useRef({
    lumpSum: 0,
    monthly: 0,
    months: 1,
    manualMode: false,
    manualItems: [] as DeployManualItem[],
  });

  // --- Refs for auto-save ---
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autoSaveErrorCountRef = useRef(0);
  const autoSaveStatusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const currentSimIdRef = useRef<number | null>(null);

  // Keep ref in sync
  currentSimIdRef.current = currentSimulationId;

  // =========================================================================
  // Persist helpers
  // =========================================================================

  const persistLocalStorage = useCallback(
    (overrides: Partial<PersistedState> = {}) => {
      const existing = loadPersistedState() || {
        mode: "overlay" as SimulatorMode,
        scope: "global" as SimulatorScope,
        portfolioId: null,
        overlaySimulationId: null,
        portfolioSimulationId: null,
      };
      const modeKey =
        (overrides.mode || mode) === "portfolio"
          ? "portfolioSimulationId"
          : "overlaySimulationId";
      const state: PersistedState = {
        ...existing,
        mode: overrides.mode ?? mode,
        scope: overrides.scope ?? scope,
        portfolioId: overrides.portfolioId !== undefined ? overrides.portfolioId : portfolioId,
        [modeKey]: currentSimulationId,
        ...overrides,
      };
      savePersistedState(state);
    },
    [mode, scope, portfolioId, currentSimulationId]
  );

  // =========================================================================
  // Auto-save
  // =========================================================================

  const doAutoSave = useCallback(async () => {
    const simId = currentSimIdRef.current;
    if (!simId) return;

    setAutoSaveStatus("saving");
    try {
      const res = await apiFetch<{ success: boolean }>(
        `/simulator/simulations/${simId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items,
            global_value_mode: "euro",
            total_amount: totalAmount,
            deploy_lump_sum: deployRef.current.lumpSum,
            deploy_monthly: deployRef.current.monthly,
            deploy_months: deployRef.current.months,
            deploy_manual_mode: deployRef.current.manualMode,
            deploy_manual_items: deployRef.current.manualItems,
          }),
        }
      );
      if (res.success) {
        autoSaveErrorCountRef.current = 0;
        setAutoSaveStatus("saved");
        clearTimeout(autoSaveStatusTimerRef.current);
        autoSaveStatusTimerRef.current = setTimeout(
          () => setAutoSaveStatus("idle"),
          2000
        );
      } else {
        throw new Error("save failed");
      }
    } catch {
      autoSaveErrorCountRef.current++;
      setAutoSaveStatus("error");
      if (autoSaveErrorCountRef.current >= 3) {
        toast.error("Auto-save failed repeatedly. Check your connection.");
        autoSaveErrorCountRef.current = 0;
      }
      clearTimeout(autoSaveStatusTimerRef.current);
      autoSaveStatusTimerRef.current = setTimeout(
        () => setAutoSaveStatus("idle"),
        4000
      );
    }
  }, [items, totalAmount]);

  const triggerAutoSave = useCallback(() => {
    if (!currentSimIdRef.current) return;
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(doAutoSave, 800);
  }, [doAutoSave]);

  const cancelPendingAutoSave = useCallback(() => {
    clearTimeout(autoSaveTimerRef.current);
  }, []);

  // =========================================================================
  // Fetch helpers
  // =========================================================================

  const fetchPortfolios = useCallback(async () => {
    try {
      const res = await apiFetch<PortfolioOption[]>(
        "/portfolios?include_ids=true&include_values=true"
      );
      setPortfolios(res || []);
      return res || [];
    } catch {
      return [];
    }
  }, []);

  const fetchSimulations = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: { simulations: SimulationSummary[] } }>(
        "/simulator/simulations"
      );
      if (res.success) {
        setSimulations(res.data.simulations);
        return res.data.simulations;
      }
    } catch {
      // ignore
    }
    return [];
  }, []);

  const fetchBaseline = useCallback(
    async (s: SimulatorScope, pId: number | null, m: SimulatorMode) => {
      if (m === "portfolio") {
        setPortfolioData(null);
        return null;
      }
      try {
        const params = new URLSearchParams({ scope: s });
        if (s === "portfolio" && pId) params.set("portfolio_id", String(pId));
        const res = await apiFetch<{
          success: boolean;
          data: PortfolioData & { investmentTargets?: PortfolioData["investmentTargets"] };
        }>(`/simulator/portfolio-allocations?${params}`);
        if (res.success) {
          setPortfolioData(res.data);
          return res.data;
        }
      } catch {
        // ignore
      }
      return null;
    },
    []
  );

  // =========================================================================
  // Load simulation
  // =========================================================================

  const populateFromSimulation = useCallback(
    (simulation: SimulationFull, silent: boolean) => {
      setCurrentSimulationId(simulation.id);
      setCurrentSimulationName(simulation.name);
      setCurrentSimulationType(simulation.type);
      setCurrentClonedFromName(simulation.cloned_from_name);
      setTotalAmountState(simulation.total_amount || 0);

      let loadedItems = simulation.items || [];
      if (simulation.type === "portfolio") {
        loadedItems = ensureItemPercentages(
          loadedItems,
          simulation.total_amount || 0
        );
      }
      setItems(loadedItems);

      // Restore deploy data
      deployRef.current = {
        lumpSum: simulation.deploy_lump_sum || 0,
        monthly: simulation.deploy_monthly || 0,
        months: simulation.deploy_months || 1,
        manualMode: simulation.deploy_manual_mode || false,
        manualItems: simulation.deploy_manual_items || [],
      };

      if (!silent) {
        toast.success(`Loaded "${simulation.name}"`);
      }
    },
    []
  );

  const loadSimulation = useCallback(
    async (simulationId: number | null, silent = false) => {
      if (!simulationId) {
        // Reset
        setCurrentSimulationId(null);
        setCurrentSimulationName(null);
        setCurrentSimulationType(null);
        setCurrentClonedFromName(null);
        setItems([]);
        setTotalAmountState(0);
        setAutoSaveStatus("idle");
        deployRef.current = {
          lumpSum: 0, monthly: 0, months: 1,
          manualMode: false, manualItems: [],
        };
        return;
      }

      cancelPendingAutoSave();

      try {
        const res = await apiFetch<{
          success: boolean;
          data: { simulation: SimulationFull };
        }>(`/simulator/simulations/${simulationId}`);

        if (res.success) {
          const sim = res.data.simulation;
          const targetMode =
            sim.type === "portfolio" ? "portfolio" : "overlay";

          if (targetMode !== mode) {
            setModeState(targetMode);
          }

          populateFromSimulation(sim, silent);
        } else if (!silent) {
          toast.error("Failed to load simulation");
        }
      } catch {
        if (!silent) toast.error("Failed to load simulation");
      }
    },
    [cancelPendingAutoSave, mode, populateFromSimulation]
  );

  // =========================================================================
  // Initialization
  // =========================================================================

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setIsLoading(true);
      setError(null);

      try {
        const [portfoliosList, simsList] = await Promise.all([
          fetchPortfolios(),
          fetchSimulations(),
        ]);

        if (cancelled) return;

        const saved = loadPersistedState();
        let initMode: SimulatorMode = "overlay";
        let initScope: SimulatorScope = "global";
        let initPortfolioId: number | null = null;
        let targetSimId: number | null = null;

        if (saved) {
          if (saved.mode === "overlay" || saved.mode === "portfolio") {
            initMode = saved.mode;
          }
          if (saved.scope) initScope = saved.scope;
          if (saved.portfolioId) initPortfolioId = saved.portfolioId;

          targetSimId =
            initMode === "portfolio"
              ? saved.portfolioSimulationId
              : saved.overlaySimulationId;
        }

        setModeState(initMode);
        setScopeState(initScope);
        setPortfolioIdState(initPortfolioId);

        // Load baseline (overlay mode only)
        const baseline = await fetchBaseline(initScope, initPortfolioId, initMode);

        // Auto-restore simulation
        if (targetSimId && simsList.some((s) => s.id === targetSimId)) {
          try {
            const res = await apiFetch<{
              success: boolean;
              data: { simulation: SimulationFull };
            }>(`/simulator/simulations/${targetSimId}`);

            if (!cancelled && res.success) {
              const sim = res.data.simulation;
              populateFromSimulation(sim, true);

              // If overlay, recalculate with baseline
              if (initMode === "overlay" && baseline) {
                const recalced = recalculateAllPercentageItems(
                  sim.items || [],
                  baseline,
                  initMode
                );
                setItems(
                  sim.type === "portfolio"
                    ? ensureItemPercentages(sim.items || [], sim.total_amount || 0)
                    : recalced
                );
              }
            }
          } catch {
            // Silently fail on auto-restore
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to initialize");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================================================================
  // Baseline reload on scope/portfolio/mode change (after init)
  // =========================================================================

  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    fetchBaseline(scope, portfolioId, mode).then((baseline) => {
      if (baseline && mode === "overlay") {
        setItems((prev) =>
          recalculateAllPercentageItems(prev, baseline, mode)
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, portfolioId, mode]);

  // =========================================================================
  // Mode switching
  // =========================================================================

  const switchMode = useCallback(
    async (newMode: SimulatorMode) => {
      if (newMode === mode) return;

      // Flush pending auto-save
      cancelPendingAutoSave();
      if (currentSimIdRef.current) {
        await doAutoSave();
      }

      // Save current mode's simulation ID
      persistLocalStorage();

      // Read target mode's saved simulation ID
      const saved = loadPersistedState();
      const targetSimId =
        newMode === "portfolio"
          ? saved?.portfolioSimulationId
          : saved?.overlaySimulationId;

      // Reset state
      setCurrentSimulationId(null);
      setCurrentSimulationName(null);
      setCurrentSimulationType(null);
      setCurrentClonedFromName(null);
      setTotalAmountState(0);
      setItems([]);
      setAutoSaveStatus("idle");
      setModeState(newMode);

      // Persist new mode
      const updated = loadPersistedState() || {
        mode: newMode,
        scope,
        portfolioId,
        overlaySimulationId: null,
        portfolioSimulationId: null,
      };
      updated.mode = newMode;
      savePersistedState(updated);

      // Restore target mode's simulation
      if (targetSimId && simulations.some((s) => s.id === targetSimId)) {
        await loadSimulation(targetSimId, true);
      }
    },
    [
      mode,
      scope,
      portfolioId,
      cancelPendingAutoSave,
      doAutoSave,
      persistLocalStorage,
      simulations,
      loadSimulation,
    ]
  );

  // =========================================================================
  // Scope switching
  // =========================================================================

  const setScope = useCallback(
    (newScope: SimulatorScope, newPortfolioId: number | null = null) => {
      setScopeState(newScope);
      setPortfolioIdState(newPortfolioId);
      persistLocalStorage({ scope: newScope, portfolioId: newPortfolioId });
    },
    [persistLocalStorage]
  );

  // =========================================================================
  // Item CRUD
  // =========================================================================

  const addItem = useCallback(
    (item: SimulatorItem) => {
      setItems((prev) => [...prev, item]);
      triggerAutoSave();
    },
    [triggerAutoSave]
  );

  const updateItem = useCallback(
    (id: string, updates: Partial<SimulatorItem>) => {
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
      );
      triggerAutoSave();
    },
    [triggerAutoSave]
  );

  const deleteItem = useCallback(
    (id: string) => {
      setItems((prev) => prev.filter((item) => item.id !== id));
      triggerAutoSave();
    },
    [triggerAutoSave]
  );

  // =========================================================================
  // Add item handlers
  // =========================================================================

  const handleAddTicker = useCallback(
    async (ticker: string) => {
      const trimmed = ticker.trim().toUpperCase();
      if (!trimmed) return;

      try {
        const res = await apiFetch<{
          success: boolean;
          data: TickerLookupResult;
          error?: string;
        }>("/simulator/ticker-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: trimmed }),
        });

        if (res.success) {
          const d = res.data;
          const newItem: SimulatorItem = {
            id: generateItemId(),
            ticker: d.ticker,
            name: d.name,
            sector: normalizeLabel(d.sector) || "—",
            thesis: normalizeLabel(d.thesis) || "—",
            country: normalizeLabel(d.country) || "—",
            value: 0,
            targetPercent: 0,
            source: "ticker",
            portfolio_id:
              scope === "portfolio" && portfolioId ? portfolioId : null,
            existsInPortfolio: d.existsInPortfolio || false,
            portfolioData: d.portfolioData || null,
          };
          addItem(newItem);
          const existsMsg = d.existsInPortfolio
            ? " (exists in portfolio)"
            : "";
          toast.success(`Added ${d.ticker} (${d.name})${existsMsg}`);
          return true;
        } else {
          toast.error(res.error || "Ticker not found");
          return false;
        }
      } catch {
        toast.error("Failed to fetch ticker data");
        return false;
      }
    },
    [scope, portfolioId, addItem]
  );

  const handleAddDimension = useCallback(
    (type: "sector" | "thesis" | "country", value: string) => {
      const normalized = normalizeLabel(value);
      if (!normalized) return;

      const newItem: SimulatorItem = {
        id: generateItemId(),
        ticker: "—",
        name: "",
        sector: type === "sector" ? normalized : "—",
        thesis: type === "thesis" ? normalized : "—",
        country: type === "country" ? normalized : "—",
        value: 0,
        targetPercent: 0,
        source: type,
        portfolio_id:
          scope === "portfolio" && portfolioId ? portfolioId : null,
      };
      addItem(newItem);

      // Auto-expand the corresponding chart bar
      if (type === "country") {
        setExpandedCountryBar(normalized);
      } else if (
        (type === "thesis" && categoryMode === "thesis") ||
        (type === "sector" && categoryMode === "sector")
      ) {
        setExpandedSectorBar(normalized);
      }
    },
    [scope, portfolioId, addItem, categoryMode]
  );

  // =========================================================================
  // EUR/% derivation on item edit
  // =========================================================================

  const updateItemValue = useCallback(
    (id: string, field: "value" | "targetPercent", rawValue: number) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;

          if (field === "value") {
            // EUR changed → derive %
            const denom = getPercentDenominator(mode, totalAmount, prev);
            const pct = derivePercentFromEur(rawValue, denom);
            return { ...item, value: rawValue, targetPercent: pct };
          } else {
            // % changed
            if (mode === "portfolio" && totalAmount > 0) {
              // Sandbox: derive EUR from %
              const eur = deriveEurFromPercent(rawValue, totalAmount);
              return { ...item, targetPercent: rawValue, value: eur };
            } else if (mode === "overlay") {
              // Overlay: recalculate via formula
              const updated = { ...item, targetPercent: rawValue };
              return recalculatePercentageItem(updated, portfolioData, mode);
            }
            return { ...item, targetPercent: rawValue };
          }
        })
      );
      triggerAutoSave();
    },
    [mode, totalAmount, portfolioData, triggerAutoSave]
  );

  // =========================================================================
  // Total amount
  // =========================================================================

  const setTotalAmount = useCallback(
    (newTotal: number) => {
      const oldTotal = totalAmount;
      setTotalAmountState(newTotal);
      setItems((prev) => onTotalAmountChanged(prev, oldTotal, newTotal));
      triggerAutoSave();
    },
    [totalAmount, triggerAutoSave]
  );

  // =========================================================================
  // Simulation CRUD
  // =========================================================================

  const saveAsSimulation = useCallback(
    async (name: string) => {
      const data = {
        name,
        scope,
        portfolio_id: scope === "portfolio" ? portfolioId : null,
        items,
        type: mode === "portfolio" ? "portfolio" : "overlay",
        global_value_mode: "euro",
        total_amount: totalAmount,
        deploy_lump_sum: deployRef.current.lumpSum,
        deploy_monthly: deployRef.current.monthly,
        deploy_months: deployRef.current.months,
        deploy_manual_mode: deployRef.current.manualMode,
        deploy_manual_items: deployRef.current.manualItems,
      };

      try {
        const res = await apiFetch<{
          success: boolean;
          data: { simulation: SimulationFull };
          error?: string;
        }>("/simulator/simulations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (res.success) {
          const sim = res.data.simulation;
          setCurrentSimulationId(sim.id);
          setCurrentSimulationName(sim.name);
          setCurrentSimulationType(sim.type);
          await fetchSimulations();
          persistLocalStorage();
          toast.success(`Saved "${name}"`);
          return true;
        } else {
          toast.error(res.error || "Failed to save simulation");
          return false;
        }
      } catch {
        toast.error("Failed to save simulation");
        return false;
      }
    },
    [scope, portfolioId, items, mode, totalAmount, fetchSimulations, persistLocalStorage]
  );

  const renameSimulation = useCallback(
    async (name: string) => {
      if (!currentSimulationId) return false;

      try {
        const res = await apiFetch<{ success: boolean; error?: string }>(
          `/simulator/simulations/${currentSimulationId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          }
        );

        if (res.success) {
          setCurrentSimulationName(name);
          await fetchSimulations();
          persistLocalStorage();
          toast.success(`Renamed to "${name}"`);
          return true;
        } else {
          toast.error(res.error || "Failed to rename simulation");
          return false;
        }
      } catch {
        toast.error("Failed to rename simulation");
        return false;
      }
    },
    [currentSimulationId, fetchSimulations, persistLocalStorage]
  );

  const deleteSimulation = useCallback(async () => {
    if (!currentSimulationId) return false;

    try {
      const res = await apiFetch<{ success: boolean; error?: string }>(
        `/simulator/simulations/${currentSimulationId}`,
        { method: "DELETE" }
      );

      if (res.success) {
        toast.success(`Deleted "${currentSimulationName}"`);
        setCurrentSimulationId(null);
        setCurrentSimulationName(null);
        setCurrentSimulationType(null);
        setCurrentClonedFromName(null);
        setItems([]);
        setTotalAmountState(0);
        setAutoSaveStatus("idle");
        await fetchSimulations();
        return true;
      } else {
        toast.error(res.error || "Failed to delete simulation");
        return false;
      }
    } catch {
      toast.error("Failed to delete simulation");
      return false;
    }
  }, [currentSimulationId, currentSimulationName, fetchSimulations]);

  // =========================================================================
  // Clone portfolio
  // =========================================================================

  const clonePortfolio = useCallback(
    async (
      clonePortfolioId: number,
      name: string,
      zeroValues: boolean
    ) => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { simulation: SimulationFull };
          error?: string;
        }>("/simulator/clone-portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolio_id: clonePortfolioId,
            name,
            zero_values: zeroValues,
          }),
        });

        if (res.success) {
          const sim = res.data.simulation;
          populateFromSimulation(sim, true);
          await fetchSimulations();
          persistLocalStorage();
          const posCount = (sim.items || []).length;
          toast.success(
            `Cloned "${sim.cloned_from_name}" (${posCount} positions)`
          );
          return true;
        } else {
          toast.error(res.error || "Failed to clone portfolio");
          return false;
        }
      } catch {
        toast.error("Failed to clone portfolio");
        return false;
      }
    },
    [populateFromSimulation, fetchSimulations, persistLocalStorage]
  );

  // =========================================================================
  // Memos
  // =========================================================================

  const combinedAllocations = useMemo(
    () =>
      calculateCombinedAllocations(
        items,
        portfolioData,
        mode,
        scope,
        portfolioId,
        totalAmount
      ),
    [items, portfolioData, mode, scope, portfolioId, totalAmount]
  );

  const allocationSummary = useMemo(
    () => calculateAllocationSummary(items, mode, totalAmount),
    [items, mode, totalAmount]
  );

  const filteredSimulations = useMemo(() => {
    const modeType = mode === "portfolio" ? "portfolio" : "overlay";
    return simulations.filter((s) => s.type === modeType);
  }, [simulations, mode]);

  const percentDenominator = useMemo(
    () => getPercentDenominator(mode, totalAmount, items),
    [mode, totalAmount, items]
  );

  const globalTotal = useMemo(
    () => getGlobalTotal(mode, totalAmount, items, portfolios),
    [mode, totalAmount, items, portfolios]
  );

  // =========================================================================
  // Cleanup
  // =========================================================================

  useEffect(() => {
    return () => {
      clearTimeout(autoSaveTimerRef.current);
      clearTimeout(autoSaveStatusTimerRef.current);
    };
  }, []);

  // =========================================================================
  // Return
  // =========================================================================

  return {
    // Core state
    mode,
    scope,
    portfolioId,
    items,
    totalAmount,
    categoryMode,
    setCategoryMode,

    // Simulation state
    simulations,
    filteredSimulations,
    currentSimulationId,
    currentSimulationName,
    currentSimulationType,
    currentClonedFromName,

    // Baseline
    portfolioData,
    portfolios,

    // UI
    isLoading,
    error,
    autoSaveStatus,
    expandedCountryBar,
    setExpandedCountryBar,
    expandedSectorBar,
    setExpandedSectorBar,

    // Computed
    combinedAllocations,
    allocationSummary,
    percentDenominator,
    globalTotal,

    // Actions
    switchMode,
    setScope,
    addItem,
    updateItem,
    deleteItem,
    updateItemValue,
    handleAddTicker,
    handleAddDimension,
    setTotalAmount,
    loadSimulation,
    saveAsSimulation,
    renameSimulation,
    deleteSimulation,
    clonePortfolio,
  };
}

export type UseSimulatorReturn = ReturnType<typeof useSimulator>;
