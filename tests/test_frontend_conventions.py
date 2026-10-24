"""Cross-cutting frontend conventions that no single unit test can catch.

Deliberately narrow: only invariants where a violation is a real user-visible
bug, not a snapshot of how the code happens to look today.
"""

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


class FrontendConventionTests(unittest.TestCase):
    def test_date_formatting_is_centralized(self):
        """All dates render through lib/format.ts and lib/staleness.ts.

        A stray toLocaleDateString() picks up the browser's locale, so the same
        timestamp renders differently from one component to the next.
        """
        allowed = {
            "frontend/src/lib/format.ts",
            "frontend/src/lib/staleness.ts",
        }
        offenders = [
            path.relative_to(REPO_ROOT).as_posix()
            for path in (REPO_ROOT / "frontend/src").rglob("*")
            if path.suffix in {".ts", ".tsx"}
            and path.relative_to(REPO_ROOT).as_posix() not in allowed
            and re.search(r"\.toLocale(?:Date|Time)String\(", path.read_text())
        ]
        self.assertEqual([], offenders)


if __name__ == "__main__":
    unittest.main()
