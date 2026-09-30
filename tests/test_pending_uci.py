"""Exercise the deployment's read-only UCI preflight against a fake router CLI."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import yaml


DEPLOY = Path(__file__).resolve().parents[1] / "ansible/deploy.yml"


class PendingUciTests(unittest.TestCase):
    def test_deployment_rejects_pending_network_edits_before_writes(self) -> None:
        play = yaml.safe_load(DEPLOY.read_text())[0]
        preflight = next(task for task in play["tasks"]
                         if task.get("name") ==
                         "Refuse deployment over pending router network configuration edits")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            uci = root / "uci"
            uci.write_text("""#!/bin/sh
[ "$1" = -q ] && [ "$2" = changes ] || exit 2
[ "$3" != "$FIPS_TEST_FAIL_UCI" ] || exit 1
[ "$3" = "$FIPS_TEST_PENDING_UCI" ] && echo "set $3.test=1"
exit 0
""")
            uci.chmod(0o755)
            env = os.environ | {"PATH": f"{root}:{os.environ['PATH']}"}
            command = ["sh", "-c", preflight["ansible.builtin.raw"]]
            clean = subprocess.run(command, env=env, text=True, capture_output=True)
            self.assertEqual(clean.returncode, 0, clean.stderr)
            for name in ("network", "dhcp", "firewall"):
                with self.subTest(name=name):
                    pending = subprocess.run(
                        command, env=env | {"FIPS_TEST_PENDING_UCI": name},
                        text=True, capture_output=True,
                    )
                    self.assertNotEqual(pending.returncode, 0)
                    self.assertIn(f"Pending UCI changes in {name}", pending.stderr)
            failed_read = subprocess.run(
                command, env=env | {"FIPS_TEST_FAIL_UCI": "dhcp"},
                text=True, capture_output=True,
            )
            self.assertNotEqual(failed_read.returncode, 0)


if __name__ == "__main__":
    unittest.main()
