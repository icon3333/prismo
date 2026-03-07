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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, X } from "lucide-react";
import type { BulkEditValues } from "@/types/enrich";

interface BulkActionBarProps {
  selectedCount: number;
  selectedManualCount: number;
  selectedManualNames: string[];
  portfolioOptions: string[];
  countryOptions: string[];
  onApply: (values: BulkEditValues) => void;
  onDelete: () => void;
  onClear: () => void;
}

export function BulkActionBar({
  selectedCount,
  selectedManualCount,
  selectedManualNames,
  portfolioOptions,
  countryOptions,
  onApply,
  onDelete,
  onClear,
}: BulkActionBarProps) {
  const [values, setValues] = useState<BulkEditValues>({
    portfolio: "",
    sector: "",
    thesis: "",
    country: "",
    investmentType: "",
  });

  const hasValues = values.portfolio || values.sector || values.thesis || values.country || values.investmentType;

  const deleteDescription = selectedManualNames.length === 1
    ? `This will permanently delete "${selectedManualNames[0]}".`
    : `This will permanently delete ${selectedManualNames.length} manually-added positions: ${selectedManualNames.join(", ")}.`;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-aqua-400/30 bg-aqua-400/5 p-3">
      <span className="text-sm font-medium mr-2">{selectedCount} selected</span>

      <Select
        value={values.portfolio || "__empty__"}
        onValueChange={(v) => { if (v) setValues((p) => ({ ...p, portfolio: v === "__empty__" ? "" : v })); }}
      >
        <SelectTrigger className="h-7 w-28 text-xs">
          <SelectValue placeholder="Portfolio" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">Portfolio...</SelectItem>
          {portfolioOptions.map((p) => (
            <SelectItem key={p} value={p}>{p}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        className="h-7 w-24 text-xs"
        placeholder="Sector"
        value={values.sector}
        onChange={(e) => setValues((p) => ({ ...p, sector: e.target.value }))}
      />

      <Input
        className="h-7 w-24 text-xs"
        placeholder="Thesis"
        value={values.thesis}
        onChange={(e) => setValues((p) => ({ ...p, thesis: e.target.value }))}
      />

      <Select
        value={values.country || "__empty__"}
        onValueChange={(v) => { if (v) setValues((p) => ({ ...p, country: v === "__empty__" ? "" : v })); }}
      >
        <SelectTrigger className="h-7 w-24 text-xs">
          <SelectValue placeholder="Country" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">Country...</SelectItem>
          {countryOptions.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={values.investmentType || "__empty__"}
        onValueChange={(v) => { if (v) setValues((p) => ({ ...p, investmentType: v === "__empty__" ? "" : v })); }}
      >
        <SelectTrigger className="h-7 w-20 text-xs">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">Type...</SelectItem>
          <SelectItem value="Stock">Stock</SelectItem>
          <SelectItem value="ETF">ETF</SelectItem>
          <SelectItem value="Crypto">Crypto</SelectItem>
        </SelectContent>
      </Select>

      <Button
        size="sm"
        className="h-7 text-xs"
        disabled={!hasValues}
        onClick={() => onApply(values)}
      >
        Apply Changes
      </Button>

      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>
        <X className="size-3.5 mr-1" />
        Clear
      </Button>

      {selectedManualCount > 0 && (
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-xs ml-auto"
              />
            }
          >
            <Trash2 className="size-3.5 mr-1" />
            Delete ({selectedManualCount})
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete positions?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteDescription} This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
