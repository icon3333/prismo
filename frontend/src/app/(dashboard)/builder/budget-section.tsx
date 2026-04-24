"use client";

import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import { formatNumber } from "@/lib/builder-calc";
import type { BudgetData, PortfolioMetrics } from "@/types/builder";

interface BudgetSectionProps {
  budget: BudgetData;
  setBudgetField: (
    field: "totalNetWorth" | "alreadyInvested" | "emergencyFund",
    value: number
  ) => void;
  populateAlreadyInvested: () => void;
  portfolioMetrics: PortfolioMetrics;
}

type EditableField = "totalNetWorth" | "alreadyInvested" | "emergencyFund";

const budgetFields: {
  key: EditableField;
  label: string;
  subtitle?: string;
}[] = [
  { key: "totalNetWorth", label: "Total Net Worth" },
  { key: "alreadyInvested", label: "Already Invested" },
  { key: "emergencyFund", label: "Emergency Fund" },
];

function BudgetInput({
  label,
  value,
  onChange,
  subtitle,
}: {
  label: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  subtitle?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [rawValue, setRawValue] = useState("");

  const handleFocus = useCallback(() => {
    setEditing(true);
    setRawValue(value ? String(value) : "");
  }, [value]);

  const handleBlur = useCallback(() => {
    setEditing(false);
    const parsed = parseFloat(rawValue.replace(/,/g, ""));
    onChange(isNaN(parsed) ? 0 : parsed);
  }, [rawValue, onChange]);

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {subtitle && (
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        )}
      </div>
      <div className="relative w-36">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          &euro;
        </span>
        <Input
          className="pl-6 text-right"
          value={editing ? rawValue : value ? formatNumber(value) : ""}
          onChange={(e) => setRawValue(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="0"
        />
      </div>
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="text-sm font-semibold text-aqua-400 tabular-nums">
        <SensitiveValue>
          &euro;{formatNumber(value)}
        </SensitiveValue>
      </div>
    </div>
  );
}

export function BudgetSection({
  budget,
  setBudgetField,
  populateAlreadyInvested,
  portfolioMetrics,
}: BudgetSectionProps) {
  return (
    <div className="border border-border/50 bg-slate-900/50 p-5">
      <h2 className="mb-4 text-lg font-semibold">Budget</h2>
      <div className="space-y-3">
        {budgetFields.map((field) => (
          <BudgetInput
            key={field.key}
            label={
              field.key === "alreadyInvested" ? (
                <span>
                  Already Invested
                  {portfolioMetrics.total_value > 0 && (
                    <button
                      type="button"
                      onClick={populateAlreadyInvested}
                      className="ml-2 text-xs text-aqua-400 hover:text-aqua-300 transition-colors"
                    >
                      (use{" "}
                      <SensitiveValue>
                        &euro;
                        {formatNumber(portfolioMetrics.total_value)}
                      </SensitiveValue>
                      )
                    </button>
                  )}
                </span>
              ) : (
                field.label
              )
            }
            subtitle={field.subtitle}
            value={budget[field.key]}
            onChange={(v) => setBudgetField(field.key, v)}
          />
        ))}

        <div className="my-3 border-t border-border/30" />

        <ReadOnlyField
          label="Total Investable Capital"
          value={budget.totalInvestableCapital}
        />
        <ReadOnlyField
          label="Available to Invest"
          value={budget.availableToInvest}
        />
      </div>
    </div>
  );
}
