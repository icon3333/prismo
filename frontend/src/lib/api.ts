const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const CACHE_TTL = 30_000;

// Writes that only persist UI state (sort order, expanded rows, …) don't
// change portfolio data — exempt them from mutation notification so every
// debounced toggle doesn't refetch all subscribed reads.
const UI_STATE_WRITE_PATHS = ["/state"];

type MutationListener = () => void;
const mutationListeners = new Set<MutationListener>();

/**
 * Register a callback fired after every successful data-changing request.
 * Client-side mirror of the Flask `after_request` hook that invalidates the
 * account's memoized reads on every successful write. Returns unsubscribe.
 */
export function onApiMutation(listener: MutationListener): () => void {
  mutationListeners.add(listener);
  return () => {
    mutationListeners.delete(listener);
  };
}

function notifyMutation(path: string) {
  if (UI_STATE_WRITE_PATHS.some((p) => path.startsWith(p))) return;
  for (const listener of mutationListeners) listener();
}

// Bumped on every cache clear so GETs that were already in flight don't
// re-seed the cache with pre-write data when they land.
let cacheEpoch = 0;

/** Drop cached GET responses; with `prefix`, only those whose path starts with it. */
export function clearApiCache(prefix = "") {
  cacheEpoch++;
  if (!prefix) {
    cache.clear();
    return;
  }
  const urlPrefix = `${API_BASE}${prefix}`;
  for (const key of cache.keys()) {
    if (key.startsWith(urlPrefix)) cache.delete(key);
  }
}

async function doFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
  });

  if (!res.ok) {
    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      const data = await res.json();
      throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
    }
    throw new ApiError(`HTTP ${res.status}`, res.status);
  }

  return res.json();
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const url = `${API_BASE}${path}`;

  if (method !== "GET") {
    clearApiCache();
    const data = await doFetch<T>(url, init);
    notifyMutation(path);
    return data;
  }

  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data as T;
  }

  const pending = inflight.get(url);
  if (pending) {
    return (await pending) as T;
  }

  const epochAtStart = cacheEpoch;
  const promise = doFetch<T>(url, init);
  inflight.set(url, promise);

  try {
    const data = await promise;
    Object.freeze(data);
    // Skip caching if a write cleared the cache mid-flight — this response
    // may predate that write.
    if (cacheEpoch === epochAtStart) {
      cache.set(url, { data, ts: Date.now() });
    }
    return data as T;
  } catch (e) {
    cache.delete(url);
    throw e;
  } finally {
    inflight.delete(url);
  }
}

/**
 * POST a form to a form-style endpoint (e.g. `/api/manage_portfolios`).
 * These endpoints signal failure via `success: false` + `message` in a
 * non-2xx JSON body, so the body is returned as-is instead of throwing;
 * mutation notification fires only on success.
 */
export async function apiPostForm<T extends { success?: boolean }>(
  url: string,
  formData: FormData
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    body: formData,
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  let data: T;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`HTTP ${res.status}`, res.status);
  }

  if (data?.success) {
    clearApiCache();
    notifyMutation(url);
  }
  return data;
}
