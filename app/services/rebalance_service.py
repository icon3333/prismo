"""Capital-mode rebalancing engine.

Single implementation of the three capital modes (existing-only, new-only,
new-with-sells) at portfolio and position level. Ported 1:1 from the former
frontend/src/lib/rebalancer-calc.ts so the numbers users saw don't change;
the vitest suite for that module lives on as tests/test_rebalance_service.py.

Pure functions over the dict tree produced by allocation_service — no Flask,
no DB.
"""
import math
from typing import Any, Dict, List

VALID_MODES = ('existing-only', 'new-only', 'new-with-sells')


def _js_round(x: float) -> int:
    """JS Math.round (half away from zero for positives) — not banker's."""
    return int(math.floor(x + 0.5))


def calculate_rebalancing(portfolios: List[Dict[str, Any]], mode: str,
                          investment_amount: float) -> List[Dict[str, Any]]:
    """Portfolio-level rebalancing: target values, discrepancies, actions.

    Returns new dicts (shallow copies of the inputs plus targetValue /
    discrepancy / action); portfolios with targetWeight <= 0 are dropped.
    """
    filtered = [p for p in portfolios if (p.get('targetWeight') or 0) > 0]
    if not filtered:
        return []

    total_current_value = sum((p.get('currentValue') or 0) for p in filtered)
    new_total_value = (
        total_current_value if mode == 'existing-only'
        else total_current_value + investment_amount
    )
    total_target_weight = sum((p.get('targetWeight') or 0) for p in filtered)

    result = []
    for p in filtered:
        normalized_weight = (
            (p.get('targetWeight') or 0) / total_target_weight * 100
            if total_target_weight > 0 else 0
        )
        target_value = (normalized_weight / 100) * new_total_value
        entry = dict(p)
        entry['targetValue'] = target_value
        entry['discrepancy'] = target_value - (p.get('currentValue') or 0)
        entry['action'] = 0
        result.append(entry)

    _apply_rebalancing_actions(result, mode, investment_amount)
    return result


def _apply_rebalancing_actions(portfolios: List[Dict[str, Any]], mode: str,
                               investment_amount: float) -> None:
    if mode == 'existing-only':
        positive_gaps = []
        negative_gaps = []
        total_positive_gap = 0.0
        total_negative_gap = 0.0

        for p in portfolios:
            if abs(p['discrepancy']) < 0.01:
                p['action'] = 0
            elif p['discrepancy'] > 0:
                positive_gaps.append(p)
                total_positive_gap += p['discrepancy']
            else:
                negative_gaps.append(p)
                total_negative_gap += abs(p['discrepancy'])

        rebalance_amount = min(total_positive_gap, total_negative_gap)

        for p in positive_gaps:
            p['action'] = (p['discrepancy'] / total_positive_gap) * rebalance_amount
        for p in negative_gaps:
            p['action'] = -1 * (abs(p['discrepancy']) / total_negative_gap) * rebalance_amount

    elif mode == 'new-only':
        total_gap = 0.0
        eligible = []

        for p in portfolios:
            if p['discrepancy'] <= 0:
                p['action'] = 0
            else:
                eligible.append(p)
                total_gap += p['discrepancy']

        if investment_amount > 0 and total_gap > 0:
            for p in eligible:
                p['action'] = (p['discrepancy'] / total_gap) * investment_amount

    else:  # new-with-sells
        for p in portfolios:
            p['action'] = 0 if abs(p['discrepancy']) < 0.01 else p['discrepancy']


