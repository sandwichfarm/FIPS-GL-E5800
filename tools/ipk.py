#!/usr/bin/env python3
"""Inspect an IPK and render a Python-free OpenWrt installer for Ansible."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import tarfile

NAMES = {"fips": "fips", "web_ui": "gl-sdk4-ui-fips", "device_ui": "gl-e5800-dashboard"}


def members(archive):
    result = {}
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Unsafe package path: " + member.name)
        name = str(path)
        if name in result:
            raise ValueError("Duplicate package path: " + name)
        result[name] = member
    return result


def inspect(path, sha256, component):
    blob = Path(path).read_bytes()
    actual = hashlib.sha256(blob).hexdigest()
    if actual != sha256:
        raise ValueError("Artifact SHA-256 does not match the pinned digest")
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as outer:
        entries = members(outer)
        for name in ("control.tar.gz", "data.tar.gz", "debian-binary"):
            if name not in entries or not entries[name].isfile():
                raise ValueError("Missing regular IPK member: " + name)
        if outer.extractfile(entries["debian-binary"]).read().strip() != b"2.0":
            raise ValueError("Unsupported IPK version")
        control_blob = outer.extractfile(entries["control.tar.gz"]).read()
        payload_blob = outer.extractfile(entries["data.tar.gz"]).read()
    with tarfile.open(fileobj=io.BytesIO(control_blob), mode="r:gz") as control:
        entries = members(control)
        if not entries["control"].isfile():
            raise ValueError("Package control must be a regular file")
        metadata = {}
        for line in control.extractfile(entries["control"]).read().decode().splitlines():
            if line and not line[0].isspace() and ":" in line:
                key, value = line.split(":", 1)
                if key in metadata:
                    raise ValueError("Duplicate control field: " + key)
                metadata[key] = value.strip()
        conf = set()
        if "conffiles" in entries:
            conf = set(control.extractfile(entries["conffiles"]).read().decode().splitlines())
    if metadata.get("Package") != NAMES[component]:
        raise ValueError("Package name is not allowed for component " + component)
    if metadata.get("Architecture") not in ("all", "aarch64_cortex-a53"):
        raise ValueError("Package architecture is not supported on this router")
    if not re.fullmatch(r"[A-Za-z0-9.+:~_-]+", metadata.get("Version", "")):
        raise ValueError("Invalid package version")
    checks = []
    with tarfile.open(fileobj=io.BytesIO(payload_blob), mode="r:gz") as data:
        for name, entry in members(data).items():
            if not re.fullmatch(r"[A-Za-z0-9_./+@-]+", name):
                raise ValueError("Unsupported payload filename: " + name)
            if entry.issym() or entry.islnk():
                # No need for links in any of the three recovery packages.
                raise ValueError("Recovery packages must not contain links: " + name)
            if not entry.isfile() and not entry.isdir():
                raise ValueError("Unsupported payload entry: " + name)
            if entry.isfile() and "/" + name not in conf and not name.startswith("etc/uci-defaults/"):
                digest = hashlib.sha256(data.extractfile(entry).read()).hexdigest()
                checks.append(digest + "  /" + name)
    if not checks:
        raise ValueError("Package has no verifiable payload")
    return {"package": metadata["Package"], "version": metadata["Version"],
            "architecture": metadata["Architecture"], "sha256": actual,
            "depends": metadata.get("Depends", ""), "checks": checks}, blob


def render(info, blob):
    package = shlex.quote(info["package"])
    version = shlex.quote(info["version"])
    # The script module transfers this file over SSH. No Python, rsync, SFTP,
    # remote downloader, shell-evaluated variable, or credential is required.
    return """#!/bin/sh
set -eu
work=$(mktemp -d /tmp/fips-stack.XXXXXX)
trap 'rm -rf "$work"' EXIT HUP INT TERM
cat > "$work/checks" <<'FIPS_STACK_CHECKS'
""" + "\n".join(info["checks"]) + "\nFIPS_STACK_CHECKS\n" + f"""
current=$(opkg status {package} 2>/dev/null | sed -n 's/^Version: //p')
installed=$(opkg status {package} 2>/dev/null | awk '/^Status:/ {{print $4}}')
if [ "$current" = {version} ] && [ "$installed" = installed ]; then
    if sha256sum -c "$work/checks" > "$work/verify.log" 2>&1; then
        echo STACK_UNCHANGED
        exit 0
    fi
    echo 'Package has local drift; refusing destructive force-reinstall. Review files first.' >&2
    cat "$work/verify.log" >&2
    exit 3
fi
decode_base64() {{
    if command -v base64 >/dev/null 2>&1; then
        base64 -d
    else
        openssl base64 -d
    fi
}}
decode_base64 > "$work/package.ipk" <<'FIPS_STACK_PAYLOAD'
""" + base64.encodebytes(blob).decode() + f"""FIPS_STACK_PAYLOAD
echo '{info['sha256']}  '"$work/package.ipk" | sha256sum -c -
opkg install "$work/package.ipk"
test "$(opkg status {package} | sed -n 's/^Version: //p')" = {version}
test "$(opkg status {package} | awk '/^Status:/ {{print $4}}')" = installed
sha256sum -c "$work/checks"
echo STACK_CHANGED
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--component", choices=NAMES, required=True)
    parser.add_argument("--render", type=Path)
    args = parser.parse_args()
    info, blob = inspect(args.path, args.sha256, args.component)
    if args.render:
        args.render.write_text(render(info, blob))
        args.render.chmod(0o700)
    print(json.dumps({k: v for k, v in info.items() if k != "checks"}))


if __name__ == "__main__":
    main()
