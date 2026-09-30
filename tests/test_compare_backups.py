"""Prove encrypted pre/post rollback comparisons do not expose file contents."""

from __future__ import annotations

import io
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

from tools.compare_backups import compare
from tests.test_backup_bundle import CONFIG


def archive(files: dict[str, bytes], *, mode: int = 0o600, mtime: int = 100) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as bundle:
        for name, data in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            member.mode = mode
            member.uid = 0
            member.gid = 0
            member.mtime = mtime
            bundle.addfile(member, io.BytesIO(data))
    return output.getvalue()


@unittest.skipUnless(shutil.which("age") and shutil.which("age-keygen"), "age CLI unavailable")
class CompareBackupsTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.identity = self.root / "identity.txt"
        subprocess.run(["age-keygen", "-o", str(self.identity)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.recipient = subprocess.check_output(
            ["age-keygen", "-y", str(self.identity)], text=True,
        ).strip()

    def encrypt(self, name: str, plaintext: bytes) -> Path:
        destination = self.root / name
        with destination.open("wb") as ciphertext:
            subprocess.run(["age", "-r", self.recipient], input=plaintext,
                           stdout=ciphertext, stderr=subprocess.DEVNULL, check=True)
        return destination

    def test_identical_independent_backups_match(self) -> None:
        before = self.encrypt("before.age", archive(CONFIG, mode=0o606))
        after = self.encrypt("after.age", archive(CONFIG, mode=0o606))
        self.assertEqual(compare(before, after, self.identity), [])
        with self.assertRaisesRegex(ValueError, "independent"):
            compare(before, before, self.identity)

    def test_content_and_metadata_drift_are_reported_without_values(self) -> None:
        before = self.encrypt("before.age", archive(CONFIG, mode=0o606, mtime=100))
        changed = CONFIG | {"etc/config/network": b"private-new-configuration\n"}
        after = self.encrypt("after.age", archive(changed, mode=0o600, mtime=101))
        differences = compare(before, after, self.identity)
        self.assertIn("CHANGED etc/config/network: contents, mode, mtime", differences)
        self.assertIn("CHANGED etc/config/firewall: mode, mtime", differences)
        self.assertNotIn("private-new-configuration", "\n".join(differences))
        without_mtime = compare(before, after, self.identity, ignore_mtime=True)
        self.assertIn("CHANGED etc/config/network: contents, mode", without_mtime)
        self.assertIn("CHANGED etc/config/firewall: mode", without_mtime)

    def test_explicit_mtime_relaxation_allows_timestamp_only_drift(self) -> None:
        before = self.encrypt("before.age", archive(CONFIG, mtime=100))
        after = self.encrypt("after.age", archive(CONFIG, mtime=101))
        self.assertIn("CHANGED etc/config/network: mtime",
                      compare(before, after, self.identity))
        self.assertEqual(compare(before, after, self.identity, ignore_mtime=True), [])

    def test_partial_fips_identity_cannot_pass_as_matching_state(self) -> None:
        partial = CONFIG | {"etc/fips/fips.key": b"synthetic"}
        before = self.encrypt("before.age", archive(partial))
        after = self.encrypt("after.age", archive(partial))
        with self.assertRaisesRegex(ValueError, "incomplete FIPS identity"):
            compare(before, after, self.identity)


if __name__ == "__main__":
    unittest.main()
