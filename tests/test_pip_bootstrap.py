import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

import start


REPO_ROOT = Path(__file__).resolve().parents[1]
PIP_FLOOR = "pip>=26.1.2"


class PipBootstrapTests(unittest.TestCase):
    def test_launcher_upgrades_pip_floor_before_requirements(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            venv = Path(tmpdir) / "venv"
            python = venv / "bin" / "python3"
            requirements = Path(tmpdir) / "requirements.txt"
            venv.mkdir()
            requirements.touch()

            with (
                patch.object(start, "VENV", venv),
                patch.object(start, "VENV_PY", python),
                patch.object(start, "REQ", requirements),
                patch.object(start.subprocess, "check_call") as check_call,
            ):
                start.pip_install(force=True)

            self.assertEqual(
                check_call.call_args_list,
                [
                    call(
                        [str(python), "-m", "pip", "install", "--upgrade", PIP_FLOOR, "--quiet"]
                    ),
                    call(
                        [str(python), "-m", "pip", "install", "-r", str(requirements), "--quiet"]
                    ),
                ],
            )

    def test_documented_and_automated_installs_apply_pip_floor_first(self):
        expected_sequences = {
            "README.md": [
                'python -m pip install --upgrade "pip>=26.1.2"',
                "python -m pip install -r requirements.txt",
            ],
            ".github/workflows/test.yml": [
                'python -m pip install --upgrade "pip>=26.1.2"',
                "python -m pip install -r requirements-dev.txt",
            ],
            "test.sh": [
                '"$PY" -m pip install -q --upgrade "pip>=26.1.2"',
                '"$PY" -m pip install -q -r requirements-dev.txt',
            ],
            "CLAUDE.md": [
                'venv/bin/python -m pip install --upgrade "pip>=26.1.2"',
                "venv/bin/python -m pip install -r requirements-dev.txt",
            ],
            "requirements-dev.txt": [
                'python -m pip install --upgrade "pip>=26.1.2"',
                "python -m pip install -r requirements-dev.txt",
            ],
        }

        for relative_path, commands in expected_sequences.items():
            with self.subTest(path=relative_path):
                contents = (REPO_ROOT / relative_path).read_text()
                positions = [contents.index(command) for command in commands]
                self.assertEqual(positions, sorted(positions))


if __name__ == "__main__":
    unittest.main()
