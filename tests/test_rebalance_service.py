"""Parity suite for app/services/rebalance_service.py.

1:1 port of frontend/src/lib/__tests__/rebalancer-calc.test.ts (the suite of
the former client implementation) so the server engine provably reproduces
the numbers users saw before the calc moved off the client.
"""
import copy
import json
from pathlib import Path

import pytest

from app.services.rebalance_service import (
    calculate_rebalancing,
    calculate_detailed_rebalancing,
)

FIXTURE_PATH = Path(__file__).parent / 'fixtures' / 'allocation_parity_cases.json'
FIXTURE = json.loads(FIXTURE_PATH.read_text())
TOLERANCE = FIXTURE['float_tolerance']


def portfolio(name, current_value, target_weight, **extra):
    return {'name': name, 'currentValue': current_value,
            'targetWeight': target_weight, 'sectors': [], **extra}


def position(name, current_value, target_allocation, **extra):
    return {'name': name, 'investment_type': 'Stock',
            'currentValue': current_value,
            'targetAllocation': target_allocation, **extra}


def sector(name, positions):
    return {'name': name, 'companies': [],
            'positionCount': len(positions), 'positions': positions}


@pytest.fixture
def portfolios():
    return [
        portfolio('Over', 700, 50),
        portfolio('Under', 300, 50),
        portfolio('Ignored', 100, 0),  # zero target weight -> filtered out
    ]


class TestCalculateRebalancing:
    def test_filters_zero_weight_and_normalizes(self, portfolios):
        result = calculate_rebalancing(portfolios, 'new-with-sells', 0)
        assert [p['name'] for p in result] == ['Over', 'Under']
        assert result[0]['targetValue'] == 500
        assert result[1]['targetValue'] == 500

    def test_existing_only_sells_fund_buys(self, portfolios):
        result = calculate_rebalancing(portfolios, 'existing-only', 0)
        over = next(p for p in result if p['name'] == 'Over')
        under = next(p for p in result if p['name'] == 'Under')
        assert over['action'] == pytest.approx(-200)
        assert under['action'] == pytest.approx(200)
        assert over['action'] + under['action'] == pytest.approx(0)

    def test_new_only_distributes_to_underweight(self, portfolios):
        result = calculate_rebalancing(portfolios, 'new-only', 500)
        over = next(p for p in result if p['name'] == 'Over')
        under = next(p for p in result if p['name'] == 'Under')
        # new total 1500 -> targets 750 each; gaps +50/+450, 500 split pro rata
        assert over['action'] == pytest.approx(50)
        assert under['action'] == pytest.approx(450)
        assert over['action'] + under['action'] == pytest.approx(500)

    def test_new_with_sells_action_is_discrepancy(self, portfolios):
        result = calculate_rebalancing(portfolios, 'new-with-sells', 500)
        over = next(p for p in result if p['name'] == 'Over')
        assert over['action'] == pytest.approx(750 - 700)

    def test_empty_input(self):
        assert calculate_rebalancing([], 'new-only', 100) == []


