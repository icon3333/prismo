/**
 * Golden-fixture parity tests for the frontend rebalancing math.
 *
 * The SAME fixture file (tests/fixtures/allocation_parity_cases.json, repo
 * root) drives tests/test_allocation_parity.py, so the duplicated
 * TypeScript/Python allocation math cannot silently drift: changing either
 * implementation forces an update of the shared golden numbers, which fails
 * the other side's suite.
 *
 * Fixture conventions:
 * - `position_targets` / `portfolio_targets` are BACKEND-canonical values;
 *   the frontend must match them wherever weights sum to 100.
 * - `*_frontend` overrides encode known, intentional divergences (this side
 *   normalizes weights to 100% and back-fills zero weights; the backend
 *   applies raw weights) — see the `divergence` note on those cases.
 * - For cases with `rules`, `position_targets` are the backend's type-
 *   constrained values; mirroring production, they are injected here as
 *   `position.targetValue` and must pass through unchanged.
 * - `expected.frontend` holds frontend-only buy/sell outputs (the backend's
 *   generate_rebalancing_plan is a passthrough with no action math).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  calculateRebalancing,
  calculateDetailedRebalancing,
} from "@/lib/rebalancer-calc";
import type {
  Portfolio,
  PortfolioPosition,
  PortfolioSector,
  RebalanceMode,
} from "@/types/portfolio";

interface FixturePosition {
  name: string;
  sector: string;
  weight: number;
  current_value: number;
  investment_type: "Stock" | "ETF" | "Crypto";
}

interface FixturePortfolio {
  name: string;
  allocation: number;
  positions: FixturePosition[];
}

type ValueMap = Record<string, number>;
type NestedValueMap = Record<string, ValueMap>;

interface FixtureCase {
  name: string;
  description: string;
  divergence?: string;
  mode: RebalanceMode;
  investment: number;
  rules: Record<string, number> | null;
  portfolios: FixturePortfolio[];
  expected: {
    portfolio_targets: ValueMap;
    portfolio_targets_frontend?: ValueMap;
    position_targets: NestedValueMap;
    position_targets_frontend?: NestedValueMap;
    frontend?: {
      portfolio_actions?: ValueMap;
      position_actions?: NestedValueMap;
      excluded_reasons?: Record<string, Record<string, string>>;
      total_buys?: ValueMap;
      total_sells?: ValueMap;
    };
  };
}

interface Fixture {
  float_tolerance: number;
  cases: FixtureCase[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(
    new URL("../../../../tests/fixtures/allocation_parity_cases.json", import.meta.url),
    "utf-8"
  )
);

const TOLERANCE = fixture.float_tolerance;

function approx(actual: number | undefined, expected: number, label: string) {
  expect(
    Math.abs((actual ?? 0) - expected),
    `${label}: got ${actual}, want ${expected} (±${TOLERANCE})`
  ).toBeLessThanOrEqual(TOLERANCE);
}

/** Adapt the language-neutral fixture shape into rebalancer-calc inputs. */
function buildPortfolios(c: FixtureCase): Portfolio[] {
  return c.portfolios.map((p) => {
    const sectorOrder: string[] = [];
    const bySector = new Map<string, PortfolioPosition[]>();

    for (const pos of p.positions) {
      if (!bySector.has(pos.sector)) {
        bySector.set(pos.sector, []);
        sectorOrder.push(pos.sector);
      }
      const entry: PortfolioPosition = {
        name: pos.name,
        identifier: pos.name,
        investment_type: pos.investment_type,
        currentValue: pos.current_value,
        targetAllocation: pos.weight,
      };
      if (c.rules) {
        // Mirror production: the backend computes type-constrained targets
        // and ships them as targetValue; the frontend uses them verbatim.
        entry.targetValue = c.expected.position_targets[p.name][pos.name];
      }
      bySector.get(pos.sector)!.push(entry);
    }

    const sectors: PortfolioSector[] = sectorOrder.map((name) => {
      const positions = bySector.get(name)!;
      return {
        name,
        companies: [],
        positionCount: positions.length,
        positions,
        currentValue: positions.reduce((s, x) => s + x.currentValue, 0),
      };
    });

    return {
      name: p.name,
      currentValue: p.positions.reduce((s, x) => s + x.current_value, 0),
      targetWeight: p.allocation,
      sectors,
    };
  });
}

for (const c of fixture.cases) {
  describe(c.name, () => {
    const expectedPortfolioTargets =
      c.expected.portfolio_targets_frontend ?? c.expected.portfolio_targets;
    const expectedPositionTargets =
      c.expected.position_targets_frontend ?? c.expected.position_targets;

    it("portfolio-level targets match golden values", () => {
      const result = calculateRebalancing(buildPortfolios(c), c.mode, c.investment);
      expect(result.map((p) => p.name).sort()).toEqual(
        Object.keys(expectedPortfolioTargets).sort()
      );
      for (const p of result) {
        approx(p.targetValue, expectedPortfolioTargets[p.name], `${p.name}.targetValue`);
      }
    });

    it("position-level targets match golden values", () => {
      const rebalanced = calculateRebalancing(buildPortfolios(c), c.mode, c.investment);
      expect(rebalanced.map((p) => p.name).sort()).toEqual(
        Object.keys(expectedPositionTargets).sort()
      );
      for (const p of rebalanced) {
        const wanted = expectedPositionTargets[p.name];
        const detailed = calculateDetailedRebalancing(p, p.action, c.mode);
        const positions = detailed.sectors.flatMap((s) => s.positions);
        expect(positions.map((x) => x.name).sort()).toEqual(Object.keys(wanted).sort());
        for (const pos of positions) {
          approx(
            pos.calculatedTargetValue,
            wanted[pos.name],
            `${p.name}/${pos.name}.calculatedTargetValue`
          );
        }
      }
    });

    const fe = c.expected.frontend;
    if (fe?.portfolio_actions) {
      const portfolioActions = fe.portfolio_actions;
      it("portfolio-level actions match golden values", () => {
        const result = calculateRebalancing(buildPortfolios(c), c.mode, c.investment);
        for (const [pname, want] of Object.entries(portfolioActions)) {
          const p = result.find((x) => x.name === pname);
          expect(p, `portfolio ${pname} missing from result`).toBeDefined();
          approx(p!.action, want, `${pname}.action`);
        }
      });
    }

    if (fe?.position_actions || fe?.excluded_reasons || fe?.total_buys || fe?.total_sells) {
      it("position-level actions and exclusions match golden values", () => {
        const rebalanced = calculateRebalancing(buildPortfolios(c), c.mode, c.investment);
        for (const p of rebalanced) {
          const detailed = calculateDetailedRebalancing(p, p.action, c.mode);
          const positions = new Map(
            detailed.sectors.flatMap((s) => s.positions).map((x) => [x.name, x])
          );

          for (const [posName, want] of Object.entries(fe.position_actions?.[p.name] ?? {})) {
            approx(positions.get(posName)?.action, want, `${p.name}/${posName}.action`);
          }
          for (const [posName, reason] of Object.entries(fe.excluded_reasons?.[p.name] ?? {})) {
            expect(
              positions.get(posName)?.excludedReason,
              `${p.name}/${posName}.excludedReason`
            ).toBe(reason);
          }
          if (fe.total_buys && p.name in fe.total_buys) {
            approx(detailed.totalBuys, fe.total_buys[p.name], `${p.name}.totalBuys`);
          }
          if (fe.total_sells && p.name in fe.total_sells) {
            approx(detailed.totalSells, fe.total_sells[p.name], `${p.name}.totalSells`);
          }
        }
      });
    }
  });
}
