import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

interface PagePersistence<T> {
  /** Merge a partial into the accumulated state and schedule a debounced POST. */
  persistState: (partial: Partial<T>) => void;
  /** Seed the accumulated state from server-loaded values without triggering a POST. */
  hydrate: (initial: Partial<T>) => void;
  /** True while a debounced POST is in flight. */
  isSaving: boolean;
}

/**
 * Debounced (500ms) POST of accumulated state merges to /state.
 *
 * Each `persistState(partial)` call merges into an internal ref and schedules
 * a POST that includes the full accumulated state under the given `page`. Any
 * pending POST is cancelled so only the latest accumulated state is sent.
 *
 * Pages typically `hydrate(serverState)` once on mount so subsequent partial
 * updates POST the full merged state, not just the changed key.
 */
export function usePagePersistence<T extends object>(
  page: string,
): PagePersistence<T> {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stateRef = useRef<Partial<T>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const persistState = useCallback(
    (partial: Partial<T>) => {
      stateRef.current = { ...stateRef.current, ...partial };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        setIsSaving(true);
        try {
          await apiFetch("/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              page,
              ...stateRef.current,
            }),
          });
        } catch {
          // Silently fail
        } finally {
          setIsSaving(false);
        }
      }, 500);
    },
    [page],
  );

  const hydrate = useCallback((initial: Partial<T>) => {
    stateRef.current = { ...stateRef.current, ...initial };
  }, []);

  return { persistState, hydrate, isSaving };
}
