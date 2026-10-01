"""Exercise the actual confirmation probe script with a local router fixture."""

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


class ConfirmationBindingTests(unittest.TestCase):
    def test_deployment_stages_the_complete_selected_component_set(self):
        play = yaml.safe_load((ROOT / "ansible/deploy.yml").read_text())[0]
        transaction = next(item for item in play["tasks"] if item["name"].startswith("Install with a router-local"))
        install_guard = next(item for item in transaction["block"]
                             if item["name"].startswith("Install and start boot-persistent"))
        self.assertIn("ansible.builtin.script", install_guard)
        guard_template = (ROOT / "ansible/templates/install-guard.sh.j2").read_text()
        line = next(line.strip() for line in guard_template.splitlines()
                    if "'components':" in line)
        jinja = Environment()
        jinja.filters["to_json"] = json.dumps
        jinja.filters["b64encode"] = lambda value: base64.b64encode(value.encode()).decode()
        encoded = jinja.from_string(line).render({
            "recovery_probe_ip": "1.1.1.1", "recovery_probe_name": "example.com",
            "restore_components": ["web_ui", "fips", "device_ui"],
        })
        staged = json.loads(base64.b64decode(encoded))
        self.assertEqual(staged["components"], "device_ui,fips,web_ui")

    def test_cannot_narrow_the_component_list_at_confirmation(self):
        play = yaml.safe_load((ROOT / "ansible/confirm.yml").read_text())[0]
        task = next(item for item in play["tasks"] if item["name"].startswith("Recheck pending guard"))
        template = task["ansible.builtin.raw"]
        jinja = Environment()
        jinja.filters["quote"] = shlex.quote

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            guard_dir = root / "etc/fips-recovery"
            (guard_dir / "tx1/backup").mkdir(parents=True)
            (guard_dir / "tx1/backup/mode").write_text("packages\n")
            (guard_dir / "probes.json").write_text(json.dumps({
                "ip": "1.1.1.1", "name": "example.com", "minimum_links": 1,
                "ipv6": None, "components": "device_ui,fips,web_ui",
            }))
            guard = guard_dir / "guard.sh"
            guard.write_text("#!/bin/sh\nprintf 'PENDING tx1 10060\\n'\n")
            health = guard_dir / "health.sh"
            health.write_text("#!/bin/sh\nprintf '%s\\n' \"$3\" > \"$FIPS_TEST_HEALTH_LOG\"\necho FIPS_HEALTHY\n")
            fake_bin = root / "bin"
            fake_bin.mkdir()
            jsonfilter = fake_bin / "jsonfilter"
            jsonfilter.write_text(
                "#!/usr/bin/env python3\n"
                "import json, sys\n"
                "args = sys.argv\n"
                "value = json.load(open(args[args.index('-i') + 1]))[args[args.index('-e') + 1][2:]]\n"
                "print('null' if value is None else value)\n"
            )
            jsonfilter.chmod(0o755)
            health_log = root / "health-components"
            env = os.environ | {
                "PATH": f"{fake_bin}:{os.environ['PATH']}",
                "FIPS_TEST_HEALTH_LOG": str(health_log),
            }
            variables = {
                "recovery_transaction": "tx1", "recovery_probe_ip": "1.1.1.1",
                "recovery_probe_name": "example.com", "fips_required_link_count": 1,
            }

            def run(components):
                rendered = jinja.from_string(template).render(
                    variables | {"restore_components": components}
                )
                rendered = rendered.replace("/etc/fips-recovery", str(guard_dir))
                return subprocess.run(["sh", "-c", rendered], env=env,
                                      capture_output=True, text=True)

            narrowed = run(["fips", "web_ui"])
            self.assertNotEqual(narrowed.returncode, 0, narrowed.stdout)
            self.assertFalse(health_log.exists())

            exact = run(["web_ui", "device_ui", "fips"])
            self.assertEqual(exact.returncode, 0, exact.stderr)
            self.assertIn("FIPS_READY_TO_CONFIRM", exact.stdout)
            self.assertEqual(health_log.read_text(), "device_ui,fips,web_ui\n")


if __name__ == "__main__":
    unittest.main()
