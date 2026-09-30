#!/usr/bin/env python3
"""Decrypt a verified backup into a private, isolated local restore directory."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile

if __package__:
    from .backup_bundle import read_encrypted
else:
    from backup_bundle import read_encrypted


def stage(backup: Path, identity: Path, destination: Path,
          require_fips_identity: bool = False) -> dict[str, str]:
    if destination.exists() or destination.is_symlink():
        raise ValueError("Restore destination must be new")
    destination.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    if destination.parent.is_symlink() or stat.S_IMODE(destination.parent.stat().st_mode) & 0o077:
        raise ValueError("Restore parent must be a private directory (mode 0700)")

    # Validate the complete archive in memory before making any plaintext file.
    files = read_encrypted(backup, identity, require_fips_identity)
    temporary = Path(tempfile.mkdtemp(prefix=".restore-", dir=destination.parent))
    try:
        digests: dict[str, str] = {}
        for name, data in files.items():
            target = temporary / name
            target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
            with target.open("xb") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            target.chmod(0o600)
            digests[name] = hashlib.sha256(data).hexdigest()
        if destination.exists() or destination.is_symlink():
            raise ValueError("Restore destination appeared during staging")
        os.rename(temporary, destination)
        return digests
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--require-fips-identity", action="store_true")
    args = parser.parse_args()
    digests = stage(args.backup, args.identity, args.destination, args.require_fips_identity)
    print(json.dumps({"destination": str(args.destination), "sha256": digests}, sort_keys=True))


if __name__ == "__main__":
    main()
