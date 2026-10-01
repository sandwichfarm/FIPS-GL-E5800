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
    def test_first_install_preflight_rejects_stale_bootstrap_paths(self) -> None:
        play = yaml.safe_load((ROOT / "ansible/deploy.yml").read_text())[0]
        task = next(task for task in play["tasks"]
                    if task["name"] == "Classify a prior recovery guard before router writes")
        rendered = Environment().from_string(task["ansible.builtin.raw"]).render({
            "restore_components": ["fips"], "recovery_transaction": "tx1",
        })
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            init_dir = root / "etc/init.d"
            links = root / "etc/rc.d"
            init_dir.mkdir(parents=True)
            links.mkdir()
            fake_bin = root / "bin"
            fake_bin.mkdir()
            opkg = fake_bin / "opkg"
            opkg.write_text("#!/bin/sh\nexit 0\n")
            opkg.chmod(0o755)
            substitutions = (
                ("/etc/fips-recovery", root / "etc/fips-recovery"),
                ("/etc/init.d/fips-recovery", init_dir / "fips-recovery"),
                ("/etc/rc.d", links),
                ("/tmp/fips-recovery", root / "tmp/fips-recovery"),
            )
            for index, (original, _) in enumerate(substitutions):
                rendered = rendered.replace(original, f"FIPS_TEST_PATH_{index}")
            for index, (_, replacement) in enumerate(substitutions):
                rendered = rendered.replace(f"FIPS_TEST_PATH_{index}", str(replacement))
            env = os.environ | {"PATH": f"{fake_bin}:{os.environ['PATH']}"}

            def run() -> subprocess.CompletedProcess[str]:
                return subprocess.run(["sh", "-c", rendered], env=env,
                                      capture_output=True, text=True)

            self.assertIn("FIRST_INSTALL", run().stdout)
            lock = root / "tmp/fips-recovery"
            lock.mkdir(parents=True)
            self.assertNotEqual(run().returncode, 0)
            lock.rmdir()
            (links / "S05fips-recovery").symlink_to(init_dir / "fips-recovery")
            self.assertNotEqual(run().returncode, 0)

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
        self.assertEqual(block[names.index("Arm the existing guard before replacing its files")]["when"],
                         "existing_recovery_guard")
        self.assertLess(names.index("Render guard bootstrap as a streamed script"),
                        names.index("Install and start boot-persistent recovery guard"))
        install = block[names.index("Install and start boot-persistent recovery guard")]
        self.assertEqual(install["ansible.builtin.script"]["executable"], "/bin/sh")
        self.assertIn("guard_stage.path", install["ansible.builtin.script"]["cmd"])
        self.assertIn("/bin/sh /etc/fips-recovery/guard.sh arm",
                      (ROOT / "ansible/templates/install-guard.sh.j2").read_text())
        self.assertNotIn("Stage exact prior packages for a first installation", names)

    def test_both_guard_install_scripts_render_as_shell(self) -> None:
        play = yaml.safe_load((ROOT / "ansible/deploy.yml").read_text())[0]
        tasks = play["tasks"]
        classify = next(task for task in tasks
                        if task["name"] == "Classify a prior recovery guard before router writes")
        block = next(task["block"] for task in tasks
                     if task["name"] == "Install with a router-local rollback guard")
        install = (ROOT / "ansible/templates/install-guard.sh.j2").read_text()
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
            "recovery_seconds": 300,
            "recovery_probe_ip": "1.1.1.1",
            "recovery_probe_name": "example.com",
        }
        for existing in (False, True):
            rendered_classify = jinja.from_string(classify["ansible.builtin.raw"]).render(variables)
            rendered_install = jinja.from_string(install).render(
                variables | {"existing_recovery_guard": existing})
            for name, rendered in (("classify", rendered_classify), ("install", rendered_install)):
                result = subprocess.run(["sh", "-n"], input=rendered, text=True,
                                        capture_output=True, check=False)
                self.assertEqual(result.returncode, 0, f"{name} existing={existing}: {result.stderr}")
            self.assertIn("test -f /etc/fips-recovery/pending" if existing
                          else "test ! -e /etc/fips-recovery/pending", rendered_install)
            self.assertEqual("/etc/init.d/fips-recovery restart" in rendered_install,
                             not existing)
            self.assertEqual("bootstrap_cleanup" in rendered_install, not existing)

        manual_install = jinja.from_string(install).render(
            variables | {"existing_recovery_guard": False,
                         "deployment_recovery_mode": "manual"})
        self.assertIn("tx1 manual", manual_install)
        self.assertNotIn("tx1 300", manual_install)
        self.assertEqual(subprocess.run(["sh", "-n"], input=manual_install,
                                        text=True, capture_output=True).returncode, 0)

    def test_rescue_covers_both_armed_paths_and_cleans_unarmed_bootstrap(self) -> None:
        play = yaml.safe_load((ROOT / "ansible/deploy.yml").read_text())[0]
        transaction = next(task for task in play["tasks"]
                           if task["name"] == "Install with a router-local rollback guard")
        rescue = transaction["rescue"]
        rollback = rescue[0]
        self.assertEqual(rollback["when"], "deployment_recovery_mode != 'manual'")
        self.assertIn("recovery_guard_install", rescue[1]["when"][1])
        jinja = Environment()
        jinja.filters["quote"] = shlex.quote
        for existing in (False, True):
            rendered = jinja.from_string(rollback["ansible.builtin.raw"]).render({
                "existing_recovery_guard": existing, "recovery_transaction": "tx1",
            })
            result = subprocess.run(["sh", "-n"], input=rendered, text=True,
                                    capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)

        bootstrap = rescue[1]["ansible.builtin.script"]
        self.assertIn("packaging/recovery/cleanup-bootstrap.sh", bootstrap["cmd"])
        self.assertEqual(bootstrap["executable"], "/bin/sh")
        self.assertEqual(transaction["always"][0]["name"],
                         "Remove private controller guard staging")

    def test_manual_mode_is_first_install_only_and_has_no_auto_rollback(self) -> None:
        play = yaml.safe_load((ROOT / "ansible/deploy.yml").read_text())[0]
        tasks = play["tasks"]
        manual_gate = next(task for task in tasks
                           if task["name"] == "Require first installation for manual-only rollback")
        self.assertEqual(manual_gate["when"], "deployment_recovery_mode == 'manual'")
        self.assertIn("not existing_recovery_guard", manual_gate["ansible.builtin.assert"]["that"])
        transaction = next(task for task in tasks
                           if task["name"] == "Install with a router-local rollback guard")
        self.assertIn("'manual' if deployment_recovery_mode",
                      (ROOT / "ansible/templates/install-guard.sh.j2").read_text())
        self.assertEqual(transaction["rescue"][0]["when"],
                         "deployment_recovery_mode != 'manual'")

    def test_first_install_bootstrap_cleans_on_disconnect_before_arming(self) -> None:
        play = yaml.safe_load((ROOT / "ansible/deploy.yml").read_text())[0]
        transaction = next(task for task in play["tasks"]
                           if task["name"] == "Install with a router-local rollback guard")
        template = (ROOT / "ansible/templates/install-guard.sh.j2").read_text()
        jinja = Environment()
        jinja.filters["from_json"] = json.loads
        jinja.filters["to_json"] = json.dumps
        jinja.filters["b64encode"] = lambda value: base64.b64encode(value.encode()).decode()
        jinja.filters["quote"] = shlex.quote
        fake_guard = (
            '#!/bin/sh\n'
            'if [ "$1" = arm ]; then\n'
            '  root="$FIPS_TEST_ROOT/etc/fips-recovery"\n'
            '  printf "%s 10060 160 boot-a\\n" "$2" > "$root/pending"\n'
            '  echo "ARMED $2"\n'
            'elif [ "$1" = status ]; then\n'
            '  echo "PENDING tx1 10060"\n'
            'fi\n'
        )
        fake_init = '#!/bin/sh\ncase "$1" in enable|restart|status|disable|stop) exit 0;; esac\nexit 2\n'

        def lookup(kind: str, path: str) -> str:
            self.assertEqual(kind, "file")
            if path.endswith("/guard.sh"):
                return fake_guard
            if path.endswith("/fips-recovery.init"):
                return fake_init
            if path.endswith("/runtime.json"):
                return Path(path).read_text()
            return "#!/bin/sh\nexit 0\n"

        rendered = jinja.from_string(template).render({
            "lookup": lookup, "playbook_dir": str(ROOT / "ansible"),
            "restore_components": ["fips"], "existing_recovery_guard": False,
            "recovery_transaction": "tx1", "recovery_seconds": 300,
            "recovery_probe_ip": "1.1.1.1", "recovery_probe_name": "example.com",
        })
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            fake_bin = base / "bin"
            fake_bin.mkdir()
            opkg = fake_bin / "opkg"
            opkg.write_text('#!/bin/sh\n[ "$1" = list-installed ]\n')
            opkg.chmod(0o755)
            for kind in ("disconnect", "success"):
                root = base / kind
                (root / "etc/init.d").mkdir(parents=True)
                (root / "etc/rc.d").mkdir()
                substitutions = (
                    ("/etc/fips-recovery", root / "etc/fips-recovery"),
                    ("/etc/init.d/fips-recovery", root / "etc/init.d/fips-recovery"),
                    ("/etc/rc.d", root / "etc/rc.d"),
                    ("/tmp/fips-recovery", root / "tmp/fips-recovery"),
                )
                script = rendered
                for index, (original, _) in enumerate(substitutions):
                    script = script.replace(original, f"FIPS_TEST_PATH_{index}")
                for index, (_, replacement) in enumerate(substitutions):
                    script = script.replace(f"FIPS_TEST_PATH_{index}", str(replacement))
                if kind == "disconnect":
                    before_arm = f"mkdir -p {root}/etc/fips-recovery/tx1/previous"
                    script = script.replace(before_arm, "kill -HUP $$\n" + before_arm, 1)
                result = subprocess.run(["sh", "-c", script], capture_output=True, text=True,
                                        env=os.environ | {"FIPS_TEST_ROOT": str(root),
                                                          "PATH": f"{fake_bin}:{os.environ['PATH']}"})
                if kind == "disconnect":
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse((root / "etc/fips-recovery").exists())
                    self.assertFalse((root / "etc/init.d/fips-recovery").exists())
                else:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn("ARMED tx1", result.stdout)
                    self.assertTrue((root / "etc/fips-recovery/pending").exists())
                    self.assertTrue((root / "etc/init.d/fips-recovery").exists())


if __name__ == "__main__":
    unittest.main()
