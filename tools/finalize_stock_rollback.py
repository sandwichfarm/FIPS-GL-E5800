#!/usr/bin/env python3
"""Archive guard evidence and clean a verified first-install rollback to stock."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile

if __package__:
    from .capture_backup import capture as capture_backup, prepare_capture
    from .compare_backups import compare as compare_backups
    from .router_inventory import capture as capture_inventory, compare as compare_inventory
    from .router_inventory import prepare_private_output, ssh_command, write_private
else:
    from capture_backup import capture as capture_backup, prepare_capture
    from compare_backups import compare as compare_backups
    from router_inventory import capture as capture_inventory, compare as compare_inventory
    from router_inventory import prepare_private_output, ssh_command, write_private


ROOT = Path(__file__).resolve().parents[1]
CLEANUP = ROOT / "packaging/recovery/cleanup-stock.sh"
CANDIDATE_PACKAGES = {"fips", "gl-sdk4-ui-fips", "gl-e5800-dashboard"}
CANDIDATE_SERVICES = ("fips", "fips-gateway", "citydash", "homebutton", "fips-recovery")


def validate_precleanup(before: dict, current: dict) -> bool:
    """Return False if already clean; reject anything beyond the new guard."""
    if before.get("format") != 2 or not isinstance(before.get("packages"), dict):
        raise ValueError("Baseline inventory is invalid")
    if CANDIDATE_PACKAGES & before["packages"].keys():
        raise ValueError("Stock cleanup requires a first-install baseline")
    services = before.get("services", {})
    if services.get("gl_screen") != ["enabled", "running"] or any(
        services.get(name) != ["absent", "absent"] for name in CANDIDATE_SERVICES
    ):
        raise ValueError("Baseline is not a running stock display without FIPS")
    differences = compare_inventory(before, current)
    if not differences:
        return False
    if differences != ["CHANGED service fips-recovery"] or current["services"].get("fips-recovery") != ["enabled", "running"]:
        raise ValueError("Post-rollback inventory differs beyond the recovery guard: "
                         + ", ".join(differences))
    return True


def run_read_only(ssh: list[str], command: str) -> str:
    result = subprocess.run([*ssh, command], stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, timeout=30,
                            check=False)
    if result.returncode:
        raise ValueError("Router rollback evidence check failed")
    return result.stdout


def verify_guard_result(ssh: list[str], transaction: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", transaction):
        raise ValueError("Invalid rollback transaction ID")
    command = (
        "set -eu; test -x /etc/fips-recovery/guard.sh; "
        "test ! -e /etc/fips-recovery/pending; "
        f"test \"$(cat /etc/fips-recovery/{transaction}/result)\" = "
        f"\"ROLLED_BACK {transaction}\"; "
        "test \"$(/bin/sh /etc/fips-recovery/guard.sh status)\" = NONE; "
        "echo ROLLBACK_READY"
    )
    if run_read_only(ssh, command).strip() != "ROLLBACK_READY":
        raise ValueError("Router did not prove a completed rollback")


def verify_guard_archive(backup: Path, identity: Path, transaction: str) -> None:
    decrypted = subprocess.Popen(["age", "--decrypt", "-i", str(identity), str(backup)],
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    expected = f"etc/fips-recovery/{transaction}/result"
    required = {expected, "etc/fips-recovery/guard.sh", "etc/init.d/fips-recovery"}
    found: set[str] = set()
    try:
        with tarfile.open(fileobj=decrypted.stdout, mode="r|gz") as archive:
            for index, member in enumerate(archive):
                if index >= 10000 or member.size > 256 * 1024 * 1024:
                    raise ValueError("Recovery evidence archive is unexpectedly large")
                if member.name == "etc/fips-recovery/pending":
                    raise ValueError("Recovery evidence still has a pending marker")
                if member.name in required:
                    if not member.isfile():
                        raise ValueError("Recovery evidence has an invalid required file")
                    found.add(member.name)
                if member.name == expected:
                    if member.size > 128:
                        raise ValueError("Recovery result is invalid")
                    data = archive.extractfile(member).read()
                    if data != f"ROLLED_BACK {transaction}\n".encode():
                        raise ValueError("Recovery result does not match the transaction")
        if len(decrypted.stdout.read(1024 * 1024 + 1)) > 1024 * 1024:
            raise ValueError("Recovery evidence has excessive trailing data")
        if decrypted.wait() != 0 or found != required:
            raise ValueError("Recovery evidence could not be decrypted and verified")
    finally:
        if decrypted.stdout is not None:
            decrypted.stdout.close()
        if decrypted.poll() is None:
            decrypted.kill()
            decrypted.wait()


def archive_guard(ssh: list[str], recipient: str, identity: Path,
                  output: Path, transaction: str) -> None:
    prepare_capture(recipient, identity, output)
    descriptor, temporary = tempfile.mkstemp(prefix=".guard-", suffix=".age", dir=output.parent)
    temporary = Path(temporary)
    remote = None
    try:
        with os.fdopen(descriptor, "wb") as ciphertext:
            remote = subprocess.Popen(
                [*ssh, "set -eu; test ! -e /etc/fips-recovery/pending; "
                 "tar -czf - -C / etc/fips-recovery etc/init.d/fips-recovery"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            )
            age = subprocess.Popen(["age", "-r", recipient], stdin=remote.stdout,
                                   stdout=ciphertext, stderr=subprocess.DEVNULL)
            remote.stdout.close()
            if age.wait() != 0 or remote.wait() != 0:
                raise ValueError("Could not encrypt recovery evidence")
            ciphertext.flush()
            os.fsync(ciphertext.fileno())
        verify_guard_archive(temporary, identity, transaction)
        os.replace(temporary, output)
    finally:
        if remote is not None and remote.poll() is None:
            remote.kill()
            remote.wait()
        temporary.unlink(missing_ok=True)


def invoke_cleanup(ssh: list[str], transaction: str) -> None:
    result = subprocess.run([*ssh, f"/bin/sh -s -- {transaction}"],
                            input=CLEANUP.read_bytes(), stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=60, check=False)
    if result.returncode or result.stdout.strip() != b"STOCK_CLEAN":
        raise ValueError("Stock cleanup failed; encrypted guard evidence is preserved")


def finalize(args: argparse.Namespace) -> str:
    ssh = ssh_command(args.host, args.ssh_key)
    before = json.loads(args.before_inventory.read_text())
    current = capture_inventory(args.host, args.ssh_key)
    needed = validate_precleanup(before, current)
    differences = compare_backups(args.before_backup, args.after_backup, args.identity,
                                  ignore_mtime=args.ignore_mtime)
    if differences:
        raise ValueError("Configuration differs after rollback: " + ", ".join(differences))
    if not needed:
        return "STOCK_ALREADY_CLEAN"
    verify_guard_result(ssh, args.transaction)
    if not args.apply:
        return "STOCK_CLEANUP_READY"
    if not args.recipient or not args.evidence_output or not args.final_backup or not args.final_inventory:
        raise ValueError("Apply requires evidence, final backup, final inventory and age recipient")
    if len({args.evidence_output.resolve(), args.final_backup.resolve(),
            args.final_inventory.resolve()}) != 3:
        raise ValueError("Use distinct evidence and final-state output paths")
    prepare_capture(args.recipient, args.identity, args.evidence_output)
    prepare_capture(args.recipient, args.identity, args.final_backup)
    prepare_private_output(args.final_inventory)
    archive_guard(ssh, args.recipient, args.identity, args.evidence_output, args.transaction)
    invoke_cleanup(ssh, args.transaction)
    after_cleanup = capture_inventory(args.host, args.ssh_key)
    write_private(args.final_inventory, after_cleanup)
    inventory_diff = compare_inventory(before, after_cleanup)
    capture_backup(args.host, args.recipient, args.identity, args.final_backup,
                   ssh_key=args.ssh_key)
    config_diff = compare_backups(args.before_backup, args.final_backup, args.identity,
                                  ignore_mtime=args.ignore_mtime)
    if inventory_diff or config_diff:
        raise ValueError("Final stock state differs from baseline: "
                         + ", ".join(inventory_diff + config_diff))
    return "STOCK_STATE_RESTORED"


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
    parser.add_argument("--apply", action="store_true",
                        help="Archive guard evidence, remove the first-install guard and verify stock state")
    parser.add_argument("--recipient")
    parser.add_argument("--evidence-output", type=Path)
    parser.add_argument("--final-backup", type=Path)
    parser.add_argument("--final-inventory", type=Path)
    print(finalize(parser.parse_args()))


if __name__ == "__main__":
    main()
