"""
Characterization tests for app/utils/csv_processing/share_calculator.py.

The core reimport invariant lives here: user manual share edits must survive
CSV reimports, with only transactions NEWER than the edit applied on top.
Pure functions — no DB.
"""

import pandas as pd

from app.utils.csv_processing.share_calculator import (
    calculate_share_changes,
    calculate_share_changes_snapshot,
    identify_companies_to_remove,
)


def make_df(rows):
    """rows: list of (holdingname, type, shares, date_str)"""
    df = pd.DataFrame(
        [
            {"holdingname": name, "type": type_, "shares": shares, "parsed_date": pd.Timestamp(date)}
            for name, type_, shares, date in rows
        ]
    )
    return df


def position(shares, identifier="ID1"):
    return {"total_shares": shares, "total_invested": 0, "identifier": identifier}


class TestNoManualEdit:
    def test_plain_csv_shares_pass_through(self):
        df = make_df([("Apple", "buy", 10, "2023-01-01")])
        result = calculate_share_changes(df, {"Apple": position(10)}, {})
        assert result["Apple"] == {
            "csv_shares": 10,
            "override_shares": None,
            "has_manual_edit": False,
            "csv_modified_after_edit": False,
        }

    def test_zero_share_companies_skipped(self):
        df = make_df([("Apple", "buy", 10, "2023-01-01")])
        result = calculate_share_changes(df, {"Apple": position(0.0)}, {})
        assert "Apple" not in result


class TestManualEditProtection:
    def test_newer_transactions_applied_on_top_of_manual_shares(self):
        # User set shares to 5 on 2023-06-01; a buy of 2 happened later.
        df = make_df(
            [
                ("Apple", "buy", 10, "2023-01-01"),  # older than edit: ignored
                ("Apple", "buy", 2, "2023-07-01"),  # newer: applied
            ]
        )
        user_edits = {
            "Apple": {"manual_edit_date": "2023-06-01 00:00:00", "manual_shares": 5.0}
        }
        result = calculate_share_changes(df, {"Apple": position(12)}, user_edits)
        assert result["Apple"]["override_shares"] == 7.0  # 5 manual + 2 newer
        assert result["Apple"]["csv_shares"] == 12
        assert result["Apple"]["has_manual_edit"] is True
        assert result["Apple"]["csv_modified_after_edit"] is True

    def test_newer_sells_reduce_override(self):
        df = make_df([("Apple", "sell", 3, "2023-07-01")])
        user_edits = {
            "Apple": {"manual_edit_date": "2023-06-01 00:00:00", "manual_shares": 5.0}
        }
        result = calculate_share_changes(df, {"Apple": position(7)}, user_edits)
        assert result["Apple"]["override_shares"] == 2.0

    def test_no_newer_transactions_keeps_override_untouched(self):
        df = make_df([("Apple", "buy", 10, "2023-01-01")])
        user_edits = {
            "Apple": {"manual_edit_date": "2023-06-01 00:00:00", "manual_shares": 5.0}
        }
        result = calculate_share_changes(df, {"Apple": position(10)}, user_edits)
        assert result["Apple"]["override_shares"] == 5.0
        assert result["Apple"]["csv_modified_after_edit"] is False

    def test_identifier_fallback_when_company_renamed(self):
        # Parqet renamed 'Apple' -> 'Apple Inc'; the name map misses but the
        # identifier map preserves the override.
        df = make_df([("Apple Inc", "buy", 10, "2023-01-01")])
        identifier_edits = {
            "US037": {"manual_edit_date": "2023-06-01 00:00:00", "manual_shares": 4.0}
        }
        result = calculate_share_changes(
            df,
            {"Apple Inc": position(10, identifier="US037")},
            user_edit_map={},
            identifier_edit_map=identifier_edits,
        )
        assert result["Apple Inc"]["override_shares"] == 4.0
        assert result["Apple Inc"]["has_manual_edit"] is True

    def test_unparseable_edit_date_preserves_override(self):
        df = make_df([("Apple", "buy", 10, "2023-01-01")])
        user_edits = {
            "Apple": {"manual_edit_date": object(), "manual_shares": 5.0}
        }
        result = calculate_share_changes(df, {"Apple": position(10)}, user_edits)
        assert result["Apple"]["override_shares"] == 5.0

    def test_missing_edit_date_preserves_override(self):
        df = make_df([("Apple", "buy", 10, "2023-01-01")])
        user_edits = {"Apple": {"manual_edit_date": None, "manual_shares": 5.0}}
        result = calculate_share_changes(df, {"Apple": position(10)}, user_edits)
        assert result["Apple"]["override_shares"] == 5.0

    def test_both_zero_marks_for_removal(self):
        df = make_df([("Apple", "sell", 5, "2023-07-01")])
        user_edits = {
            "Apple": {"manual_edit_date": "2023-06-01 00:00:00", "manual_shares": 5.0}
        }
        result = calculate_share_changes(df, {"Apple": position(0.0)}, user_edits)
        assert "Apple" not in result  # 0 csv + (5 - 5) override -> removed


class TestSnapshotShareChanges:
    def test_snapshot_shares_pass_through(self):
        result = calculate_share_changes_snapshot({"Apple": position(10)}, {})
        assert result["Apple"]["csv_shares"] == 10
        assert result["Apple"]["override_shares"] is None

    def test_broker_delta_applied_to_override(self):
        # User overrode to 8 when broker said 10; broker now says 12 (+2).
        user_edits = {
            "Apple": {"manual_shares": 8.0, "original_shares": 10.0}
        }
        result = calculate_share_changes_snapshot({"Apple": position(12)}, user_edits)
        assert result["Apple"]["override_shares"] == 10.0  # 8 + 2
        assert result["Apple"]["csv_modified_after_edit"] is True

    def test_unchanged_broker_shares_keep_override(self):
        user_edits = {
            "Apple": {"manual_shares": 8.0, "original_shares": 10.0}
        }
        result = calculate_share_changes_snapshot({"Apple": position(10)}, user_edits)
        assert result["Apple"]["override_shares"] == 8.0
        assert result["Apple"]["csv_modified_after_edit"] is False

    def test_zero_snapshot_skipped(self):
        result = calculate_share_changes_snapshot({"Apple": position(0.0)}, {})
        assert result == {}


class TestIdentifyCompaniesToRemove:
    def test_removes_db_companies_missing_from_csv(self):
        removed = identify_companies_to_remove(
            csv_company_names={"Apple"},
            db_company_names={"Apple", "OldCo"},
            company_positions={"Apple": position(10)},
        )
        assert removed == {"OldCo"}

    def test_removes_existing_companies_with_zero_shares(self):
        removed = identify_companies_to_remove(
            csv_company_names={"Apple", "SoldOut"},
            db_company_names={"Apple", "SoldOut"},
            company_positions={"Apple": position(10), "SoldOut": position(0.0)},
        )
        assert removed == {"SoldOut"}

    def test_zero_share_company_not_in_db_is_not_removed(self):
        removed = identify_companies_to_remove(
            csv_company_names={"NewZero"},
            db_company_names=set(),
            company_positions={"NewZero": position(0.0)},
        )
        assert removed == set()
