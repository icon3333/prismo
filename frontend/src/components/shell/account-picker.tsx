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
    fetch("/auth/accounts", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setAccounts(data.accounts ?? []);
        setCurrentId(data.current_account_id ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function selectAccount(id: number) {
    const res = await fetch(`/auth/select/${id}`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      setCurrentId(id);
      window.location.reload();
    }
  }

  if (loading) return null;
  if (currentId) return null; // Already authenticated

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 space-y-4">
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
              <User className="size-4 text-aqua-500" />
              {account.username}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
