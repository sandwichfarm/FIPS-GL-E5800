"""Exercise the router rollback guard against an isolated fake filesystem."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

from tools.render_backup_restore import render


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
        stock_screen = self.etc / "init.d/gl_screen"
        stock_screen.write_text(
            '#!/bin/sh\n'
            'if [ "$1" = start ] && [ "${FIPS_TEST_STOCK_FAIL:-}" = yes ]; then exit 1; fi\n'
            'exit 0\n'
        )
        stock_screen.chmod(0o755)
        opkg = self.root / "fake-bin/opkg"
        opkg.write_text("""#!/bin/sh
case "$1" in
  status)
    if grep -qx "$2" "$FIPS_TEST_OPKG_STATE"; then
      state=installed
    elif grep -qx "$2:unpacked" "$FIPS_TEST_OPKG_STATE"; then
      state=unpacked
    else
      exit 0
    fi
    printf 'Package: %s\\nVersion: 1\\nStatus: install user %s\\n' "$2" "$state"
    ;;
  remove)
    [ "${FIPS_TEST_OPKG_REMOVE_FAIL:-}" != yes ] || exit 1
    printf 'remove %s\\n' "$2" >> "$FIPS_TEST_OPKG_LOG"
    awk -v name="$2" '$0 != name && $0 != name ":unpacked"' "$FIPS_TEST_OPKG_STATE" > "$FIPS_TEST_OPKG_STATE.tmp"
    mv "$FIPS_TEST_OPKG_STATE.tmp" "$FIPS_TEST_OPKG_STATE"
    ;;
  install)
    [ "$2" = --force-downgrade ] || exit 2
    name=$(basename "$3" .ipk)
    printf 'install %s\\n' "$name" >> "$FIPS_TEST_OPKG_LOG"
    [ -z "${FIPS_TEST_OPKG_INSTALL_DELAY:-}" ] || sleep "$FIPS_TEST_OPKG_INSTALL_DELAY"
    grep -qx "$name" "$FIPS_TEST_OPKG_STATE" || echo "$name" >> "$FIPS_TEST_OPKG_STATE"
    if [ "${FIPS_TEST_OPKG_MUTATE_CONFIG:-}" = yes ]; then
      echo 'postinst changed network' > "$FIPS_TEST_FS_ROOT/etc/config/network"
    fi
    ;;
  *) exit 2;;
esac
""")
        opkg.chmod(0o755)
        uci = self.root / "fake-bin/uci"
        uci.write_text("""#!/bin/sh
[ "$1" = -q ] || exit 2
case "$2" in
  changes) [ ! -f "$FIPS_TEST_UCI_DIR/$3.delta" ] || cat "$FIPS_TEST_UCI_DIR/$3.delta" ;;
  revert) rm -f "$FIPS_TEST_UCI_DIR/$3.delta" ;;
  *) exit 2 ;;
