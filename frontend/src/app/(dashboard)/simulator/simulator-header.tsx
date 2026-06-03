"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { parseSimValue, formatSimValue } from "@/lib/simulator-calc";
import { SaveDialog } from "./save-dialog";
import { CloneDialog } from "./clone-dialog";
import type { UseSimulatorReturn } from "@/hooks/use-simulator";

interface Props {
  sim: UseSimulatorReturn;
}

export function SimulatorHeader({ sim }: Props) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDialogMode, setSaveDialogMode] = useState<"save" | "rename">("save");
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const isPortfolioMode = sim.mode === "portfolio";

  return (
    <div className="space-y-3">
      {/* Row 1: Title + Mode toggle + Auto-save status */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Simulator</h1>

        {/* Mode toggle group */}
        <div className="inline-flex border border-border/50 bg-muted/30 p-0.5">
          <button
            onClick={() => sim.switchMode("overlay")}
            className={cn(
              "inline-flex items-center px-3 py-1.5 text-sm font-medium transition-colors",
              !isPortfolioMode
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Overlay
          </button>
          <button
            onClick={() => sim.switchMode("portfolio")}
            className={cn(
              "inline-flex items-center px-3 py-1.5 text-sm font-medium transition-colors",
              isPortfolioMode
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Sandbox
          </button>
        </div>

        {/* Auto-save status */}
        <AutoSaveIndicator status={sim.autoSaveStatus} />

        {/* Cloned-from label */}
        {sim.currentClonedFromName && isPortfolioMode && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            Cloned from: {sim.currentClonedFromName}
          </span>
        )}
      </div>

      {/* Row 2: Scope + Total Amount + Simulation dropdown + CRUD buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Portfolio scope (overlay only) */}
        {!isPortfolioMode && (
          <Select
            value={
              sim.scope === "portfolio" && sim.portfolioId
                ? String(sim.portfolioId)
                : "global"
            }
            onValueChange={(v) => {
              if (!v) return;
              if (v === "global") {
                sim.setScope("global");
              } else {
                sim.setScope("portfolio", parseInt(v));
              }
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">All Portfolios</SelectItem>
              {sim.portfolios.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Total amount (sandbox only) */}
        {isPortfolioMode && (
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              Total:
            </span>
            <Input
              className="w-[140px]"
              placeholder="€ amount"
              defaultValue={
                sim.totalAmount > 0 ? formatSimValue(sim.totalAmount) : ""
              }
              onBlur={(e) => {
                const val = parseSimValue(e.target.value);
                sim.setTotalAmount(val);
                e.target.value = val > 0 ? formatSimValue(val) : "";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </div>
        )}

        {/* Simulation dropdown */}
        <Select
          value={sim.currentSimulationId ? String(sim.currentSimulationId) : ""}
          onValueChange={(v) => {
            if (!v) return;
            if (v === "new") {
              sim.loadSimulation(null);
            } else {
              sim.loadSimulation(parseInt(v));
            }
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select simulation" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">New Simulation</SelectItem>
            {sim.filteredSimulations.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* CRUD buttons */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSaveDialogMode("save");
            setSaveDialogOpen(true);
          }}
        >
          Save As
        </Button>

        {sim.currentSimulationId && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSaveDialogMode("rename");
                setSaveDialogOpen(true);
              }}
            >
              Rename
            </Button>

            {!deleteConfirm ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteConfirm(true)}
              >
                Delete
              </Button>
            ) : (
              <div className="inline-flex gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    await sim.deleteSimulation();
                    setDeleteConfirm(false);
                  }}
                >
                  Confirm
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteConfirm(false)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </>
        )}

        {/* Clone button (sandbox only) */}
        {isPortfolioMode && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCloneDialogOpen(true)}
          >
            Clone Portfolio
          </Button>
        )}
      </div>

      {/* Allocation summary (sandbox with totalAmount) */}
      {isPortfolioMode && sim.items.length > 0 && (
        <AllocationSummaryBadge
          totalPercent={sim.allocationSummary.totalPercent}
          status={sim.allocationSummary.status}
          totalEur={sim.allocationSummary.totalEur}
          hasTotalAmount={sim.totalAmount > 0}
        />
      )}

      {/* Dialogs */}
      <SaveDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        mode={saveDialogMode}
        currentName={sim.currentSimulationName}
        onSave={async (name) => {
          const ok =
            saveDialogMode === "rename"
              ? await sim.renameSimulation(name)
              : await sim.saveAsSimulation(name);
          if (ok) setSaveDialogOpen(false);
          return ok;
        }}
      />

      <CloneDialog
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
        portfolios={sim.portfolios}
        onClone={async (portfolioId, name, zeroValues) => {
          const ok = await sim.clonePortfolio(portfolioId, name, zeroValues);
          if (ok) setCloneDialogOpen(false);
          return ok;
        }}
      />
    </div>
  );
}

function AutoSaveIndicator({ status }: { status: string }) {
  if (status === "idle") return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs transition-opacity",
        status === "saving" && "text-muted-foreground animate-pulse",
        status === "saved" && "text-green",
        status === "error" && "text-red"
      )}
    >
      {status === "saving" && (
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-amber">FETCHING…</span>
      )}
      {status === "saved" && (
        <>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green align-middle" aria-hidden /> Saved
        </>
      )}
      {status === "error" && (
        <>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red align-middle" aria-hidden /> Save failed
        </>
      )}
    </span>
  );
}

function AllocationSummaryBadge({
  totalPercent,
  status,
  totalEur,
  hasTotalAmount,
}: {
  totalPercent: number;
  status: "under" | "full" | "over";
  totalEur: number;
  hasTotalAmount: boolean;
}) {
  if (!hasTotalAmount) {
    if (totalEur > 0) {
      return (
        <span className="text-xs text-muted-foreground">
          Total: €{formatSimValue(totalEur)}
        </span>
      );
    }
    return null;
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs",
        status === "full" && "border-emerald-400/50 text-green",
        status === "over" && "border-red-400/50 text-red",
        status === "under" && "border-border text-muted-foreground"
      )}
    >
      {status === "full"
        ? "100% allocated"
        : status === "over"
          ? `${totalPercent.toFixed(1)}% — over budget`
          : `${totalPercent.toFixed(1)}% allocated — ${(100 - totalPercent).toFixed(1)}% remaining`}
    </Badge>
  );
}
