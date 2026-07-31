// Staleness classifier — Terminal §12.1.
// Buckets a "last update" timestamp into one of four levels and produces
// the masthead/cell label. Times rendered in 24h CET ("Europe/Berlin").

export type Staleness = "live" | "recent" | "stale" | "disconnected";

export interface StalenessResult {
  level: Staleness;
  label: string;
  ageMs: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatCetTime(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
  return `${time} CET`;
}

function formatAge(ageMs: number): string {
  if (ageMs < MINUTE) return "JUST NOW";
  if (ageMs < HOUR) return `${Math.floor(ageMs / MINUTE)}m AGO`;
  if (ageMs < DAY) return `${Math.floor(ageMs / HOUR)}h AGO`;
  return `${Math.floor(ageMs / DAY)}d AGO`;
}

export function classifyStaleness(
  lastUpdateMs: number | null | undefined,
  nowMs: number = Date.now(),
): StalenessResult {
  if (lastUpdateMs == null || !Number.isFinite(lastUpdateMs)) {
    return {
      level: "disconnected",
      label: "NO VALUATION DATA",
      ageMs: Infinity,
    };
  }

  const ageMs = Math.max(0, nowMs - lastUpdateMs);

  if (ageMs <= DAY) {
    return {
      level: "live",
      label: `CURRENT · EUR · ${formatCetTime(lastUpdateMs)}`,
      ageMs,
    };
  }
  return {
    level: "stale",
    label: `STALE · ${formatAge(ageMs)}`,
    ageMs,
  };
}
