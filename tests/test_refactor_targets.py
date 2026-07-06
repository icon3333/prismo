import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (REPO_ROOT / path).read_text()


class RefactorTargetTests(unittest.TestCase):
    def test_backend_route_implementations_are_split_by_domain(self):
        expected_modules = [
            "app/routes/portfolio_account_api.py",
            "app/routes/portfolio_builder_api.py",
            "app/routes/portfolio_manual_api.py",
            "app/routes/portfolio_simulator_api.py",
            "app/routes/portfolio_state_api.py",
            "app/routes/portfolio_data_api.py",
            "app/routes/portfolio_company_api.py",
        ]
        for module in expected_modules:
            self.assertTrue((REPO_ROOT / module).exists(), module)

        routes = read("app/routes/portfolio_api_routes.py")
        for module in expected_modules:
            module_name = module.removesuffix(".py").replace("/", ".")
            self.assertIn(module_name, routes)

        # The old monolith is fully dissolved
        self.assertFalse((REPO_ROOT / "app/routes/portfolio_api.py").exists())

    def test_hooks_delegate_autosave_and_export_logic(self):
        simulator_hook = read("frontend/src/hooks/use-simulator.ts")
        builder_hook = read("frontend/src/hooks/use-builder.ts")

        self.assertIn("useSimulationAutosave", simulator_hook)
        self.assertNotIn("const doAutoSave", simulator_hook)
        self.assertNotIn("autoSaveErrorCountRef", simulator_hook)

        self.assertIn("exportBuilderPDF", builder_hook)
        self.assertNotIn('await import("jspdf")', builder_hook)
        self.assertNotIn("doc.roundedRect", builder_hook)

    def test_overview_uses_terminal_operator_language(self):
        overview = read("frontend/src/app/(dashboard)/page.tsx")

        self.assertNotIn("Welcome", overview)
        self.assertNotIn("Your portfolio at a glance", overview)
        self.assertNotIn("rounded-full", overview)
        self.assertNotIn("border-l-4", overview)
        self.assertIn("OPERATOR OVERVIEW", overview)
        self.assertIn("Portfolio Status", overview)

    def test_date_formatting_is_centralized(self):
        allowed = {
            "frontend/src/lib/format.ts",
            "frontend/src/lib/staleness.ts",
        }
        direct_locale_calls = []
        for path in (REPO_ROOT / "frontend/src").rglob("*"):
            if path.suffix not in {".ts", ".tsx"}:
                continue
            rel = path.relative_to(REPO_ROOT).as_posix()
            if rel in allowed:
                continue
            text = path.read_text()
            if re.search(r"\.toLocale(?:Date|Time)String\(", text):
                direct_locale_calls.append(rel)
        self.assertEqual([], direct_locale_calls)

    def test_residual_terminal_primitive_drift_is_removed(self):
        checks = {
            "frontend/src/components/domain/slider-item.tsx": [
                "rounded-full",
                "bg-gradient-to-r",
                "border-l-3",
            ],
            "frontend/src/components/ui/sheet.tsx": ["backdrop-blur"],
            "frontend/src/components/ui/checkbox.tsx": ["ring-3"],
            "frontend/src/app/(dashboard)/concentrations/portfolio-filter.tsx": [
                "rounded-full",
            ],
        }
        for file_path, forbidden_tokens in checks.items():
            text = read(file_path)
            for token in forbidden_tokens:
                self.assertNotIn(token, text, f"{file_path}: {token}")


if __name__ == "__main__":
    unittest.main()
