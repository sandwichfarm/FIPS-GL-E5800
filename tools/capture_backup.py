#!/usr/bin/env python3
"""Stream a read-only router backup directly into local age encryption."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile

if __package__:
    from .backup_bundle import verify_encrypted
else:
    from backup_bundle import verify_encrypted


ROOT = Path(__file__).resolve().parents[1]
REMOTE_ARCHIVE = """set -eu
set -- etc/config/network etc/config/firewall etc/config/dhcp
if [ -d /etc/fips ]; then set -- "$@" etc/fips; fi
if [ -f /root/dashboard/config.json ]; then set -- "$@" root/dashboard/config.json; fi
tar -czf - -C / "$@"
"""


def capture(host: str, recipient: str, identity: Path, output: Path,
            require_fips_identity: bool = False) -> Path:
    if not host or host.startswith("-") or any(char.isspace() for char in host):
        raise ValueError("Invalid SSH host")
    if not recipient.startswith("age1") or any(char.isspace() for char in recipient):
        raise ValueError("Provide a public age recipient")
    if shutil.which("age") is None:
        raise ValueError("age CLI is required for encrypted capture")
    if identity.is_symlink() or not identity.is_file():
        raise ValueError("Age identity file is missing or linked")
    try:
        identity_recipient = subprocess.check_output(
            ["age-keygen", "-y", str(identity)], text=True, stderr=subprocess.DEVNULL,
        ).strip()
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        raise ValueError("Age identity could not be read") from error
    if identity_recipient != recipient:
        raise ValueError("Age recipient does not match the supplied identity")
    if output.suffix != ".age" or output.exists() or output.is_symlink():
        raise ValueError("Choose a new .age backup output path")
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if stat.S_IMODE(output.parent.stat().st_mode) & 0o077:
        raise ValueError("Backup directory must be private (mode 0700)")
    descriptor, temporary = tempfile.mkstemp(prefix=".backup-", suffix=".age", dir=output.parent)
    temporary = Path(temporary)
    ssh = None
    try:
        with os.fdopen(descriptor, "wb") as ciphertext:
            ssh = subprocess.Popen(
                ["ssh", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
                 "-o", "ConnectTimeout=8", host, REMOTE_ARCHIVE],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            )
            try:
                age = subprocess.Popen(["age", "-r", recipient], stdin=ssh.stdout,
                                       stdout=ciphertext, stderr=subprocess.DEVNULL)
            except Exception:
                ssh.kill()
                ssh.wait()
                raise
            ssh.stdout.close()
            age_status = age.wait()
            ssh_status = ssh.wait()
            if age_status != 0 or ssh_status != 0:
                raise ValueError("Router capture or age encryption failed")
            ciphertext.flush()
            os.fsync(ciphertext.fileno())
        verify_encrypted(temporary, identity, require_fips_identity)
        os.replace(temporary, output)
        return output
    finally:
        if ssh is not None and ssh.poll() is None:
            ssh.kill()
            ssh.wait()
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="root@192.168.8.1")
    parser.add_argument("--recipient", required=True)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "private/identity-config-backup.age")
    parser.add_argument("--require-fips-identity", action="store_true")
    args = parser.parse_args()
    print(capture(args.host, args.recipient, args.identity, args.output,
                  args.require_fips_identity))
