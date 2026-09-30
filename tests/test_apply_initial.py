"""Exercise the router-side initial-settings sequence without touching a router."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "packaging/recovery/apply-initial.sh"


class ApplyInitialTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.log = self.root / "requests.jsonl"
        self.admin = self.root / "fake-admin"
        self.admin.write_text("""#!/usr/bin/env python3
import json, os, sys
request = json.load(sys.stdin)
with open(os.environ['FIPS_FAKE_LOG'], 'a') as log:
    log.write(json.dumps({'request': request, 'args': sys.argv[1:]}) + '\\n')
operation = request['operation']
if os.environ.get('FIPS_FAKE_FAIL') == operation:
    print(json.dumps({'status': 'error', 'error': 'simulated'}))
    sys.exit(1)
if operation == 'configuration':
    data = {'revision': 'a' * 64}
elif operation == 'stage':
    data = {'revision': 'b' * 64, 'staged': True}
elif operation == 'activate_package':
    if '--package-activation' not in sys.argv[1:]:
        sys.exit(2)
    data = {'transaction_id': request['transaction_id']}
else:
    sys.exit(2)
print(json.dumps({'status': 'ok', 'data': data}))
""")
        self.admin.chmod(0o755)
        jsonfilter = self.root / "jsonfilter"
        jsonfilter.write_text("""#!/usr/bin/env python3
import json, sys
data = json.load(sys.stdin)
for part in sys.argv[sys.argv.index('-e') + 1][2:].split('.'):
    data = data[part]
print(data)
""")
        jsonfilter.chmod(0o755)
        self.env = os.environ | {
            "FIPS_ADMIN_BIN": str(self.admin),
            "FIPS_FAKE_LOG": str(self.log),
            "PATH": f"{self.root}:{os.environ['PATH']}",
        }
        self.settings = {
            "enabled": True,
            "udp_port": 2121,
            "tcp_port": 8443,
            "gateway_enabled": False,
            "peers": [{"npub": "public-peer", "transport": "udp", "address": "peer.example:2121"}],
            "mesh_tcp_ports": [],
            "mesh_udp_ports": [],
        }

    def run_script(self, transaction: str = "deploy_1", env: dict | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["sh", str(SCRIPT), transaction], input=json.dumps(self.settings),
            env=env or self.env, text=True, capture_output=True, check=False,
        )

    def requests(self) -> list[dict]:
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_stages_then_activates_exact_package_transaction(self) -> None:
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "FIPS_CONFIG_APPLIED")
        requests = self.requests()
        self.assertEqual([item["request"]["operation"] for item in requests],
                         ["configuration", "stage", "activate_package"])
        self.assertEqual(requests[1]["request"]["settings"], self.settings)
        self.assertEqual(requests[1]["request"]["expected_revision"], "a" * 64)
        self.assertEqual(requests[2]["request"]["expected_revision"], "b" * 64)
        self.assertEqual(requests[2]["request"]["transaction_id"], "deploy_1")
        self.assertEqual(requests[2]["args"], ["--package-activation"])
        self.assertNotIn("peer.example", result.stdout + result.stderr)

    def test_rejects_unsafe_transaction_before_backend_access(self) -> None:
        result = self.run_script("bad;transaction")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.requests(), [])

    def test_failed_stage_never_activates(self) -> None:
        result = self.run_script(env=self.env | {"FIPS_FAKE_FAIL": "stage"})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([item["request"]["operation"] for item in self.requests()],
                         ["configuration", "stage"])
        self.assertNotIn("FIPS_CONFIG_APPLIED", result.stdout)


if __name__ == "__main__":
    unittest.main()
