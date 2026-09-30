"""Check exact-state upgrade cleanup and off-router evidence ordering."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from tools.finalize_upgrade_rollback import REQUIRED_GUARD_FILES, finalize, validate_baseline
from tools.router_inventory import SERVICES


def inventory() -> dict:
    services = {name: ["absent", "absent"] for name in SERVICES}
    services["fips-recovery"] = ["enabled", "running"]
    services["fips"] = ["enabled", "running"]
    services["gl_screen"] = ["enabled", "running"]
    return {
        "format": 2, "firmware": "4.10.0",
        "packages": {"fips": ["0.5.2", "install user installed"]},
        "services": services,
        "stock_files": {"web_app": ["/www/js/app.js.gz", "a" * 64],
                        "touchscreen": ["/usr/bin/gl_screen", "b" * 64]},
    }


class FinalizeUpgradeTests(unittest.TestCase):
    def test_requires_prior_guard_and_identical_inventory(self) -> None:
        before = inventory()
        validate_baseline(before, inventory())
        drift = inventory()
        drift["packages"]["fips"] = ["0.5.3", "install user installed"]
        with self.assertRaisesRegex(ValueError, "differs"):
            validate_baseline(before, drift)
        before["services"]["fips-recovery"] = ["absent", "absent"]
        with self.assertRaisesRegex(ValueError, "prior recovery guard"):
            validate_baseline(before, inventory())

    def test_archives_evidence_before_upgrade_cleanup_and_final_comparison(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            private = Path(temporary) / "private"
            private.mkdir(mode=0o700)
            before = inventory()
            baseline = private / "before.json"
            baseline.write_text(json.dumps(before))
            args = argparse.Namespace(
                host="root@synthetic", ssh_key=private / "ssh-key",
                before_backup=private / "before.age", after_backup=private / "after.age",
                before_inventory=baseline, identity=private / "age-key", transaction="tx1",
                ignore_mtime=False, apply=True, recipient="age1synthetic",
                evidence_output=private / "guard.age", final_backup=private / "final.age",
                final_inventory=private / "final.json",
            )
            calls = Mock()
            with (patch("tools.finalize_upgrade_rollback.ssh_command", return_value=["ssh"]),
                  patch("tools.finalize_upgrade_rollback.capture_inventory",
                        side_effect=[before, before]),
                  patch("tools.finalize_upgrade_rollback.read_encrypted_details",
                        return_value=({name: b"prior" for name in REQUIRED_GUARD_FILES}, {})),
                  patch("tools.finalize_upgrade_rollback.compare_backups", return_value=[]),
                  patch("tools.finalize_upgrade_rollback.cleanup_state", return_value="READY"),
                  patch("tools.finalize_upgrade_rollback.verify_guard_result"),
                  patch("tools.finalize_upgrade_rollback.prepare_capture"),
                  patch("tools.finalize_upgrade_rollback.capture_backup") as captured,
                  patch("tools.finalize_upgrade_rollback.archive_guard") as archived,
                  patch("tools.finalize_upgrade_rollback.invoke_cleanup") as cleaned):
                calls.attach_mock(archived, "archive")
                calls.attach_mock(cleaned, "clean")
                calls.attach_mock(captured, "capture")
                self.assertEqual(finalize(args), "UPGRADE_STATE_RESTORED")
            self.assertEqual([call[0] for call in calls.mock_calls],
                             ["archive", "clean", "capture"])
            self.assertEqual(json.loads(args.final_inventory.read_text()), before)

    def test_resume_requires_existing_verified_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            private = Path(temporary) / "private"
            private.mkdir(mode=0o700)
            baseline = private / "before.json"
            baseline.write_text(json.dumps(inventory()))
            args = argparse.Namespace(
                host="root@synthetic", ssh_key=private / "ssh-key",
                before_backup=private / "before.age", after_backup=private / "after.age",
                before_inventory=baseline, identity=private / "age-key", transaction="tx1",
                ignore_mtime=False, apply=True, recipient="age1synthetic",
                evidence_output=private / "guard.age", final_backup=private / "final.age",
                final_inventory=private / "final.json",
            )
            with (patch("tools.finalize_upgrade_rollback.ssh_command", return_value=["ssh"]),
                  patch("tools.finalize_upgrade_rollback.capture_inventory", return_value=inventory()),
                  patch("tools.finalize_upgrade_rollback.read_encrypted_details",
                        return_value=({name: b"prior" for name in REQUIRED_GUARD_FILES}, {})),
                  patch("tools.finalize_upgrade_rollback.compare_backups", return_value=[]),
                  patch("tools.finalize_upgrade_rollback.cleanup_state", return_value="RESUME"),
                  patch("tools.finalize_upgrade_rollback.prepare_capture"),
                  patch("tools.finalize_upgrade_rollback.archive_guard") as archived,
                  patch("tools.finalize_upgrade_rollback.invoke_cleanup") as cleaned):
                with self.assertRaisesRegex(ValueError, "prior encrypted guard evidence"):
                    finalize(args)
                archived.assert_not_called()
                cleaned.assert_not_called()

    def test_rejects_backup_that_did_not_capture_old_guard(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            private = Path(temporary) / "private"
            private.mkdir(mode=0o700)
            baseline = private / "before.json"
            baseline.write_text(json.dumps(inventory()))
            args = argparse.Namespace(
                host="root@synthetic", ssh_key=private / "ssh-key",
                before_backup=private / "before.age", after_backup=private / "after.age",
                before_inventory=baseline, identity=private / "age-key", transaction="tx1",
                ignore_mtime=False, apply=False,
            )
            with (patch("tools.finalize_upgrade_rollback.ssh_command", return_value=["ssh"]),
                  patch("tools.finalize_upgrade_rollback.capture_inventory", return_value=inventory()),
                  patch("tools.finalize_upgrade_rollback.read_encrypted_details",
                        return_value=({"etc/fips-recovery/guard.sh": b"prior"}, {}))):
                with self.assertRaisesRegex(ValueError, "missing prior guard"):
                    finalize(args)


if __name__ == "__main__":
    unittest.main()
