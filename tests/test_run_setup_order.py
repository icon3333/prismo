import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
RUN_PY = REPO_ROOT / "run.py"


class RunSetupOrderTests(unittest.TestCase):
    def test_setup_env_runs_before_flask_app_creation(self):
        env = os.environ.copy()
        for key in ("SECRET_KEY", "DATABASE_URL", "FLASK_ENV"):
            env.pop(key, None)
        env["PYTHONPATH"] = str(REPO_ROOT)

        with tempfile.TemporaryDirectory() as tmpdir:
            result = subprocess.run(
                [sys.executable, str(RUN_PY), "--setup-env", "--production"],
                cwd=tmpdir,
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10,
            )

            self.assertEqual(
                result.returncode,
                0,
                msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
            )
            env_file = Path(tmpdir) / ".env"
            self.assertTrue(env_file.exists())
            contents = env_file.read_text()
            self.assertIn("SECRET_KEY=", contents)
            self.assertIn("FLASK_ENV=production", contents)


if __name__ == "__main__":
    unittest.main()
