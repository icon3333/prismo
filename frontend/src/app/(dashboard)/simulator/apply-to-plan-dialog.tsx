"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ApplyMapping } from "@/lib/apply-to-plan";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetPortfolioName: string;
  mapping: ApplyMapping;
  onConfirm: () => Promise<boolean>;
}

export function ApplyToPlanDialog({
  open,
  onOpenChange,
  targetPortfolioName,
  mapping,
  onConfirm,
}: Props) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (loading) return;
    setLoading(true);
    const ok = await onConfirm();
    setLoading(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Apply to Plan</DialogTitle>
          <DialogDescription>
            Replace the positions of “{targetPortfolioName}” in the Plan with
            these weights.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 overflow-y-auto space-y-1">
          {mapping.applied.map((p) => (
            <div
              key={p.companyName}
              className="flex items-center justify-between text-sm"
            >
              <span className="truncate">{p.companyName}</span>
              <span className="font-mono text-muted-foreground ml-3">
                {p.weight.toFixed(2)}%
              </span>
            </div>
          ))}
          {mapping.skipped.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between text-sm text-muted-foreground"
            >
              <span className="truncate line-through">{name}</span>
              <span className="ml-3 text-xs">skipped</span>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || mapping.applied.length === 0}
          >
            {loading && (
              <span className="font-mono text-micro uppercase tracking-[0.12em] text-amber">
                FETCHING…
              </span>
            )}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
