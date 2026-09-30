"""Check safe removal of an unarmed first-install guard in an isolated router tree."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "packaging/recovery/cleanup-bootstrap.sh"


class CleanupBootstrapTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.recovery = self.root / "etc/fips-recovery"
        (self.recovery / "tx1/previous").mkdir(parents=True)
        (self.recovery / "guard.sh").write_text("partial guard\n")
        init_dir = self.root / "etc/init.d"
        init_dir.mkdir(parents=True)
        self.init = init_dir / "fips-recovery"
        self.init.write_text(
            '#!/bin/sh\n'
            'marker="$FIPS_TEST_FS_ROOT/watchdog-running"\n'
            'case "$1" in\n'
            '  enabled) exit 0;;\n'
            '  status) test -e "$marker";;\n'
            '  disable) exit 0;;\n'
            '  stop) [ "${FIPS_TEST_STOP_FAIL:-}" != yes ] || exit 1; rm -f "$marker";;\n'
            '  *) exit 2;;\n'
            'esac\n'
        )
        self.init.chmod(0o755)
        (self.root / "watchdog-running").touch()
        stock = init_dir / "gl_screen"
        stock.write_text('#!/bin/sh\ncase "$1" in enabled|status) exit 0;; esac\nexit 2\n')
        stock.chmod(0o755)
        links = self.root / "etc/rc.d"
        links.mkdir()
        (links / "S05fips-recovery").symlink_to(self.init)
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        opkg = fake_bin / "opkg"
        opkg.write_text(
            '#!/bin/sh\n'
            'case "$1" in\n'
            '  list-installed) exit 0;;\n'
            '  status) [ "$2" = "${FIPS_TEST_PRESENT_PACKAGE:-}" ] || exit 0; '
            'printf "Package: %s\\nStatus: install user unpacked\\n" "$2";;\n'
            '  *) exit 2;;\n'
            'esac\n'
        )
        opkg.chmod(0o755)
        self.env = os.environ | {
            "FIPS_TEST_FS_ROOT": str(self.root),
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
        }

    def run_cleanup(self, expected: int = 0, env: dict | None = None) -> str:
        result = subprocess.run(["sh", str(SCRIPT), "tx1"], env=env or self.env,
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result.stdout

    def test_cleans_partial_bootstrap_and_is_idempotent(self) -> None:
        self.assertIn("BOOTSTRAP_CLEAN", self.run_cleanup())
        self.assertFalse(self.recovery.exists())
        self.assertFalse(self.init.exists())
        self.assertFalse((self.root / "watchdog-running").exists())
        self.assertEqual(list((self.root / "etc/rc.d").iterdir()), [])
        lock = self.root / "tmp/fips-recovery"
        lock.mkdir(parents=True)
        (lock / "guard.lock").symlink_to("99999999")
        self.assertIn("BOOTSTRAP_CLEAN", self.run_cleanup())
        self.assertFalse(lock.exists())

    def test_refuses_pending_transaction_or_rollback_result(self) -> None:
        (self.recovery / "pending").write_text("tx1 100 100 boot\n")
        self.run_cleanup(expected=1)
        (self.recovery / "pending").unlink()
        (self.recovery / "tx1/result").write_text("ROLLED_BACK tx1\n")
        self.run_cleanup(expected=1)
        self.assertTrue(self.recovery.exists())

    def test_refuses_candidate_package_unknown_file_or_running_watchdog_failure(self) -> None:
        self.run_cleanup(expected=1,
                         env=self.env | {"FIPS_TEST_PRESENT_PACKAGE": "gl-e5800-dashboard"})
        (self.recovery / "operator-data").write_text("do not remove\n")
        self.run_cleanup(expected=1)
        (self.recovery / "operator-data").unlink()
        self.run_cleanup(expected=1, env=self.env | {"FIPS_TEST_STOP_FAIL": "yes"})
        lock = self.root / "tmp/fips-recovery"
        lock.mkdir(parents=True)
        (lock / "operator-data").write_text("do not remove\n")
        self.run_cleanup(expected=1)
        (lock / "operator-data").unlink()
        (lock / "guard.lock").symlink_to(str(os.getpid()))
        self.run_cleanup(expected=1)
        self.assertTrue(self.recovery.exists())


if __name__ == "__main__":
    unittest.main()
