"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Check, AlertTriangle } from "lucide-react";
import { parseGermanNumber } from "@/lib/enrich-calc";
import type {
  AddPositionForm,
  IdentifierValidation,
  PortfolioDropdownItem,
} from "@/types/enrich";

const INITIAL_FORM: AddPositionForm = {
  identifier: "",
  name: "",
  portfolio_id: null,
  sector: "",
  investment_type: null,
  country: "",
  shares: "",
  total_value: "",
  total_invested: "",
};

interface AddPositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolios: PortfolioDropdownItem[];
  countryOptions: string[];
  onValidateIdentifier: (identifier: string) => Promise<IdentifierValidation>;
  onSubmit: (form: AddPositionForm) => Promise<{ success: boolean; error?: string }>;
}

export function AddPositionDialog({
  open,
  onOpenChange,
  portfolios,
  countryOptions,
  onValidateIdentifier,
  onSubmit,
}: AddPositionDialogProps) {
  const [form, setForm] = useState<AddPositionForm>(INITIAL_FORM);
  const [validation, setValidation] = useState<IdentifierValidation>({
    loading: false,
    status: null,
    priceData: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showTotalValueField =
    !form.identifier.trim() || validation.status === "invalid";

  const handleIdentifierBlur = useCallback(async () => {
    const id = form.identifier.trim();
    if (!id) {
      setValidation({ loading: false, status: null, priceData: null });
      return;
    }
    setValidation((v) => ({ ...v, loading: true }));
    const result = await onValidateIdentifier(id);
    setValidation(result);

    // Auto-fill from validation
    if (result.status === "valid" && result.priceData) {
      setForm((f) => ({
        ...f,
        name: f.name || result.priceData?.name || f.name,
        sector: f.sector || result.priceData?.sector || f.sector,
        investment_type: f.investment_type || result.priceData?.investment_type || f.investment_type,
        country: f.country || result.priceData?.country || f.country,
      }));
    }
  }, [form.identifier, onValidateIdentifier]);

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Company name is required";
    if (!form.sector.trim()) errs.sector = "Sector is required";
    const s = parseGermanNumber(form.shares);
    if (isNaN(s) || s <= 0) errs.shares = "Shares must be greater than 0";
    if (showTotalValueField) {
      const tv = parseGermanNumber(form.total_value);
      if (isNaN(tv) || tv <= 0) errs.total_value = "Total value is required";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [form, showTotalValueField]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const result = await onSubmit(form);
    setIsSubmitting(false);
    if (result.success) {
      setForm(INITIAL_FORM);
      setValidation({ loading: false, status: null, priceData: null });
      setErrors({});
      onOpenChange(false);
    } else {
      setSubmitError(result.error || "Failed to add position");
    }
  }, [form, validate, onSubmit, onOpenChange]);

  const handleClose = useCallback(
    (v: boolean) => {
      if (!v) {
        setForm(INITIAL_FORM);
        setValidation({ loading: false, status: null, priceData: null });
        setErrors({});
        setSubmitError(null);
      }
      onOpenChange(v);
    },
    [onOpenChange]
  );

  const update = <K extends keyof AddPositionForm>(key: K, value: AddPositionForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Position</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {submitError && (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          {/* Identifier */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Identifier (optional)
            </label>
            <div className="relative">
              <Input
                className="text-sm pr-8"
                placeholder="e.g. AAPL, BTC-USD"
                value={form.identifier}
                onChange={(e) => update("identifier", e.target.value)}
                onBlur={handleIdentifierBlur}
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                {validation.loading && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-amber">FETCHING…</span>}
                {validation.status === "valid" && <Check className="size-4 text-emerald-400" />}
                {validation.status === "invalid" && <AlertTriangle className="size-4 text-amber-400" />}
              </div>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Company Name *
            </label>
            <Input
              className={`text-sm ${errors.name ? "border-red-400" : ""}`}
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
            />
            {errors.name && <p className="text-xs text-red-400 mt-0.5">{errors.name}</p>}
          </div>

          {/* Portfolio */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Portfolio</label>
            <Select
              value={form.portfolio_id != null ? String(form.portfolio_id) : "__none__"}
              onValueChange={(v) => update("portfolio_id", v === "__none__" ? null : Number(v))}
            >
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Select portfolio" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {portfolios.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Sector */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Sector *</label>
            <Input
              className={`text-sm ${errors.sector ? "border-red-400" : ""}`}
              value={form.sector}
              onChange={(e) => update("sector", e.target.value)}
            />
            {errors.sector && <p className="text-xs text-red-400 mt-0.5">{errors.sector}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Type */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Type</label>
              <Select
                value={form.investment_type || "__none__"}
                onValueChange={(v) => update("investment_type", v === "__none__" ? null : (v as AddPositionForm["investment_type"]))}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">-</SelectItem>
                  <SelectItem value="Stock">Stock</SelectItem>
                  <SelectItem value="ETF">ETF</SelectItem>
                  <SelectItem value="Crypto">Crypto</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Country */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Country</label>
              <Select
                value={form.country || "__none__"}
                onValueChange={(v) => { if (v) update("country", v === "__none__" ? "" : v); }}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">-</SelectItem>
                  {countryOptions.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Shares */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Shares *</label>
            <Input
              className={`text-sm ${errors.shares ? "border-red-400" : ""}`}
              placeholder="e.g. 10 or 0,5"
              value={form.shares}
              onChange={(e) => update("shares", e.target.value)}
            />
            {errors.shares && <p className="text-xs text-red-400 mt-0.5">{errors.shares}</p>}
          </div>

          {/* Total Value (conditional) */}
          {showTotalValueField && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Total Value (EUR) *
              </label>
              <Input
                className={`text-sm ${errors.total_value ? "border-red-400" : ""}`}
                placeholder="e.g. 1.500,00"
                value={form.total_value}
                onChange={(e) => update("total_value", e.target.value)}
              />
              {errors.total_value && <p className="text-xs text-red-400 mt-0.5">{errors.total_value}</p>}
            </div>
          )}

          {/* Total Invested */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Total Invested (optional)
            </label>
            <Input
              className="text-sm"
              placeholder="e.g. 1.200,00"
              value={form.total_invested}
              onChange={(e) => update("total_invested", e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-amber">FETCHING…</span>}
            Add Position
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
