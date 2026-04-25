"use client";

import { useState, useRef } from "react";
import { useAccount } from "@/hooks/use-account";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export default function AccountPage() {
  const {
    account,
    loading,
    updateUsername,
    resetSettings,
    deleteStocksCrypto,
    deleteAccount,
    importData,
  } = useAccount();

  const [newUsername, setNewUsername] = useState("");
  const [usernameSubmitting, setUsernameSubmitting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newUsername.trim();
    if (!trimmed) return;
    setUsernameSubmitting(true);
    try {
      await updateUsername(trimmed);
      setNewUsername("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update username");
    } finally {
      setUsernameSubmitting(false);
    }
  };

  const handleImport = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error("No file selected");
      return;
    }
    try {
      await importData(file);
      setImportOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import data");
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await deleteAccount();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete account");
    } finally {
      setDeleteConfirmation("");
      setDeleteOpen(false);
    }
  };

  const handleDeleteStocksCrypto = async () => {
    try {
      await deleteStocksCrypto();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete data");
    }
  };

  const handleResetSettings = async () => {
    try {
      await resetSettings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset settings");
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    try {
      return new Date(dateStr + "Z").toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Account</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        {/* Left panel: Account info */}
        <div className="border border-border/50 bg-slate-900/50 p-5">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Account Info
          </h2>
          <div className="space-y-4">
            <InfoRow label="Username" value={account?.username ?? "—"} />
            <InfoRow label="Account ID" value={String(account?.account_id ?? "—")} />
            <InfoRow label="Created" value={formatDate(account?.created_at ?? null)} />
            <InfoRow label="Last Price Update" value={formatDate(account?.last_price_update ?? null)} />
          </div>
        </div>

        {/* Right panel: Settings tabs */}
        <Tabs defaultValue="settings">
          <TabsList>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="danger">Danger Zone</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-6 pt-4">
            {/* Update Username */}
            <Section title="Update Username">
              <form onSubmit={handleUsernameSubmit} className="flex gap-3">
                <Input
                  placeholder={account?.username ?? "New username"}
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="max-w-xs"
                />
                <Button type="submit" disabled={usernameSubmitting || !newUsername.trim()}>
                  {usernameSubmitting ? "Saving..." : "Update"}
                </Button>
              </form>
            </Section>

            {/* Data Migration */}
            <Section title="Data Migration">
              <div className="flex flex-wrap gap-3">
                <a href="/account/export" download>
                  <Button variant="outline">
                    Export Data
                  </Button>
                </a>

                <AlertDialog open={importOpen} onOpenChange={setImportOpen}>
                  <AlertDialogTrigger
                    render={
                      <Button variant="outline">
                        Import Data
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Import Account Data</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will replace all existing data with the imported file. Make sure to export a backup first.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      className="text-sm file:mr-3 file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-slate-700"
                    />
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleImport}>
                        Import
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </Section>
          </TabsContent>

          <TabsContent value="danger" className="space-y-6 pt-4">
            {/* Delete Stocks & Crypto */}
            <DangerSection
              title="Delete Stocks & Crypto"
              description="Remove all stock and crypto positions from this account. This cannot be undone."
              actionLabel="Delete All Positions"
              onConfirm={handleDeleteStocksCrypto}
            />

            {/* Reset Settings */}
            <DangerSection
              title="Reset Account Settings"
              description="Clear all saved UI settings (expanded states, sort preferences). This cannot be undone."
              actionLabel="Reset Settings"
              onConfirm={handleResetSettings}
            />

            {/* Delete Account */}
            <div className="border border-red-500/30 bg-red-950/20 p-5">
              <div className="flex items-start gap-3">
                <span className="mt-2 inline-block w-1.5 h-1.5 rounded-full bg-red shrink-0" aria-hidden />
                <div className="flex-1">
                  <h3 className="font-medium text-red">Delete Account</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Permanently delete this account and all associated data. This action is irreversible.
                  </p>
                  <AlertDialog
                    open={deleteOpen}
                    onOpenChange={(open) => {
                      setDeleteOpen(open);
                      if (!open) setDeleteConfirmation("");
                    }}
                  >
                    <AlertDialogTrigger
                      render={
                        <Button variant="destructive" size="sm" className="mt-3">
                          Delete Account
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Account</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete your account and all data. Type <strong>DELETE</strong> to confirm.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <Input
                        placeholder='Type "DELETE" to confirm'
                        value={deleteConfirmation}
                        onChange={(e) => setDeleteConfirmation(e.target.value)}
                      />
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={deleteConfirmation !== "DELETE"}
                          onClick={handleDeleteAccount}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Delete Account
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium truncate">{value}</div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border/50 bg-slate-900/50 p-5">
      <h3 className="mb-3 font-medium">{title}</h3>
      {children}
    </div>
  );
}

function DangerSection({
  title,
  description,
  actionLabel,
  onConfirm,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => Promise<void>;
}) {
  return (
    <div className="border border-red-500/30 bg-red-950/20 p-5">
      <div className="flex items-start gap-3">
        <span className="mt-2 inline-block w-1.5 h-1.5 rounded-full bg-red shrink-0" aria-hidden />
        <div className="flex-1">
          <h3 className="font-medium text-red">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="destructive" size="sm" className="mt-3">
                  {actionLabel}
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{title}</AlertDialogTitle>
                <AlertDialogDescription>{description}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onConfirm}
                  className="bg-red-600 hover:bg-red-700"
                >
                  Confirm
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
