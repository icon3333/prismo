import type {
  PersistedState,
  SimulatorMode,
  SimulatorScope,
} from "@/types/simulator";

/**
 * Serialization for the simulator's selection state, persisted server-side
 * in the expanded_state table under page 'simulator' (string values per key),
 * so the selection follows the user across browsers.
 */

export const DEFAULT_PERSISTED_STATE: PersistedState = {
  mode: "overlay",
  scope: "global",
  portfolioId: null,
  overlaySimulationId: null,
  portfolioSimulationId: null,
};

function parseId(raw: string | undefined): number | null {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

export function parsePersistedState(
  raw: Record<string, string> | null | undefined
): PersistedState {
  if (!raw) return { ...DEFAULT_PERSISTED_STATE };
  return {
    mode:
      raw.mode === "portfolio" || raw.mode === "overlay"
        ? (raw.mode as SimulatorMode)
        : DEFAULT_PERSISTED_STATE.mode,
    scope:
      raw.scope === "portfolio" || raw.scope === "global"
        ? (raw.scope as SimulatorScope)
        : DEFAULT_PERSISTED_STATE.scope,
    portfolioId: parseId(raw.portfolioId),
    overlaySimulationId: parseId(raw.overlaySimulationId),
    portfolioSimulationId: parseId(raw.portfolioSimulationId),
  };
}

export function serializePersistedState(
  state: PersistedState
): Record<string, string> {
  return {
    mode: state.mode,
    scope: state.scope,
    portfolioId: state.portfolioId != null ? String(state.portfolioId) : "",
    overlaySimulationId:
      state.overlaySimulationId != null
        ? String(state.overlaySimulationId)
        : "",
    portfolioSimulationId:
      state.portfolioSimulationId != null
        ? String(state.portfolioSimulationId)
        : "",
  };
}
