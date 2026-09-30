#!/usr/bin/env python3
"""Render a guarded router restore script from a verified encrypted backup."""

from __future__ import annotations

import argparse
import base64
import os
from pathlib import Path
import re
import shlex
import stat
import textwrap

if __package__:
    from .backup_bundle import read_encrypted, require_enabled_fips, restorable_fips_config
else:
    from backup_bundle import read_encrypted, require_enabled_fips, restorable_fips_config


def render(backup: Path, identity: Path, transaction: str,
           restore_dashboard: bool = False) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", transaction):
        raise ValueError("Invalid recovery transaction ID")
    files = read_encrypted(backup, identity, True)
    require_enabled_fips(files)
    selected = {
        name: data for name, data in files.items()
        if restorable_fips_config(name) or
        (restore_dashboard and name == "root/dashboard/config.json")
    }
    lines = [
        "#!/bin/sh", "set -eu", "umask 077",
        "device_root=${FIPS_TEST_FS_ROOT:-}",
        f"transaction={shlex.quote(transaction)}",
        'test -f "$device_root/etc/fips-recovery/pending"',
        'read -r pending_id wall_limit uptime_limit boot_id < "$device_root/etc/fips-recovery/pending"',
        'test "$pending_id" = "$transaction"',
        'test "$(cat "$device_root/etc/fips-recovery/$transaction/backup/mode")" = packages',
        'test -x "$device_root/etc/init.d/fips"',
        "decode() { if command -v base64 >/dev/null 2>&1; then base64 -d; else openssl base64 -d; fi; }",
        "changed=0",
    ]
    directories = sorted(
        {"/" + "/".join(name.split("/")[:index])
         for name in selected for index in range(2, len(name.split("/")))},
        key=lambda path: (path.count("/"), path),
    )
    for directory in directories:
        quoted = shlex.quote(directory)
        lines += [f'directory="$device_root"{quoted}', 'test ! -L "$directory"',
                  'mkdir -p "$directory"', 'chmod 0700 "$directory"']
    for index, (name, data) in enumerate(sorted(selected.items())):
        target = shlex.quote("/" + name)
        marker = f"FIPS_RESTORE_DATA_{index}"
        encoded = base64.b64encode(data).decode("ascii")
        lines += [
            f'target="$device_root"{target}',
            'test ! -L "$target"',
            'if [ -e "$target" ]; then test -f "$target"; fi',
            'temporary="$target.fips-restore-$transaction.tmp"',
            'test ! -L "$temporary"',
            'if [ -e "$temporary" ]; then test -f "$temporary"; fi',
            f"decode <<'{marker}' > \"$temporary\"",
            *textwrap.wrap(encoded, 76),
            marker,
            'chmod 0600 "$temporary"',
            'if [ -f "$target" ] && cmp -s "$temporary" "$target"; then',
            '  rm -f "$temporary"',
            "else",
            '  mv -f "$temporary" "$target"',
            "  changed=1",
            "fi",
            'chmod 0600 "$target"',
        ]
    lines += [
        'if [ "$changed" -eq 1 ] || ! "$device_root/etc/init.d/fips" status >/dev/null 2>&1 || ! "$device_root/etc/init.d/fips" enabled >/dev/null 2>&1; then',
        '  "$device_root/etc/init.d/fips" enable',
        '  "$device_root/etc/init.d/fips" restart',
        "  changed=1",
        "fi",
        'gateway_enabled=$(jsonfilter -i "$device_root/etc/fips/router/settings.json" -e "@.gateway_enabled" 2>/dev/null || true)',
        'if [ "$gateway_enabled" = true ]; then',
        '  test -x "$device_root/etc/init.d/fips-gateway"',
        '  if [ "$changed" -eq 1 ] || ! "$device_root/etc/init.d/fips-gateway" status >/dev/null 2>&1 || ! "$device_root/etc/init.d/fips-gateway" enabled >/dev/null 2>&1; then',
        '    "$device_root/etc/init.d/fips-gateway" enable',
        '    "$device_root/etc/init.d/fips-gateway" restart',
        '    changed=1',
        '  fi',
        'elif [ -x "$device_root/etc/init.d/fips-gateway" ]; then',
        '  if "$device_root/etc/init.d/fips-gateway" status >/dev/null 2>&1; then',
        '    "$device_root/etc/init.d/fips-gateway" stop',
        '    changed=1',
        '  fi',
        '  if "$device_root/etc/init.d/fips-gateway" enabled >/dev/null 2>&1; then',
        '    "$device_root/etc/init.d/fips-gateway" disable',
        '    changed=1',
        '  fi',
        'fi',
        "sync",
        '[ "$changed" -eq 0 ] || echo FIPS_BACKUP_CHANGED',
        "echo FIPS_BACKUP_RESTORED",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--transaction", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--restore-dashboard", action="store_true")
    args = parser.parse_args()
    script = render(args.backup, args.identity, args.transaction, args.restore_dashboard)
    if args.output.is_symlink() or args.output.exists():
        raise ValueError("Restore script output must be new")
    if args.output.parent.is_symlink() or stat.S_IMODE(args.output.parent.stat().st_mode) & 0o077:
        raise ValueError("Restore script directory must be private (mode 0700)")
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="ascii") as output:
        output.write(script)
    print("rendered guarded encrypted-backup restore script")


if __name__ == "__main__":
    main()
