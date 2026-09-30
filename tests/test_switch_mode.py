"""Check guarded FIPS/stock mode transitions and partial display recovery."""

from __future__ import annotations

import json
import subprocess
import unittest
from unittest.mock import Mock, patch

from tools.switch_mode import ModeController


class FakeController(ModeController):
    def __init__(self, replies: dict[str, dict]):
        self.replies = replies
        self.calls: list[tuple] = []

    def require_display_package(self) -> None:
        self.calls.append(("display_package",))

    def request(self, operation: str, **fields: object) -> dict:
        self.calls.append((operation, fields))
        return self.replies[operation]

    def toggle_display(self, mode: str) -> None:
        self.calls.append(("toggle_display", mode))


class SwitchModeTests(unittest.TestCase):
    def test_prepare_stock_preserves_peer_settings_and_disables_gateway(self) -> None:
        settings = {"enabled": True, "gateway_enabled": True,
                    "peers": [{"npub": "synthetic-peer", "address": "peer:2121"}]}
        controller = FakeController({
            "recovery": {"pending": False},
            "configuration": {"revision": "old", "settings": settings},
            "stage": {"revision": "new"},
            "activate": {"pending": True, "transaction_id": "cfg_0123456789abcdef",
                         "deadline_seconds": 180},
        })
        result = controller.prepare("stock")
        self.assertEqual(result["state"], "PENDING_CONFIRMATION")
        staged = next(call[1]["settings"] for call in controller.calls
                      if call[0] == "stage")
        self.assertFalse(staged["enabled"])
        self.assertFalse(staged["gateway_enabled"])
        self.assertEqual(staged["peers"], settings["peers"])
        self.assertEqual(controller.calls[-1][0], "activate")

    def test_prepare_fips_never_enables_gateway_and_noop_is_idempotent(self) -> None:
        controller = FakeController({
            "recovery": {"pending": False},
            "configuration": {"revision": "old", "settings": {
                "enabled": False, "gateway_enabled": False, "peers": ["saved"]}},
            "stage": {"revision": "new"},
            "activate": {"pending": True, "transaction_id": "cfg_0123456789abcdef"},
        })
        self.assertEqual(controller.prepare("fips")["state"], "PENDING_CONFIRMATION")
        staged = next(call[1]["settings"] for call in controller.calls
                      if call[0] == "stage")
        self.assertTrue(staged["enabled"])
        self.assertFalse(staged["gateway_enabled"])
        already = FakeController({
            "recovery": {"pending": False},
            "configuration": {"revision": "current", "settings": {
                "enabled": True, "gateway_enabled": False}},
        })
        self.assertEqual(already.prepare("fips")["state"], "CONFIG_ALREADY_IN_MODE")
        self.assertNotIn("stage", [call[0] for call in already.calls])

    def test_confirm_changes_display_only_after_backend_confirms(self) -> None:
        transaction = "cfg_0123456789abcdef"
        controller = FakeController({
            "recovery": {"pending": True, "mode": "config_only",
                         "transaction_id": transaction},
            "configuration": {"settings": {"enabled": False,
                                               "gateway_enabled": False}},
            "confirm": {"confirmed": True, "transaction_id": transaction},
        })
        self.assertEqual(controller.confirm("stock", transaction)["state"], "MODE_ACTIVE")
        self.assertEqual([call[0] for call in controller.calls][-2:],
                         ["confirm", "toggle_display"])
        controller.calls.clear()
        controller.replies["configuration"]["settings"]["enabled"] = True
        with self.assertRaisesRegex(ValueError, "does not match"):
            controller.confirm("stock", transaction)
        self.assertNotIn("confirm", [call[0] for call in controller.calls])

    def test_rollback_never_changes_display(self) -> None:
        transaction = "cfg_0123456789abcdef"
        controller = FakeController({
            "recovery": {"pending": True, "mode": "config_only",
                         "transaction_id": transaction},
            "rollback": {"rolled_back": True},
        })
        self.assertEqual(controller.rollback(transaction)["state"], "PREVIOUS_MODE_RESTORED")
        self.assertNotIn("toggle_display", [call[0] for call in controller.calls])

    def test_screen_retry_requires_matching_config_and_verifies_service_owner(self) -> None:
        controller = ModeController.__new__(ModeController)
        controller.ssh = ["ssh", "root@synthetic"]
        controller.require_display_package = Mock()
        controller.request = Mock(side_effect=[
            {"settings": {"enabled": False, "gateway_enabled": False}},
            {"pending": False},
        ])
        controller.display_state = Mock(return_value={
            "gl_screen": ["enabled", "running"],
            "citydash": ["disabled", "stopped"],
            "homebutton": ["enabled", "running"],
        })
        with patch("tools.switch_mode.subprocess.run",
                   return_value=subprocess.CompletedProcess([], 0, "stock restored")) as run:
            controller.toggle_display("stock")
        self.assertEqual(run.call_args.args[0][-1], "/root/dashboard/toggle.sh off")
        controller.request = Mock(return_value={"settings": {"enabled": True,
                                                                "gateway_enabled": False}})
        with patch("tools.switch_mode.subprocess.run") as run:
            with self.assertRaisesRegex(ValueError, "does not match"):
                controller.toggle_display("stock")
        run.assert_not_called()

    def test_fips_screen_requires_working_return_button(self) -> None:
        controller = ModeController.__new__(ModeController)
        controller.ssh = ["ssh", "root@synthetic"]
        controller.require_display_package = Mock()
        controller.request = Mock(side_effect=[
            {"settings": {"enabled": True, "gateway_enabled": False}},
            {"pending": False},
        ])
        controller.display_state = Mock(return_value={
            "gl_screen": ["disabled", "stopped"],
            "citydash": ["enabled", "running"],
            "homebutton": ["disabled", "stopped"],
        })
        with patch("tools.switch_mode.subprocess.run",
                   return_value=subprocess.CompletedProcess([], 0, "dashboard on")):
            with self.assertRaisesRegex(ValueError, "return button"):
                controller.toggle_display("fips")

    def test_management_request_uses_json_stdin_and_rejects_bad_reply(self) -> None:
        controller = ModeController.__new__(ModeController)
        controller.ssh = ["ssh", "root@synthetic"]
        reply = subprocess.CompletedProcess([], 0, '{"status":"ok","data":{"pending":false}}')
        with patch("tools.switch_mode.subprocess.run", return_value=reply) as run:
            self.assertEqual(controller.request("recovery"), {"pending": False})
        self.assertEqual(json.loads(run.call_args.kwargs["input"]), {"operation": "recovery"})
        with patch("tools.switch_mode.subprocess.run",
                   return_value=subprocess.CompletedProcess([], 0, "[]")):
            with self.assertRaisesRegex(ValueError, "response is invalid"):
                controller.request("recovery")


if __name__ == "__main__":
    unittest.main()