esac
""")
        uci.chmod(0o755)
        (self.root / "uci-deltas").mkdir()
        self.env = os.environ | {
            "FIPS_TEST_FS_ROOT": str(self.root),
            "FIPS_TEST_OPKG_STATE": str(self.state),
            "FIPS_TEST_OPKG_LOG": str(self.log),
            "FIPS_TEST_UCI_DIR": str(self.root / "uci-deltas"),
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

    def display_service(self, name: str, *, enabled: bool, running: bool) -> None:
        state = self.root / "display-state"
        state.mkdir(exist_ok=True)
        for suffix, present in (("enabled", enabled), ("running", running)):
            marker = state / f"{name}.{suffix}"
            if present:
                marker.touch()
            else:
                marker.unlink(missing_ok=True)
        script = self.etc / "init.d" / name
        script.write_text(
            '#!/bin/sh\n'
            f'marker="$FIPS_TEST_FS_ROOT/display-state/{name}"\n'
            'case "$1" in\n'
            '  enabled) test -e "$marker.enabled";;\n'
            '  status) test -e "$marker.running";;\n'
            '  enable) touch "$marker.enabled";;\n'
            '  disable) rm -f "$marker.enabled";;\n'
            f'  start) [ "${{FIPS_TEST_DISPLAY_START_FAIL:-}}" != "{name}" ] || exit 1; '
            'touch "$marker.running";;\n'
            '  stop) rm -f "$marker.running";;\n'
            '  *) exit 2;;\n'
            'esac\n'
        )
        script.chmod(0o755)

    def test_deadline_restores_identity_config_and_prior_package(self) -> None:
        self.run_guard("arm", "tx1", "60")
        (self.etc / "fips/identity.key").write_text("bad deployment")
        (self.etc / "config/network").write_text("bad network")
        (self.etc / "config/firewall").write_text("new firewall")
        self.state.write_text("fips\ngl-sdk4-ui-fips\n")
        expired = self.env | {"FIPS_TEST_NOW": "10061", "FIPS_TEST_UPTIME": "161",
                              "FIPS_TEST_OPKG_MUTATE_CONFIG": "yes"}
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

    def test_interrupted_install_rolls_back_without_controller(self) -> None:
        self.run_guard("arm", "tx1", "60")
        # Simulate controller loss after removing FIPS and installing only the dashboard.
        self.state.write_text("gl-e5800-dashboard\n")
        (self.etc / "fips/identity.key").write_text("interrupted install")
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))
        self.assertEqual(self.state.read_text(), "fips\n")
        self.assertEqual((self.etc / "fips/identity.key").read_text(), "original identity")
        self.assertEqual(self.log.read_text(), "remove gl-e5800-dashboard\ninstall fips\n")
        self.assertEqual(self.run_guard("check", env=expired), "")
        self.run_guard("rollback", expected=1)
        self.assertEqual(self.log.read_text(), "remove gl-e5800-dashboard\ninstall fips\n")

    def test_upgrade_rollback_restores_previous_guard_files_after_controller_loss(self) -> None:
        recovery = self.etc / "fips-recovery"
        files = {
            recovery / "guard.sh": b"previous guard\n",
            recovery / "health.sh": b"previous health\n",
            recovery / "probes.json": b'{"name":"old.example"}\n',
            recovery / "apply-initial.sh": b"previous apply\n",
            recovery / "runtime-packages": b"python3\n",
            self.etc / "init.d/fips-recovery":
                b'#!/bin/sh\ncase "$1" in enabled|status) exit 0;; esac\nexit 1\n',
        }
        for path, original in files.items():
            path.write_bytes(original)
            path.chmod(0o700 if path.name.endswith(".sh") or path.name == "fips-recovery" else 0o600)
            os.utime(path, (12345, 12345))
        self.run_guard("arm", "tx1", "60")
        for path in files:
            path.write_bytes(b"replacement\n")
            path.chmod(0o644)
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))
        for path, original in files.items():
            self.assertEqual(path.read_bytes(), original, path.as_posix())
            self.assertEqual(path.stat().st_mode & 0o777,
                             0o700 if path.name.endswith(".sh") or path.name == "fips-recovery" else 0o600)
            self.assertEqual(int(path.stat().st_mtime), 12345)

    def test_failed_guard_file_restore_keeps_rollback_pending_for_retry(self) -> None:
        recovery = self.etc / "fips-recovery"
        (recovery / "guard.sh").write_text("previous guard\n")
        self.run_guard("arm", "tx1", "60")
        (recovery / "guard.sh").write_text("replacement\n")
        saved = recovery / "tx1/backup/guard-files/guard.sh"
        saved.rename(saved.with_suffix(".missing"))
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        self.run_guard("check", expected=1, env=expired)
        self.assertTrue((recovery / "pending").exists())
        saved.with_suffix(".missing").rename(saved)
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))
        self.assertEqual((recovery / "guard.sh").read_text(), "previous guard\n")

    def test_upgrade_rollback_restarts_prior_watchdog_after_failed_candidate_start(self) -> None:
        marker = self.root / "watchdog-running"
        marker.touch()
        init = self.etc / "init.d/fips-recovery"
        init.write_text(
            '#!/bin/sh\n'
            'marker="$FIPS_TEST_FS_ROOT/watchdog-running"\n'
            'case "$1" in\n'
            '  enabled) exit 0;;\n'
            '  status) test -e "$marker";;\n'
            '  start) [ "${FIPS_TEST_RECOVERY_START_FAIL:-}" != yes ] || exit 1; touch "$marker";;\n'
            '  *) exit 2;;\n'
            'esac\n'
        )
        init.chmod(0o755)
        self.run_guard("arm", "tx1", "60")
        marker.unlink()
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        self.run_guard("check", expected=1,
                       env=expired | {"FIPS_TEST_RECOVERY_START_FAIL": "yes"})
        self.assertTrue((self.etc / "fips-recovery/pending").exists())
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))
        self.assertTrue(marker.exists())

    def test_partially_unpacked_new_package_is_removed(self) -> None:
        self.run_guard("arm", "tx1", "60")
        self.state.write_text("fips\ngl-e5800-dashboard:unpacked\n")
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))
        self.assertEqual(self.state.read_text(), "fips\n")
        self.assertEqual(self.log.read_text(), "remove gl-e5800-dashboard\ninstall fips\n")

    def test_runtime_rollback_removes_only_new_dependencies_in_safe_order(self) -> None:
        (self.etc / "fips-recovery/runtime-packages").write_text(
            "python3-numpy\npython3\npython3-light\n"
        )
        self.state.write_text("fips\npython3-light\n")
        self.run_guard("arm", "tx1", "60")
        self.state.write_text("fips\npython3-light\npython3\npython3-numpy\n")
        self.run_guard("rollback")
        self.assertEqual(self.state.read_text(), "fips\npython3-light\n")
        self.assertEqual(self.log.read_text(),
                         "remove python3-numpy\nremove python3\ninstall fips\n")

    def test_interrupted_runtime_install_is_removed_after_controller_loss(self) -> None:
        (self.etc / "fips-recovery/runtime-packages").write_text("python3\n")
        self.run_guard("arm", "tx1", "60")
        self.state.write_text("fips\npython3:unpacked\n")
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))
        self.assertEqual(self.state.read_text(), "fips\n")
        self.assertEqual(self.log.read_text(), "remove python3\ninstall fips\n")

    def test_partial_package_removal_failure_retries_under_guard(self) -> None:
        self.run_guard("arm", "tx1", "60")
        self.state.write_text("fips\ngl-e5800-dashboard:unpacked\n")
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        failed = expired | {"FIPS_TEST_OPKG_REMOVE_FAIL": "yes"}
        self.run_guard("check", expected=1, env=failed)
        self.assertTrue((self.etc / "fips-recovery/pending").exists())
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))
        self.assertEqual(self.state.read_text(), "fips\n")

    def test_runtime_removal_failure_keeps_guard_pending_for_retry(self) -> None:
        (self.etc / "fips-recovery/runtime-packages").write_text("python3\n")
        self.run_guard("arm", "tx1", "60")
        self.state.write_text("fips\npython3:unpacked\n")
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        self.run_guard("check", expected=1,
                       env=expired | {"FIPS_TEST_OPKG_REMOVE_FAIL": "yes"})
        self.assertTrue((self.etc / "fips-recovery/pending").exists())
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))
        self.assertEqual(self.state.read_text(), "fips\n")
        self.assertEqual(self.log.read_text(), "remove python3\ninstall fips\n")

    def test_confirmation_cancels_rollback(self) -> None:
        self.run_guard("arm", "tx1", "60")
        self.run_guard("confirm", "wrong", expected=1)
        self.run_guard("confirm", "tx1")
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        self.assertEqual(self.run_guard("check", env=expired), "")
        self.assertEqual((self.etc / "fips-recovery/tx1/result").read_text(), "CONFIRMED tx1\n")

    def test_expired_confirmation_keeps_rollback_pending(self) -> None:
        self.run_guard("arm", "tx1", "60")
        expired = self.env | {"FIPS_TEST_NOW": "10060"}
        self.run_guard("confirm", "tx1", expected=1, env=expired)
        self.assertTrue((self.etc / "fips-recovery/pending").exists())
        self.assertFalse((self.etc / "fips-recovery/tx1/result").exists())
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))

    def test_rebooted_confirmation_keeps_rollback_pending(self) -> None:
        self.run_guard("arm", "tx1", "60")
        rebooted = self.env | {"FIPS_TEST_BOOT_ID": "boot-b", "FIPS_TEST_UPTIME": "1"}
        self.run_guard("confirm", "tx1", expected=1, env=rebooted)
        self.assertTrue((self.etc / "fips-recovery/pending").exists())
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=rebooted))

    def test_uptime_deadline_blocks_confirmation_after_clock_rollback(self) -> None:
        self.run_guard("arm", "tx1", "60")
        expired = self.env | {"FIPS_TEST_NOW": "9000", "FIPS_TEST_UPTIME": "160"}
        self.run_guard("confirm", "tx1", expected=1, env=expired)
        self.assertTrue((self.etc / "fips-recovery/pending").exists())
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))

    def test_invalid_pending_deadline_cannot_be_confirmed(self) -> None:
        self.run_guard("arm", "tx1", "60")
        (self.etc / "fips-recovery/pending").write_text("tx1 invalid 160 boot-a\n")
        self.run_guard("confirm", "tx1", expected=1)
        self.assertTrue((self.etc / "fips-recovery/pending").exists())

    def test_confirmation_cannot_race_active_rollback(self) -> None:
        self.run_guard("arm", "tx1", "60")
        process = subprocess.Popen(
            ["sh", str(GUARD), "rollback"],
            env=self.env | {"FIPS_TEST_OPKG_INSTALL_DELAY": "2"},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        try:
            deadline = time.monotonic() + 5
            while not self.log.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(self.log.exists(), "rollback never reached package restore")
            self.run_guard("confirm", "tx1", expected=1)
            output, error = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, output + error)
            self.assertIn("ROLLED_BACK tx1", output)
            self.assertFalse((self.etc / "fips-recovery/pending").exists())
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_watchdog_recovers_stale_lock_and_rolls_back(self) -> None:
        self.run_guard("arm", "tx1", "60")
        lock = self.root / "tmp/fips-recovery/guard.lock"
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.symlink_to("99999999")
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        process = subprocess.Popen(
            ["sh", str(GUARD), "watch"], env=expired,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        try:
            deadline = time.monotonic() + 5
            while (self.etc / "fips-recovery/pending").exists() and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertFalse((self.etc / "fips-recovery/pending").exists())
            self.assertEqual((self.etc / "fips-recovery/tx1/result").read_text(),
                             "ROLLED_BACK tx1\n")
        finally:
            process.terminate()
            try:
                process.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()

    def test_symlinked_lock_directory_blocks_arming(self) -> None:
        (self.root / "tmp").mkdir()
        (self.root / "tmp/fips-recovery").symlink_to(self.etc / "fips-recovery")
        self.run_guard("arm", "tx1", "60", expected=1)
        self.assertFalse((self.etc / "fips-recovery/pending").exists())

    def test_checksum_mismatch_blocks_arming(self) -> None:
        (self.etc / "fips-recovery/tx1/previous/fips.ipk").write_bytes(b"tampered")
        self.run_guard("arm", "tx1", "60", expected=1)
        self.assertFalse((self.etc / "fips-recovery/pending").exists())

    def test_wrong_prior_version_blocks_arming(self) -> None:
        (self.etc / "fips-recovery/tx1/previous/fips.version").write_text("2\n")
        self.run_guard("arm", "tx1", "60", expected=1)
        self.assertFalse((self.etc / "fips-recovery/pending").exists())

    def test_config_only_restores_settings_without_reinstalling_packages(self) -> None:
        dashboard = self.root / "root/dashboard"
        dashboard.mkdir(parents=True)
        toggle = dashboard / "toggle.sh"
        toggle.write_text("#!/bin/sh\necho \"$1\" >> \"$FIPS_TEST_TOGGLE_LOG\"\n")
        toggle.chmod(0o755)
        self.env["FIPS_TEST_TOGGLE_LOG"] = str(self.root / "toggle.log")
        for name in ("citydash", "gl_screen"):
            display_service = self.etc / "init.d" / name
            display_service.write_text(
                '#!/bin/sh\necho "' + name + ' $1" >> "$FIPS_TEST_DISPLAY_LOG"\n'
            )
            display_service.chmod(0o755)
        self.env["FIPS_TEST_DISPLAY_LOG"] = str(self.root / "display.log")
        (self.etc / "fips-recovery/tx1/previous/fips.ipk").unlink()
        self.run_guard("arm", "tx1", "60", "config_only")
        (self.etc / "fips/identity.key").write_text("new identity")
        (self.etc / "fips/new-config").write_text("new")
        (self.etc / "config/network").write_text("new network")
        expired = self.env | {"FIPS_TEST_UPTIME": "161"}
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))
        self.assertEqual((self.etc / "fips/identity.key").read_text(), "original identity")
        self.assertFalse((self.etc / "fips/new-config").exists())
        self.assertEqual((self.etc / "config/network").read_text(), "original network")
        self.assertFalse(self.log.exists())
        self.assertFalse((self.root / "toggle.log").exists())
        self.assertFalse((self.root / "display.log").exists())

    def test_package_rollback_returns_to_stock_display(self) -> None:
        dashboard = self.root / "root/dashboard"
        dashboard.mkdir(parents=True)
        toggle = dashboard / "toggle.sh"
        toggle.write_text("#!/bin/sh\necho \"$1\" >> \"$FIPS_TEST_TOGGLE_LOG\"\n")
        toggle.chmod(0o755)
        self.env["FIPS_TEST_TOGGLE_LOG"] = str(self.root / "toggle.log")
        self.run_guard("arm", "tx1", "60")
        (dashboard / "config.json").write_text('{"temporary":true}\n')
        self.run_guard("rollback")
        self.assertEqual((self.root / "toggle.log").read_text().splitlines(), ["off"])
        self.assertFalse((dashboard / "config.json").exists())

    def test_upgrade_rollback_restores_prior_dashboard_and_button_watcher(self) -> None:
        self.state.write_text("fips\ngl-e5800-dashboard\n")
        previous = self.etc / "fips-recovery/tx1/previous"
        archive = previous / "gl-e5800-dashboard.ipk"
        archive.write_bytes(b"known-good dashboard")
        (previous / "gl-e5800-dashboard.sha256").write_text(
            hashlib.sha256(archive.read_bytes()).hexdigest()
        )
        (previous / "gl-e5800-dashboard.version").write_text("1\n")
        self.display_service("gl_screen", enabled=False, running=False)
        self.display_service("citydash", enabled=True, running=True)
        self.display_service("homebutton", enabled=True, running=True)
        dashboard = self.root / "root/dashboard"
        dashboard.mkdir(parents=True)
        config = dashboard / "config.json"
        config.write_text('{"city":"before"}\n')
        config.chmod(0o640)
        network = self.etc / "config/network"
        network.chmod(0o606)
        self.run_guard("arm", "tx1", "60")

        # Model an interrupted upgrade whose package scripts reverted to stock.
        self.display_service("gl_screen", enabled=True, running=True)
        self.display_service("citydash", enabled=False, running=False)
        self.display_service("homebutton", enabled=False, running=False)
        config.write_text('{"city":"after"}\n')
        config.chmod(0o600)
        network.write_text("changed network")
        network.chmod(0o600)
        self.run_guard("rollback")
        state = self.root / "display-state"
        for name, enabled, running in (
            ("gl_screen", False, False),
            ("citydash", True, True),
            ("homebutton", True, True),
        ):
            self.assertEqual((state / f"{name}.enabled").exists(), enabled)
            self.assertEqual((state / f"{name}.running").exists(), running)
        self.assertEqual(self.state.read_text(), "fips\ngl-e5800-dashboard\n")
        self.assertEqual(config.read_text(), '{"city":"before"}\n')
        self.assertEqual(config.stat().st_mode & 0o777, 0o640)
        self.assertEqual(network.read_text(), "original network")
        self.assertEqual(network.stat().st_mode & 0o777, 0o606)

    def test_stock_screen_start_failure_keeps_rollback_pending_for_retry(self) -> None:
        self.run_guard("arm", "tx1", "60")
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        self.run_guard("check", expected=1, env=expired | {"FIPS_TEST_STOCK_FAIL": "yes"})
        self.assertTrue((self.etc / "fips-recovery/pending").exists())
        self.assertFalse((self.etc / "fips-recovery/tx1/result").exists())
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))
        self.assertFalse((self.etc / "fips-recovery/pending").exists())

    def test_dashboard_restart_failure_keeps_rollback_pending_for_retry(self) -> None:
        self.state.write_text("fips\ngl-e5800-dashboard\n")
        previous = self.etc / "fips-recovery/tx1/previous"
        archive = previous / "gl-e5800-dashboard.ipk"
        archive.write_bytes(b"known-good dashboard")
        (previous / "gl-e5800-dashboard.sha256").write_text(
            hashlib.sha256(archive.read_bytes()).hexdigest()
        )
        (previous / "gl-e5800-dashboard.version").write_text("1\n")
        self.display_service("gl_screen", enabled=False, running=False)
        self.display_service("citydash", enabled=True, running=True)
        self.run_guard("arm", "tx1", "60")
        self.display_service("gl_screen", enabled=True, running=True)
        self.display_service("citydash", enabled=False, running=False)
        self.run_guard("rollback", expected=1,
                       env=self.env | {"FIPS_TEST_DISPLAY_START_FAIL": "citydash"})
        self.assertTrue((self.etc / "fips-recovery/pending").exists())
        self.assertFalse((self.etc / "fips-recovery/tx1/result").exists())
        self.assertIn("ROLLED_BACK tx1", self.run_guard("rollback"))
        self.assertFalse((self.etc / "fips-recovery/pending").exists())

    def test_config_rollback_reloads_previous_firewall_and_service(self) -> None:
        fips_init = self.etc / "init.d/fips"
        fips_init.write_text(
            "#!/bin/sh\n"
            "case \"$1\" in enabled) exit 0;; esac\n"
            "echo \"$1\" >> \"$FIPS_TEST_SERVICE_LOG\"\n"
        )
        fips_init.chmod(0o755)
        nft = self.root / "fake-bin/nft"
        nft.write_text("#!/bin/sh\necho \"$*\" >> \"$FIPS_TEST_NFT_LOG\"\n")
        nft.chmod(0o755)
        jsonfilter = self.root / "fake-bin/jsonfilter"
        jsonfilter.write_text("#!/bin/sh\necho true\n")
        jsonfilter.chmod(0o755)
        self.env["FIPS_TEST_NFT_LOG"] = str(self.root / "nft.log")
        self.env["FIPS_TEST_SERVICE_LOG"] = str(self.root / "service.log")
        router = self.etc / "fips/router"
        router.mkdir()
        (router / "settings.json").write_text('{"enabled":true}\n')
        (router / "mesh.nft").write_text("table inet fips { chain old {} }\n")
        self.run_guard("arm", "tx1", "60", "config_only")
        (router / "settings.json").write_text('{"enabled":false}\n')
        (router / "mesh.nft").write_text("new rules")
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        self.run_guard("check", env=expired)
        self.assertEqual((router / "settings.json").read_text(), '{"enabled":true}\n')
        self.assertEqual((router / "mesh.nft").read_text(), "table inet fips { chain old {} }\n")
        self.assertIn("delete table inet fips", (self.root / "nft.log").read_text())
        self.assertIn("-f ", (self.root / "nft.log").read_text())
        self.assertIn("restart", (self.root / "service.log").read_text())

    def test_rollback_discards_uncommitted_uci_network_changes(self) -> None:
        self.run_guard("arm", "tx1", "60", "config_only")
        for name in ("network", "dhcp", "firewall"):
            (self.root / "uci-deltas" / f"{name}.delta").write_text(
                f"set {name}.fips_test=unsafe\n"
            )
        self.run_guard("rollback")
        self.assertEqual(list((self.root / "uci-deltas").iterdir()), [])
        self.assertEqual((self.etc / "config/network").read_text(), "original network")

    def test_config_rollback_restores_prior_gateway_service_state(self) -> None:
        gateway = self.etc / "init.d/fips-gateway"
        gateway.write_text(
            '#!/bin/sh\n'
            'case "$1" in enabled) exit 0;; esac\n'
            'echo "$1" >> "$FIPS_TEST_GATEWAY_LOG"\n'
        )
        gateway.chmod(0o755)
        self.env["FIPS_TEST_GATEWAY_LOG"] = str(self.root / "gateway.log")
        self.run_guard("arm", "tx1", "60", "config_only")
        self.assertEqual((self.etc / "fips-recovery/tx1/backup/gateway-service").read_text(),
                         "enabled\n")
        expired = self.env | {"FIPS_TEST_NOW": "10061"}
        self.run_guard("check", env=expired)
        self.assertEqual((self.root / "gateway.log").read_text().splitlines(),
                         ["stop", "enable", "restart"])

    def test_controller_loss_rolls_back_post_firmware_identity_restore(self) -> None:
        # Model a firmware update that left no installed FIPS package or identity.
        self.state.write_text("")
        shutil.rmtree(self.etc / "fips")
        fips_init = self.etc / "init.d/fips"
        fips_init.write_text("#!/bin/sh\nexit 0\n")
        fips_init.chmod(0o755)
        self.run_guard("arm", "tx1", "60")

        restored = {
            "etc/config/network": b"old firmware network",
            "etc/config/firewall": b"old firmware firewall",
            "etc/config/dhcp": b"old firmware dhcp",
            "etc/fips/fips.key": b"prior private identity",
            "etc/fips/fips.yaml": b"prior daemon config",
            "etc/fips/router/settings.json": b'{"enabled":true}',
            "etc/fips/router/mesh.nft": b"table inet fips {}",
        }
        with patch("tools.render_backup_restore.read_encrypted", return_value=restored):
            script = render(Path("unused.age"), Path("unused-key"), "tx1")
        script_path = self.root / "restore.sh"
        script_path.write_text(script)
        applied = subprocess.run(["sh", str(script_path)], env=self.env,
                                 capture_output=True, text=True, check=True)
        self.assertIn("FIPS_BACKUP_RESTORED", applied.stdout)
        self.assertEqual((self.etc / "fips/fips.key").read_bytes(), b"prior private identity")
        self.assertEqual((self.etc / "config/network").read_text(), "original network")

        # No controller confirmation: the boot-persistent guard times out locally.
        expired = self.env | {"FIPS_TEST_NOW": "10061", "FIPS_TEST_UPTIME": "161"}
        self.assertIn("ROLLED_BACK tx1", self.run_guard("check", env=expired))
        self.assertFalse((self.etc / "fips").exists())
        self.assertEqual((self.etc / "config/network").read_text(), "original network")
        self.assertEqual((self.etc / "fips-recovery/tx1/result").read_text(), "ROLLED_BACK tx1\n")


if __name__ == "__main__":
    unittest.main()
