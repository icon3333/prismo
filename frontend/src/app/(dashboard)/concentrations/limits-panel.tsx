"use client";

import { useEffect, useMemo, useState } from "react";
import { useApiQuery } from "@/lib/api-cache";
import { usePagePersistence } from "@/hooks/use-page-persistence";
import { RulesSection } from "@/components/domain/rules-section";
import type { AllocationRules } from "@/types/builder";

// Same defaults as use-builder.ts — a fresh account sees identical limits on
// both pages.
const DEFAULT_RULES: AllocationRules = {
  maxPerStock: 5,
  maxPerETF: 10,
  maxPerCrypto: 5,
  maxPerCategory: 25,
  maxPerCountry: 10,
};

/**
 * Concentration limits, editable where the concentrations are shown.
 *
 * Reads and writes the same `rules` key of the builder page state, so the
 * Builder and the Overview's violation panels stay in sync. POST /state
 * replaces ALL keys for a page, so the full builder state is hydrated into
 * the persistence buffer before any save — a rules edit must never wipe the
 * builder's budget/portfolios state.
 */
export function LimitsPanel() {
  const stateQuery = useApiQuery<Record<string, string>>("/state?page=builder");
  const { persistState, hydrate } = usePagePersistence<Record<string, string>>("builder");
  // Local edits win over server state; null until the user touches a field.
  const [edited, setEdited] = useState<AllocationRules | null>(null);

  useEffect(() => {
    if (stateQuery.data) hydrate(stateQuery.data);
  }, [stateQuery.data, hydrate]);

  const serverRules = useMemo<AllocationRules | null>(() => {
    if (!stateQuery.data) return null;
    let saved: Partial<AllocationRules> = {};
    try {
      saved = stateQuery.data.rules ? JSON.parse(stateQuery.data.rules) : {};
    } catch {
      saved = {};
    }
    return {
      maxPerStock: saved.maxPerStock ?? DEFAULT_RULES.maxPerStock,
      maxPerETF: saved.maxPerETF ?? DEFAULT_RULES.maxPerETF,
      maxPerCrypto: saved.maxPerCrypto ?? DEFAULT_RULES.maxPerCrypto,
      maxPerCategory: saved.maxPerCategory ?? DEFAULT_RULES.maxPerCategory,
      maxPerCountry: saved.maxPerCountry ?? DEFAULT_RULES.maxPerCountry,
    };
  }, [stateQuery.data]);

  const rules = edited ?? serverRules;
  if (!rules) return null;

  const setRule = (field: keyof AllocationRules, value: number) => {
    const next = { ...rules, [field]: value };
    setEdited(next);
    persistState({ rules: JSON.stringify(next) });
  };

  return <RulesSection rules={rules} setRule={setRule} />;
}
