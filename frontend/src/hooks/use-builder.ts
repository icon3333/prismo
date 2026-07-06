"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { usePagePersistence } from "@/hooks/use-page-persistence";
import {
  type BuilderPersistedState,
  stripRuntimeFields,
  tryParse,
} from "@/lib/builder-persistence";
import {
  computeBudgetDerived,
  computeMinPositions,
  computeEvenSplitWeight,
  computePlaceholder,
  computeTotalAllocation,
  computeTotalAllocatedAmount,
  reconcilePortfolios,
  buildCSVContent,
} from "@/lib/builder-calc";
import { exportBuilderPDF } from "@/lib/builder-export";
import type {
  BudgetData,
  AllocationRules,
  BuilderPortfolio,
  BuilderRealPosition,
  BuilderPlaceholderPosition,
  PortfolioCompany,
  PortfolioMetrics,
  PortfolioOption,
  SortOptions,
} from "@/types/builder";

const DEFAULT_BUDGET: BudgetData = {
  totalNetWorth: 0,
  alreadyInvested: 0,
  emergencyFund: 0,
  totalInvestableCapital: 0,
  availableToInvest: 0,
};

const DEFAULT_RULES: AllocationRules = {
  maxPerStock: 5,
  maxPerETF: 10,
  maxPerCrypto: 5,
  maxPerCategory: 25,
  maxPerCountry: 10,
};

const DEFAULT_METRICS: PortfolioMetrics = {
  total_value: 0,
  total_items: 0,
  health: 100,
  missing_prices: 0,
  last_update: null,
};

