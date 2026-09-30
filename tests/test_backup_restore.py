"""Rehearse a guarded post-firmware identity restore in an isolated filesystem."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tools.render_backup_restore import render
from tests.test_backup_bundle import CONFIG, IDENTITY


class BackupRestoreTests(unittest.TestCase):
    def test_enabled_gateway_is_restarted_from_encrypted_backup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            guard = root / "etc/fips-recovery/tx1/backup"
            guard.mkdir(parents=True)
            (guard / "mode").write_text("packages\n")
            (guard.parent.parent / "pending").write_text("tx1 200 200 boot\n")
            init = root / "etc/init.d"
            init.mkdir(parents=True)
            for name in ("fips", "fips-gateway"):
                service = init / name
                service.write_text('#!/bin/sh\necho "$(basename "$0") $1" >> "$FIPS_TEST_SERVICE_LOG"\n')
                service.chmod(0o755)
            fake_bin = root / "fake-bin"
            fake_bin.mkdir()
            jsonfilter = fake_bin / "jsonfilter"
            jsonfilter.write_text("""#!/usr/bin/env python3
import json, sys
data = json.load(open(sys.argv[sys.argv.index('-i') + 1]))
print(str(data[sys.argv[sys.argv.index('-e') + 1][2:]]).lower())
""")
            jsonfilter.chmod(0o755)
            files = IDENTITY | {"etc/fips/router/settings.json": b'{"enabled":true,"gateway_enabled":true}'}
            with patch("tools.render_backup_restore.read_encrypted", return_value=files):
                script = render(Path("unused.age"), Path("unused-key"), "tx1")
            script_path = root / "restore.sh"
            script_path.write_text(script)
            log = root / "services.log"
            environment = os.environ | {"FIPS_TEST_FS_ROOT": str(root),
                                        "FIPS_TEST_SERVICE_LOG": str(log),
                                        "PATH": f"{fake_bin}:{os.environ['PATH']}"}
            result = subprocess.run(["sh", str(script_path)], env=environment,
                                    capture_output=True, text=True, check=True)
            self.assertIn("FIPS_BACKUP_RESTORED", result.stdout)
            self.assertEqual(log.read_text().splitlines(),
                             ["fips enable", "fips restart",
                              "fips-gateway enable", "fips-gateway restart"])
            repeated = subprocess.run(["sh", str(script_path)], env=environment,
                                      capture_output=True, text=True, check=True)
            self.assertNotIn("FIPS_BACKUP_CHANGED", repeated.stdout)
            self.assertEqual(log.read_text().splitlines()[-4:],
                             ["fips status", "fips enabled",
                              "fips-gateway status", "fips-gateway enabled"])

    def test_disabled_gateway_is_stopped_once_and_reported_as_a_change(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            guard = root / "etc/fips-recovery/tx1/backup"
            guard.mkdir(parents=True)
            (guard / "mode").write_text("packages\n")
            (guard.parent.parent / "pending").write_text("tx1 200 200 boot\n")
            init = root / "etc/init.d"
            init.mkdir(parents=True)
            fips = init / "fips"
            fips.write_text('#!/bin/sh\nexit 0\n')
            fips.chmod(0o755)
            gateway = init / "fips-gateway"
            gateway.write_text('''#!/bin/sh
case "$1" in
  status) test -f "$FIPS_TEST_FS_ROOT/gateway-running";;
  enabled) test -f "$FIPS_TEST_FS_ROOT/gateway-enabled";;
  stop) rm -f "$FIPS_TEST_FS_ROOT/gateway-running"; echo stop >> "$FIPS_TEST_SERVICE_LOG";;
  disable) rm -f "$FIPS_TEST_FS_ROOT/gateway-enabled"; echo disable >> "$FIPS_TEST_SERVICE_LOG";;
esac
''')
            gateway.chmod(0o755)
            (root / "gateway-running").touch()
            (root / "gateway-enabled").touch()
            fake_bin = root / "fake-bin"
            fake_bin.mkdir()
            jsonfilter = fake_bin / "jsonfilter"
            jsonfilter.write_text('''#!/usr/bin/env python3
import json, sys
data = json.load(open(sys.argv[sys.argv.index('-i') + 1]))
print(str(data[sys.argv[sys.argv.index('-e') + 1][2:]]).lower())
''')
            jsonfilter.chmod(0o755)
            files = IDENTITY | {"etc/fips/router/settings.json": b'{"enabled":true,"gateway_enabled":false}'}
            with patch("tools.render_backup_restore.read_encrypted", return_value=files):
                script = render(Path("unused.age"), Path("unused-key"), "tx1")
            script_path = root / "restore.sh"
            script_path.write_text(script)
            log = root / "services.log"
            environment = os.environ | {"FIPS_TEST_FS_ROOT": str(root),
                                        "FIPS_TEST_SERVICE_LOG": str(log),
                                        "PATH": f"{fake_bin}:{os.environ['PATH']}"}
            first = subprocess.run(["sh", str(script_path)], env=environment,
                                   capture_output=True, text=True, check=True)
            self.assertIn("FIPS_BACKUP_CHANGED", first.stdout)
            self.assertEqual(log.read_text().splitlines(), ["stop", "disable"])
            second = subprocess.run(["sh", str(script_path)], env=environment,
                                    capture_output=True, text=True, check=True)
            self.assertNotIn("FIPS_BACKUP_CHANGED", second.stdout)
            self.assertEqual(log.read_text().splitlines(), ["stop", "disable"])

    def test_restores_identity_without_replaying_firmware_network_config(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            guard = root / "etc/fips-recovery/tx1"
            (guard / "backup").mkdir(parents=True)
            (guard / "backup/mode").write_text("packages\n")
            (guard.parent / "pending").write_text("tx1 200 200 boot\n")
            (root / "etc/init.d").mkdir(parents=True)
            service = root / "etc/init.d/fips"
            service.write_text("""#!/bin/sh
