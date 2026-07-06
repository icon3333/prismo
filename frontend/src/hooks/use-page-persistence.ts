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
 *
 * POST /state replaces every key of the page, so before posting, the flush
 * re-reads the server state and lets it win for keys this hook never edited.
 * That way a long-open tab can't clobber keys another page/tab wrote since
 * hydrate (e.g. a limits edit on Concentrations reverting an Apply-to-Plan),
 * and a failed initial GET can't shrink the posted key set to just the
 * edited keys.
 */
export function usePagePersistence<T extends object>(
  page: string,
): PagePersistence<T> {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stateRef = useRef<Partial<T>>({});
  const editedKeysRef = useRef<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const persistState = useCallback(
    (partial: Partial<T>) => {
      stateRef.current = { ...stateRef.current, ...partial };
      for (const key of Object.keys(partial)) editedKeysRef.current.add(key);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        setIsSaving(true);
        try {
          let payload: Record<string, unknown> = { ...stateRef.current };
          try {
            const fresh = await apiFetch<Record<string, unknown>>(
              `/state?page=${encodeURIComponent(page)}`,
              { noStore: true },
            );
            payload = { ...payload, ...fresh };
            for (const key of editedKeysRef.current) {
              payload[key] = (stateRef.current as Record<string, unknown>)[key];
            }
            stateRef.current = payload as Partial<T>;
          } catch {
            // Server unreachable for the read — post the local buffer as-is.
          }
          await apiFetch("/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              page,
              ...payload,
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
