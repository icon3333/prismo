"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import type { AccountInfo } from "@/types/account";
import { toast } from "sonner";

export function useAccount() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAccount = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<AccountInfo & { success: boolean }>("/account");
      setAccount({
        username: data.username,
        account_id: data.account_id,
        created_at: data.created_at,
        last_price_update: data.last_price_update,
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Failed to load account";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccount();
  }, [fetchAccount]);

  const updateUsername = useCallback(async (username: string) => {
    await apiFetch("/account/username", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    toast.success("Username updated");
    setAccount((prev) => (prev ? { ...prev, username } : prev));
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
    fetchAccount();
  }, [fetchAccount]);

  return {
    account,
    loading,
    updateUsername,
    resetSettings,
    deleteStocksCrypto,
    deleteAccount,
    importData,
  };
}