class TestCalculateDetailedRebalancing:
    def test_normalizes_targets_and_computes_gaps(self):
        p = portfolio('P', 1000, 100, sectors=[
            # targets sum to 50 -> normalized x2 (i.e. 50% each)
            sector('Tech', [position('A', 700, 25)]),
            sector('Health', [position('B', 300, 25)]),
        ])
        result = calculate_detailed_rebalancing(p, 0, 'existing-only')
        positions = [x for s in result['sectors'] for x in s['positions']]
        a = next(x for x in positions if x['name'] == 'A')
        b = next(x for x in positions if x['name'] == 'B')
        assert a['calculatedTargetValue'] == pytest.approx(500)
        assert b['calculatedTargetValue'] == pytest.approx(500)
        assert a['action'] == pytest.approx(-200)
        assert b['action'] == pytest.approx(200)
        assert result['totalBuys'] == pytest.approx(200)
        assert result['totalSells'] == pytest.approx(200)

    def test_backend_target_value_bypasses_normalization(self):
        p = portfolio('P', 1000, 100, sectors=[
            sector('Tech', [position('A', 700, 0, targetValue=400)]),
            sector('Health', [position('B', 300, 0, targetValue=600)]),
        ])
        result = calculate_detailed_rebalancing(p, 0, 'new-with-sells')
        positions = [x for s in result['sectors'] for x in s['positions']]
        a = next(x for x in positions if x['name'] == 'A')
        assert a['calculatedTargetValue'] == 400
        assert a['action'] == pytest.approx(-300)

    def test_new_only_excludes_positions_at_or_above_target(self):
        p = portfolio('P', 1500, 100, sectors=[
            sector('Tech', [position('A', 1400, 50)]),
            sector('Health', [position('B', 100, 50)]),
        ])
        # portfolioTargetValue 2000 -> both target 1000. A is 400 over.
        result = calculate_detailed_rebalancing(p, 500, 'new-only')
        positions = [x for s in result['sectors'] for x in s['positions']]
        a = next(x for x in positions if x['name'] == 'A')
        b = next(x for x in positions if x['name'] == 'B')
        assert a['excludedReason'] == 'at_or_above_target'
        assert a['action'] == 0
        # B is the only positive gap, so it receives all new money
        assert b['action'] == pytest.approx(500)
        assert b['valueAfter'] == pytest.approx(600)

    def test_intra_sector_rebalancing_blocked_when_sector_at_target(self):
        # Characterization: buys are suppressed for positions whose sector has
        # no positive gap, so existing-only cannot shift money between two
        # positions of the SAME sector — the sector-level guard wins.
        p = portfolio('P', 1000, 100, sectors=[
            sector('Tech', [position('A', 700, 50), position('B', 300, 50)]),
        ])
        result = calculate_detailed_rebalancing(p, 0, 'existing-only')
        b = next(x for x in result['sectors'][0]['positions'] if x['name'] == 'B')
        assert b['excludedReason'] == 'sector_above_target'
        assert b['action'] == 0

    def test_positions_within_one_cent_marked_at_target(self):
        p = portfolio('P', 1000, 100, sectors=[
            sector('Tech', [position('A', 500, 50), position('B', 500, 50)]),
        ])
        result = calculate_detailed_rebalancing(p, 0, 'existing-only')
        for pos in result['sectors'][0]['positions']:
            assert pos['excludedReason'] == 'at_target'
            assert pos['action'] == 0

    def test_does_not_mutate_input(self):
        p = portfolio('P', 1000, 100, sectors=[
            sector('Tech', [position('A', 700, 50), position('B', 300, 50)]),
        ])
        snapshot = copy.deepcopy(p)
        calculate_detailed_rebalancing(p, 100, 'new-only')
        assert p == snapshot

    def test_builder_weights_fill_missing_target_allocations(self):
        p = portfolio('P', 1000, 100,
                      builderPositions=[
                          {'companyName': 'A', 'weight': 70},
                          {'companyName': 'B', 'weight': 30},
                      ],
                      sectors=[
                          sector('Tech', [position('A', 500, 0),
                                          position('B', 500, 0)]),
                      ])
        result = calculate_detailed_rebalancing(p, 0, 'new-with-sells')
        a = next(x for x in result['sectors'][0]['positions'] if x['name'] == 'A')
        assert a['calculatedTargetValue'] == pytest.approx(700)

    def test_summary_totals_reconcile_with_position_actions(self):
        p = portfolio('P', 1000, 100, sectors=[
            sector('Tech', [position('A', 700, 50), position('B', 300, 50)]),
        ])
        result = calculate_detailed_rebalancing(p, 200, 'new-with-sells')
        positions = [x for s in result['sectors'] for x in s['positions']]
        action_sum = sum(x.get('action') or 0 for x in positions)
        assert result['totalAction'] == pytest.approx(action_sum)
        assert result['portfolioTargetValue'] == 1200


# --- Golden-fixture parity (same file drives test_allocation_parity.py) ---
#
# rebalance_service ports the former frontend engine, so the fixtures'
# `*_frontend` overrides and `expected.frontend` action/exclusion outputs are
# this engine's golden values.