export function useBuilder() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [budget, setBudget] = useState<BudgetData>(DEFAULT_BUDGET);
  const [rules, setRulesState] = useState<AllocationRules>(DEFAULT_RULES);
  const [portfolios, setPortfolios] = useState<BuilderPortfolio[]>([]);
  const [portfolioCompanies, setPortfolioCompanies] = useState<
    Record<string, PortfolioCompany[]>
  >({});
  const [expandedPortfolios, setExpandedPortfolios] = useState<
    Record<string, boolean>
  >({});
  const [sortOptions, setSortOptionsState] = useState<SortOptions>({
    column: "weight",
    direction: "desc",
  });
  const [metricsState, setMetricsState] =
    useState<PortfolioMetrics>(DEFAULT_METRICS);

  // Debounced persist — partial updates are serialized into the persisted
  // string fields and merged into the shared hook's accumulated state.
  const { persistState, hydrate, isSaving } =
    usePagePersistence<BuilderPersistedState>("builder");

  const save = useCallback(
    (updates: {
      budget?: BudgetData;
      rules?: AllocationRules;
      portfolios?: BuilderPortfolio[];
      expandedPortfolios?: Record<string, boolean>;
      sortOptions?: SortOptions;
    }) => {
      const partial: Partial<BuilderPersistedState> = {};
      if (updates.budget) partial.budgetData = JSON.stringify(updates.budget);
      if (updates.rules) partial.rules = JSON.stringify(updates.rules);
      if (updates.portfolios)
        partial.portfolios = JSON.stringify(stripRuntimeFields(updates.portfolios));
      if (updates.expandedPortfolios)
        partial.expandedPortfolios = JSON.stringify(updates.expandedPortfolios);
      if (updates.sortOptions)
        partial.sortOptions = JSON.stringify(updates.sortOptions);
      persistState(partial);
    },
    [persistState]
  );

  // === Budget methods ===
  const setBudgetField = useCallback(
    (
      field: "totalNetWorth" | "alreadyInvested" | "emergencyFund",
      value: number
    ) => {
      setBudget((prev) => {
        const raw = { ...prev, [field]: value };
        const derived = computeBudgetDerived(raw);
        const next = { ...raw, ...derived };
        save({ budget: next });
        return next;
      });
    },
    [save]
  );

  const populateAlreadyInvested = useCallback(() => {
    if (metricsState.total_value <= 0) return;
    const rounded =
      metricsState.total_value >= 100
        ? Math.round(metricsState.total_value)
        : Math.round(metricsState.total_value * 100) / 100;
    setBudgetField("alreadyInvested", rounded);
  }, [metricsState.total_value, setBudgetField]);

  // === Rules methods ===
  const setRule = useCallback(
    (field: keyof AllocationRules, value: number) => {
      setRulesState((prev) => {
        const next = { ...prev, [field]: value };
        save({ rules: next });
        return next;
      });
    },
    [save]
  );

  // === Portfolio methods ===
  const toggleExpanded = useCallback(
    (portfolioId: string) => {
      setExpandedPortfolios((prev) => {
        const next = { ...prev, [portfolioId]: !prev[portfolioId] };
        save({ expandedPortfolios: next });
        return next;
      });
    },
    [save]
  );

  const setAllocation = useCallback(
    (portfolioId: string, value: number) => {
      setPortfolios((prev) => {
        const next = prev.map((p) =>
          p.id === portfolioId ? { ...p, allocation: value } : p
        );
        save({ portfolios: next });
        return next;
      });
    },
    [save]
  );

  const setDesiredPositions = useCallback(
    (portfolioId: string, value: number) => {
      setPortfolios((prev) => {
        const next = prev.map((p) => {
          if (p.id !== portfolioId) return p;
          const updated = { ...p, desiredPositions: Math.max(1, value) };
          // If even split, recalculate weights
          if (updated.evenSplit) {
            const effectivePos = value;
            const evenWeight = computeEvenSplitWeight(effectivePos);
            updated.positions = updated.positions.map((pos) => ({
              ...pos,
              weight: evenWeight,
            }));
          }
          return updated;
        });
        save({ portfolios: next });
        return next;
      });
    },
    [save]
  );

  const setEvenSplit = useCallback(
    (portfolioId: string, value: boolean) => {
      setPortfolios((prev) => {
        const next = prev.map((p) => {
          if (p.id !== portfolioId) return p;
          const updated = { ...p, evenSplit: value };
          if (value) {
            const minPos = computeMinPositions(
              updated.allocation,
              rules.maxPerStock
            );
            const effectivePos = updated.desiredPositions ?? minPos;
            const evenWeight = computeEvenSplitWeight(effectivePos);
            updated.positions = updated.positions.map((pos) => ({
              ...pos,
              weight: evenWeight,
            }));
          }
          return updated;
        });
        save({ portfolios: next });
        return next;
      });
    },
    [save, rules.maxPerStock]
  );

  const addPosition = useCallback(
    (portfolioId: string) => {
      setPortfolios((prev) => {
        const next = prev.map((p) => {
          if (p.id !== portfolioId) return p;
          const companyId = p.selectedPosition
            ? parseInt(p.selectedPosition, 10)
            : null;
          if (!companyId) return p;

          const companies = portfolioCompanies[portfolioId] || [];
          const company = companies.find((c) => c.id === companyId);
          if (!company) return p;

          const realPositions = p.positions.filter((pos) => !pos.isPlaceholder);
          let initialWeight: number;

          if (p.evenSplit) {
            const minPos = computeMinPositions(
              p.allocation,
              rules.maxPerStock
            );
            const effectivePos = p.desiredPositions ?? minPos;
            initialWeight = computeEvenSplitWeight(effectivePos);
          } else {
            const usedWeight = realPositions.reduce(
              (sum, pos) => sum + (pos.weight || 0),
              0
            );
            initialWeight = Math.min(20, Math.max(0, 100 - usedWeight));
          }

          const newPosition: BuilderRealPosition = {
            companyId: company.id,
            companyName: company.name,
            weight: initialWeight,
            isPlaceholder: false as const,
          };

          const updatedPositions = [...p.positions, newPosition];

          // If even split, recalculate all weights
          if (p.evenSplit) {
            const minPos = computeMinPositions(
              p.allocation,
              rules.maxPerStock
            );
            const effectivePos = p.desiredPositions ?? minPos;
            const evenWeight = computeEvenSplitWeight(effectivePos);
            return {
              ...p,
              positions: updatedPositions.map((pos) => ({
                ...pos,
                weight: evenWeight,
              })),
              selectedPosition: "",
            };
          }

          return { ...p, positions: updatedPositions, selectedPosition: "" };
        });
        save({ portfolios: next });
        return next;
      });
    },
    [portfolioCompanies, rules.maxPerStock, save]
  );

  const removePosition = useCallback(
    (portfolioId: string, companyId: number) => {
      setPortfolios((prev) => {
        const next = prev.map((p) => {
          if (p.id !== portfolioId) return p;
          const updated = {
            ...p,
            positions: p.positions.filter(
              (pos) => pos.isPlaceholder || pos.companyId !== companyId
            ),
          };

          if (updated.evenSplit) {
            const minPos = computeMinPositions(
              updated.allocation,
              rules.maxPerStock
            );
            const effectivePos = updated.desiredPositions ?? minPos;
            const evenWeight = computeEvenSplitWeight(effectivePos);
            updated.positions = updated.positions.map((pos) => ({
              ...pos,
              weight: evenWeight,
            }));
          }

          return updated;
        });
        save({ portfolios: next });
        return next;
      });
    },
    [rules.maxPerStock, save]
  );

  const setPositionWeight = useCallback(
    (portfolioId: string, companyId: number, weight: number) => {
      setPortfolios((prev) => {
        const next = prev.map((p) => {
          if (p.id !== portfolioId) return p;
          return {
            ...p,
            positions: p.positions.map((pos) =>
              !pos.isPlaceholder && pos.companyId === companyId
                ? { ...pos, weight }
                : pos
            ),
          };
        });
        save({ portfolios: next });
        return next;
      });
    },
    [save]
  );

  // === Computed values ===
  const minPositions = useMemo(() => {
    const result: Record<string, number> = {};
    for (const p of portfolios) {
      result[p.id] = computeMinPositions(p.allocation, rules.maxPerStock);
    }
    return result;
  }, [portfolios, rules.maxPerStock]);

  const effectivePositions = useMemo(() => {
    const result: Record<string, number> = {};
    for (const p of portfolios) {
      result[p.id] = p.desiredPositions ?? minPositions[p.id] ?? 1;
    }
    return result;
  }, [portfolios, minPositions]);

  const currentPositionsMap = useMemo(() => {
    const result: Record<string, number> = {};
    for (const p of portfolios) {
      result[p.id] = portfolioCompanies[p.id]?.length ?? 0;
    }
    return result;
  }, [portfolios, portfolioCompanies]);

  const placeholders = useMemo(() => {
    const result: Record<string, BuilderPlaceholderPosition | null> = {};
    for (const p of portfolios) {
      const realPositions = p.positions.filter(
        (pos): pos is BuilderRealPosition => !pos.isPlaceholder
      );
      result[p.id] = computePlaceholder(
        realPositions,
        currentPositionsMap[p.id] ?? 0,
        effectivePositions[p.id] ?? 1
      );
    }
    return result;
  }, [portfolios, currentPositionsMap, effectivePositions]);

  const availableCompanies = useMemo(() => {
    const result: Record<string, PortfolioCompany[]> = {};
    for (const p of portfolios) {
      const companies = portfolioCompanies[p.id] || [];
      const existingIds = new Set(
        p.positions
          .filter((pos): pos is BuilderRealPosition => !pos.isPlaceholder)
          .map((pos) => pos.companyId)
      );
      result[p.id] = companies.filter((c) => !existingIds.has(c.id));
    }
    return result;
  }, [portfolios, portfolioCompanies]);

  const totalAllocation = useMemo(
    () => computeTotalAllocation(portfolios),
    [portfolios]
  );

  const totalAllocatedAmount = useMemo(
    () =>
      computeTotalAllocatedAmount(portfolios, budget.totalInvestableCapital),
    [portfolios, budget.totalInvestableCapital]
  );

  // === Sort ===
  const setSortOptions = useCallback(
    (opts: SortOptions) => {
      setSortOptionsState(opts);
      save({ sortOptions: opts });
    },
    [save]
  );

  // === Export ===
  const exportCSV = useCallback(() => {
    const csv = buildCSVContent(
      portfolios,
      portfolioCompanies,
      currentPositionsMap,
      effectivePositions,
      budget.totalInvestableCapital
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `allocation_summary_${new Date().toISOString().slice(0, 10)}.csv`;
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [
    portfolios,
    portfolioCompanies,
    currentPositionsMap,
    effectivePositions,
    budget.totalInvestableCapital,
  ]);

  const exportPDF = useCallback(async () => {
    await exportBuilderPDF({
      budget,
      portfolios,
      currentPositionsMap,
      effectivePositions,
      totalAllocation,
      totalAllocatedAmount,
    });
  }, [
    budget,
    portfolios,
    currentPositionsMap,
    effectivePositions,
    totalAllocation,
  totalAllocatedAmount,
  ]);

  // === Initial load ===
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setIsLoading(true);
        setError(null);

        const [portfolioList, metrics, savedState] = await Promise.all([
          apiFetch<PortfolioOption[]>("/portfolios?include_ids=true"),
          apiFetch<PortfolioMetrics>("/portfolio_metrics").catch(
            () => DEFAULT_METRICS
          ),
          apiFetch<BuilderPersistedState>("/state?page=builder").catch(
            () => ({} as BuilderPersistedState)
          ),
        ]);

        if (cancelled) return;

        // Filter out "-" placeholder
        const validPortfolios = portfolioList.filter((p) => p.name !== "-");

        setMetricsState(metrics);

        // Parse saved state
        const savedBudget = tryParse<BudgetData | null>(savedState.budgetData, null);
        const savedRules = tryParse<AllocationRules | null>(savedState.rules, null);
        const savedPortfolios = tryParse<BuilderPortfolio[] | null>(
          savedState.portfolios,
          null
        );
        const savedExpanded = tryParse(savedState.expandedPortfolios, {});
        const savedSort = tryParse<SortOptions | null>(
          savedState.sortOptions,
          null
        );

        // Budget
        let currentBudget: BudgetData;
        if (savedBudget) {
          const derived = computeBudgetDerived(savedBudget);
          currentBudget = {
            totalNetWorth: savedBudget.totalNetWorth,
            alreadyInvested: savedBudget.alreadyInvested,
            emergencyFund: savedBudget.emergencyFund,
            totalInvestableCapital: derived.totalInvestableCapital,
            availableToInvest: derived.availableToInvest,
          };
        } else {
          currentBudget = DEFAULT_BUDGET;
        }
        setBudget(currentBudget);

        // Rules
        const currentRules: AllocationRules = savedRules
          ? {
              maxPerStock: savedRules.maxPerStock ?? DEFAULT_RULES.maxPerStock,
              maxPerETF: savedRules.maxPerETF ?? DEFAULT_RULES.maxPerETF,
              maxPerCrypto: savedRules.maxPerCrypto ?? DEFAULT_RULES.maxPerCrypto,
              maxPerCategory: savedRules.maxPerCategory ?? DEFAULT_RULES.maxPerCategory,
              maxPerCountry: savedRules.maxPerCountry ?? DEFAULT_RULES.maxPerCountry,
            }
          : DEFAULT_RULES;
        setRulesState(currentRules);

        // Portfolios — reconcile saved vs current DB
        let reconciledPortfolios: BuilderPortfolio[];
        if (savedPortfolios && savedPortfolios.length > 0) {
          reconciledPortfolios = reconcilePortfolios(
            savedPortfolios,
            validPortfolios
          );
        } else {
          // First-time: distribute evenly
          const evenAlloc =
            validPortfolios.length > 0
              ? parseFloat((100 / validPortfolios.length).toFixed(2))
              : 0;
          reconciledPortfolios = validPortfolios.map((p) => ({
            id: p.id,
            name: p.name,
            allocation: evenAlloc,
            positions: [],
            evenSplit: false,
            desiredPositions: null,
          }));
        }

        // Load companies for each portfolio in parallel
        const companiesMap: Record<string, PortfolioCompany[]> = {};
        await Promise.all(
          reconciledPortfolios.map(async (p) => {
            try {
              const companies = await apiFetch<PortfolioCompany[]>(
                `/portfolio_companies/${p.id}`
              );
              companiesMap[p.id] = companies;
              p.currentPositions = companies.length;
            } catch {
              companiesMap[p.id] = [];
              p.currentPositions = 0;
            }
          })
        );

        if (cancelled) return;

        // Calculate minPositions for each
        for (const p of reconciledPortfolios) {
          p.minPositions = computeMinPositions(
            p.allocation,
            currentRules.maxPerStock
          );
        }

        setPortfolioCompanies(companiesMap);
        setPortfolios(reconciledPortfolios);
        setExpandedPortfolios(savedExpanded);
        if (savedSort) setSortOptionsState(savedSort);

        // Seed accumulated state so future partial saves POST the full state
        hydrate({
          budgetData: JSON.stringify(currentBudget),
          rules: JSON.stringify(currentRules),
          portfolios: JSON.stringify(stripRuntimeFields(reconciledPortfolios)),
          expandedPortfolios: JSON.stringify(savedExpanded),
          sortOptions: JSON.stringify(
            savedSort ?? { column: "weight", direction: "desc" }
          ),
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load builder data"
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
  }, [hydrate]);

  return {
    isLoading,
    error,
    isSaving,
    budget,
    setBudgetField,
    populateAlreadyInvested,
    rules,
    setRule,
    portfolios,
    portfolioCompanies,
    expandedPortfolios,
    toggleExpanded,
    setAllocation,
    setDesiredPositions,
    setEvenSplit,
    addPosition,
    removePosition,
    setPositionWeight,
    placeholders,
    minPositions,
    effectivePositions,
    availableCompanies,
    portfolioMetrics: metricsState,
    totalAllocation,
    currentPositionsMap,
    totalAllocatedAmount,
    sortOptions,
    setSortOptions,
    exportCSV,
    exportPDF,
    // Expose for portfolio-row to update selectedPosition locally
    setPortfolios,
  };
}
