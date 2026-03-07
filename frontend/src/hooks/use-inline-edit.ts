"use client";

import { useState, useRef, useCallback } from "react";

interface UseInlineEditOptions {
  onCommit: (value: string) => Promise<void>;
}

export function useInlineEdit(initialValue: string, { onCommit }: UseInlineEditOptions) {
  const [editingValue, setEditingValue] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);
  const originalRef = useRef(initialValue);

  // Sync when parent value changes (e.g. after refresh)
  const syncValue = useCallback((v: string) => {
    setEditingValue(v);
    originalRef.current = v;
  }, []);

  const handleFocus = useCallback(() => {
    originalRef.current = editingValue;
  }, [editingValue]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingValue(e.target.value);
  }, []);

  const commit = useCallback(async () => {
    const trimmed = editingValue.trim();
    if (trimmed === originalRef.current.trim()) return;
    setIsSaving(true);
    try {
      await onCommit(trimmed);
      originalRef.current = trimmed;
    } catch {
      setEditingValue(originalRef.current);
    } finally {
      setIsSaving(false);
    }
  }, [editingValue, onCommit]);

  const handleBlur = useCallback(() => {
    commit();
  }, [commit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        (e.target as HTMLElement).blur();
      }
    },
    []
  );

  return {
    editingValue,
    isSaving,
    syncValue,
    inputProps: {
      value: editingValue,
      onChange: handleChange,
      onFocus: handleFocus,
      onBlur: handleBlur,
      onKeyDown: handleKeyDown,
    },
  };
}
