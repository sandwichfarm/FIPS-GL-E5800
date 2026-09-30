#!/usr/bin/env python3
"""Validate a decrypted GL-E5800 backup without writing plaintext to disk."""

from __future__ import annotations

import argparse
import ipaddress
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import zlib


MAX_FILE = 8 * 1024 * 1024
MAX_TOTAL = 32 * 1024 * 1024
MAX_MEMBERS = 512
REQUIRED_CONFIG = {"etc/config/network", "etc/config/firewall", "etc/config/dhcp"}
REQUIRED_IDENTITY = {
    "etc/fips/fips.key", "etc/fips/fips.yaml",
    "etc/fips/router/settings.json", "etc/fips/router/mesh.nft",
}
OPTIONAL_FIPS_CONFIG = {
    "etc/fips/hosts", "etc/fips/peers.allow", "etc/fips/peers.deny",
    "etc/fips/fips.nft",
}
OPTIONAL_FILE = {"root/dashboard/config.json"}


def restorable_fips_config(name: str) -> bool:
    return name in REQUIRED_IDENTITY | OPTIONAL_FIPS_CONFIG or bool(
        re.fullmatch(r"etc/fips/fips\.d/[A-Za-z0-9_.+-]+\.nft", name)
    )


def read_plain(stream: io.BufferedIOBase, require_identity: bool) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    total = 0
    members = 0
    with tarfile.open(fileobj=stream, mode="r|gz") as archive:
        for member in archive:
            members += 1
            if members > MAX_MEMBERS:
                raise ValueError("Backup contains too many entries")
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or not path.parts:
                raise ValueError("Unsafe backup path")
            name = path.as_posix()
            if not re.fullmatch(r"[A-Za-z0-9_./+-]+", name):
                raise ValueError("Unsafe backup path")
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError("Backup contains a link or special file")
            if name in files:
                raise ValueError("Duplicate backup file")
            if (name not in OPTIONAL_FILE and not name.startswith("etc/config/")
                    and not name.startswith("etc/fips/")):
                raise ValueError("Backup contains an unexpected file")
            if member.size > MAX_FILE or total + member.size > MAX_TOTAL:
                raise ValueError("Backup file size is unsupported")
            content = archive.extractfile(member)
            data = content.read(member.size + 1) if content is not None else b""
            if len(data) != member.size:
                raise ValueError("Truncated backup file")
            total += member.size
            files[name] = data
    missing = REQUIRED_CONFIG - files.keys()
    if require_identity:
        missing |= REQUIRED_IDENTITY - files.keys()
    if missing:
        raise ValueError("Backup is missing required configuration or identity files")
    required = REQUIRED_CONFIG | (REQUIRED_IDENTITY if require_identity else set())
    if any(not files[name] for name in required):
        raise ValueError("Backup contains an empty required configuration or identity file")
    return files


def inspect_plain(stream: io.BufferedIOBase, require_identity: bool) -> set[str]:
    return set(read_plain(stream, require_identity))


def read_encrypted(backup: Path, identity: Path, require_identity: bool) -> dict[str, bytes]:
    if backup.is_symlink() or not backup.is_file() or backup.suffix != ".age":
        raise ValueError("Encrypted backup is missing or linked")
    if identity.is_symlink() or not identity.is_file():
        raise ValueError("Age identity file is missing or linked")
    with backup.open("rb") as ciphertext:
        header = ciphertext.read(22)
    if header != b"age-encryption.org/v1\n":
        raise ValueError("Encrypted backup header is invalid")
    try:
        process = subprocess.Popen(
            ["age", "--decrypt", "-i", str(identity), str(backup)],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError as error:
        raise ValueError("age CLI is required to verify the encrypted backup") from error
    try:
        try:
            files = read_plain(process.stdout, require_identity)
        except (tarfile.TarError, OSError, EOFError, zlib.error) as error:
            raise ValueError("Encrypted backup did not contain a valid gzip tar archive") from error
        if len(process.stdout.read(1024 * 1024 + 1)) > 1024 * 1024:
            raise ValueError("Encrypted backup has excessive trailing data")
        process.stdout.close()
        if process.wait() != 0:
            raise ValueError("Encrypted backup decryption failed")
        return files
    finally:
        if process.stdout is not None:
            process.stdout.close()
        if process.poll() is None:
            process.kill()
            process.wait()


def verify_encrypted(backup: Path, identity: Path, require_identity: bool) -> set[str]:
    return set(read_encrypted(backup, identity, require_identity))


def require_enabled_fips(files: dict[str, bytes]) -> None:
    try:
        settings = json.loads(files["etc/fips/router/settings.json"])
    except (KeyError, ValueError, UnicodeDecodeError) as error:
        raise ValueError("Recovery backup has invalid FIPS settings") from error
    if not isinstance(settings, dict) or settings.get("enabled") is not True:
        raise ValueError("Recovery backup FIPS node must be enabled for deployment")


def validate_gateway_ipv6_probe(files: dict[str, bytes], probe: str) -> None:
    if "etc/fips/router/settings.json" not in files:
        if probe:
            raise ValueError("Gateway IPv6 probe requires FIPS settings")
        return
    try:
        settings = json.loads(files["etc/fips/router/settings.json"])
    except (KeyError, ValueError, UnicodeDecodeError) as error:
        raise ValueError("Recovery backup has invalid FIPS settings") from error
    if not isinstance(settings, dict) or not isinstance(settings.get("gateway_enabled", False), bool):
        raise ValueError("Recovery backup has invalid gateway settings")
    if not probe:
        return
    try:
        address = ipaddress.IPv6Address(probe)
    except ipaddress.AddressValueError as error:
        raise ValueError("Gateway IPv6 probe must be a reviewed public address") from error
    if not address.is_global:
        raise ValueError("Gateway IPv6 probe must be a public address")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--require-fips-identity", action="store_true")
    parser.add_argument("--require-enabled-fips", action="store_true")
    parser.add_argument("--gateway-probe-ipv6", default="")
    args = parser.parse_args()
    files = read_encrypted(args.backup, args.identity,
                           args.require_fips_identity or args.require_enabled_fips)
    if args.require_enabled_fips:
        require_enabled_fips(files)
    validate_gateway_ipv6_probe(files, args.gateway_probe_ipv6)
    present = set(files)
    print(f"verified encrypted backup ({len(present)} allowed files)")


if __name__ == "__main__":
    main()