def calculate_detailed_rebalancing(portfolio: Dict[str, Any],
                                   portfolio_action_amount: float,
                                   mode: str) -> Dict[str, Any]:
    """Position-level plan for one portfolio (the former 5-pass client algorithm).

    Does not mutate the input; positions are cloned into the result.
    """
    total_current_value = portfolio.get('currentValue') or 0
    portfolio_target_value = total_current_value + portfolio_action_amount

    sectors = portfolio.get('sectors') or []
    builder_positions = portfolio.get('builderPositions') or []

    builder_weight_map = {
        bp['companyName']: (bp.get('weight') or 0)
        for bp in builder_positions
        if not bp.get('isPlaceholder') and bp.get('companyName')
    }
    placeholder_bp = next(
        (bp for bp in builder_positions if bp.get('isPlaceholder')), None)

    # === Pass 1: count positions and gather allocations ===
    total_positions_count = 0
    user_defined_count = 0
    sum_user_defined = 0.0

    for sector in sectors:
        positions = sector.get('positions') or []
        if not positions:
            continue
        if sector.get('name') == 'Missing Positions':
            ph = next((p for p in positions if p.get('isPlaceholder')), None)
            if ph:
                total_positions_count += ph.get('positionsRemaining') or 0
        else:
            for pos in positions:
                total_positions_count += 1
                if (pos.get('targetAllocation') or 0) > 0:
                    user_defined_count += 1
                    sum_user_defined += pos['targetAllocation']

    if placeholder_bp:
        default_allocation = placeholder_bp.get('weight') or 0
    elif sum_user_defined < 100:
        without_defined = total_positions_count - user_defined_count
        default_allocation = (
            (100 - sum_user_defined) / without_defined if without_defined > 0 else 0)
    else:
        default_allocation = 0

    # === Pass 2: should the Missing Positions sector be shown? ===
    should_show_missing_positions = False
    missing_positions_sector = next(
        (s for s in sectors
         if s.get('name') == 'Missing Positions'
         or any(p.get('isPlaceholder') for p in (s.get('positions') or []))),
        None)

    if missing_positions_sector:
        real_bp = [bp for bp in builder_positions if not bp.get('isPlaceholder')]
        total_real_weight = sum((bp.get('weight') or 0) for bp in real_bp)
        effective_positions = (
            portfolio.get('effectivePositions')
            if portfolio.get('effectivePositions') is not None
            else portfolio.get('minPositions') or 0
        )
        current_count = sum(
            len(s.get('positions') or [])
            for s in sectors if s.get('name') != 'Missing Positions')
        should_show_missing_positions = (
            current_count < effective_positions
            and _js_round(total_real_weight) < 100
        )

    # === Pass 3: assign target allocations ===
    total_target_allocation = 0.0
    has_backend_constraints = False
    working_sectors = []

    for sector in sectors:
        positions = sector.get('positions') or []
        if not positions:
            continue
        if sector.get('name') == 'Missing Positions' and not should_show_missing_positions:
            continue

        cloned_positions = [dict(p) for p in positions]
        working_sectors.append({
            'name': sector.get('name'),
            'positions': cloned_positions,
            'isPlaceholder': sector.get('isPlaceholder'),
            '_currentValue': 0.0,
            '_targetAlloc': 0.0,
            '_calcTargetValue': 0.0,
        })

        for pos in cloned_positions:
            if pos.get('targetValue') is not None:
                has_backend_constraints = True
                backend_pct = (
                    pos['targetValue'] / portfolio_target_value * 100
                    if portfolio_target_value > 0 else 0)
                total_target_allocation += backend_pct
            else:
                if not pos.get('targetAllocation') or pos['targetAllocation'] <= 0:
                    pos['targetAllocation'] = builder_weight_map.get(
                        pos.get('name'), default_allocation)
                total_target_allocation += pos['targetAllocation']

    norm_factor = (
        100 / total_target_allocation
        if not has_backend_constraints and total_target_allocation > 0 else 1)

    # === Pass 4: normalize and calculate target values ===
    for ws in working_sectors:
        sector_current_value = 0.0
        sector_target_alloc = 0.0

        for pos in ws['positions']:
            sector_current_value += pos.get('currentValue') or 0

            if pos.get('targetValue') is not None:
                pos['calculatedTargetValue'] = pos['targetValue']
                backend_alloc = (
                    pos['targetValue'] / portfolio_target_value * 100
                    if portfolio_target_value > 0 else 0)
                sector_target_alloc += backend_alloc
            else:
                normalized_alloc = pos['targetAllocation'] * norm_factor
                sector_target_alloc += normalized_alloc
                pos['calculatedTargetValue'] = (
                    normalized_alloc / 100) * portfolio_target_value

        ws['_currentValue'] = sector_current_value
        ws['_targetAlloc'] = sector_target_alloc
        ws['_calcTargetValue'] = (sector_target_alloc / 100) * portfolio_target_value

    # === Pass 5: unified allocation distribution ===
    positive_gaps = []
    negative_gaps = []
    total_positive_gap = 0.0
    total_negative_gap = 0.0

    for ws in working_sectors:
        sector_gap = ws['_calcTargetValue'] - ws['_currentValue']

        for pos in ws['positions']:
            pos_current_value = pos.get('currentValue') or 0
            pos_target_value = pos.get('calculatedTargetValue') or 0
            pos_gap = pos_target_value - pos_current_value
            pos['gap'] = pos_gap

            if abs(pos_gap) < 0.01:
                pos['excludedReason'] = 'at_target'
                pos['action'] = 0
                pos['valueAfter'] = pos_current_value
            elif sector_gap <= 0 and pos_gap > 0:
                pos['excludedReason'] = 'sector_above_target'
                pos['action'] = 0
                pos['valueAfter'] = pos_current_value
            elif mode == 'new-only' and pos_gap <= 0:
                pos['excludedReason'] = 'at_or_above_target'
                pos['action'] = 0
                pos['valueAfter'] = pos_current_value
            elif mode in ('existing-only', 'new-with-sells'):
                if pos_gap > 0:
                    positive_gaps.append((pos, pos_gap))
                    total_positive_gap += pos_gap
                else:
                    negative_gaps.append((pos, abs(pos_gap)))
                    total_negative_gap += abs(pos_gap)
            else:
                # new-only with positive gap
                positive_gaps.append((pos, pos_gap))
                total_positive_gap += pos_gap

    if mode == 'new-only':
        if total_positive_gap > 0 and portfolio_action_amount > 0:
            available = max(0, portfolio_action_amount)
            for pos, gap in positive_gaps:
                alloc = (gap / total_positive_gap) * available
                pos['action'] = alloc
                pos['valueAfter'] = (pos.get('currentValue') or 0) + alloc
    elif mode == 'existing-only':
        rebalance_amount = min(total_positive_gap, total_negative_gap)
        if rebalance_amount > 0:
            if total_positive_gap > 0:
                for pos, gap in positive_gaps:
                    alloc = (gap / total_positive_gap) * rebalance_amount
                    pos['action'] = alloc
                    pos['valueAfter'] = (pos.get('currentValue') or 0) + alloc
            if total_negative_gap > 0:
                for pos, gap in negative_gaps:
                    alloc = (gap / total_negative_gap) * rebalance_amount
                    pos['action'] = -alloc
                    pos['valueAfter'] = (pos.get('currentValue') or 0) - alloc
    else:  # new-with-sells
        for pos, gap in positive_gaps:
            pos['action'] = gap
            pos['valueAfter'] = (pos.get('currentValue') or 0) + gap
        for pos, gap in negative_gaps:
            pos['action'] = -gap
            pos['valueAfter'] = (pos.get('currentValue') or 0) - gap

    for ws in working_sectors:
        for pos in ws['positions']:
            if 'action' not in pos:
                pos['action'] = 0
                pos['valueAfter'] = pos.get('currentValue') or 0

    # Build result sectors
    total_action = 0.0
    total_value_after = 0.0
    total_buys = 0.0
    total_sells = 0.0
    detailed_sectors = []

    for ws in working_sectors:
        action_sum = 0.0
        value_after_sum = 0.0
        sector_current_value = 0.0

        for pos in ws['positions']:
            act = pos.get('action') or 0
            va = pos['valueAfter'] if pos.get('valueAfter') is not None else (
                pos.get('currentValue') or 0)
            action_sum += act
            value_after_sum += va
            sector_current_value += pos.get('currentValue') or 0

            if act > 0.01:
                total_buys += act
            elif act < -0.01:
                total_sells += abs(act)

        total_action += action_sum
        total_value_after += value_after_sum

        detailed_sectors.append({
            'name': ws['name'],
            'positions': ws['positions'],
            'currentValue': sector_current_value,
            'targetAllocation': ws['_targetAlloc'],
            'calculatedTargetValue': ws['_calcTargetValue'],
            'actionSum': action_sum,
            'valueAfterSum': value_after_sum,
            'isPlaceholder': ws['isPlaceholder'],
        })

    return {
        'sectors': detailed_sectors,
        'shouldShowMissingPositions': should_show_missing_positions,
        'portfolioTargetValue': portfolio_target_value,
        'totalCurrentValue': total_current_value,
        'totalAction': total_action,
        'totalValueAfter': total_value_after,
        'totalBuys': total_buys,
        'totalSells': total_sells,
    }
