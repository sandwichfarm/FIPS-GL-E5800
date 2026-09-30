#!/usr/bin/env python3
"""Stream a read-only router backup directly into local age encryption."""

from __future__ import annotations

import argparse
import base64
import binascii
import io
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile

if __package__:
    from .backup_bundle import read_plain, verify_encrypted
else:
    from backup_bundle import read_plain, verify_encrypted


ROOT = Path(__file__).resolve().parents[1]
REMOTE_ARCHIVE = """set -eu
set -- etc/config
if [ -d /etc/fips ]; then set -- "$@" etc/fips; fi
if [ -f /root/dashboard/config.json ]; then set -- "$@" root/dashboard/config.json; fi
tar -czf - -C / "$@"
"""
MAX_ENCODED_ARCHIVE = 48 * 1024 * 1024


def prepare_capture(recipient: str, identity: Path, output: Path) -> None:
    if not recipient.startswith("age1") or any(char.isspace() for char in recipient):
        raise ValueError("Provide a public age recipient")
    if shutil.which("age") is None:
        raise ValueError("age CLI is required for encrypted capture")
    if identity.is_symlink() or not identity.is_file():
        raise ValueError("Age identity file is missing or linked")
    if stat.S_IMODE(identity.stat().st_mode) & 0o077:
        raise ValueError("Age identity file must be private (mode 0600)")
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
    resolved_output = output.resolve()
    if resolved_output.is_relative_to(ROOT) and not resolved_output.is_relative_to(ROOT / "private"):
        raise ValueError("Repository backups must stay in ignored private/")
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if output.parent.is_symlink() or stat.S_IMODE(output.parent.stat().st_mode) & 0o077:
        raise ValueError("Backup directory must be private (mode 0700)")


def capture(host: str, recipient: str, identity: Path, output: Path,
            require_fips_identity: bool = False) -> Path:
    if not host or host.startswith("-") or any(char.isspace() for char in host):
        raise ValueError("Invalid SSH host")
    prepare_capture(recipient, identity, output)
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


def capture_received(encoded: bytes, recipient: str, identity: Path, output: Path) -> Path:
    """Encrypt and validate an Ansible SSH capture without a plaintext local file."""
    prepare_capture(recipient, identity, output)
    if len(encoded) > MAX_ENCODED_ARCHIVE:
        raise ValueError("Router backup stream is too large")
    marker, separator, payload = encoded.strip().partition(b"\n")
    if not separator or marker not in (b"FIPS_PRESENT=0", b"FIPS_PRESENT=1"):
        raise ValueError("Router backup stream has no valid identity marker")
    try:
        archive = base64.b64decode(payload, validate=True)
    except binascii.Error as error:
        raise ValueError("Router backup stream is not valid base64") from error
    require_identity = marker == b"FIPS_PRESENT=1"
    files = read_plain(io.BytesIO(archive), require_identity)
    has_fips = any(name.startswith("etc/fips/") for name in files)
    if has_fips != require_identity:
        raise ValueError("Router FIPS identity marker differs from backup contents")
    descriptor, temporary = tempfile.mkstemp(prefix=".backup-", suffix=".age", dir=output.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as ciphertext:
            age = subprocess.run(["age", "-r", recipient], input=archive,
                                 stdout=ciphertext, stderr=subprocess.DEVNULL)
            if age.returncode != 0:
                raise ValueError("Router backup encryption failed")
            ciphertext.flush()
            os.fsync(ciphertext.fileno())
        verify_encrypted(temporary, identity, require_identity)
        os.replace(temporary, output)
        return output
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="root@192.168.8.1")
    parser.add_argument("--recipient", required=True)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "private/identity-config-backup.age")
    parser.add_argument("--require-fips-identity", action="store_true")
    parser.add_argument("--from-stdin", action="store_true",
                        help="Read a marked base64 archive from an Ansible SSH capture")
    args = parser.parse_args()
    if args.from_stdin:
        encoded = sys.stdin.buffer.read(MAX_ENCODED_ARCHIVE + 1)
        print(capture_received(encoded, args.recipient, args.identity, args.output))
    else:
        print(capture(args.host, args.recipient, args.identity, args.output,
                      args.require_fips_identity))
