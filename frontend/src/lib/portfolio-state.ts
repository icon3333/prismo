import { apiFetch } from "@/lib/api";

/**
 * Cross-page portfolio selection persistence.
 * Uses the "global" page in expanded_state to store the selected portfolio.
 */
export const PortfolioState = {
  async get(): Promise<string | null> {
    try {
      const state = await apiFetch<Record<string, string>>(
        "/state?page=global"
      );
      return state.selectedPortfolioId ?? null;
    } catch {
      return null;
    }
  },

  async set(id: string): Promise<void> {
    try {
      await apiFetch("/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: "global",
          selectedPortfolioId: id,
        }),
      });
    } catch {
      // Silently fail
    }
  },
};
