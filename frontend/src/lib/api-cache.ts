// Tiny stale-while-revalidate cache shared by all dashboard pages. Entries
// are keyed by API path (query string included). Components subscribe via
// useApiQuery; every successful write through the api layer invalidates all
// entries — the client-side mirror of the Flask after_request hook that
// invalidates memoized reads on every successful write.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { apiFetch, clearApiCache, onApiMutation } from "./api";

export interface ApiQueryState<T> {
  data: T | undefined;
  error: string | null;
  /** True until the first fetch for this key settles (success or failure). */
  isLoading: boolean;
  /** True while a fetch for this key is in flight. */
  isValidating: boolean;
}

interface Entry {
  data: unknown;
  hasData: boolean;
  error: string | null;
  promise: Promise<void> | null;
  /** Bumped on every invalidation; in-flight fetches from an older epoch discard their result. */
  epoch: number;
  subscribers: Set<() => void>;
  /** Stable object handed to useSyncExternalStore; replaced on every change. */
  snapshot: ApiQueryState<unknown>;
}

const entries = new Map<string, Entry>();

function snapshotOf(e: Pick<Entry, "data" | "hasData" | "error" | "promise">): ApiQueryState<unknown> {
  return {
    data: e.data,
    error: e.error,
    isLoading: !e.hasData && e.error === null,
    isValidating: e.promise !== null,
  };
}

function getEntry(path: string): Entry {
  let entry = entries.get(path);
  if (!entry) {
    entry = {
      data: undefined,
      hasData: false,
      error: null,
      promise: null,
      epoch: 0,
      subscribers: new Set(),
      snapshot: { data: undefined, error: null, isLoading: true, isValidating: false },
    };
    entries.set(path, entry);
  }
  return entry;
}

function notify(entry: Entry) {
  entry.snapshot = snapshotOf(entry);
  for (const cb of entry.subscribers) cb();
}

export function getApiQueryState<T>(path: string): ApiQueryState<T> {
  return getEntry(path).snapshot as ApiQueryState<T>;
}

export function subscribeApiQuery(path: string, cb: () => void): () => void {
  const entry = getEntry(path);
  entry.subscribers.add(cb);
  return () => {
    entry.subscribers.delete(cb);
  };
}

/**
 * Fetch `path` and update its cache entry. Concurrent calls for the same key
 * share one request. Existing data keeps being served while the fetch is in
 * flight (stale-while-revalidate), and a failed background refresh keeps the
 * last good data instead of blanking the page.
 */
export function revalidateApiQuery(path: string): Promise<void> {
  const entry = getEntry(path);
  if (entry.promise) return entry.promise;

  // If the entry is invalidated while this fetch is in flight, its result may
  // predate the write — discard it and let the chained refetch (started by
  // invalidateApiCache) be the only committer.
  const epochAtStart = entry.epoch;
  const promise = apiFetch<unknown>(path, { noStore: true })
    .then((data) => {
      if (entry.epoch !== epochAtStart) return;
      entry.data = data;
      entry.hasData = true;
      entry.error = null;
    })
    .catch((err: unknown) => {
      if (entry.epoch !== epochAtStart) return;
      if (!entry.hasData) {
        entry.error = err instanceof Error ? err.message : "Request failed";
      }
    })
    .finally(() => {
      entry.promise = null;
      notify(entry);
    });

  entry.promise = promise;
  notify(entry);
  return promise;
}

/**
 * Mark cached reads matching `prefix` (all when omitted) stale: the TTL cache
 * in api.ts is dropped so the next fetch hits the network, and every key with
 * live subscribers refetches immediately. Keys without subscribers keep their
 * data as a stale seed — useApiQuery always revalidates on mount.
 */
export function invalidateApiCache(prefix = ""): Promise<void> {
  clearApiCache(prefix);
  const refetches: Promise<void>[] = [];
  for (const [path, entry] of entries) {
    if (!path.startsWith(prefix)) continue;
    // Any in-flight fetch for this key may predate the write — make sure its
    // late result is discarded rather than committed over post-write data.
    entry.epoch++;
    if (entry.subscribers.size === 0) continue;
    // A fetch already in flight may predate the write that triggered this
    // invalidation — chain a fresh one behind it instead of deduping into it.
    refetches.push(
      entry.promise
        ? entry.promise.then(() => revalidateApiQuery(path))
        : revalidateApiQuery(path)
    );
  }
  return Promise.all(refetches).then(() => undefined);
}

// Every successful write through the api layer refreshes all subscribed reads.
onApiMutation(() => {
  void invalidateApiCache();
});

const IDLE_STATE: ApiQueryState<never> = {
  data: undefined,
  error: null,
  isLoading: true,
  isValidating: false,
};

export interface UseApiQueryResult<T> extends ApiQueryState<T> {
  refetch: () => Promise<void>;
}

const noopUnsubscribe = () => {};

/**
 * Subscribe to a GET endpoint with stale-while-revalidate semantics: cached
 * data renders immediately, a background refetch runs on mount, and any
 * successful write (or explicit invalidateApiCache call) refreshes it.
 * Pass `null` to keep the query idle until its path is known.
 */
export function useApiQuery<T>(path: string | null): UseApiQueryResult<T> {
  const subscribe = useCallback(
    (cb: () => void) => (path === null ? noopUnsubscribe : subscribeApiQuery(path, cb)),
    [path]
  );
  const getSnapshot = useCallback(
    () => (path === null ? IDLE_STATE : getEntry(path).snapshot) as ApiQueryState<T>,
    [path]
  );
  const state = useSyncExternalStore(subscribe, getSnapshot, () => IDLE_STATE as ApiQueryState<T>);

  // Revalidate on mount and whenever the key changes.
  useEffect(() => {
    if (path !== null) void revalidateApiQuery(path);
  }, [path]);

  const refetch = useCallback(
    () => (path === null ? Promise.resolve() : revalidateApiQuery(path)),
    [path]
  );

  return { ...state, refetch };
}
