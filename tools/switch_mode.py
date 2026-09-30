#!/usr/bin/env python3
"""Switch FIPS and stock operating modes through guarded router operations."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess

if __package__:
    from .router_inventory import ssh_command
else:
    from router_inventory import ssh_command


DISPLAY_SCRIPT = """set -eu
for name in gl_screen citydash homebutton; do
    if [ ! -x "/etc/init.d/$name" ]; then
        printf '%s\tabsent\tabsent\n' "$name"
        continue
    fi
    if "/etc/init.d/$name" enabled >/dev/null 2>&1; then enabled=enabled; else enabled=disabled; fi
    if "/etc/init.d/$name" status >/dev/null 2>&1; then running=running; else running=stopped; fi
    printf '%s\t%s\t%s\n' "$name" "$enabled" "$running"
done
"""


class ModeController:
    def __init__(self, host: str, ssh_key: Path):
        self.ssh = ssh_command(host, ssh_key)

    def request(self, operation: str, **fields: object) -> dict:
        payload = json.dumps({"operation": operation, **fields}, separators=(",", ":"))
        try:
            process = subprocess.run([*self.ssh, "/usr/bin/fips-router-admin"],
                                     input=payload + "\n", text=True, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, timeout=30, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError("Router management is unreachable") from error
        try:
            response = json.loads(process.stdout)
        except json.JSONDecodeError as error:
            raise ValueError("Router management response is invalid") from error
        if not isinstance(response, dict):
            raise ValueError("Router management response is invalid")
        if process.returncode or response.get("status") != "ok" or not isinstance(response.get("data"), dict):
            reason = response.get("error", "management_unavailable")
            raise ValueError(f"Router management rejected {operation}: {reason}")
        return response["data"]

    def display_state(self) -> dict[str, list[str]]:
        try:
            result = subprocess.run([*self.ssh, DISPLAY_SCRIPT], text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    timeout=10, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError("Cannot read touchscreen service state") from error
        if result.returncode:
            raise ValueError("Cannot read touchscreen service state")
        state = {}
        for line in result.stdout.splitlines():
            parts = line.split("\t")
            if len(parts) != 3 or parts[0] not in ("gl_screen", "citydash", "homebutton"):
                raise ValueError("Invalid touchscreen service state")
            if parts[1] not in ("enabled", "disabled", "absent") or parts[2] not in ("running", "stopped", "absent"):
                raise ValueError("Invalid touchscreen service state")
            state[parts[0]] = parts[1:]
        if set(state) != {"gl_screen", "citydash", "homebutton"}:
            raise ValueError("Incomplete touchscreen service state")
        return state

    def require_display_package(self) -> None:
        try:
            result = subprocess.run([*self.ssh, "test -x /root/dashboard/toggle.sh"],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    timeout=8, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError("Community dashboard toggle is unavailable") from error
        if result.returncode:
            raise ValueError("Community dashboard toggle is unavailable")

    def status(self) -> dict:
        configuration = self.request("configuration")
        recovery = self.request("recovery")
        settings = configuration.get("settings")
        if not isinstance(settings, dict) or not isinstance(settings.get("enabled"), bool):
            raise ValueError("Router FIPS configuration is invalid")
        return {
            "fips_enabled": settings["enabled"],
            "gateway_enabled": settings.get("gateway_enabled"),
            "pending": recovery.get("pending") is True,
            "transaction_id": recovery.get("transaction_id") if recovery.get("pending") else None,
            "display": self.display_state(),
        }

    def prepare(self, mode: str) -> dict:
        self.require_display_package()
        recovery = self.request("recovery")
        if recovery.get("pending"):
            raise ValueError("A guarded router change is already pending")
        configuration = self.request("configuration")
        settings = configuration.get("settings")
        revision = configuration.get("revision")
        if not isinstance(settings, dict) or not isinstance(revision, str):
            raise ValueError("Router FIPS configuration is invalid")
        desired = mode == "fips"
        if settings.get("enabled") is desired and settings.get("gateway_enabled") is False:
            return {"state": "CONFIG_ALREADY_IN_MODE", "mode": mode}
        settings["enabled"] = desired
        # Switching operating mode never enables LAN gateway or replaces WAN.
        settings["gateway_enabled"] = False
        staged = self.request("stage", settings=settings, expected_revision=revision)
        candidate = staged.get("revision")
        if not isinstance(candidate, str):
            raise ValueError("Router did not return a staged revision")
        activated = self.request("activate", expected_revision=candidate)
        transaction = activated.get("transaction_id")
        if activated.get("pending") is not True or not isinstance(transaction, str):
            raise ValueError("Router did not arm a guarded mode switch")
        return {"state": "PENDING_CONFIRMATION", "mode": mode,
                "transaction_id": transaction, "deadline_seconds": activated.get("deadline_seconds")}

    def confirm(self, mode: str, transaction: str) -> dict:
        recovery = self.request("recovery")
        if recovery.get("pending") is not True or recovery.get("mode") != "config_only" or recovery.get("transaction_id") != transaction:
            raise ValueError("The specified mode switch is not pending")
        configuration = self.request("configuration")
        settings = configuration.get("settings", {})
        if settings.get("enabled") is not (mode == "fips") or settings.get("gateway_enabled") is not False:
            raise ValueError("Pending configuration does not match the requested mode")
        self.request("confirm", transaction_id=transaction)
        try:
            self.toggle_display(mode)
        except ValueError as error:
            raise ValueError("FIPS configuration confirmed; display switch remains pending: "
                             + str(error)) from error
        return {"state": "MODE_ACTIVE", "mode": mode}

    def rollback(self, transaction: str) -> dict:
        recovery = self.request("recovery")
        if recovery.get("pending") is not True or recovery.get("mode") != "config_only" or recovery.get("transaction_id") != transaction:
            raise ValueError("The specified mode switch is not pending")
        self.request("rollback", transaction_id=transaction)
        return {"state": "PREVIOUS_MODE_RESTORED"}

    def toggle_display(self, mode: str) -> None:
        self.require_display_package()
        configuration = self.request("configuration")
        settings = configuration.get("settings", {})
        if settings.get("enabled") is not (mode == "fips") or settings.get("gateway_enabled") is not False:
            raise ValueError("FIPS configuration does not match the requested display mode")
        recovery = self.request("recovery")
        if recovery.get("pending"):
            raise ValueError("Confirm or roll back the pending configuration first")
        desired = "on" if mode == "fips" else "off"
        try:
            result = subprocess.run([*self.ssh, f"/root/dashboard/toggle.sh {desired}"],
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    text=True, timeout=20, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError("Touchscreen toggle failed") from error
        if result.returncode:
            raise ValueError("Touchscreen toggle failed")
        display = self.display_state()
        expected = (("citydash", "gl_screen") if mode == "fips"
                    else ("gl_screen", "citydash"))
        if (display[expected[0]] != ["enabled", "running"]
                or display[expected[1]] not in (["disabled", "stopped"], ["absent", "absent"])):
            raise ValueError("Touchscreen did not reach the requested mode")
        if mode == "fips" and display["homebutton"] != ["enabled", "running"]:
            raise ValueError("Touchscreen return button is not running")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="root@192.168.8.1")
    parser.add_argument("--ssh-key", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status")
    for command in ("prepare", "confirm", "screen"):
        part = commands.add_parser(command)
        part.add_argument("mode", choices=("stock", "fips"))
        if command == "confirm":
            part.add_argument("--transaction", required=True)
    rollback = commands.add_parser("rollback")
    rollback.add_argument("--transaction", required=True)
    args = parser.parse_args()
    controller = ModeController(args.host, args.ssh_key)
    try:
        if args.command == "status":
            outcome = controller.status()
        elif args.command == "prepare":
            outcome = controller.prepare(args.mode)
        elif args.command == "confirm":
            outcome = controller.confirm(args.mode, args.transaction)
        elif args.command == "screen":
            controller.toggle_display(args.mode)
            outcome = {"state": "DISPLAY_ACTIVE", "mode": args.mode}
        else:
            outcome = controller.rollback(args.transaction)
    except ValueError as error:
        parser.exit(1, f"mode switch: {error}\n")
    print(json.dumps(outcome, sort_keys=True))


if __name__ == "__main__":
    main()
