"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import {
  computeBudgetDerived,
  computeMinPositions,
  computeEvenSplitWeight,
  computePlaceholder,
  computePortfolioAmount,
  computeTotalAllocation,
  computeTotalAllocatedAmount,
  computeSummaryGroups,
  reconcilePortfolios,
  buildCSVContent,
  formatCurrencyRaw,
  formatNumber,
} from "@/lib/builder-calc";
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

interface PersistedState {
  budgetData?: string;
  rules?: string;
  portfolios?: string;
  expandedPortfolios?: string;
  sortOptions?: string;
}

function tryParse<T>(json: string | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function stripRuntimeFields(
  portfolios: BuilderPortfolio[]
): Array<Omit<BuilderPortfolio, "minPositions" | "currentPositions" | "selectedPosition">> {
  return portfolios.map(
    ({ minPositions, currentPositions, selectedPosition, ...rest }) => rest
  );
}

export function useBuilder() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  // Debounced persist
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingRef = useRef<{
    budget: BudgetData;
    rules: AllocationRules;
    portfolios: BuilderPortfolio[];
    expandedPortfolios: Record<string, boolean>;
    sortOptions: SortOptions;
  }>({
    budget: DEFAULT_BUDGET,
    rules: DEFAULT_RULES,
    portfolios: [],
    expandedPortfolios: {},
    sortOptions: { column: "weight", direction: "desc" },
  });

  const persistState = useCallback(
    (updates: {
      budget?: BudgetData;
      rules?: AllocationRules;
      portfolios?: BuilderPortfolio[];
      expandedPortfolios?: Record<string, boolean>;
      sortOptions?: SortOptions;
    }) => {
      pendingRef.current = {
        budget: updates.budget ?? pendingRef.current.budget,
        rules: updates.rules ?? pendingRef.current.rules,
        portfolios: updates.portfolios ?? pendingRef.current.portfolios,
        expandedPortfolios: updates.expandedPortfolios ?? pendingRef.current.expandedPortfolios,
        sortOptions: updates.sortOptions ?? pendingRef.current.sortOptions,
      };

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        const payload = pendingRef.current;
        setIsSaving(true);
        try {
          await apiFetch("/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              page: "builder",
              budgetData: JSON.stringify(payload.budget),
              rules: JSON.stringify(payload.rules),
              portfolios: JSON.stringify(stripRuntimeFields(payload.portfolios)),
              expandedPortfolios: JSON.stringify(payload.expandedPortfolios),
              sortOptions: JSON.stringify(payload.sortOptions),
            }),
          });
        } catch {
          // Silently fail
        } finally {
          setIsSaving(false);
        }
      }, 500);
    },
    []
  );

  // Helper to persist current + partial update
  const save = useCallback(
    (partial: {
      budget?: BudgetData;
      rules?: AllocationRules;
      portfolios?: BuilderPortfolio[];
      expandedPortfolios?: Record<string, boolean>;
      sortOptions?: SortOptions;
    }) => {
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
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();

    doc.setProperties({ title: "Portfolio Allocation Summary", creator: "Prismo" });

    const colors = {
      primary: [33, 37, 41] as [number, number, number],
      secondary: [108, 117, 125] as [number, number, number],
      light: [248, 249, 250] as [number, number, number],
      accent: [6, 182, 212] as [number, number, number],
    };

    // Header
    doc.setFillColor(...colors.primary);
    doc.rect(0, 0, 210, 35, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont("helvetica", "normal");
    doc.text("Portfolio Allocation Summary", 20, 22);
    doc.setFontSize(10);
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    doc.text(`Generated ${today}`, 20, 30);

    doc.setTextColor(...colors.primary);

    // Budget overview
    let yPosition = 45;
    doc.setFontSize(16);
    doc.text("Investment Overview", 20, yPosition);
    yPosition += 10;

    const cardWidth = 42;
    const cardHeight = 25;
    const cardSpacing = 5;

    const budgetItems = [
      { label: "Net Worth", value: formatCurrencyRaw(budget.totalNetWorth) },
      { label: "Invested", value: formatCurrencyRaw(budget.alreadyInvested) },
      { label: "Emergency", value: formatCurrencyRaw(budget.emergencyFund) },
      { label: "Available", value: formatCurrencyRaw(budget.availableToInvest) },
    ];

    budgetItems.forEach((item, index) => {
      const x = 20 + index * (cardWidth + cardSpacing);
      doc.setFillColor(...colors.light);
      doc.roundedRect(x, yPosition, cardWidth, cardHeight, 2, 2, "F");
      doc.setDrawColor(...colors.secondary);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, yPosition, cardWidth, cardHeight, 2, 2, "S");
      doc.setTextColor(...colors.secondary);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(item.label, x + 3, yPosition + 8);
      doc.setTextColor(...colors.primary);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      const tw = doc.getTextWidth(item.value);
      doc.text(item.value, x + cardWidth - tw - 3, yPosition + 18);
    });

    yPosition += cardHeight + 15;

    // Allocation table
    doc.setTextColor(...colors.primary);
    doc.setFontSize(16);
    doc.setFont("helvetica", "normal");
    doc.text("Portfolio Allocations", 20, yPosition);
    yPosition += 10;

    const tableWidth = 170;
    const rowHeight = 8;
    const headerHeight = 12;
    const columns = [
      { header: "Portfolio", width: 40, align: "left" as const },
      { header: "Position", width: 50, align: "left" as const },
      { header: "Global %", width: 20, align: "right" as const },
      { header: "Portfolio %", width: 22, align: "right" as const },
      { header: "Amount", width: 38, align: "right" as const },
    ];

    // Table header
    doc.setFillColor(...colors.primary);
    doc.rect(20, yPosition, tableWidth, headerHeight, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    let xPos = 20;
    columns.forEach((col) => {
      const textX = col.align === "right" ? xPos + col.width - 3 : xPos + 3;
      doc.text(col.header, textX, yPosition + 8, { align: col.align });
      xPos += col.width;
    });
    yPosition += headerHeight;

    let rowIndex = 0;

    for (const portfolio of portfolios) {
      if (yPosition > 260) {
        doc.addPage();
        yPosition = 30;
        rowIndex = 0;
      }

      const portfolioAmount = computePortfolioAmount(
        portfolio.allocation,
        budget.totalInvestableCapital
      );

      // Portfolio row
      const bgColor = rowIndex % 2 === 0 ? [255, 255, 255] : colors.light;
      doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
      doc.rect(20, yPosition, tableWidth, rowHeight + 2, "F");
      doc.setTextColor(...colors.primary);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");

      const portfolioRow = [
        portfolio.name,
        "",
        `${portfolio.allocation.toFixed(1)}%`,
        "100%",
        formatCurrencyRaw(portfolioAmount),
      ];

      xPos = 20;
      portfolioRow.forEach((data, colIndex) => {
        const textX =
          columns[colIndex].align === "right"
            ? xPos + columns[colIndex].width - 3
            : xPos + 3;
        doc.text(data, textX, yPosition + 6, { align: columns[colIndex].align });
        xPos += columns[colIndex].width;
      });
      yPosition += rowHeight + 2;
      rowIndex++;

      // Position rows
      const groups = computeSummaryGroups(
        portfolio,
        currentPositionsMap[portfolio.id] ?? 0,
        effectivePositions[portfolio.id] ?? 0,
        budget.totalInvestableCapital
      );

      for (const group of groups) {
        if (yPosition > 260) {
          doc.addPage();
          yPosition = 30;
          rowIndex = 0;
        }

        const rowBg = rowIndex % 2 === 0 ? [255, 255, 255] : colors.light;
        doc.setFillColor(rowBg[0], rowBg[1], rowBg[2]);
        doc.rect(20, yPosition, tableWidth, rowHeight, "F");
        doc.setTextColor(...colors.secondary);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");

        const suffix = group.eachSuffix ? " each" : "";
        const displayName =
          group.companyName.length > 30
            ? group.companyName.substring(0, 27) + "..."
            : group.companyName;

        const posRow = [
          "",
          displayName,
          `${group.globalPct.toFixed(1)}%${suffix}`,
          `${group.portfolioPct.toFixed(1)}%${suffix}`,
          `${formatCurrencyRaw(group.amount)}${suffix}`,
        ];

        xPos = 20;
        posRow.forEach((data, colIndex) => {
          const textX =
            columns[colIndex].align === "right"
              ? xPos + columns[colIndex].width - 3
              : xPos + 3;
          doc.text(data, textX, yPosition + 5, { align: columns[colIndex].align });
          xPos += columns[colIndex].width;
        });
        yPosition += rowHeight;
        rowIndex++;
      }

      yPosition += 2;
    }

    // Total row
    if (yPosition > 260) {
      doc.addPage();
      yPosition = 30;
    }
    yPosition += 5;
    doc.setFillColor(...colors.accent);
    doc.rect(20, yPosition, tableWidth, rowHeight + 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");

    const totalRow = [
      "TOTAL ALLOCATION",
      "",
      `${totalAllocation.toFixed(1)}%`,
      "\u2014",
      formatCurrencyRaw(totalAllocatedAmount),
    ];

    xPos = 20;
    totalRow.forEach((data, colIndex) => {
      const textX =
        columns[colIndex].align === "right"
          ? xPos + columns[colIndex].width - 3
          : xPos + 3;
      doc.text(data, textX, yPosition + 6, { align: columns[colIndex].align });
      xPos += columns[colIndex].width;
    });

    // Footer
    const pageHeight = doc.internal.pageSize.height;
    doc.setTextColor(...colors.secondary);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("Generated by Prismo", 20, pageHeight - 10);

    doc.save(
      `allocation_summary_${new Date().toISOString().slice(0, 10)}.pdf`
    );
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
          apiFetch<PersistedState>("/state?page=builder").catch(
            () => ({} as PersistedState)
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

        // Seed pending ref for future saves
        pendingRef.current = {
          budget: currentBudget,
          rules: currentRules,
          portfolios: reconciledPortfolios,
          expandedPortfolios: savedExpanded,
          sortOptions: savedSort ?? { column: "weight", direction: "desc" },
        };
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
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

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
