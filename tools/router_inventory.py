#!/usr/bin/env python3
"""Capture and compare private, read-only router package and service inventories."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess


ROOT = Path(__file__).resolve().parents[1]
SERVICES = (
    "dropbear", "network", "firewall", "dnsmasq", "uhttpd",
    "gl_screen", "citydash", "homebutton", "fips", "fips-gateway", "fips-recovery",
)
SERVICE_SCRIPT = """set -eu
for name in dropbear network firewall dnsmasq uhttpd gl_screen citydash homebutton fips fips-gateway fips-recovery; do
    if [ ! -x "/etc/init.d/$name" ]; then
        printf '%s\tabsent\tabsent\n' "$name"
        continue
    fi
    if "/etc/init.d/$name" enabled >/dev/null 2>&1; then enabled=enabled; else enabled=disabled; fi
    if "/etc/init.d/$name" status >/dev/null 2>&1; then running=running; else running=stopped; fi
    printf '%s\t%s\t%s\n' "$name" "$enabled" "$running"
done
"""
PACKAGE_NAME = re.compile(r"[A-Za-z0-9_.+-]+\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def parse_packages(output: str) -> dict[str, list[str]]:
    packages: dict[str, list[str]] = {}
    for paragraph in output.strip().split("\n\n"):
        fields = {}
        for line in paragraph.splitlines():
            if line.startswith((" ", "\t")) or ": " not in line:
                continue
            key, value = line.split(": ", 1)
            if key in ("Package", "Version", "Status"):
                fields[key] = value
        name = fields.get("Package", "")
        if not PACKAGE_NAME.fullmatch(name) or not fields.get("Version") or not fields.get("Status"):
            raise ValueError("Router returned an invalid opkg record")
        if name in packages:
            raise ValueError("Router returned a duplicate opkg package")
        packages[name] = [fields["Version"], fields["Status"]]
    if not packages:
        raise ValueError("Router returned no opkg packages")
    return packages


def parse_services(output: str) -> dict[str, list[str]]:
    services: dict[str, list[str]] = {}
    for line in output.splitlines():
        parts = line.split("\t")
        if len(parts) != 3 or parts[0] not in SERVICES or parts[0] in services:
            raise ValueError("Router returned invalid service state")
        enabled, running = parts[1:]
        if (enabled, running) != ("absent", "absent") and (
            enabled not in ("enabled", "disabled") or running not in ("running", "stopped")
        ):
            raise ValueError("Router returned invalid service state")
        services[parts[0]] = [enabled, running]
    if set(services) != set(SERVICES):
        raise ValueError("Router omitted service state")
    return services


def parse_stock_files(output: str) -> dict[str, list[str]]:
    lines = output.splitlines()
    if len(lines) != 2:
        raise ValueError("Router did not return both stock UI fingerprints")
    fingerprints = {}
    for label, line in zip(("web_app", "touchscreen"), lines):
        parts = line.split(maxsplit=1)
        if len(parts) != 2 or not SHA256.fullmatch(parts[0]):
            raise ValueError("Router returned an invalid stock UI fingerprint")
        path = parts[1].strip()
        if label == "web_app" and not re.fullmatch(r"/www/js/app\.[A-Za-z0-9_-]+\.js\.gz", path):
            raise ValueError("Router returned an unexpected stock web path")
        if label == "touchscreen" and path != "/usr/bin/gl_screen":
            raise ValueError("Router returned an unexpected stock screen path")
        fingerprints[label] = [path, parts[0]]
    return fingerprints


def ssh_command(host: str, ssh_key: Path) -> list[str]:
    if not re.fullmatch(r"[A-Za-z0-9_.@:-]+", host) or host.startswith("-"):
        raise ValueError("Invalid SSH host")
    if ssh_key.is_symlink() or not ssh_key.is_file() or stat.S_IMODE(ssh_key.stat().st_mode) & 0o077:
        raise ValueError("SSH identity must be a private regular file")
    return [
        "ssh", "-T", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
        "-o", "PreferredAuthentications=publickey", "-o", "PasswordAuthentication=no",
        "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=8",
        "-o", "ControlPath=none", "-i", str(ssh_key), host,
    ]


def capture(host: str, ssh_key: Path) -> dict:
    ssh = ssh_command(host, ssh_key)

    def run(command: str) -> str:
        result = subprocess.run([*ssh, command], text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=30, check=False)
        if result.returncode:
            raise ValueError("Read-only router inventory command failed")
        return result.stdout

    firmware = run("cat /etc/glversion").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.+-]+", firmware):
        raise ValueError("Router returned invalid firmware version")
    return {
        "format": 2,
        "firmware": firmware,
        "packages": parse_packages(run("opkg status")),
        "services": parse_services(run(SERVICE_SCRIPT)),
        "stock_files": parse_stock_files(run(
            'set -eu; set -- /www/js/app.*.js.gz; test "$#" = 1; '
            'sha256sum "$1" /usr/bin/gl_screen'
        )),
    }


def prepare_private_output(path: Path) -> None:
    if path.exists() or path.is_symlink() or path.suffix != ".json":
        raise ValueError("Choose a new JSON inventory path")
    resolved = path.resolve()
    if resolved.is_relative_to(ROOT) and not resolved.is_relative_to(ROOT / "private"):
        raise ValueError("Repository inventories must stay in ignored private/")
    if not path.parent.is_dir() or path.parent.is_symlink() or stat.S_IMODE(path.parent.stat().st_mode) & 0o077:
        raise ValueError("Inventory directory must exist with mode 0700")


def write_private(path: Path, inventory: dict) -> None:
    prepare_private_output(path)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w") as destination:
            json.dump(inventory, destination, sort_keys=True, indent=2)
            destination.write("\n")
            destination.flush()
            os.fsync(destination.fileno())
    except Exception:
        path.unlink(missing_ok=True)
        raise


def compare(before: dict, after: dict) -> list[str]:
    if before.get("format") != 2 or after.get("format") != 2:
        raise ValueError("Unsupported router inventory format")
    differences = []
    if before.get("firmware") != after.get("firmware"):
        differences.append("CHANGED firmware")
    for field, noun in (("packages", "package"), ("services", "service"),
                        ("stock_files", "stock file")):
        left, right = before.get(field), after.get(field)
        if not isinstance(left, dict) or not isinstance(right, dict):
            raise ValueError("Invalid router inventory")
        for name in sorted(left.keys() | right.keys()):
            if name not in left:
                differences.append(f"ADDED {noun} {name}")
            elif name not in right:
                differences.append(f"REMOVED {noun} {name}")
            elif left[name] != right[name]:
                differences.append(f"CHANGED {noun} {name}")
    return differences


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    snapshot = commands.add_parser("capture")
    snapshot.add_argument("--host", default="root@192.168.8.1")
    snapshot.add_argument("--ssh-key", type=Path, required=True)
    snapshot.add_argument("--output", type=Path, required=True)
    comparison = commands.add_parser("compare")
    comparison.add_argument("--before", type=Path, required=True)
    comparison.add_argument("--after", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "capture":
        write_private(args.output, capture(args.host, args.ssh_key))
        print(args.output)
        return
    before = json.loads(args.before.read_text())
    after = json.loads(args.after.read_text())
    differences = compare(before, after)
    if differences:
        print("\n".join(differences))
        raise SystemExit(1)
    print("Router inventory matches: firmware, opkg packages, services and stock UI files")


if __name__ == "__main__":
    main()
