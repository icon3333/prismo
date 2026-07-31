import { describe, expect, it } from "vitest";
import { classifyStaleness } from "@/lib/staleness";
import { parseServerTimestampMs } from "@/lib/enrich-calc";

const NOW = Date.parse("2026-07-19T12:00:00Z");

describe("classifyStaleness", () => {
  it("labels a valuation at the 24-hour boundary as current", () => {
    expect(classifyStaleness(NOW - 24 * 60 * 60 * 1000, NOW)).toEqual({
      level: "live",
      label: "CURRENT · EUR · 14:00 CET",
      ageMs: 24 * 60 * 60 * 1000,
    });
  });

  it("labels older valuations stale with their age", () => {
    expect(classifyStaleness(NOW - 49 * 60 * 60 * 1000, NOW)).toEqual({
      level: "stale",
      label: "STALE · 2d AGO",
      ageMs: 49 * 60 * 60 * 1000,
    });
  });

  it.each([null, undefined, Number.NaN])(
    "labels %s as missing valuation data",
    (lastUpdate) => {
      expect(classifyStaleness(lastUpdate, NOW)).toEqual({
        level: "disconnected",
        label: "NO VALUATION DATA",
        ageMs: Infinity,
      });
    },
  );

  it("labels an invalid server timestamp as missing valuation data", () => {
    expect(classifyStaleness(parseServerTimestampMs("invalid"), NOW)).toMatchObject({
      level: "disconnected",
      label: "NO VALUATION DATA",
    });
  });

  it("treats a future timestamp as current without a negative age", () => {
    expect(classifyStaleness(NOW + 60_000, NOW)).toMatchObject({
      level: "live",
      label: "CURRENT · EUR · 14:01 CET",
      ageMs: 0,
    });
  });
});
