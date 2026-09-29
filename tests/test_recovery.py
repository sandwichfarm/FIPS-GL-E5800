"""Exercise the router rollback guard against an isolated fake filesystem."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


GUARD = Path(__file__).resolve().parents[1] / "packaging/recovery/guard.sh"


class RecoveryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.etc = self.root / "etc"
        (self.etc / "init.d").mkdir(parents=True)
        (self.etc / "config").mkdir()
        (self.root / "fake-bin").mkdir()
        self.state = self.root / "installed"
        self.state.write_text("fips\n")
        self.log = self.root / "opkg.log"
        init = self.etc / "init.d/fips-recovery"
        init.write_text("#!/bin/sh\ncase \"$1\" in enabled|status) exit 0;; esac\nexit 1\n")
        init.chmod(0o755)
        network = self.etc / "init.d/network"
        network.write_text("#!/bin/sh\nexit 0\n")
        network.chmod(0o755)
        firewall = self.etc / "init.d/firewall"
        firewall.write_text("#!/bin/sh\nexit 0\n")
        firewall.chmod(0o755)
        opkg = self.root / "fake-bin/opkg"
        opkg.write_text("""#!/bin/sh
case "$1" in
  status)
    grep -qx "$2" "$FIPS_TEST_OPKG_STATE" || exit 0
    printf 'Package: %s\\nVersion: 1\\nStatus: install user installed\\n' "$2"
    ;;
  remove)
    printf 'remove %s\\n' "$2" >> "$FIPS_TEST_OPKG_LOG"
    grep -vx "$2" "$FIPS_TEST_OPKG_STATE" > "$FIPS_TEST_OPKG_STATE.tmp" || true
    mv "$FIPS_TEST_OPKG_STATE.tmp" "$FIPS_TEST_OPKG_STATE"
    ;;
  install)
    [ "$2" = --force-downgrade ] || exit 2
    name=$(basename "$3" .ipk)
    printf 'install %s\\n' "$name" >> "$FIPS_TEST_OPKG_LOG"
    grep -qx "$name" "$FIPS_TEST_OPKG_STATE" || echo "$name" >> "$FIPS_TEST_OPKG_STATE"
    ;;
  *) exit 2;;
esac
""")
        opkg.chmod(0o755)
        self.env = os.environ | {
            "FIPS_TEST_FS_ROOT": str(self.root),
            "FIPS_TEST_OPKG_STATE": str(self.state),
            "FIPS_TEST_OPKG_LOG": str(self.log),
            "FIPS_TEST_NOW": "10000",
            "FIPS_TEST_UPTIME": "100",
            "FIPS_TEST_BOOT_ID": "boot-a",
            "PATH": f"{self.root / 'fake-bin'}:{os.environ['PATH']}",
        }
        previous = self.etc / "fips-recovery/tx1/previous"
        previous.mkdir(parents=True)
        archive = previous / "fips.ipk"
        archive.write_bytes(b"known-good")
        (previous / "fips.sha256").write_text(hashlib.sha256(archive.read_bytes()).hexdigest())
        (previous / "fips.version").write_text("1\n")
        (self.etc / "fips").mkdir()
        (self.etc / "fips/identity.key").write_text("original identity")
        (self.etc / "config/network").write_text("original network")

    def run_guard(self, *args: str, expected: int = 0, env: dict | None = None) -> str:
        process = subprocess.run(
            ["sh", str(GUARD), *args], env=env or self.env, text=True,
            capture_output=True, check=False,
        )
        self.assertEqual(process.returncode, expected, process.stdout + process.stderr)
        return process.stdout

    def test_deadline_restores_identity_config_and_prior_package(self) -> None:
        self.run_guard("arm", "tx1", "60")
        (self.etc / "fips/identity.key").write_text("bad deployment")
        (self.etc / "config/network").write_text("bad network")
        (self.etc / "config/firewall").write_text("new firewall")
        self.state.write_text("fips\ngl-sdk4-ui-fips\n")
        expired = self.env | {"FIPS_TEST_NOW": "10061", "FIPS_TEST_UPTIME": "161"}
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))
        self.assertEqual((self.etc / "fips/identity.key").read_text(), "original identity")
        self.assertEqual((self.etc / "config/network").read_text(), "original network")
        self.assertFalse((self.etc / "config/firewall").exists())
        self.assertEqual(self.state.read_text(), "fips\n")
        self.assertEqual(self.log.read_text(), "remove gl-sdk4-ui-fips\ninstall fips\n")
        self.assertFalse((self.etc / "fips-recovery/pending").exists())
        self.assertEqual(self.run_guard("check"), "")

    def test_reboot_rolls_back_before_deadline(self) -> None:
        self.run_guard("arm", "tx1", "60")
        rebooted = self.env | {"FIPS_TEST_BOOT_ID": "boot-b", "FIPS_TEST_UPTIME": "1"}
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=rebooted))

    def test_confirmation_cancels_rollback(self) -> None:
        self.run_guard("arm", "tx1", "60")
        self.run_guard("confirm", "wrong", expected=1)
        self.run_guard("confirm", "tx1")
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        self.assertEqual(self.run_guard("check", env=expired), "")
        self.assertEqual((self.etc / "fips-recovery/tx1/result").read_text(), "CONFIRMED tx1\n")

    def test_checksum_mismatch_blocks_arming(self) -> None:
        (self.etc / "fips-recovery/tx1/previous/fips.ipk").write_bytes(b"tampered")
        self.run_guard("arm", "tx1", "60", expected=1)
        self.assertFalse((self.etc / "fips-recovery/pending").exists())

    def test_wrong_prior_version_blocks_arming(self) -> None:
        (self.etc / "fips-recovery/tx1/previous/fips.version").write_text("2\n")
        self.run_guard("arm", "tx1", "60", expected=1)
        self.assertFalse((self.etc / "fips-recovery/pending").exists())


if __name__ == "__main__":
    unittest.main()
