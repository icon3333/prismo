"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { User } from "lucide-react";

interface Account {
  id: number;
  username: string;
}

export function AccountPicker() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/accounts", { credentials: "include" });
      const data = await res.json();
      if (cancelled) return;
      const list: Account[] = data.accounts ?? [];
      const current: number | null = data.current_account_id ?? null;
      // Single-user homeserver: auto-select when there's exactly one account
      // and nothing's selected yet. Skips the picker entirely on fresh boot.
      if (!current && list.length === 1) {
        const ok = await selectAccount(list[0].id, { reload: false });
        if (ok) {
          setCurrentId(list[0].id);
          setLoading(false);
          return;
        }
      }
      setAccounts(list);
      setCurrentId(current);
      setLoading(false);
    })().catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function selectAccount(id: number, opts: { reload?: boolean } = { reload: true }) {
    const res = await fetch(`/api/select_account/${id}`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      setCurrentId(id);
      if (opts.reload !== false) window.location.reload();
      return true;
    }
    return false;
  }

  if (loading) return null;
  if (currentId) return null; // Already authenticated

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95">
      <div className="w-full max-w-sm border border-border bg-card p-6 space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-bold">Welcome to Prismo</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Select an account to continue
          </p>
        </div>
        <div className="space-y-2">
          {accounts.map((account) => (
            <Button
              key={account.id}
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => selectAccount(account.id)}
            >
              <User className="size-4 text-cyan" />
              {account.username}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