def _build_portfolios(case):
    """Adapt the language-neutral fixture shape into engine inputs."""
    portfolios = []
    for p in case['portfolios']:
        sector_order = []
        by_sector = {}
        for pos in p['positions']:
            if pos['sector'] not in by_sector:
                by_sector[pos['sector']] = []
                sector_order.append(pos['sector'])
            entry = {
                'name': pos['name'],
                'identifier': pos['name'],
                'investment_type': pos['investment_type'],
                'currentValue': pos['current_value'],
                'targetAllocation': pos['weight'],
            }
            if case['rules']:
                # Mirror production: the backend computes type-constrained
                # targets and ships them as targetValue, used verbatim.
                entry['targetValue'] = case['expected']['position_targets'][p['name']][pos['name']]
            by_sector[pos['sector']].append(entry)

        sectors = [{
            'name': name,
            'companies': [],
            'positionCount': len(by_sector[name]),
            'positions': by_sector[name],
            'currentValue': sum(x['currentValue'] for x in by_sector[name]),
        } for name in sector_order]

        portfolios.append({
            'name': p['name'],
            'currentValue': sum(x['current_value'] for x in p['positions']),
            'targetWeight': p['allocation'],
            'sectors': sectors,
        })
    return portfolios


def _approx(actual, expected, label):
    actual = actual or 0
    assert abs(actual - expected) <= TOLERANCE, (
        f'{label}: got {actual}, want {expected} (±{TOLERANCE})')


@pytest.mark.parametrize('case', FIXTURE['cases'], ids=lambda c: c['name'])
class TestGoldenFixtureParity:
    def test_portfolio_level_targets(self, case):
        # dict.get with the backend values as default: an explicitly empty
        # `*_frontend` override must win (JS `??` semantics, not `or`).
        expected = case['expected'].get(
            'portfolio_targets_frontend', case['expected']['portfolio_targets'])
        result = calculate_rebalancing(
            _build_portfolios(case), case['mode'], case['investment'])
        assert sorted(p['name'] for p in result) == sorted(expected.keys())
        for p in result:
            _approx(p['targetValue'], expected[p['name']],
                    f"{p['name']}.targetValue")

    def test_position_level_targets(self, case):
        expected = case['expected'].get(
            'position_targets_frontend', case['expected']['position_targets'])
        rebalanced = calculate_rebalancing(
            _build_portfolios(case), case['mode'], case['investment'])
        assert sorted(p['name'] for p in rebalanced) == sorted(expected.keys())
        for p in rebalanced:
            wanted = expected[p['name']]
            detailed = calculate_detailed_rebalancing(p, p['action'], case['mode'])
            positions = [x for s in detailed['sectors'] for x in s['positions']]
            assert sorted(x['name'] for x in positions) == sorted(wanted.keys())
            for pos in positions:
                _approx(pos['calculatedTargetValue'], wanted[pos['name']],
                        f"{p['name']}/{pos['name']}.calculatedTargetValue")

    def test_actions_and_exclusions(self, case):
        fe = case['expected'].get('frontend') or {}
        rebalanced = calculate_rebalancing(
            _build_portfolios(case), case['mode'], case['investment'])

        for pname, want in (fe.get('portfolio_actions') or {}).items():
            p = next((x for x in rebalanced if x['name'] == pname), None)
            assert p is not None, f'portfolio {pname} missing from result'
            _approx(p['action'], want, f'{pname}.action')

        for p in rebalanced:
            detailed = calculate_detailed_rebalancing(p, p['action'], case['mode'])
            positions = {x['name']: x
                         for s in detailed['sectors'] for x in s['positions']}

            for pos_name, want in (fe.get('position_actions') or {}).get(p['name'], {}).items():
                _approx(positions[pos_name].get('action'), want,
                        f"{p['name']}/{pos_name}.action")
            for pos_name, reason in (fe.get('excluded_reasons') or {}).get(p['name'], {}).items():
                assert positions[pos_name].get('excludedReason') == reason, (
                    f"{p['name']}/{pos_name}.excludedReason")
            if p['name'] in (fe.get('total_buys') or {}):
                _approx(detailed['totalBuys'], fe['total_buys'][p['name']],
                        f"{p['name']}.totalBuys")
            if p['name'] in (fe.get('total_sells') or {}):
                _approx(detailed['totalSells'], fe['total_sells'][p['name']],
                        f"{p['name']}.totalSells")
