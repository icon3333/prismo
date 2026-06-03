import type { PersistedState } from "@/types/simulator";

const LS_KEY = "simulator_state";

export function loadPersistedState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function savePersistedState(state: PersistedState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // Ignore unavailable storage.
  }
}
