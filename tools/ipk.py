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
import struct
import tarfile

NAMES = {"fips": "fips", "web_ui": "gl-sdk4-ui-fips", "device_ui": "gl-e5800-dashboard"}
FIPS_BINARIES = {"usr/bin/fips", "usr/bin/fipsctl", "usr/bin/fips-gateway", "usr/bin/fips-router-admin"}
FIPS_FILES = FIPS_BINARIES | {
    "usr/bin/fipstop", "usr/bin/fips-mesh-setup", "usr/bin/fips-ap-setup",
    "etc/init.d/fips", "etc/init.d/fips-gateway",
    "etc/fips/fips.yaml", "etc/fips/firewall.sh",
    "etc/sysctl.d/fips-bridge.conf", "etc/sysctl.d/fips-gateway.conf",
    "etc/hotplug.d/net/99-fips", "etc/uci-defaults/90-fips-setup",
    "lib/upgrade/keep.d/fips",
}
WEB_FILES = {
    "usr/share/oui/menu.d/fips.json",
    "www/cgi-bin/gl-sdk4-ui-fips",
    "www/views/gl-sdk4-ui-fips.common.js.gz",
}
DEVICE_FILES = {"etc/init.d/citydash", "etc/init.d/homebutton"}
REQUIRED_CANDIDATE_FILES = {
    "fips": FIPS_BINARIES | {"etc/init.d/fips", "etc/init.d/fips-gateway", "lib/upgrade/keep.d/fips"},
    "web_ui": WEB_FILES,
    "device_ui": DEVICE_FILES | {
        "root/dashboard/dashboard.py", "root/dashboard/button_watch.py",
        "root/dashboard/run.sh", "root/dashboard/screen_sleep.sh",
        "root/dashboard/toggle.sh",
    },
}
REQUIRED_CANDIDATE_DEPENDENCIES = {
    "fips": {"kmod-tun", "ip-full"},
    "web_ui": {"fips"},
    "device_ui": {
        "python3", "python3-numpy", "python3-pillow", "libtiff6",
        "zoneinfo-europe", "zoneinfo-asia", "zoneinfo-america",
        "zoneinfo-australia-nz", "zoneinfo-pacific",
    },
}
ALLOWED_FILES = {"fips": FIPS_FILES, "web_ui": WEB_FILES, "device_ui": DEVICE_FILES}
ALLOWED_DIRS = {
    component: {str(parent) for name in files for parent in PurePosixPath(name).parents
                if str(parent) != "."}
    for component, files in ALLOWED_FILES.items()
}
ALLOWED_DIRS["device_ui"].update({"root", "root/dashboard"})
DEVICE_CONTROL_SCRIPTS = {
    name: Path(__file__).resolve().parents[1] / "packaging/device-ui/control" / name
    for name in ("postinst", "prerm")
}


def check_payload_path(component, name, directory):
    if directory:
        allowed = name == "." or name in ALLOWED_DIRS[component]
    elif component == "device_ui" and re.fullmatch(r"root/dashboard/[A-Za-z0-9_-]+\.(?:py|sh)", name):
        allowed = True
    else:
        allowed = name in ALLOWED_FILES[component]
    if not allowed:
        raise ValueError("Package payload outside approved component paths: " + name)


def check_aarch64_elf(data, name):
    if (len(data) < 64 or data[:4] != b"\x7fELF" or data[4:7] != b"\x02\x01\x01"
            or struct.unpack_from("<H", data, 16)[0] not in (2, 3)
            or struct.unpack_from("<H", data, 18)[0] != 183
            or struct.unpack_from("<I", data, 20)[0] != 1
            or struct.unpack_from("<H", data, 52)[0] != 64):
        raise ValueError("FIPS binary is not a 64-bit little-endian AArch64 ELF: " + name)
    program_offset = struct.unpack_from("<Q", data, 32)[0]
    entry_size, count = struct.unpack_from("<HH", data, 54)
    if (program_offset < 64 or entry_size != 56 or count < 1
            or program_offset + entry_size * count > len(data)
            or not any(struct.unpack_from("<I", data, program_offset + entry_size * index)[0] == 1
                       for index in range(count))):
        raise ValueError("FIPS binary has no valid loadable ELF program headers: " + name)


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


def inspect(path, sha256, component, candidate=False):
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
        if candidate:
            scripts = DEVICE_CONTROL_SCRIPTS if component == "device_ui" else {}
            expected = {"control"} | set(scripts)
            if set(entries) != expected:
                raise ValueError("Candidate package has unexpected control scripts or files")
            for name, source in scripts.items():
                if source.is_symlink() or not source.is_file():
                    raise ValueError("Reviewed candidate control script is missing: " + name)
                entry = entries[name]
                if not entry.isfile() or control.extractfile(entry).read() != source.read_bytes():
                    raise ValueError("Candidate control script differs from reviewed source: " + name)
    if metadata.get("Package") != NAMES[component]:
        raise ValueError("Package name is not allowed for component " + component)
    required_arch = "aarch64_cortex-a53" if component == "fips" else "all"
    if metadata.get("Architecture") != required_arch:
        raise ValueError("Package architecture is not supported on this router")
    if not re.fullmatch(r"[A-Za-z0-9.+:~_-]+", metadata.get("Version", "")):
        raise ValueError("Invalid package version")
    if candidate:
        declared = {part.strip() for part in metadata.get("Depends", "").split(",")}
        missing = REQUIRED_CANDIDATE_DEPENDENCIES[component] - declared
        if missing:
            raise ValueError("Candidate package is missing dependencies: " + ", ".join(sorted(missing)))
    checks = []
    fips_present = set()
    payload_files = set()
    with tarfile.open(fileobj=io.BytesIO(payload_blob), mode="r:gz") as data:
        for name, entry in members(data).items():
            if not re.fullmatch(r"[A-Za-z0-9_./+@-]+", name):
                raise ValueError("Unsupported payload filename: " + name)
            if entry.issym() or entry.islnk():
                # No need for links in any of the three recovery packages.
                raise ValueError("Recovery packages must not contain links: " + name)
            if not entry.isfile() and not entry.isdir():
                raise ValueError("Unsupported payload entry: " + name)
            check_payload_path(component, name, entry.isdir())
            if entry.isfile():
                payload_files.add(name)
                content = data.extractfile(entry).read()
                if component == "fips" and name in FIPS_BINARIES:
                    check_aarch64_elf(content, name)
                    fips_present.add(name)
                if "/" + name not in conf and not name.startswith("etc/uci-defaults/"):
                    digest = hashlib.sha256(content).hexdigest()
                    checks.append(digest + "  /" + name)
    if component == "fips" and "usr/bin/fips" not in fips_present:
        raise ValueError("FIPS package has no validated daemon binary")
    if candidate:
        missing = REQUIRED_CANDIDATE_FILES[component] - payload_files
        if missing:
            raise ValueError("Candidate package is missing runtime files: " + ", ".join(sorted(missing)))
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
    parser.add_argument("--candidate", action="store_true", help="require reviewed candidate control scripts")
    parser.add_argument("--render", type=Path)
    args = parser.parse_args()
    info, blob = inspect(args.path, args.sha256, args.component, candidate=args.candidate)
    if args.render:
        args.render.write_text(render(info, blob))
        args.render.chmod(0o700)
    print(json.dumps({k: v for k, v in info.items() if k != "checks"}))


if __name__ == "__main__":
    main()
