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
  DEFAULT_PERSISTED_STATE,
  parsePersistedState,
  serializePersistedState,
} from "@/lib/simulator-persistence";
import {
  applyPositionsToBuilderPortfolios,
  type AppliedPosition,
} from "@/lib/apply-to-plan";
import { useSimulationAutosave } from "@/hooks/use-simulation-autosave";
import { usePagePersistence } from "@/hooks/use-page-persistence";
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
  SimulationSummary,
  SimulationFull,
  PortfolioData,
  PortfolioOption,
  PersistedState,
  TickerLookupResult,
  DeployManualItem,
} from "@/types/simulator";

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
  const [currentClonedFromPortfolioId, setCurrentClonedFromPortfolioId] = useState<number | null>(null);

  // --- Baseline state ---
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [portfolios, setPortfolios] = useState<PortfolioOption[]>([]);

  // --- UI state ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCountryBar, setExpandedCountryBar] = useState<string | null>(null);
  const [expandedSectorBar, setExpandedSectorBar] = useState<string | null>(null);

  // Refs mirror the latest committed state so row-facing callbacks can keep
  // empty/narrow deps (stable references for React.memo'd rows) without ever
  // reading a stale value — the ref is reassigned on every render below.
  const modeRef = useRef(mode);
  const totalAmountRef = useRef(totalAmount);
  const portfolioDataRef = useRef(portfolioData);
  modeRef.current = mode;
  totalAmountRef.current = totalAmount;
  portfolioDataRef.current = portfolioData;

  // --- Deploy state (stored, not rendered in Phase 1) ---
  const deployRef = useRef({
    lumpSum: 0,
    monthly: 0,
    months: 1,
    manualMode: false,
    manualItems: [] as DeployManualItem[],
  });

  const {
    autoSaveStatus,
    setAutoSaveStatus,
    triggerAutoSave,
    cancelPendingAutoSave,
    flushAutoSave,
  } = useSimulationAutosave({
    currentSimulationId,
    payload: {
      items,
      totalAmount,
      deploy: deployRef.current,
    },
  });

  // =========================================================================
  // Persist helpers
  // =========================================================================

  // Selection state (mode/scope/simulation ids) lives server-side under
  // page 'simulator'. persistedRef mirrors the last known server state so
  // POSTs always carry the full key set (POST /state replaces all keys).
  const { persistState: persistServerState, hydrate: hydrateServerState } =
    usePagePersistence<Record<string, string>>("simulator");
  const persistedRef = useRef<PersistedState>({ ...DEFAULT_PERSISTED_STATE });

  const persistSelection = useCallback(
    (overrides: Partial<PersistedState> = {}) => {
      const modeKey =
        (overrides.mode || mode) === "portfolio"
          ? "portfolioSimulationId"
          : "overlaySimulationId";
      const state: PersistedState = {
        ...persistedRef.current,
        mode: overrides.mode ?? mode,
        scope: overrides.scope ?? scope,
        portfolioId: overrides.portfolioId !== undefined ? overrides.portfolioId : portfolioId,
        [modeKey]: currentSimulationId,
        ...overrides,
      };
      persistedRef.current = state;
      persistServerState(serializePersistedState(state));
    },
    [mode, scope, portfolioId, currentSimulationId, persistServerState]
  );

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
      setCurrentClonedFromPortfolioId(simulation.cloned_from_portfolio_id ?? null);
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
        setCurrentClonedFromPortfolioId(null);
        setItems([]);
        setTotalAmountState(0);
        setAutoSaveStatus("idle");
        deployRef.current = {
          lumpSum: 0, monthly: 0, months: 1,
          manualMode: false, manualItems: [],
        };
        persistSelection({
          [mode === "portfolio" ? "portfolioSimulationId" : "overlaySimulationId"]: null,
        });
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
          persistSelection({
            mode: targetMode,
            [sim.type === "portfolio" ? "portfolioSimulationId" : "overlaySimulationId"]: sim.id,
          });
        } else if (!silent) {
          toast.error("Failed to load simulation");
        }
      } catch {
        if (!silent) toast.error("Failed to load simulation");
      }
    },
    [cancelPendingAutoSave, mode, populateFromSimulation, persistSelection, setAutoSaveStatus]
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
        const [, simsList, savedRaw] = await Promise.all([
          fetchPortfolios(),
          fetchSimulations(),
          apiFetch<Record<string, string>>("/state?page=simulator").catch(
            () => null
          ),
        ]);

        if (cancelled) return;

        // Seed the persistence buffer so later partial saves POST all keys.
        hydrateServerState(serializePersistedState(parsePersistedState(savedRaw)));
        const saved = parsePersistedState(savedRaw);
        persistedRef.current = saved;

        const initMode: SimulatorMode = saved.mode;
        const initScope: SimulatorScope = saved.scope;
        const initPortfolioId: number | null = saved.portfolioId;
        const targetSimId: number | null =
          initMode === "portfolio"
            ? saved.portfolioSimulationId
            : saved.overlaySimulationId;

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
      if (currentSimulationId) {
        await flushAutoSave();
      } else {
        cancelPendingAutoSave();
      }

      // Save current mode's simulation ID
      persistSelection();

      // Read target mode's saved simulation ID
      const saved = persistedRef.current;
      const targetSimId =
        newMode === "portfolio"
          ? saved.portfolioSimulationId
          : saved.overlaySimulationId;

      // Reset state
      setCurrentSimulationId(null);
      setCurrentSimulationName(null);
      setCurrentSimulationType(null);
      setCurrentClonedFromName(null);
      setCurrentClonedFromPortfolioId(null);
      setTotalAmountState(0);
      setItems([]);
      setAutoSaveStatus("idle");
      setModeState(newMode);

      // Persist new mode (don't touch either mode's saved simulation id)
      const updated = { ...persistedRef.current, mode: newMode };
      persistedRef.current = updated;
      persistServerState(serializePersistedState(updated));

      // Restore target mode's simulation
      if (targetSimId && simulations.some((s) => s.id === targetSimId)) {
        await loadSimulation(targetSimId, true);
      }
    },
    [
      mode,
      cancelPendingAutoSave,
      currentSimulationId,
      flushAutoSave,
      persistSelection,
      persistServerState,
      setAutoSaveStatus,
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
      persistSelection({ scope: newScope, portfolioId: newPortfolioId });
    },
    [persistSelection]
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
      // Read current mode/total/baseline from refs so this callback stays a
      // stable reference across item edits (keeps React.memo'd rows quiet).
      const mode = modeRef.current;
      const totalAmount = totalAmountRef.current;
      const portfolioData = portfolioDataRef.current;
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
    [triggerAutoSave]
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
          persistSelection();
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
    [scope, portfolioId, items, mode, totalAmount, fetchSimulations, persistSelection]
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
          persistSelection();
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
    [currentSimulationId, fetchSimulations, persistSelection]
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
        setCurrentClonedFromPortfolioId(null);
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
  }, [
    currentSimulationId,
    currentSimulationName,
    fetchSimulations,
    setAutoSaveStatus,
  ]);

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
          persistSelection();
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
    [populateFromSimulation, fetchSimulations, persistSelection]
  );

  // =========================================================================
  // Apply to Plan (builder state)
  // =========================================================================

  const applyToPlan = useCallback(
    async (targetPortfolioId: number, applied: AppliedPosition[]) => {
      try {
        // Fresh read — this state is about to be overwritten wholesale.
        const builderState = await apiFetch<Record<string, string>>(
          "/state?page=builder",
          { noStore: true }
        );
        const updatedPortfolios = applyPositionsToBuilderPortfolios(
          builderState?.portfolios,
          targetPortfolioId,
          applied
        );
        if (!updatedPortfolios) {
          toast.error(
            "Target portfolio not found in the Plan — open /plan and add it first"
          );
          return false;
        }
        // POST /state replaces every key for the page, so send back all
        // fetched keys verbatim with only 'portfolios' re-serialized.
        await apiFetch("/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...builderState,
            page: "builder",
            portfolios: updatedPortfolios,
          }),
        });
        toast.success("Applied to Plan — open /plan to see the trades");
        return true;
      } catch {
        toast.error("Failed to apply to Plan");
        return false;
      }
    },
    []
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
    currentClonedFromPortfolioId,

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
    applyToPlan,
  };
}

export type UseSimulatorReturn = ReturnType<typeof useSimulator>;
