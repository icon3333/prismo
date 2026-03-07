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

export function clearApiCache() { cache.clear(); }

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
    cache.clear();
    return doFetch<T>(url, init);
  }

  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data as T;
  }

  const pending = inflight.get(url);
  if (pending) {
    return (await pending) as T;
  }

  const promise = doFetch<T>(url, init);
  inflight.set(url, promise);

  try {
    const data = await promise;
    Object.freeze(data);
    cache.set(url, { data, ts: Date.now() });
    return data as T;
  } catch (e) {
    cache.delete(url);
    throw e;
  } finally {
    inflight.delete(url);
  }
}
