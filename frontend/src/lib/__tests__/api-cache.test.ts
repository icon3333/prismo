import { describe, it, expect, beforeEach, vi } from "vitest";

// api.ts and api-cache.ts hold module-level state (TTL cache, entry map,
// mutation listeners), so each test gets a fresh module graph.
async function loadModules() {
  vi.resetModules();
  const api = await import("@/lib/api");
  const apiCache = await import("@/lib/api-cache");
  return { ...api, ...apiCache };
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => data,
  };
}

/** Install a fetch mock that resolves per-URL with the given payloads. */
function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("api-cache", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("dedupes concurrent revalidations for the same key", async () => {
    const { revalidateApiQuery, getApiQueryState } = await loadModules();
    const fetchMock = mockFetch(() => jsonResponse([{ id: 1 }]));

    await Promise.all([
      revalidateApiQuery("/portfolio_data"),
      revalidateApiQuery("/portfolio_data"),
      revalidateApiQuery("/portfolio_data"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/portfolio_data", expect.anything());
    expect(getApiQueryState("/portfolio_data").data).toEqual([{ id: 1 }]);
    expect(getApiQueryState("/portfolio_data").isLoading).toBe(false);
  });

  it("serves stale data while revalidating, then swaps in fresh data", async () => {
    const { revalidateApiQuery, invalidateApiCache, subscribeApiQuery, getApiQueryState } =
      await loadModules();

    let value = "v1";
    let release: () => void = () => {};
    let slow = false;
    mockFetch(async () => {
      if (slow) await new Promise<void>((resolve) => (release = resolve));
      return jsonResponse({ value });
    });

    await revalidateApiQuery("/portfolio_data");
    expect(getApiQueryState("/portfolio_data").data).toEqual({ value: "v1" });

    // Subscribe so invalidation refetches; make the refetch hang.
    const notified = vi.fn();
    subscribeApiQuery("/portfolio_data", notified);
    value = "v2";
    slow = true;
    const done = invalidateApiCache();

    // Old data still served while the refetch is in flight.
    const during = getApiQueryState<{ value: string }>("/portfolio_data");
    expect(during.data).toEqual({ value: "v1" });
    expect(during.isValidating).toBe(true);
    expect(during.isLoading).toBe(false);

    release();
    await done;
    expect(getApiQueryState("/portfolio_data").data).toEqual({ value: "v2" });
    expect(notified).toHaveBeenCalled();
  });

  it("invalidation refetches subscribed keys only, honoring the prefix", async () => {
    const { revalidateApiQuery, invalidateApiCache, subscribeApiQuery, getApiQueryState } =
      await loadModules();
    const fetchMock = mockFetch((url) => jsonResponse({ url }));

    await revalidateApiQuery("/portfolio_data");
    await revalidateApiQuery("/portfolios");
    await revalidateApiQuery("/account/cash");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    subscribeApiQuery("/portfolio_data", () => {});
    subscribeApiQuery("/portfolios", () => {});
    // /account/cash has no subscribers.

    await invalidateApiCache("/portfolio_data");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/portfolio_data", expect.anything());

    await invalidateApiCache();
    // Both subscribed keys refetch; the unsubscribed one keeps its stale data.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(getApiQueryState("/account/cash").data).toEqual({ url: "/api/account/cash" });
  });

  it("chains a fresh fetch when invalidation lands while one is in flight", async () => {
    const { revalidateApiQuery, invalidateApiCache, subscribeApiQuery, getApiQueryState } =
      await loadModules();

    let value = "pre-write";
    let release: () => void = () => {};
    let slow = true;
    mockFetch(async () => {
      const snapshot = value; // capture at request time, like a real server
      if (slow) await new Promise<void>((resolve) => (release = resolve));
      return jsonResponse({ value: snapshot });
    });

    // Start a slow fetch, then invalidate (as a write would) before it lands.
    const first = revalidateApiQuery("/portfolio_data");
    subscribeApiQuery("/portfolio_data", () => {});
    value = "post-write";
    const invalidated = invalidateApiCache();

    slow = false;
    release(); // in-flight response returns pre-write data
    await first;
    await invalidated;

    // The chained refetch must win over the stale in-flight response.
    expect(getApiQueryState("/portfolio_data").data).toEqual({ value: "post-write" });
  });

  it("a successful mutation through apiFetch invalidates subscribed reads", async () => {
    const { apiFetch, revalidateApiQuery, subscribeApiQuery, getApiQueryState } =
      await loadModules();

    let items = ["old"];
    const fetchMock = mockFetch((url, init) => {
      if ((init?.method ?? "GET") !== "GET") {
        items = ["new"];
        return jsonResponse({ success: true });
      }
      return jsonResponse(items);
    });

    await revalidateApiQuery("/portfolio_data");
    subscribeApiQuery("/portfolio_data", () => {});
    expect(getApiQueryState("/portfolio_data").data).toEqual(["old"]);

    await apiFetch("/update_portfolio/1", { method: "POST", body: "{}" });
    // Let the invalidation-triggered refetch settle.
    await vi.waitFor(() => {
      expect(getApiQueryState("/portfolio_data").data).toEqual(["new"]);
    });
    // 1 initial GET + 1 POST + 1 refetch GET
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("UI-state writes (/state) do not trigger invalidation", async () => {
    const { apiFetch, revalidateApiQuery, subscribeApiQuery } = await loadModules();
    const fetchMock = mockFetch((url, init) =>
      (init?.method ?? "GET") !== "GET" ? jsonResponse({ success: true }) : jsonResponse([])
    );

    await revalidateApiQuery("/portfolio_data");
    subscribeApiQuery("/portfolio_data", () => {});

    await apiFetch("/state", { method: "POST", body: "{}" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 1 initial GET + 1 POST, no refetch.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces the error when the initial fetch fails", async () => {
    const { revalidateApiQuery, getApiQueryState } = await loadModules();
    mockFetch(() => jsonResponse({ error: "boom" }, 500));

    await revalidateApiQuery("/portfolio_data");
    const state = getApiQueryState("/portfolio_data");
    expect(state.data).toBeUndefined();
    expect(state.error).toBe("boom");
    expect(state.isLoading).toBe(false);
  });

  it("keeps the last good data when a background refresh fails", async () => {
    const { revalidateApiQuery, invalidateApiCache, subscribeApiQuery, getApiQueryState } =
      await loadModules();

    let fail = false;
    mockFetch(() => (fail ? jsonResponse({ error: "boom" }, 500) : jsonResponse(["good"])));

    await revalidateApiQuery("/portfolio_data");
    subscribeApiQuery("/portfolio_data", () => {});
    fail = true;
    await invalidateApiCache();

    const state = getApiQueryState("/portfolio_data");
    expect(state.data).toEqual(["good"]);
    expect(state.error).toBeNull();
  });

  it("apiPostForm parses non-2xx JSON bodies and only notifies on success", async () => {
    const { apiPostForm, revalidateApiQuery, subscribeApiQuery } = await loadModules();
    let succeed = false;
    const fetchMock = mockFetch((url, init) => {
      if ((init?.method ?? "GET") !== "GET") {
        return succeed
          ? jsonResponse({ success: true, message: "ok" })
          : jsonResponse({ success: false, message: "duplicate name" }, 400);
      }
      return jsonResponse([]);
    });

    await revalidateApiQuery("/portfolios");
    subscribeApiQuery("/portfolios", () => {});

    const failed = await apiPostForm("/manage-portfolios", new FormData());
    expect(failed).toEqual({ success: false, message: "duplicate name" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2); // no refetch on failure

    succeed = true;
    const ok = await apiPostForm("/manage-portfolios", new FormData());
    expect(ok).toEqual({ success: true, message: "ok" });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4); // POST + invalidation refetch
    });
  });
});
