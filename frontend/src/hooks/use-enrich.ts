"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import {
  filterItems,
  sortItems,
  computeMetrics,
  computeColumnHealth,
  calculateItemValue,
  parseGermanNumber,
  escapeCSVField,
} from "@/lib/enrich-calc";
import type {
  EnrichItem,
  SortState,
  SortColumn,
  PortfolioDropdownItem,
  AddPositionForm,
  IdentifierValidation,
  BulkEditValues,
} from "@/types/enrich";
import { toast } from "sonner";

const INITIAL_ADD_FORM: AddPositionForm = {
  identifier: "",
  name: "",
  portfolio_id: null,
  sector: "",
  investment_type: null,
  country: "",
  shares: "",
  total_value: "",
  total_invested: "",
};

export function useEnrich() {
  const [items, setItems] = useState<EnrichItem[]>([]);
  const [portfolioOptions, setPortfolioOptions] = useState<string[]>([]);
  const [portfolioDropdown, setPortfolioDropdown] = useState<PortfolioDropdownItem[]>([]);
  const [cashBalance, setCashBalance] = useState(0);
  const [builderAvailable, setBuilderAvailable] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & sort
  const [selectedPortfolio, setSelectedPortfolio] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortState>({ column: null, direction: "asc" });

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const lastCheckedIndex = useRef<number | null>(null);

  // --- Data loading ---

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Critical fetches — unblock table rendering
      const [itemsData, portfolios] = await Promise.all([
        apiFetch<EnrichItem[]>("/portfolio_data"),
        apiFetch<string[]>("/portfolios"),
      ]);
      setItems(itemsData);
      setPortfolioOptions(portfolios.filter((p) => p && p !== "-"));
      setIsLoading(false);

      // Deferred fetches — summary bar & add-position dialog
      Promise.all([
        apiFetch<{ success: boolean; cash: number }>("/account/cash").catch(() => ({ success: false, cash: 0 })),
        apiFetch<{ data?: { budget?: { availableToInvest?: number } }; partialData?: { budget?: { availableToInvest?: number } } }>("/builder/investment-targets").catch(() => null),
        apiFetch<{ success: boolean; portfolios: PortfolioDropdownItem[] }>("/portfolios_dropdown").catch(() => ({ success: false, portfolios: [] })),
      ]).then(([cashData, builderData, dropdownData]) => {
        setCashBalance(cashData.cash || 0);
        if (dropdownData?.portfolios) setPortfolioDropdown(dropdownData.portfolios);

        // Extract builder available
        const bd = builderData?.data || builderData;
        const partial = builderData && "partialData" in builderData ? builderData.partialData : null;
        const budget = (bd as Record<string, unknown>)?.budget as Record<string, unknown> | undefined;
        const partialBudget = (partial as Record<string, unknown>)?.budget as Record<string, unknown> | undefined;
        const avail = budget?.availableToInvest ?? partialBudget?.availableToInvest ?? null;
        setBuilderAvailable(typeof avail === "number" ? avail : null);
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load data");
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Derived state ---

  const filteredItems = useMemo(
    () => filterItems(items, selectedPortfolio, searchQuery),
    [items, selectedPortfolio, searchQuery]
  );

  const sortedItems = useMemo(() => sortItems(filteredItems, sort), [filteredItems, sort]);

  const metrics = useMemo(() => computeMetrics(filteredItems), [filteredItems]);
  const columnHealth = useMemo(() => computeColumnHealth(filteredItems), [filteredItems]);
  const portfolioTotal = metrics.totalValue + cashBalance;

  const selectedManualCount = useMemo(() => {
    return items.filter((i) => selectedIds.has(i.id) && i.source === "manual").length;
  }, [items, selectedIds]);

  // --- Actions ---

  const refreshData = useCallback(async () => {
    const [itemsData, portfolios] = await Promise.all([
      apiFetch<EnrichItem[]>("/portfolio_data"),
      apiFetch<string[]>("/portfolios"),
    ]);
    setItems(itemsData);
    setPortfolioOptions(portfolios.filter((p) => p && p !== "-"));
  }, []);

  const saveField = useCallback(
    async (id: number, payload: Record<string, unknown>) => {
      const res = await apiFetch<{ success: boolean; error?: string; data?: Partial<EnrichItem> }>(
        `/update_portfolio/${id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.success) throw new Error(res.error || "Update failed");
      return res;
    },
    []
  );

  const updateItemLocal = useCallback((id: number, updates: Partial<EnrichItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...updates } : i)));
  }, []);

  // --- Field saves ---

  const savePortfolioChange = useCallback(
    async (id: number, portfolio: string) => {
      try {
        await saveField(id, { portfolio: portfolio || "-" });
        updateItemLocal(id, { portfolio });
        toast.success("Portfolio updated");
      } catch {
        toast.error("Failed to update portfolio");
      }
    },
    [saveField, updateItemLocal]
  );

  const saveIdentifierChange = useCallback(
    async (id: number, identifier: string) => {
      await saveField(id, { identifier: identifier || "", is_identifier_user_edit: true });
      updateItemLocal(id, { identifier });
      toast.success("Identifier updated");
      refreshData();
    },
    [saveField, updateItemLocal, refreshData]
  );

  const saveSectorChange = useCallback(
    async (id: number, sector: string) => {
      await saveField(id, { sector: sector || "" });
      updateItemLocal(id, { sector });
      toast.success("Sector updated");
    },
    [saveField, updateItemLocal]
  );

  const saveThesisChange = useCallback(
    async (id: number, thesis: string) => {
      await saveField(id, { thesis: thesis || "" });
      updateItemLocal(id, { thesis });
      toast.success("Thesis updated");
    },
    [saveField, updateItemLocal]
  );

  const saveCompanyChange = useCallback(
    async (id: number, name: string) => {
      await saveField(id, { name: name || "" });
      updateItemLocal(id, { company: name });
      toast.success("Company name updated");
    },
    [saveField, updateItemLocal]
  );

  const saveInvestmentTypeChange = useCallback(
    async (id: number, investment_type: string) => {
      try {
        await saveField(id, { investment_type });
        updateItemLocal(id, { investment_type: investment_type as EnrichItem["investment_type"] });
        toast.success(`Type updated to ${investment_type}`);
      } catch {
        toast.error("Failed to update type");
      }
    },
    [saveField, updateItemLocal]
  );

  const saveCountryChange = useCallback(
    async (id: number, country: string) => {
      try {
        await saveField(id, { country, is_country_user_edit: true });
        updateItemLocal(id, {
          effective_country: country,
          country_manually_edited: true,
          country_manual_edit_date: new Date().toISOString(),
        });
        toast.success("Country updated");
      } catch {
        toast.error("Failed to update country");
      }
    },
    [saveField, updateItemLocal]
  );

  const saveSharesChange = useCallback(
    async (id: number, newShares: string) => {
      const shares = parseFloat(newShares);
      if (isNaN(shares)) {
        toast.error("Shares must be a valid number");
        return;
      }
      const res = await saveField(id, { override_share: shares, is_user_edit: true });
      const effectiveShares = res.data?.override_share ?? shares;
      updateItemLocal(id, {
        is_manually_edited: true,
        csv_modified_after_edit: false,
        override_share: shares,
        effective_shares: effectiveShares as number,
        manual_edit_date: new Date().toISOString(),
      });
      toast.success("Shares updated");
    },
    [saveField, updateItemLocal]
  );

  const saveTotalValueChange = useCallback(
    async (id: number, rawValue: string) => {
      const totalValue = parseGermanNumber(rawValue);
      if (isNaN(totalValue) || totalValue < 0) {
        toast.error("Total value must be a valid positive number");
        return;
      }
      const item = items.find((i) => i.id === id);
      const customPrice = item && item.effective_shares > 0 ? totalValue / item.effective_shares : 0;
      await saveField(id, {
        custom_total_value: totalValue,
        custom_price_eur: customPrice,
        is_custom_value_edit: true,
      });
      updateItemLocal(id, {
        custom_total_value: totalValue,
        custom_price_eur: customPrice,
        is_custom_value: true,
      });
      toast.success("Total value updated");
    },
    [saveField, updateItemLocal, items]
  );

  // --- Resets ---

  const resetIdentifier = useCallback(
    async (id: number) => {
      await saveField(id, { reset_identifier: true });
      toast.success("Identifier reset");
      refreshData();
    },
    [saveField, refreshData]
  );

  const resetCountry = useCallback(
    async (id: number) => {
      const res = await saveField(id, { reset_country: true });
      if (res.data) {
        updateItemLocal(id, {
          effective_country: (res.data as Record<string, string>).effective_country,
          country_manually_edited: false,
          country_manual_edit_date: null,
        });
      }
      toast.success("Country reset");
    },
    [saveField, updateItemLocal]
  );

  const resetShares = useCallback(
    async (id: number) => {
      await saveField(id, { reset_shares: true });
      const item = items.find((i) => i.id === id);
      if (item) {
        updateItemLocal(id, {
          override_share: null,
          effective_shares: item.shares,
          is_manually_edited: false,
          csv_modified_after_edit: false,
        });
      }
      toast.success("Shares reset");
    },
    [saveField, updateItemLocal, items]
  );

  const resetCustomValue = useCallback(
    async (id: number) => {
      await saveField(id, { reset_custom_value: true });
      updateItemLocal(id, {
        custom_total_value: null,
        custom_price_eur: null,
        is_custom_value: false,
      });
      const item = items.find((i) => i.id === id);
      toast.success(item?.price_eur ? "Reset to market price" : "Custom value cleared");
    },
    [saveField, updateItemLocal, items]
  );

  // --- Cash ---

  const saveCash = useCallback(async (amount: number) => {
    const res = await apiFetch<{ success: boolean; cash: number }>("/account/cash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cash: amount }),
    });
    if (res.success) {
      setCashBalance(res.cash);
      toast.success("Cash balance updated");
    }
  }, []);

  const useBuilderAsCash = useCallback(async () => {
    if (builderAvailable != null) {
      await saveCash(builderAvailable);
    }
  }, [builderAvailable, saveCash]);

  // --- Bulk edit ---

  const applyBulkEdit = useCallback(
    async (ids: number[], values: BulkEditValues) => {
      const selectedItems = items.filter((i) => ids.includes(i.id));
      const updateData = selectedItems.map((item) => {
        const update: Record<string, unknown> = {
          id: item.id,
          company: item.company,
          portfolio: values.portfolio || item.portfolio,
          sector: values.sector !== "" ? values.sector : item.sector,
          thesis: values.thesis !== "" ? values.thesis : item.thesis,
          country: values.country !== "" ? values.country : item.effective_country,
          is_country_user_edit: values.country !== "",
          identifier: item.identifier,
        };
        if (values.investmentType) update.investment_type = values.investmentType;
        return update;
      });

      const res = await apiFetch<{ success: boolean; error?: string }>("/bulk_update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });
      if (!res.success) throw new Error(res.error || "Bulk update failed");
      toast.success(`Updated ${ids.length} items`);
      await refreshData();
      setSelectedIds(new Set());
    },
    [items, refreshData]
  );

  const deleteCompanies = useCallback(
    async (ids: number[]) => {
      const manualIds = items
        .filter((i) => ids.includes(i.id) && i.source === "manual")
        .map((i) => i.id);
      if (manualIds.length === 0) return;

      const res = await apiFetch<{ success: boolean; deleted_count: number }>("/delete_companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_ids: manualIds }),
      });
      if (res.success) {
        setItems((prev) => prev.filter((i) => !manualIds.includes(i.id)));
        setSelectedIds(new Set());
        toast.success(`Deleted ${res.deleted_count} position(s)`);
      }
    },
    [items]
  );

  // --- Identifier validation ---

  const validateIdentifier = useCallback(async (identifier: string): Promise<IdentifierValidation> => {
    if (!identifier.trim()) {
      return { loading: false, status: null, priceData: null };
    }
    try {
      const res = await apiFetch<{ success: boolean; price_data?: IdentifierValidation["priceData"] }>(
        `/validate_identifier?identifier=${encodeURIComponent(identifier)}`
      );
      return {
        loading: false,
        status: res.success ? "valid" : "invalid",
        priceData: res.price_data ?? null,
      };
    } catch {
      return { loading: false, status: "invalid", priceData: null };
    }
  }, []);

  // --- Add position ---

  const addPosition = useCallback(
    async (form: AddPositionForm) => {
      const shares = parseGermanNumber(form.shares);
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        identifier: form.identifier.trim() || null,
        portfolio_id: form.portfolio_id,
        sector: form.sector.trim(),
        investment_type: form.investment_type,
        country: form.country || null,
        shares,
      };
      if (form.total_value.trim()) {
        payload.total_value = parseGermanNumber(form.total_value);
      }
      if (form.total_invested.trim()) {
        payload.total_invested = parseGermanNumber(form.total_invested);
      }

      const res = await apiFetch<{
        success: boolean;
        message?: string;
        error?: string;
        existing?: { name: string; portfolio_name: string };
      }>("/add_company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.success) {
        toast.success(res.message || "Position added");
        await refreshData();
        return { success: true as const };
      }
      if (res.error === "duplicate") {
        return {
          success: false as const,
          error: `A company named "${res.existing?.name}" already exists in portfolio "${res.existing?.portfolio_name}". Please edit the existing entry instead.`,
        };
      }
      return { success: false as const, error: res.error || "Failed to add position" };
    },
    [refreshData]
  );

  // --- Portfolio management ---

  const managePortfolio = useCallback(
    async (action: string, params: Record<string, string>) => {
      const formData = new FormData();
      formData.append("action", action);
      Object.entries(params).forEach(([k, v]) => formData.append(k, v));

      const res = await fetch("/manage-portfolios", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const result = await res.json();
      if (result.success) {
        if (result.portfolios) setPortfolioOptions(result.portfolios);
        toast.success(result.message);
        await refreshData();
      } else {
        toast.error(result.message || "Action failed");
      }
      return result;
    },
    [refreshData]
  );

  // --- Price updates ---

  const [isPriceUpdating, setIsPriceUpdating] = useState(false);
  const pricePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPricePolling = useCallback(() => {
    if (pricePollingRef.current) {
      clearInterval(pricePollingRef.current);
      pricePollingRef.current = null;
    }
  }, []);

  const startPricePolling = useCallback(() => {
    setIsPriceUpdating(true);
    stopPricePolling();
    pricePollingRef.current = setInterval(async () => {
      try {
        const progress = await apiFetch<{ status: string; progress?: number; total?: number }>(
          "/price_fetch_progress"
        );
        if (progress.status === "completed" || progress.status === "failed") {
          stopPricePolling();
          setIsPriceUpdating(false);
          await refreshData();
          toast.success(
            progress.status === "completed"
              ? "Prices updated successfully"
              : "Price update finished with errors"
          );
        }
      } catch {
        stopPricePolling();
        setIsPriceUpdating(false);
      }
    }, 1500);
  }, [refreshData, stopPricePolling]);

  // Cleanup polling on unmount
  useEffect(() => stopPricePolling, [stopPricePolling]);

  const updateAllPrices = useCallback(async () => {
    await apiFetch("/update_all_prices", { method: "POST" });
    toast.success("Price update started");
    startPricePolling();
  }, [startPricePolling]);

  const updateSelectedPrices = useCallback(
    async (ids: number[]) => {
      await apiFetch("/update_selected_prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_ids: ids }),
      });
      toast.success("Updating selected prices...");
      startPricePolling();
    },
    [startPricePolling]
  );

  // --- CSV export ---

  const downloadCSV = useCallback(() => {
    const data = sortedItems;
    if (data.length === 0) {
      toast.error("No data to export");
      return;
    }
    const headers = ["Identifier", "Company", "Portfolio", "Sector", "Shares", "Price (EUR)", "Total Value (EUR)", "Total Invested (EUR)", "Last Updated"];
    const rows = [headers.join(",")];
    for (const item of data) {
      rows.push(
        [
          escapeCSVField(item.identifier || ""),
          escapeCSVField(item.company || ""),
          escapeCSVField(item.portfolio || ""),
          escapeCSVField(item.sector || ""),
          escapeCSVField(item.effective_shares || 0),
          escapeCSVField(item.price_eur || 0),
          escapeCSVField(calculateItemValue(item).toFixed(2)),
          escapeCSVField(item.total_invested || 0),
          escapeCSVField(item.last_updated || ""),
        ].join(",")
      );
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = new Date().toISOString().split("T")[0];
    const suffix = selectedPortfolio ? `_${selectedPortfolio}` : "";
    a.href = url;
    a.download = `portfolio_data${suffix}_${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`CSV downloaded with ${data.length} records`);
  }, [sortedItems, selectedPortfolio]);

  // --- Sort ---

  const toggleSort = useCallback((column: SortColumn) => {
    setSort((prev) => ({
      column,
      direction: prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  // --- Selection ---

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = sortedItems.every((i) => prev.has(i.id));
      if (allSelected) return new Set();
      return new Set(sortedItems.map((i) => i.id));
    });
  }, [sortedItems]);

  const toggleSelect = useCallback(
    (id: number, index: number, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (shiftKey && lastCheckedIndex.current !== null) {
          const start = Math.min(lastCheckedIndex.current, index);
          const end = Math.max(lastCheckedIndex.current, index);
          for (let i = start; i <= end; i++) {
            next.add(sortedItems[i].id);
          }
        } else {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        lastCheckedIndex.current = index;
        return next;
      });
    },
    [sortedItems]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastCheckedIndex.current = null;
  }, []);

  return {
    // Data
    items,
    sortedItems,
    filteredItems,
    metrics,
    columnHealth,
    portfolioOptions,
    portfolioDropdown,
    cashBalance,
    builderAvailable,
    portfolioTotal,
    isLoading,
    error,

    // Filters
    selectedPortfolio,
    setSelectedPortfolio,
    searchQuery,
    setSearchQuery,
    sort,
    toggleSort,

    // Selection
    selectedIds,
    selectedManualCount,
    toggleSelectAll,
    toggleSelect,
    clearSelection,

    // Field saves
    savePortfolioChange,
    saveIdentifierChange,
    saveSectorChange,
    saveThesisChange,
    saveCompanyChange,
    saveInvestmentTypeChange,
    saveCountryChange,
    saveSharesChange,
    saveTotalValueChange,

    // Resets
    resetIdentifier,
    resetCountry,
    resetShares,
    resetCustomValue,

    // Cash
    saveCash,
    useBuilderAsCash,

    // Bulk
    applyBulkEdit,
    deleteCompanies,

    // Identifier validation
    validateIdentifier,

    // Add position
    addPosition,

    // Portfolio management
    managePortfolio,

    // Prices
    isPriceUpdating,
    updateAllPrices,
    updateSelectedPrices,

    // CSV
    downloadCSV,

    // Refresh
    refreshData,
  };
}
