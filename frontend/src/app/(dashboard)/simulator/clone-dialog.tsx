"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PortfolioOption } from "@/types/simulator";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolios: PortfolioOption[];
  onClone: (
    portfolioId: number,
    name: string,
    zeroValues: boolean
  ) => Promise<boolean>;
}

export function CloneDialog({
  open,
  onOpenChange,
  portfolios,
  onClone,
}: Props) {
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>("");
  const [name, setName] = useState("");
  const [valueMode, setValueMode] = useState<"with-values" | "zeroed">(
    "with-values"
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && portfolios.length > 0) {
      const firstId = String(portfolios[0].id);
      setSelectedPortfolioId(firstId);
      setName(`Clone of ${portfolios[0].name}`);
      setValueMode("with-values");
      setLoading(false);
    }
  }, [open, portfolios]);

  const handlePortfolioChange = (v: string | null) => {
    if (!v) return;
    setSelectedPortfolioId(v);
    const selected = portfolios.find((p) => String(p.id) === v);
    if (selected) {
      setName(`Clone of ${selected.name}`);
    }
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!selectedPortfolioId || !trimmed || loading) return;
    setLoading(true);
    await onClone(
      parseInt(selectedPortfolioId),
      trimmed,
      valueMode === "zeroed"
    );
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Clone Portfolio</DialogTitle>
          <DialogDescription>
            Create a sandbox simulation from an existing portfolio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Portfolio select */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Portfolio</label>
            <Select
              value={selectedPortfolioId}
              onValueChange={handlePortfolioChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select portfolio" />
              </SelectTrigger>
              <SelectContent>
                {portfolios.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Value mode */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Values</label>
            <RadioGroup
              value={valueMode}
              onValueChange={(v) =>
                setValueMode(v as "with-values" | "zeroed")
              }
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="with-values" id="with-values" />
                <label htmlFor="with-values" className="text-sm cursor-pointer">
                  Keep values
                </label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="zeroed" id="zeroed" />
                <label htmlFor="zeroed" className="text-sm cursor-pointer">
                  Zero values
                </label>
              </div>
            </RadioGroup>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
          </div>
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
            onClick={handleSubmit}
            disabled={!selectedPortfolioId || !name.trim() || loading}
          >
            {loading && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-amber">FETCHING…</span>}
            Clone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
