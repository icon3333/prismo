"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";

interface PortfolioFooterProps {
  portfolioOptions: string[];
  onManagePortfolio: (action: string, params: Record<string, string>) => Promise<{ success: boolean }>;
}

export function PortfolioFooter({ portfolioOptions, onManagePortfolio }: PortfolioFooterProps) {
  const [action, setAction] = useState("");
  const [name, setName] = useState("");
  const [oldName, setOldName] = useState("");
  const [newName, setNewName] = useState("");
  const [deleteName, setDeleteName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const canApply =
    (action === "add" && name.trim()) ||
    (action === "rename" && oldName && newName.trim()) ||
    (action === "delete" && deleteName);

  const resetForm = () => {
    setAction("");
    setName("");
    setOldName("");
    setNewName("");
    setDeleteName("");
  };

  const handleApply = async () => {
    if (!canApply) return;
    if (action === "delete") {
      setShowDeleteConfirm(true);
      return;
    }
    await executeAction();
  };

  const executeAction = async () => {
    setIsProcessing(true);
    const params: Record<string, string> = {};
    if (action === "add") params.add_portfolio_name = name.trim();
    if (action === "rename") {
      params.old_name = oldName;
      params.new_name = newName.trim();
    }
    if (action === "delete") params.delete_portfolio_name = deleteName;

    const result = await onManagePortfolio(action, params);
    if (result.success) resetForm();
    setIsProcessing(false);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3">
        <span className="text-xs text-muted-foreground mr-1">Portfolios</span>

        <Select value={action || "__none__"} onValueChange={(v) => { if (v) setAction(v === "__none__" ? "" : v); }}>
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue placeholder="Action..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Action...</SelectItem>
            <SelectItem value="add">Add</SelectItem>
            <SelectItem value="rename">Rename</SelectItem>
            <SelectItem value="delete">Delete</SelectItem>
          </SelectContent>
        </Select>

        {action === "add" && (
          <Input
            className="h-7 w-40 text-xs"
            placeholder="Portfolio name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleApply()}
          />
        )}

        {action === "rename" && (
          <>
            <Select value={oldName || "__none__"} onValueChange={(v) => { if (v) setOldName(v === "__none__" ? "" : v); }}>
              <SelectTrigger className="h-7 w-32 text-xs">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select...</SelectItem>
                {portfolioOptions.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              className="h-7 w-32 text-xs"
              placeholder="New name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </>
        )}

        {action === "delete" && (
          <Select value={deleteName || "__none__"} onValueChange={(v) => { if (v) setDeleteName(v === "__none__" ? "" : v); }}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Select...</SelectItem>
              {portfolioOptions.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {action && (
          <Button size="sm" className="h-7 text-xs" disabled={!canApply || isProcessing} onClick={handleApply}>
            {isProcessing && <Loader2 className="size-3.5 mr-1 animate-spin" />}
            Apply
          </Button>
        )}
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete portfolio?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the portfolio &quot;{deleteName}&quot; and unassign all its positions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeAction}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
