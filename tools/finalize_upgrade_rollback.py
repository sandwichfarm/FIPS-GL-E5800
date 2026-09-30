#!/usr/bin/env python3
"""Archive a completed upgrade rollback, remove its evidence, and prove prior state."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess

if __package__:
    from .backup_bundle import read_encrypted_details
    from .capture_backup import capture as capture_backup, prepare_capture
    from .compare_backups import compare as compare_backups
    from .finalize_stock_rollback import archive_guard, verify_guard_archive, verify_guard_result
    from .router_inventory import capture as capture_inventory, compare as compare_inventory
    from .router_inventory import prepare_private_output, ssh_command, write_private
else:
    from backup_bundle import read_encrypted_details
    from capture_backup import capture as capture_backup, prepare_capture
    from compare_backups import compare as compare_backups
    from finalize_stock_rollback import archive_guard, verify_guard_archive, verify_guard_result
    from router_inventory import capture as capture_inventory, compare as compare_inventory
    from router_inventory import prepare_private_output, ssh_command, write_private


CLEANUP = Path(__file__).resolve().parents[1] / "packaging/recovery/cleanup-upgrade.sh"
REQUIRED_GUARD_FILES = {
    "etc/fips-recovery/guard.sh", "etc/fips-recovery/health.sh",
    "etc/fips-recovery/probes.json", "etc/fips-recovery/apply-initial.sh",
    "etc/fips-recovery/runtime-packages", "etc/init.d/fips-recovery",
}


def cleanup_state(ssh: list[str], transaction: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", transaction):
        raise ValueError("Invalid rollback transaction ID")
    command = f"""set -eu
root=/etc/fips-recovery
test -x "$root/guard.sh"
test ! -e "$root/pending"
test "$(/bin/sh "$root/guard.sh" status)" = NONE
if [ -e "$root/.cleanup-{transaction}" ] || [ -L "$root/.cleanup-{transaction}" ]; then
    test -f "$root/.cleanup-{transaction}"
    test ! -L "$root/.cleanup-{transaction}"
    test "$(cat "$root/.cleanup-{transaction}")" = "CLEANUP_AUTHORIZED {transaction}"
    echo RESUME
elif [ -d "$root/{transaction}" ]; then
    test ! -L "$root/{transaction}"
    test "$(cat "$root/{transaction}/result")" = "ROLLED_BACK {transaction}"
    echo READY
elif [ ! -e "$root/{transaction}" ]; then
    echo CLEAN
else
    exit 1
fi
"""
    result = subprocess.run([*ssh, command], capture_output=True, text=True,
                            timeout=30, check=False)
    if result.returncode or result.stdout.strip() not in {"READY", "RESUME", "CLEAN"}:
        raise ValueError("Upgrade rollback state is invalid")
    return result.stdout.strip()


def validate_baseline(before: dict, current: dict) -> None:
    if before.get("format") != 2 or not isinstance(before.get("packages"), dict):
        raise ValueError("Baseline inventory is invalid")
    if before.get("services", {}).get("fips-recovery") != ["enabled", "running"]:
        raise ValueError("Upgrade baseline needs a running prior recovery guard")
    differences = compare_inventory(before, current)
    if differences:
        raise ValueError("Post-rollback inventory differs from upgrade baseline: "
                         + ", ".join(differences))


def invoke_cleanup(ssh: list[str], transaction: str) -> None:
    result = subprocess.run([*ssh, f"/bin/sh -s -- {transaction}"],
                            input=CLEANUP.read_bytes(), stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=60, check=False)
    if result.returncode or result.stdout.strip() != b"UPGRADE_CLEAN":
        raise ValueError("Upgrade cleanup failed; encrypted guard evidence is preserved")


def finalize(args: argparse.Namespace) -> str:
    ssh = ssh_command(args.host, args.ssh_key)
    before = json.loads(args.before_inventory.read_text())
    validate_baseline(before, capture_inventory(args.host, args.ssh_key))
    before_files, _ = read_encrypted_details(args.before_backup, args.identity,
                                             require_identity="fips" in before["packages"])
    if not REQUIRED_GUARD_FILES.issubset(before_files):
        raise ValueError("Upgrade baseline backup is missing prior guard files")
    differences = compare_backups(args.before_backup, args.after_backup, args.identity,
                                  ignore_mtime=args.ignore_mtime)
    if differences:
        raise ValueError("Configuration or prior guard differs after rollback: "
                         + ", ".join(differences))
    state = cleanup_state(ssh, args.transaction)
    if state == "READY":
        verify_guard_result(ssh, args.transaction)
    if not args.apply:
        return "UPGRADE_ALREADY_CLEAN" if state == "CLEAN" else "UPGRADE_CLEANUP_READY"
    if not args.recipient or not args.evidence_output or not args.final_backup or not args.final_inventory:
        raise ValueError("Apply requires evidence, final backup, final inventory and age recipient")
    if len({args.evidence_output.resolve(), args.final_backup.resolve(),
            args.final_inventory.resolve()}) != 3:
        raise ValueError("Use distinct evidence and final-state output paths")
    prepare_capture(args.recipient, args.identity, args.final_backup)
    prepare_private_output(args.final_inventory)
    if args.evidence_output.exists():
        verify_guard_archive(args.evidence_output, args.identity, args.transaction)
    elif state == "READY":
        archive_guard(ssh, args.recipient, args.identity, args.evidence_output, args.transaction)
    else:
        raise ValueError("A prior encrypted guard evidence archive is required to resume cleanup")
    invoke_cleanup(ssh, args.transaction)
    after_cleanup = capture_inventory(args.host, args.ssh_key)
    write_private(args.final_inventory, after_cleanup)
    inventory_diff = compare_inventory(before, after_cleanup)
    capture_backup(args.host, args.recipient, args.identity, args.final_backup,
                   ssh_key=args.ssh_key)
    config_diff = compare_backups(args.before_backup, args.final_backup, args.identity,
                                  ignore_mtime=args.ignore_mtime)
    if inventory_diff or config_diff:
        raise ValueError("Final upgraded router state differs from baseline: "
                         + ", ".join(inventory_diff + config_diff))
    return "UPGRADE_STATE_RESTORED"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="root@192.168.8.1")
    parser.add_argument("--ssh-key", type=Path, required=True)
    parser.add_argument("--before-backup", type=Path, required=True)
    parser.add_argument("--after-backup", type=Path, required=True)
    parser.add_argument("--before-inventory", type=Path, required=True)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--transaction", required=True)
    parser.add_argument("--ignore-mtime", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--recipient")
    parser.add_argument("--evidence-output", type=Path)
    parser.add_argument("--final-backup", type=Path)
    parser.add_argument("--final-inventory", type=Path)
    print(finalize(parser.parse_args()))


if __name__ == "__main__":
    main()
