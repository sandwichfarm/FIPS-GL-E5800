"""Check first-install cleanup gates and encrypted guard evidence capture."""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from tools.finalize_stock_rollback import (FIRST_INSTALL_GUARD_FILES, archive_guard,
                                          finalize, validate_precleanup, verify_guard_archive)
from tools.router_inventory import SERVICES


def stock_inventory() -> dict:
    services = {name: ["absent", "absent"] for name in SERVICES}
    services["gl_screen"] = ["enabled", "running"]
    return {
        "format": 2,
        "firmware": "4.10.0",
        "packages": {"busybox": ["1.36.1-1", "install user installed"]},
        "services": services,
        "stock_files": {
            "web_app": ["/www/js/app.abc.js.gz", "a" * 64],
            "touchscreen": ["/usr/bin/gl_screen", "b" * 64],
        },
    }


def evidence(result: str, *, pending: bool = False) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        files = {
            "etc/fips-recovery/tx1/result": result.encode(),
            "etc/fips-recovery/guard.sh": b"synthetic guard",
            "etc/init.d/fips-recovery": b"synthetic init",
        }
        if pending:
            files["etc/fips-recovery/pending"] = b"tx1 1 1 boot\n"
        for name, data in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    return output.getvalue()


class FinalizeStockTests(unittest.TestCase):
    def test_precleanup_accepts_only_new_guard(self) -> None:
        before = stock_inventory()
        current = stock_inventory()
        current["services"]["fips-recovery"] = ["enabled", "running"]
        self.assertTrue(validate_precleanup(before, current))
        self.assertFalse(validate_precleanup(before, stock_inventory()))
        current["packages"]["fips"] = ["0.5.2", "install user unpacked"]
        with self.assertRaisesRegex(ValueError, "beyond"):
            validate_precleanup(before, current)
        before["packages"]["fips"] = ["0.5.1", "install user installed"]
        with self.assertRaisesRegex(ValueError, "first-install"):
            validate_precleanup(before, current)

    @unittest.skipUnless(shutil.which("age") and shutil.which("age-keygen"), "age CLI unavailable")
    def test_apply_archives_evidence_before_final_state_comparison(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private = root / "private"
            private.mkdir(mode=0o700)
            identity = private / "identity.txt"
            subprocess.run(["age-keygen", "-o", str(identity)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            recipient = subprocess.check_output(["age-keygen", "-y", str(identity)],
                                                text=True).strip()
            before = stock_inventory()
            baseline = private / "before.json"
            baseline.write_text(json.dumps(before))
            current = stock_inventory()
            current["services"]["fips-recovery"] = ["enabled", "running"]
            args = argparse.Namespace(
                host="root@synthetic", ssh_key=identity,
                before_backup=private / "before.age", after_backup=private / "after.age",
                before_inventory=baseline, identity=identity, transaction="tx1",
                ignore_mtime=False, apply=True, recipient=recipient,
                evidence_output=private / "evidence.age",
                final_backup=private / "final.age",
                final_inventory=private / "final.json",
            )
            with (patch("tools.finalize_stock_rollback.ssh_command", return_value=["ssh"]),
                  patch("tools.finalize_stock_rollback.capture_inventory",
                        side_effect=[current, before]),
                  patch("tools.finalize_stock_rollback.compare_backups",
                        side_effect=[[f"ADDED {name}" for name in FIRST_INSTALL_GUARD_FILES], []]),
                  patch("tools.finalize_stock_rollback.verify_guard_result"),
                  patch("tools.finalize_stock_rollback.archive_guard") as archived,
                  patch("tools.finalize_stock_rollback.capture_backup") as captured,
                  patch("tools.finalize_stock_rollback.invoke_cleanup") as cleaned):
                self.assertEqual(finalize(args), "STOCK_STATE_RESTORED")
            archived.assert_called_once()
            cleaned.assert_called_once()
            captured.assert_called_once()
            self.assertEqual(json.loads(args.final_inventory.read_text()), before)

    @unittest.skipUnless(shutil.which("age") and shutil.which("age-keygen"), "age CLI unavailable")
    def test_guard_evidence_is_encrypted_and_requires_completed_result(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            identity = root / "identity.txt"
            subprocess.run(["age-keygen", "-o", str(identity)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            recipient = subprocess.check_output(["age-keygen", "-y", str(identity)],
                                                text=True).strip()
            private = root / "private"
            private.mkdir(mode=0o700)
            archived = root / "guard.tar.gz"
            archived.write_bytes(evidence("ROLLED_BACK tx1\n"))
            fake_bin = root / "bin"
            fake_bin.mkdir()
            fake_ssh = fake_bin / "ssh"
            fake_ssh.write_text('#!/bin/sh\ncat "$FIPS_FAKE_GUARD_TAR"\n')
            fake_ssh.chmod(0o755)
            output = private / "guard.age"
            with patch.dict(os.environ, {
                "PATH": f"{fake_bin}:{os.environ['PATH']}",
                "FIPS_FAKE_GUARD_TAR": str(archived),
            }):
                archive_guard(["ssh", "root@synthetic"], recipient, identity, output, "tx1")
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            verify_guard_archive(output, identity, "tx1")
            bad = private / "bad.age"
            subprocess.run(["age", "-r", recipient, "-o", str(bad)],
                           input=evidence("ROLLED_BACK tx1\n", pending=True),
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with self.assertRaisesRegex(ValueError, "pending marker"):
                verify_guard_archive(bad, identity, "tx1")
            wrong = private / "wrong.age"
            subprocess.run(["age", "-r", recipient, "-o", str(wrong)],
                           input=evidence("CONFIRMED tx1\n"),
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with self.assertRaisesRegex(ValueError, "does not match"):
                verify_guard_archive(wrong, identity, "tx1")
            incomplete = private / "incomplete.age"
            only_result = io.BytesIO()
            with tarfile.open(fileobj=only_result, mode="w:gz") as archive:
                result = b"ROLLED_BACK tx1\n"
                member = tarfile.TarInfo("etc/fips-recovery/tx1/result")
                member.size = len(result)
                archive.addfile(member, io.BytesIO(result))
            subprocess.run(["age", "-r", recipient, "-o", str(incomplete)],
                           input=only_result.getvalue(), check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with self.assertRaisesRegex(ValueError, "could not be decrypted and verified"):
                verify_guard_archive(incomplete, identity, "tx1")


if __name__ == "__main__":
    unittest.main()
