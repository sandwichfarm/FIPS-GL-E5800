"""Check touchscreen controls cannot close a package deployment guard."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import unittest


PANEL = Path(__file__).resolve().parents[1] / "packaging/device-ui/fips_panel.inc.py"


class DevicePanelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scope = {"json": json, "os": os, "subprocess": subprocess}
        exec(compile(PANEL.read_text(), str(PANEL), "exec"), self.scope)

    def test_package_guard_requires_controller_confirmation(self) -> None:
        calls = []

        def request(operation, **fields):
            calls.append((operation, fields))
            if operation == "recovery":
                return {"pending": True, "mode": "packages", "transaction_id": "deploy1"}
            raise AssertionError(f"Unexpected operation: {operation}")

        self.scope["fips_request"] = request
        self.assertEqual(self.scope["fips_toggle_action"](), "Confirm from controller.")
        self.assertEqual(calls, [("recovery", {})])

    def test_configuration_guard_can_be_rolled_back(self) -> None:
        calls = []

        def request(operation, **fields):
            calls.append((operation, fields))
            if operation == "recovery":
                return {"pending": True, "mode": "config_only", "transaction_id": "cfg_0123456789abcdef"}
            if operation == "rollback":
                return {"rolled_back": True}
            raise AssertionError(f"Unexpected operation: {operation}")

        self.scope["fips_request"] = request
        self.assertEqual(self.scope["fips_toggle_action"](), "Previous FIPS setup restored.")
        self.assertEqual(calls, [("recovery", {}), ("rollback", {"transaction_id": "cfg_0123456789abcdef"})])


if __name__ == "__main__":
    unittest.main()
