#!/usr/bin/env python3
"""Compare two encrypted router backups without printing their contents."""

from __future__ import annotations

import argparse
from pathlib import Path

if __package__:
    from .backup_bundle import REQUIRED_IDENTITY, read_encrypted_details
else:
    from backup_bundle import REQUIRED_IDENTITY, read_encrypted_details


def compare(before: Path, after: Path, identity: Path,
            *, ignore_mtime: bool = False) -> list[str]:
    if before.resolve() == after.resolve():
        raise ValueError("Provide independent before and after backups")
    previous, previous_metadata = read_encrypted_details(before, identity, False)
    current, current_metadata = read_encrypted_details(after, identity, False)
    for label, files in (("before", previous), ("after", current)):
        if any(name.startswith("etc/fips/") for name in files) and not REQUIRED_IDENTITY <= files.keys():
            raise ValueError(f"{label} backup contains incomplete FIPS identity")
    differences: list[str] = []
    for name in sorted(previous.keys() | current.keys()):
        if name not in previous:
            differences.append(f"ADDED {name}")
            continue
        if name not in current:
            differences.append(f"REMOVED {name}")
            continue
        changed = []
        if previous[name] != current[name]:
            changed.append("contents")
        for index, field in enumerate(("mode", "uid", "gid", "mtime")):
            if field == "mtime" and ignore_mtime:
                continue
            if previous_metadata[name][index] != current_metadata[name][index]:
                changed.append(field)
        if changed:
            differences.append(f"CHANGED {name}: {', '.join(changed)}")
    return differences


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--ignore-mtime", action="store_true",
                        help="Allow timestamp-only drift; still compare contents, mode and ownership")
    args = parser.parse_args()
    differences = compare(args.before, args.after, args.identity,
                          ignore_mtime=args.ignore_mtime)
    if differences:
        for difference in differences:
            print(difference)
        raise SystemExit(1)
    checked = "file contents, modes and ownership"
    if not args.ignore_mtime:
        checked += " and mtimes"
    print(f"Backup state matches: {checked}")


if __name__ == "__main__":
    main()
