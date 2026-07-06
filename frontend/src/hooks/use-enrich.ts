"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, apiPostForm, ApiError } from "@/lib/api";
import { useApiQuery, invalidateApiCache } from "@/lib/api-cache";
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

interface BuilderTargetsResponse {
  data?: { budget?: { availableToInvest?: number } };
  partialData?: { budget?: { availableToInvest?: number } };
}

export function useEnrich() {
  // Shared cached reads — served instantly when cached, revalidated in the
  // background; every successful write through the api layer refreshes them.
  const itemsQuery = useApiQuery<EnrichItem[]>("/portfolio_data");
  const portfoliosQuery = useApiQuery<string[]>("/portfolios");
  const cashQuery = useApiQuery<{ success: boolean; cash: number }>("/account/cash");
  const builderQuery = useApiQuery<BuilderTargetsResponse>("/builder/investment-targets");
  const dropdownQuery = useApiQuery<{ success: boolean; portfolios: PortfolioDropdownItem[] }>(
    "/portfolios_dropdown"
  );
  const { refetch: refetchItems } = itemsQuery;

  // Local copy of holdings so inline saves can update rows optimistically;
  // re-synced from the cache whenever a refetch lands.
  const [items, setItems] = useState<EnrichItem[]>([]);
  const { data: serverItems } = itemsQuery;
  useEffect(() => {
    const sync = () => {
      if (serverItems) setItems(serverItems);
    };
    sync();
  }, [serverItems]);

  const portfolioOptions = useMemo(
    () => (portfoliosQuery.data ?? []).filter((p) => p && p !== "-"),
    [portfoliosQuery.data]
  );
  const portfolioDropdown = useMemo(
    () => dropdownQuery.data?.portfolios ?? [],
    [dropdownQuery.data]
  );

  // Cash keeps a local shadow so saveCash can apply the server-confirmed
  // value immediately without waiting for the invalidation refetch.
  const [cashBalance, setCashBalance] = useState(0);
  const serverCash = cashQuery.data?.cash;
  useEffect(() => {
    const sync = () => {
      if (serverCash !== undefined) setCashBalance(serverCash || 0);
    };
    sync();
  }, [serverCash]);

  const builderAvailable = useMemo<number | null>(() => {
    const builderData = builderQuery.data;
    if (!builderData) return null;
    const bd = builderData.data || builderData;
    const partial = "partialData" in builderData ? builderData.partialData : null;
    const budget = (bd as Record<string, unknown>)?.budget as Record<string, unknown> | undefined;
    const partialBudget = (partial as Record<string, unknown>)?.budget as Record<string, unknown> | undefined;
    const avail = budget?.availableToInvest ?? partialBudget?.availableToInvest ?? null;
    return typeof avail === "number" ? avail : null;
  }, [builderQuery.data]);

  const isLoading = itemsQuery.isLoading || portfoliosQuery.isLoading;
  const error = itemsQuery.error ?? portfoliosQuery.error;

  // Filters & sort.
  // selectedPortfolio (name) is derived from `?portfolio=<id>` in the URL,
  // resolved against the loaded portfolioDropdown list. The Masthead-less
  // PortfolioPicker in the page header is the only writer.
  const searchParams = useSearchParams();
  const portfolioIdFromUrl = searchParams.get("portfolio");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortState>({ column: null, direction: "asc" });

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const lastCheckedIndex = useRef<number | null>(null);

  // --- Derived state ---

  // Resolve URL `?portfolio=<id>` → portfolio name. Picker writes IDs; the
  // legacy filter function expects names, so we translate via the dropdown.
  // "all" or missing param both mean "no filter".
  const selectedPortfolio = useMemo<string | null>(() => {
    if (!portfolioIdFromUrl || portfolioIdFromUrl === "all") return null;
    const match = portfolioDropdown.find(
      (p) => String(p.id) === portfolioIdFromUrl
    );
    return match?.name ?? null;
  }, [portfolioIdFromUrl, portfolioDropdown]);

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

  // Full refresh: drop every cached read and refetch the subscribed ones.
  // Used after background jobs (CSV import, price updates) that change data
  // outside a request the api layer could observe.
  const refreshData = useCallback(() => invalidateApiCache(), []);

  const saveField = useCallback(
    async (id: number, payload: Record<string, unknown>) => {
      const res = await apiFetch<{
        success: boolean;
        error?: string;
        data?: { item: EnrichItem | null };
      }>(`/update_portfolio/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.success) throw new Error(res.error || "Update failed");
      return res;
    },
    []
  );

  const updateItemLocal = useCallback((id: number, updates: Partial<EnrichItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...updates } : i)));
  }, []);

  // Apply the authoritative item returned by the update endpoint (including
  // server-computed current_value/value_source). An explicit null means the
  // position no longer appears in holdings (e.g. shares zeroed out), so the
  // row is removed — matching what a refetch would show. The optimistic
  // fallback only applies if the server returned no item payload at all.
  const applyServerItem = useCallback(
    (id: number, data: { item: EnrichItem | null } | undefined, fallback: Partial<EnrichItem>) => {
      if (data && data.item && data.item.id === id) {
        updateItemLocal(id, data.item);
      } else if (data && data.item === null) {
        setItems((prev) => prev.filter((i) => i.id !== id));
      } else {
        updateItemLocal(id, fallback);
      }
    },
    [updateItemLocal]
  );

  // --- Field saves ---

  // Every save follows the same shape: optimistic local update on success,
  // toast.error + refetch (roll back to server truth) on failure. Saves
  // driven by useInlineEdit re-throw so the cell reverts immediately even
  // when the refetched server value is unchanged.

  const savePortfolioChange = useCallback(
    async (id: number, portfolio: string) => {
      try {
        await saveField(id, { portfolio: portfolio || "-" });
        updateItemLocal(id, { portfolio });
        toast.success("Portfolio updated");
      } catch {
        toast.error("Failed to update portfolio");
        void refetchItems();
      }
    },
    [saveField, updateItemLocal, refetchItems]
  );

  const saveIdentifierChange = useCallback(
    async (id: number, identifier: string) => {
      try {
        await saveField(id, { identifier: identifier || "", is_identifier_user_edit: true });
        updateItemLocal(id, { identifier });
        toast.success("Identifier updated");
      } catch (err) {
        toast.error("Failed to update identifier");
        void refetchItems();
        throw err;
      }
    },
    [saveField, updateItemLocal, refetchItems]
  );

  const saveSectorChange = useCallback(
    async (id: number, sector: string) => {
      try {
        await saveField(id, { sector: sector || "" });
        updateItemLocal(id, { sector });
        toast.success("Sector updated");
      } catch (err) {
        toast.error("Failed to update sector");
        void refetchItems();
        throw err;
      }
    },
    [saveField, updateItemLocal, refetchItems]
  );

  const saveThesisChange = useCallback(
    async (id: number, thesis: string) => {
      try {
        await saveField(id, { thesis: thesis || "" });
        updateItemLocal(id, { thesis });
        toast.success("Thesis updated");
      } catch (err) {
        toast.error("Failed to update thesis");
        void refetchItems();
        throw err;
      }
    },
    [saveField, updateItemLocal, refetchItems]
  );

  const saveCompanyChange = useCallback(
    async (id: number, name: string) => {
      try {
        await saveField(id, { name: name || "" });
        updateItemLocal(id, { company: name });
        toast.success("Company name updated");
      } catch (err) {
        toast.error("Failed to update company name");
        void refetchItems();
        throw err;
      }
    },
    [saveField, updateItemLocal, refetchItems]
  );

  const saveInvestmentTypeChange = useCallback(
    async (id: number, investment_type: string) => {
      try {
        await saveField(id, { investment_type });
        updateItemLocal(id, { investment_type: investment_type as EnrichItem["investment_type"] });
        toast.success(`Type updated to ${investment_type}`);
      } catch {
        toast.error("Failed to update type");
        void refetchItems();
      }
    },
    [saveField, updateItemLocal, refetchItems]
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
        void refetchItems();
      }
    },
    [saveField, updateItemLocal, refetchItems]
  );

  const saveSharesChange = useCallback(
    async (id: number, newShares: string) => {
      const shares = parseFloat(newShares);
      if (isNaN(shares)) {
        toast.error("Shares must be a valid number");
        return;
      }
      try {
        const res = await saveField(id, { override_share: shares, is_user_edit: true });
        applyServerItem(id, res.data, {
          is_manually_edited: true,
          csv_modified_after_edit: false,
          override_share: shares,
          effective_shares: shares,
          manual_edit_date: new Date().toISOString(),
        });
        toast.success("Shares updated");
      } catch (err) {
        toast.error("Failed to update shares");
        void refetchItems();
        throw err;
      }
    },
    [saveField, applyServerItem, refetchItems]
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
      try {
        const res = await saveField(id, {
          custom_total_value: totalValue,
          custom_price_eur: customPrice,
          is_custom_value_edit: true,
        });
        applyServerItem(id, res.data, {
          custom_total_value: totalValue,
          custom_price_eur: customPrice,
          is_custom_value: true,
          current_value: totalValue,
          value_source: "custom",
        });
        toast.success("Total value updated");
      } catch (err) {
        toast.error("Failed to update total value");
        void refetchItems();
        throw err;
      }
    },
    [saveField, applyServerItem, items, refetchItems]
  );

  // --- Resets ---

  const resetIdentifier = useCallback(
    async (id: number) => {
      try {
        await saveField(id, { reset_identifier: true });
        toast.success("Identifier reset");
      } catch {
        toast.error("Failed to reset identifier");
        void refetchItems();
      }
    },
    [saveField, refetchItems]
  );

  const resetCountry = useCallback(
    async (id: number) => {
      try {
        const res = await saveField(id, { reset_country: true });
        applyServerItem(id, res.data, {
          country_manually_edited: false,
          country_manual_edit_date: null,
        });
        toast.success("Country reset");
      } catch {
        toast.error("Failed to reset country");
        void refetchItems();
      }
    },
    [saveField, applyServerItem, refetchItems]
  );

  const resetShares = useCallback(
    async (id: number) => {
      try {
        const res = await saveField(id, { reset_shares: true });
        const item = items.find((i) => i.id === id);
        applyServerItem(id, res.data, {
          override_share: null,
          effective_shares: item ? item.shares : 0,
          is_manually_edited: false,
          csv_modified_after_edit: false,
        });
        toast.success("Shares reset");
      } catch {
        toast.error("Failed to reset shares");
        void refetchItems();
      }
    },
    [saveField, applyServerItem, items, refetchItems]
  );

  const resetCustomValue = useCallback(
    async (id: number) => {
      try {
        const res = await saveField(id, { reset_custom_value: true });
        applyServerItem(id, res.data, {
          custom_total_value: null,
          custom_price_eur: null,
          is_custom_value: false,
        });
        const item = items.find((i) => i.id === id);
        toast.success(item?.price_eur ? "Reset to market price" : "Custom value cleared");
      } catch {
        toast.error("Failed to reset custom value");
        void refetchItems();
      }
    },
    [saveField, applyServerItem, items, refetchItems]
  );

  // --- Cash ---

  const saveCash = useCallback(async (amount: number) => {
    try {
      const res = await apiFetch<{ success: boolean; cash: number }>("/account/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cash: amount }),
      });
      if (!res.success) throw new Error("Update failed");
      setCashBalance(res.cash);
      toast.success("Cash balance updated");
    } catch {
      toast.error("Failed to update cash balance");
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

      try {
        const res = await apiFetch<{ success: boolean; error?: string }>("/bulk_update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        });
        if (!res.success) throw new Error(res.error || "Bulk update failed");
        toast.success(`Updated ${ids.length} items`);
        setSelectedIds(new Set());
      } catch {
        toast.error("Failed to update items");
        void refetchItems();
      }
    },
    [items, refetchItems]
  );

  const deleteCompanies = useCallback(
    async (ids: number[]) => {
      const manualIds = items
        .filter((i) => ids.includes(i.id) && i.source === "manual")
        .map((i) => i.id);
      if (manualIds.length === 0) return;

      try {
        const res = await apiFetch<{ success: boolean; deleted_count: number }>("/delete_companies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company_ids: manualIds }),
        });
        if (!res.success) throw new Error("Delete failed");
        setItems((prev) => prev.filter((i) => !manualIds.includes(i.id)));
        setSelectedIds(new Set());
        toast.success(`Deleted ${res.deleted_count} position(s)`);
      } catch {
        toast.error("Failed to delete positions");
        void refetchItems();
      }
    },
    [items, refetchItems]
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

      try {
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
          return { success: true as const };
        }
        if (res.error === "duplicate") {
          return {
            success: false as const,
            error: `A company named "${res.existing?.name}" already exists in portfolio "${res.existing?.portfolio_name}". Please edit the existing entry instead.`,
          };
        }
        return { success: false as const, error: res.error || "Failed to add position" };
      } catch (err) {
        return {
          success: false as const,
          error: err instanceof ApiError ? err.message : "Failed to add position",
        };
      }
    },
    []
  );

  // --- Portfolio management ---

  const managePortfolio = useCallback(
    async (action: string, params: Record<string, string>) => {
      const formData = new FormData();
      formData.append("action", action);
      Object.entries(params).forEach(([k, v]) => formData.append(k, v));

      try {
        const result = await apiPostForm<{ success: boolean; message?: string }>(
          "/api/manage_portfolios",
          formData
        );
        if (result.success) {
          toast.success(result.message || "Portfolios updated");
        } else {
          toast.error(result.message || "Action failed");
        }
        return result;
      } catch {
        toast.error("Failed to manage portfolios");
        return { success: false };
      }
    },
    []
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
          // Background job changed prices outside a tracked write — drop the
          // whole cache so every page picks up the new values.
          await invalidateApiCache();
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
  }, [stopPricePolling]);

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
