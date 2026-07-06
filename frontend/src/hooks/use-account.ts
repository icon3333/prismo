"use client";

import { useCallback, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { useApiQuery } from "@/lib/api-cache";
import type { AccountInfo } from "@/types/account";
import { toast } from "sonner";

export function useAccount() {
  // Shared cached read — revalidated automatically after every successful write.
  const accountQuery = useApiQuery<AccountInfo & { success: boolean }>("/account");

  const account = useMemo<AccountInfo | null>(() => {
    const data = accountQuery.data;
    if (!data) return null;
    return {
      username: data.username,
      account_id: data.account_id,
      created_at: data.created_at,
      last_price_update: data.last_price_update,
    };
  }, [accountQuery.data]);

  const updateUsername = useCallback(async (username: string) => {
    await apiFetch("/account/username", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    toast.success("Username updated");
  }, []);

  const resetSettings = useCallback(async () => {
    await apiFetch("/account/reset-settings", { method: "POST" });
    toast.success("Account settings reset");
  }, []);

  const deleteStocksCrypto = useCallback(async () => {
    await apiFetch("/account/delete-stocks-crypto", { method: "POST" });
    toast.success("All stocks and crypto deleted");
  }, []);

  const deleteAccount = useCallback(async () => {
    await apiFetch("/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "DELETE" }),
    });
    toast.success("Account deleted");
    window.location.href = "/";
  }, []);

  const importData = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    await apiFetch("/account/import", {
      method: "POST",
      body: formData,
    });
    toast.success("Data imported successfully");
  }, []);

  return {
    account,
    loading: accountQuery.isLoading,
    error: accountQuery.error,
    updateUsername,
    resetSettings,
    deleteStocksCrypto,
    deleteAccount,
    importData,
  };
}
