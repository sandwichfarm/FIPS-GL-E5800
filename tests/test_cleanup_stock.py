"""Exercise guarded first-install rollback cleanup in an isolated filesystem."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "packaging/recovery/cleanup-stock.sh"


class CleanupStockTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        recovery = self.root / "etc/fips-recovery/tx1"
        recovery.mkdir(parents=True)
        (recovery / "result").write_text("ROLLED_BACK tx1\n")
        (self.root / "etc/init.d").mkdir(exist_ok=True)
        (self.root / "etc/rc.d").mkdir()
        guard = self.root / "etc/init.d/fips-recovery"
        guard.write_text(
            '#!/bin/sh\n'
            'case "$1" in\n'
            '  disable) rm -f "$FIPS_TEST_FS_ROOT/etc/rc.d/S05fips-recovery";;\n'
            '  stop) exit 0;;\n'
            '  *) exit 2;;\n'
            'esac\n'
        )
        guard.chmod(0o755)
        (self.root / "etc/rc.d/S05fips-recovery").symlink_to(guard)
        stock = self.root / "etc/init.d/gl_screen"
        stock.write_text('#!/bin/sh\ncase "$1" in enabled|status) exit 0;; esac\nexit 2\n')
        stock.chmod(0o755)
        fake_bin = self.root / "fake-bin"
        fake_bin.mkdir()
        opkg = fake_bin / "opkg"
        opkg.write_text(
            '#!/bin/sh\n'
            'if [ "$1" = status ] && [ "$2" = "${FIPS_TEST_PRESENT_PACKAGE:-}" ]; then\n'
            '  printf "Package: %s\\nStatus: install user unpacked\\n" "$2"\n'
            'fi\n'
        )
        opkg.chmod(0o755)
        self.env = os.environ | {
            "FIPS_TEST_FS_ROOT": str(self.root),
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
        }

    def run_cleanup(self, *, expected: int = 0, env: dict | None = None) -> str:
        process = subprocess.run(["sh", str(SCRIPT), "tx1"], env=env or self.env,
                                 capture_output=True, text=True, check=False)
        self.assertEqual(process.returncode, expected, process.stdout + process.stderr)
        return process.stdout

    def test_cleans_only_completed_stock_rollback_and_is_idempotent(self) -> None:
        self.assertIn("STOCK_CLEAN", self.run_cleanup())
        self.assertFalse((self.root / "etc/fips-recovery").exists())
        self.assertFalse((self.root / "etc/init.d/fips-recovery").exists())
        self.assertFalse((self.root / "etc/rc.d/S05fips-recovery").exists())
        self.assertIn("STOCK_CLEAN", self.run_cleanup())

    def test_refuses_pending_or_non_rollback_transaction(self) -> None:
        pending = self.root / "etc/fips-recovery/pending"
        pending.write_text("tx1 100 100 boot\n")
        self.run_cleanup(expected=1)
        self.assertTrue((self.root / "etc/init.d/fips-recovery").exists())
        pending.unlink()
        (self.root / "etc/fips-recovery/tx1/result").write_text("CONFIRMED tx1\n")
        self.run_cleanup(expected=1)
        self.assertTrue((self.root / "etc/init.d/fips-recovery").exists())

    def test_refuses_remaining_candidate_package(self) -> None:
        self.run_cleanup(expected=1,
                         env=self.env | {"FIPS_TEST_PRESENT_PACKAGE": "gl-e5800-dashboard"})
        self.assertTrue((self.root / "etc/fips-recovery").exists())


if __name__ == "__main__":
    unittest.main()
