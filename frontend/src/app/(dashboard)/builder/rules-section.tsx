"use client";

import { Input } from "@/components/ui/input";
import type { AllocationRules } from "@/types/builder";

interface RulesSectionProps {
  rules: AllocationRules;
  setRule: (field: keyof AllocationRules, value: number) => void;
}

const ruleFields: {
  key: keyof AllocationRules;
  label: string;
  subtitle: string;
}[] = [
  { key: "maxPerStock", label: "Max % per Stock", subtitle: "Maximum allocation per individual stock" },
  { key: "maxPerETF", label: "Max % per ETF", subtitle: "Maximum allocation per individual ETF" },
  { key: "maxPerCrypto", label: "Max % per Crypto", subtitle: "Maximum allocation per individual crypto" },
  { key: "maxPerCategory", label: "Max % per Sector", subtitle: "Maximum allocation per sector" },
  { key: "maxPerCountry", label: "Max % per Country", subtitle: "Maximum allocation per country" },
];

export function RulesSection({ rules, setRule }: RulesSectionProps) {
  return (
    <div className="border border-border/50 bg-slate-900/50 p-5">
      <h2 className="mb-4 text-lg font-semibold">Allocation Rules</h2>
      <div className="space-y-3">
        {ruleFields.map((field) => (
          <div key={field.key} className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">{field.label}</div>
              <div className="text-xs text-muted-foreground">{field.subtitle}</div>
            </div>
            <div className="relative w-24">
              <Input
                type="number"
                min={0}
                max={100}
                className="text-right pr-6"
                value={rules[field.key]}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) setRule(field.key, v);
                }}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                %
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
