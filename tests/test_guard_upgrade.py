"""Check the rendered upgrade path arms the old watchdog before replacing it."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

from jinja2 import Environment
import yaml


ROOT = Path(__file__).resolve().parents[1]


class GuardUpgradeTests(unittest.TestCase):
    def test_existing_guard_preflight_rejects_missing_runtime_coverage(self) -> None:
        play = yaml.safe_load((ROOT / "ansible/deploy.yml").read_text())[0]
        task = next(task for task in play["tasks"]
                    if task["name"] == "Classify a prior recovery guard before router writes")
        jinja = Environment()
        jinja.filters["from_json"] = json.loads
        rendered = jinja.from_string(task["ansible.builtin.raw"]).render({
            "restore_components": ["device_ui"],
            "recovery_transaction": "tx1",
            "playbook_dir": str(ROOT / "ansible"),
            "lookup": lambda kind, path: Path(path).read_text(),
        })
        with tempfile.TemporaryDirectory() as temporary:
            etc = Path(temporary) / "etc"
            recovery = etc / "fips-recovery"
            init = etc / "init.d/fips-recovery"
            recovery.mkdir(parents=True)
            recovery.chmod(0o700)
            init.parent.mkdir(parents=True)
            fake_bin = Path(temporary) / "bin"
            fake_bin.mkdir()
            fake_stat = fake_bin / "stat"
            fake_stat.write_text("#!/bin/sh\necho 700\n")
            fake_stat.chmod(0o755)
            for name in ("health.sh", "probes.json", "apply-initial.sh"):
                (recovery / name).write_text("prior\n")
            guard = recovery / "guard.sh"
            guard.write_text("#!/bin/sh\n# FIPS_RECOVERY_LAYOUT=2\necho NONE\n")
            init.write_text("#!/bin/sh\nexit 0\n")
            init.chmod(0o755)
            runtime = recovery / "runtime-packages"
            packages = json.loads((ROOT / "upstream/vendor/runtime.json").read_text())["remove_order"]
            runtime.write_text("\n".join(packages) + "\n")
            script = rendered.replace("/etc/fips-recovery", str(recovery)).replace(
                "/etc/init.d/fips-recovery", str(init))
            env = os.environ | {"PATH": f"{fake_bin}:{os.environ['PATH']}"}
            ok = subprocess.run(["sh", "-c", script], capture_output=True, text=True,
                                env=env)
            self.assertEqual(ok.returncode, 0, ok.stderr)
            self.assertIn("GUARDED_UPGRADE", ok.stdout)
            runtime.write_text("\n".join(packages[1:]) + "\n")
            missing = subprocess.run(["sh", "-c", script], capture_output=True, text=True,
                                     env=env)
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("does not cover candidate runtime", missing.stderr)

    def test_existing_guard_is_armed_before_it_is_replaced(self) -> None:
        play = yaml.safe_load((ROOT / "ansible/deploy.yml").read_text())[0]
        tasks = play["tasks"]
        classify = next(task for task in tasks
                        if task["name"] == "Classify a prior recovery guard before router writes")
        self.assertEqual(classify["changed_when"], False)
        block = next(task["block"] for task in tasks
                     if task["name"] == "Install with a router-local rollback guard")
        names = [task["name"] for task in block]
        self.assertLess(names.index("Stage exact prior packages before changing an existing guard"),
                        names.index("Arm the existing guard before replacing its files"))
        self.assertLess(names.index("Arm the existing guard before replacing its files"),
                        names.index("Install and start boot-persistent recovery guard"))
        self.assertLess(names.index("Install and start boot-persistent recovery guard"),
                        names.index("Arm new local guard before any candidate package installation"))
        self.assertEqual(block[names.index("Arm the existing guard before replacing its files")]["when"],
                         "existing_recovery_guard")
        self.assertEqual(block[names.index("Arm new local guard before any candidate package installation")]["when"],
                         "not existing_recovery_guard")

    def test_both_guard_install_scripts_render_as_shell(self) -> None:
        play = yaml.safe_load((ROOT / "ansible/deploy.yml").read_text())[0]
        tasks = play["tasks"]
        classify = next(task for task in tasks
                        if task["name"] == "Classify a prior recovery guard before router writes")
        block = next(task["block"] for task in tasks
                     if task["name"] == "Install with a router-local rollback guard")
        install = next(task for task in block
                       if task["name"] == "Install and start boot-persistent recovery guard")
        jinja = Environment()
        jinja.filters["from_json"] = json.loads
        jinja.filters["to_json"] = json.dumps
        jinja.filters["b64encode"] = lambda value: base64.b64encode(value.encode()).decode()
        jinja.filters["quote"] = shlex.quote

        def lookup(kind: str, path: str) -> str:
            self.assertEqual(kind, "file")
            return Path(path).read_text()

        variables = {
            "lookup": lookup,
            "playbook_dir": str(ROOT / "ansible"),
            "restore_components": ["fips", "web_ui", "device_ui"],
            "recovery_transaction": "tx1",
            "recovery_probe_ip": "1.1.1.1",
            "recovery_probe_name": "example.com",
        }
        for existing in (False, True):
            rendered_classify = jinja.from_string(classify["ansible.builtin.raw"]).render(variables)
            rendered_install = jinja.from_string(install["ansible.builtin.raw"]).render(
                variables | {"existing_recovery_guard": existing})
            for name, rendered in (("classify", rendered_classify), ("install", rendered_install)):
                result = subprocess.run(["sh", "-n"], input=rendered, text=True,
                                        capture_output=True, check=False)
                self.assertEqual(result.returncode, 0, f"{name} existing={existing}: {result.stderr}")
            self.assertIn("test -f /etc/fips-recovery/pending" if existing
                          else "test ! -e /etc/fips-recovery/pending", rendered_install)
            self.assertEqual("/etc/init.d/fips-recovery restart" in rendered_install,
                             not existing)

    def test_rescue_covers_both_armed_paths_and_cleans_unarmed_bootstrap(self) -> None:
        play = yaml.safe_load((ROOT / "ansible/deploy.yml").read_text())[0]
        transaction = next(task for task in play["tasks"]
                           if task["name"] == "Install with a router-local rollback guard")
        rescue = transaction["rescue"]
        rollback = rescue[0]
        self.assertIn("prior_recovery_arm", rollback["when"])
        self.assertIn("recovery_arm", rollback["when"])
        jinja = Environment()
        jinja.filters["quote"] = shlex.quote
        for existing in (False, True):
            rendered = jinja.from_string(rollback["ansible.builtin.raw"]).render({
                "existing_recovery_guard": existing, "recovery_transaction": "tx1",
            })
            result = subprocess.run(["sh", "-n"], input=rendered, text=True,
                                    capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)

        bootstrap = rescue[1]["ansible.builtin.raw"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            etc = root / "etc"
            recovery = etc / "fips-recovery"
            init = etc / "init.d/fips-recovery"
            links = etc / "rc.d"
            recovery.mkdir(parents=True)
            init.parent.mkdir(parents=True)
            links.mkdir(parents=True)
            (recovery / "guard.sh").write_text("candidate guard\n")
            init.write_text("#!/bin/sh\nexit 0\n")
            init.chmod(0o755)
            (links / "S05fips-recovery").symlink_to(init)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            opkg = fake_bin / "opkg"
            opkg.write_text("#!/bin/sh\nexit 0\n")
            opkg.chmod(0o755)
            substitutions = (
                ("/etc/fips-recovery", recovery),
                ("/etc/init.d/fips-recovery", init),
                ("/etc/rc.d", links),
                ("/tmp/fips-recovery", root / "tmp/fips-recovery"),
            )
            for index, (original, _) in enumerate(substitutions):
                bootstrap = bootstrap.replace(original, f"FIPS_TEST_PATH_{index}")
            for index, (_, replacement) in enumerate(substitutions):
                bootstrap = bootstrap.replace(f"FIPS_TEST_PATH_{index}", str(replacement))
            result = subprocess.run(["sh", "-c", bootstrap], capture_output=True, text=True,
                                    env=os.environ | {"PATH": f"{fake_bin}:{os.environ['PATH']}"})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("FIRST_INSTALL_BOOTSTRAP_CLEAN", result.stdout)
            self.assertFalse(recovery.exists())
            self.assertFalse(init.exists())
            self.assertEqual(list(links.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
