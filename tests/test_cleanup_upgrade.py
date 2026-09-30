"""Exercise transaction-only upgrade rollback cleanup in a fake router tree."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "packaging/recovery/cleanup-upgrade.sh"


class CleanupUpgradeTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.recovery = self.root / "etc/fips-recovery"
        self.saved = self.recovery / "tx1/backup/guard-files"
        self.saved.mkdir(parents=True)
        (self.recovery / "tx1/result").write_text("ROLLED_BACK tx1\n")
        (self.recovery / "older/result").parent.mkdir()
        (self.recovery / "older/result").write_text("CONFIRMED older\n")
        init = self.root / "etc/init.d/fips-recovery"
        init.parent.mkdir(parents=True)
        init.write_text('#!/bin/sh\ncase "$1" in enabled|status) exit 0;; esac\nexit 2\n')
        init.chmod(0o755)
        files = {
            "guard.sh": b"#!/bin/sh\necho NONE\n",
            "health.sh": b"previous health\n",
            "probes.json": b'{"ip":"1.1.1.1"}\n',
            "apply-initial.sh": b"previous apply\n",
            "runtime-packages": b"python3\n",
            "init": init.read_bytes(),
        }
        for name, content in files.items():
            target = init if name == "init" else self.recovery / name
            if name != "init":
                target.write_bytes(content)
            target.chmod(0o700 if name == "guard.sh" else target.stat().st_mode & 0o777)
            saved = self.saved / name
            saved.write_bytes(content)
            saved.chmod(target.stat().st_mode & 0o777)
            os.utime(saved, (target.stat().st_atime, target.stat().st_mtime))
            (self.saved / f"{name}.state").write_text("present\n")
        self.files = files
        self.env = os.environ | {"FIPS_TEST_FS_ROOT": str(self.root)}

    def run_cleanup(self, expected: int = 0) -> str:
        result = subprocess.run(["sh", str(SCRIPT), "tx1"], env=self.env,
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result.stdout

    def test_removes_only_completed_transaction_and_is_idempotent(self) -> None:
        (self.recovery / "guard.sh.tmp").write_text("incomplete candidate")
        self.assertIn("UPGRADE_CLEAN", self.run_cleanup())
        self.assertFalse((self.recovery / "tx1").exists())
        self.assertFalse((self.recovery / "guard.sh.tmp").exists())
        self.assertTrue((self.recovery / "older/result").exists())
        self.assertEqual((self.recovery / "guard.sh").read_bytes(), self.files["guard.sh"])
        self.assertTrue((self.root / "etc/init.d/fips-recovery").exists())
        self.assertIn("UPGRADE_CLEAN", self.run_cleanup())

    def test_refuses_pending_wrong_result_or_changed_prior_guard(self) -> None:
        pending = self.recovery / "pending"
        pending.write_text("tx1 123 123 boot\n")
        self.run_cleanup(expected=1)
        pending.unlink()
        (self.recovery / "tx1/result").write_text("CONFIRMED tx1\n")
        self.run_cleanup(expected=1)
        (self.recovery / "tx1/result").write_text("ROLLED_BACK tx1\n")
        (self.recovery / "health.sh").write_text("candidate health\n")
        self.run_cleanup(expected=1)
        (self.recovery / "health.sh").write_bytes(self.files["health.sh"])
        (self.recovery / "health.sh").chmod(0o600)
        self.run_cleanup(expected=1)
        self.assertTrue((self.recovery / "tx1").exists())

    def test_cleanup_marker_allows_retry_after_partial_deletion(self) -> None:
        (self.recovery / ".cleanup-tx1").write_text("CLEANUP_AUTHORIZED tx1\n")
        (self.recovery / "tx1/result").unlink()
        self.assertIn("UPGRADE_CLEAN", self.run_cleanup())
        self.assertFalse((self.recovery / ".cleanup-tx1").exists())
        self.assertFalse((self.recovery / "tx1").exists())


if __name__ == "__main__":
    unittest.main()