case "$1" in
  status) test -f "$FIPS_TEST_FS_ROOT/service-running";;
  enable) exit 0;;
  restart) touch "$FIPS_TEST_FS_ROOT/service-running";;
esac
""")
            service.chmod(0o755)
            (root / "etc/config").mkdir(parents=True)
            (root / "etc/config/network").write_text("new firmware network")
            files = CONFIG | IDENTITY | {
                "root/dashboard/config.json": b'{"city":"test"}',
                "etc/fips/hosts": b"home npub1synthetic\n",
                "etc/fips/peers.allow": b"home\n",
                "etc/fips/peers.deny": b"bad\n",
                "etc/fips/fips.nft": b"table inet fips {}\n",
                "etc/fips/fips.d/local.nft": b"# local policy\n",
                "etc/fips/fips.pub": b"regenerated public identity",
                "etc/fips/fips.log": b"stale runtime log",
                "etc/fips/firewall.sh": b"old packaged script",
                "etc/fips/router/candidate.json": b"stale staged configuration",
            }
            with patch("tools.render_backup_restore.read_encrypted", return_value=files):
                script = render(Path("unused.age"), Path("unused-key"), "tx1", True)
            self.assertNotIn("synthetic-secret-for-test-only", script)
            script_path = root / "restore.sh"
            script_path.write_text(script)
            environment = os.environ | {"FIPS_TEST_FS_ROOT": str(root)}
            subprocess.run(["sh", "-n", str(script_path)], check=True)
            first = subprocess.run(["sh", str(script_path)], env=environment,
                                   capture_output=True, text=True, check=True)
            self.assertIn("FIPS_BACKUP_CHANGED", first.stdout)
            self.assertEqual((root / "etc/config/network").read_text(), "new firmware network")
            self.assertFalse((root / "etc/fips/router/candidate.json").exists())
            for name in ("etc/fips/fips.pub", "etc/fips/fips.log", "etc/fips/firewall.sh"):
                self.assertFalse((root / name).exists())
            restored_names = set(IDENTITY) | {
                "root/dashboard/config.json", "etc/fips/hosts",
                "etc/fips/peers.allow", "etc/fips/peers.deny",
                "etc/fips/fips.nft", "etc/fips/fips.d/local.nft",
            }
            for name in restored_names:
                data = files[name]
                self.assertEqual((root / name).read_bytes(), data)
                self.assertEqual((root / name).stat().st_mode & 0o777, 0o600)
            second = subprocess.run(["sh", str(script_path)], env=environment,
                                    capture_output=True, text=True, check=True)
            self.assertNotIn("FIPS_BACKUP_CHANGED", second.stdout)
            (guard.parent / "pending").write_text("other 200 200 boot\n")
            denied = subprocess.run(["sh", str(script_path)], env=environment,
                                    capture_output=True, text=True, check=False)
            self.assertNotEqual(denied.returncode, 0)
            self.assertEqual((root / "etc/fips/fips.key").read_bytes(), IDENTITY["etc/fips/fips.key"])
            (guard.parent / "pending").write_text("tx1 200 200 boot\n")
            rules = root / "etc/fips/router/mesh.nft"
            rules.unlink()
            rules.mkdir()
            malformed = subprocess.run(["sh", str(script_path)], env=environment,
                                       capture_output=True, text=True, check=False)
            self.assertNotEqual(malformed.returncode, 0)
            self.assertTrue(rules.is_dir())


if __name__ == "__main__":
    unittest.main()
