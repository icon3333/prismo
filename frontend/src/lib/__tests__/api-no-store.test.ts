import { beforeEach, describe, expect, it, vi } from "vitest";

describe("apiFetch noStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("passes browser cache no-store to fetch", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ status: "processing" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await import("@/lib/api");

    await apiFetch("/simple_upload_progress?job_id=job-1", { noStore: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/simple_upload_progress?job_id=job-1",
      expect.objectContaining({ cache: "no-store" })
    );
  });
});
