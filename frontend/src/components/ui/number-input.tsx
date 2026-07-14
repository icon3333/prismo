"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { resolveNumberCommit } from "@/lib/number-input-calc";

interface NumberInputProps {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  /** Round to the nearest integer on commit. */
  integer?: boolean;
  /** Treat a lone German comma as the decimal separator. */
  decimal?: boolean;
  /** Render a committed 0 as an empty field (matches the old `value || ""`). */
  zeroAsEmpty?: boolean;
  inputMode?: "numeric" | "decimal";
  "aria-label": string;
  className?: string;
  disabled?: boolean;
}

/**
 * Controlled number field that can actually be cleared and retyped.
 *
 * The bug this fixes: binding a controlled input's `value` to a number and
 * rejecting empty input in `onChange` makes the field snap back to the old
 * number on backspace, so it can never be cleared. Instead we hold a local
 * string `draft` while focused (`null` = not editing) so intermediate and empty
 * states render, and commit a parsed/clamped number on blur. Enter blurs
 * (single commit path); Escape reverts. See `resolveNumberCommit` for the
 * numeric contract.
 */
export function NumberInput({
  value,
  onCommit,
  min,
  max,
  integer,
  decimal,
  zeroAsEmpty,
  inputMode = "numeric",
  className,
  disabled,
  "aria-label": ariaLabel,
}: NumberInputProps) {
  const [draft, setDraft] = React.useState<string | null>(null);
  // Set synchronously by Escape so the blur it triggers reverts instead of
  // committing (the draft state update wouldn't be visible to that blur yet).
  const revertRef = React.useRef(false);

  const shown = value === 0 && zeroAsEmpty ? "" : String(value);
  const display = draft !== null ? draft : shown;

  const commit = () => {
    if (revertRef.current) {
      revertRef.current = false;
      setDraft(null);
      return;
    }
    if (draft === null) return; // nothing being edited — guards a second blur
    const next = resolveNumberCommit(draft, { min, max, integer, decimal, lastValue: value });
    setDraft(null);
    if (next !== value) onCommit(next);
  };

  return (
    <Input
      type="text"
      inputMode={inputMode}
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      value={display}
      onFocus={(e) => {
        setDraft(shown);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          revertRef.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
