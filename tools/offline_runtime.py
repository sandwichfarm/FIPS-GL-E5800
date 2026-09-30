#!/usr/bin/env python3
"""Fetch, verify, and stage the pinned GL 4.10.0 dashboard runtime IPKs."""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import tarfile
import tempfile
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
NAME = re.compile(r"[a-z0-9][a-z0-9+._-]*\Z")
VERSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9+._~-]*\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")


def package_dir(root: Path = ROOT) -> Path:
    return root / "artifacts/runtime" if (root / "artifacts").is_dir() else root / "runtime"


def dependency_names(raw: str) -> list[str]:
    return [re.sub(r"\s*\([^)]*\)", "", part).strip()
            for part in raw.split(",") if part.strip()]


def manifest(root: Path = ROOT) -> dict:
    record = json.loads((root / "upstream/vendor/runtime.json").read_text())
    if record.get("schema") != 1 or record.get("target_firmware") != json.loads(
            (root / "upstream/targets.json").read_text())["firmware"]:
        raise ValueError("Offline runtime target or schema changed")
    packages = record.get("packages")
    if not isinstance(packages, list) or not packages:
        raise ValueError("Offline runtime package list is empty")
    names = set()
    files = set()
    feeds = record.get("feeds", {})
    if not isinstance(feeds, dict) or not feeds:
        raise ValueError("Invalid pinned runtime feeds")
    for item in packages:
        if not isinstance(item, dict):
            raise ValueError("Invalid pinned runtime package record")
        name, filename = item.get("name"), item.get("filename")
        if (not isinstance(name, str) or not NAME.fullmatch(name)
                or not isinstance(item.get("version"), str) or not VERSION.fullmatch(item["version"])
                or not isinstance(filename, str) or filename != f"{name}_{item.get('version')}_aarch64_cortex-a53.ipk"
                or name in names or filename in files or item.get("feed") not in feeds
                or not isinstance(item.get("size"), int) or item["size"] < 1
                or not isinstance(item.get("sha256"), str) or not SHA.fullmatch(item["sha256"])
                or item.get("architecture") != "aarch64_cortex-a53"
                or not isinstance(item.get("license"), str) or not item["license"]
                or not isinstance(item.get("source"), str) or not item["source"]
                or not isinstance(item.get("license_files"), str)
                or not isinstance(item.get("depends"), str)
                or any(not NAME.fullmatch(dep) for dep in dependency_names(item["depends"]))):
            raise ValueError("Invalid pinned runtime package record")
        names.add(name)
        files.add(filename)
    baseline = record.get("baseline_packages", [])
    if (not isinstance(baseline, list) or len(set(baseline)) != len(baseline)
            or any(not isinstance(name, str) or not NAME.fullmatch(name) for name in baseline)
            or names & set(baseline)):
        raise ValueError("Invalid pinned runtime baseline")
    provides = record.get("baseline_provides", {})
    if (not isinstance(provides, dict) or any(not isinstance(name, str) or not NAME.fullmatch(name)
            or provider not in baseline
            for name, provider in provides.items())):
        raise ValueError("Invalid pinned runtime providers")
    if (set(record.get("install_order", [])) != names
            or len(record["install_order"]) != len(names)
            or record.get("remove_order") != list(reversed(record["install_order"]))):
        raise ValueError("Invalid runtime installation or removal order")
    installed = set(baseline) | set(provides)
    ordered = set()
    by_name = {item["name"]: item for item in packages}
    for name in record["install_order"]:
        deps = set(dependency_names(by_name[name]["depends"]))
        if not deps <= installed | ordered:
            raise ValueError("Offline runtime dependency closure or order is incomplete: " + name)
        ordered.add(name)
    roots = record.get("roots")
    if (not isinstance(roots, list) or not roots
            or any(not isinstance(name, str) or not NAME.fullmatch(name) for name in roots)
            or len(set(roots)) != len(roots) or not set(roots) <= installed | names):
        raise ValueError("Offline runtime roots are incomplete")
    for feed in feeds.values():
        if (not isinstance(feed, dict) or not isinstance(feed.get("url"), str)
                or not feed["url"].startswith("https://")
                or not isinstance(feed.get("sha256"), str) or not SHA.fullmatch(feed["sha256"])):
            raise ValueError("Invalid pinned runtime feed")
    return record


def archive_entries(blob: bytes) -> dict[str, bytes]:
    files = {}
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:*") as archive:
        for entry in archive:
            path = PurePosixPath(entry.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Unsafe runtime IPK archive path")
            name = str(path)
            if entry.isdir():
                continue
            if not entry.isfile() or name in files:
                raise ValueError("Unsupported runtime IPK archive member: " + name)
            files[name] = archive.extractfile(entry).read()
    return files


def verify_package(path: Path, item: dict) -> bytes:
    if path.is_symlink() or not path.is_file():
        raise ValueError("Offline runtime IPK is missing or linked: " + item["filename"])
    blob = path.read_bytes()
    if len(blob) != item["size"] or hashlib.sha256(blob).hexdigest() != item["sha256"]:
        raise ValueError("Offline runtime IPK checksum or size changed: " + item["filename"])
    outer = archive_entries(blob)
    if set(outer) != {"debian-binary", "control.tar.gz", "data.tar.gz"} or outer["debian-binary"] != b"2.0\n":
        raise ValueError("Invalid offline runtime IPK structure")
    control = archive_entries(outer["control.tar.gz"])["control"].decode()
    fields = dict(line.split(": ", 1) for line in control.splitlines()
                  if ": " in line and not line.startswith(" "))
    for field, expected in (("Package", item["name"]), ("Version", item["version"]),
                            ("Architecture", item["architecture"]),
                            ("License", item["license"]), ("Depends", item["depends"]),
                            ("Source", item["source"]), ("LicenseFiles", item["license_files"])):
        if fields.get(field, "") != expected:
            raise ValueError("Offline runtime control metadata changed: " + item["name"] + " " + field)
    protected = ("usr/lib/libfreetype.so", "usr/bin/gl_screen", "www/js/app.",
                 "etc/fips/", "etc/config/network", "etc/config/firewall", "etc/config/dhcp")
    with tarfile.open(fileobj=io.BytesIO(outer["data.tar.gz"]), mode="r:*") as data:
        for entry in data:
            path = PurePosixPath(entry.name)
            name = str(path)
            if (path.is_absolute() or ".." in path.parts or name.startswith(protected)
                    or not (entry.isfile() or entry.isdir() or entry.issym())
                    or (entry.issym() and (PurePosixPath(entry.linkname).is_absolute()
                                          or ".." in PurePosixPath(entry.linkname).parts))):
                raise ValueError("Unsafe or stock-owned offline runtime payload: " + entry.name)
    return blob


def verify(root: Path = ROOT) -> dict:
    record = manifest(root)
    directory = package_dir(root)
    for item in record["packages"]:
        verify_package(directory / item["filename"], item)
    return record


def check_candidate_dependencies(depends: str, record: dict) -> None:
    declared = set(dependency_names(depends))
    declared.discard("gl-sdk4-screen-large")
    if declared != set(record["roots"]):
        raise ValueError("Dashboard candidate dependencies differ from offline runtime roots")


def fetch() -> None:
    record = manifest()
    destination = ROOT / "artifacts/runtime"
    destination.mkdir(parents=True, exist_ok=True)

    def one(item: dict) -> None:
        path = destination / item["filename"]
        if path.exists():
            verify_package(path, item)
            return
        feed = record["feeds"][item["feed"]]["url"].rsplit("/", 1)[0]
        url = feed + "/" + item["filename"]
        descriptor, temporary = tempfile.mkstemp(prefix=".runtime-", dir=destination)
        try:
            with os.fdopen(descriptor, "wb") as output, urlopen(url, timeout=30) as response:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            verify_package(Path(temporary), item)
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(one, record["packages"]))
    verify()


def render(root: Path = ROOT) -> str:
    record = verify(root)
    directory = package_dir(root)
    by_name = {item["name"]: item for item in record["packages"]}
    lines = ["#!/bin/sh", "set -eu", "set -f",
             "work=$(mktemp -d /tmp/fips-runtime.XXXXXX)",
             "trap 'rm -rf \"$work\"' EXIT HUP INT TERM",
             "decode() { if command -v base64 >/dev/null 2>&1; then base64 -d; else openssl base64 -d; fi; }"]
    for index, name in enumerate(record["install_order"]):
        item = by_name[name]
        tag = f"RUNTIME_IPK_{index}"
        lines.extend([f"decode > \"$work/{item['filename']}\" <<'{tag}'",
                      base64.encodebytes((directory / item["filename"]).read_bytes()).decode().rstrip(),
                      tag,
                      f"printf '%s  %s\\n' '{item['sha256']}' \"$work/{item['filename']}\" | sha256sum -c -"])
    lines.append("set --")
    for name in record["baseline_packages"]:
        lines.append(f"test \"$(opkg status {name} 2>/dev/null | awk '/^Status:/ {{print $4}}')\" = installed || {{ echo 'Missing stock runtime prerequisite: {name}' >&2; exit 1; }}")
    for name in record["install_order"]:
        item = by_name[name]
        lines.extend([f"current=$(opkg status {name} 2>/dev/null | sed -n 's/^Version: //p')",
                      f"state=$(opkg status {name} 2>/dev/null | awk '/^Status:/ {{print $4}}')",
                      "if [ \"$state\" = installed ]; then",
                      f"  [ \"$current\" = '{item['version']}' ] || {{ echo 'Runtime version differs from pin: {name}' >&2; exit 1; }}",
                      "else",
                      f"  set -- \"$@\" \"$work/{item['filename']}\"",
                      "fi"])
    lines.extend(["if [ \"$#\" -gt 0 ]; then opkg install \"$@\"; echo RUNTIME_CHANGED; else echo RUNTIME_UNCHANGED; fi"])
    for name in record["install_order"]:
        item = by_name[name]
        lines.append(f"test \"$(opkg status {name} 2>/dev/null | sed -n 's/^Version: //p')\" = '{item['version']}'")
        lines.append(f"test \"$(opkg status {name} 2>/dev/null | awk '/^Status:/ {{print $4}}')\" = installed")
    lines.append("echo RUNTIME_READY")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("fetch", "verify", "render"))
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.command == "fetch":
        fetch()
    elif args.command == "verify":
        record = verify(args.root)
        print(f"Verified {len(record['packages'])} offline runtime IPKs")
    else:
        if args.output is None:
            parser.error("render requires --output")
        args.output.write_text(render(args.root))
        args.output.chmod(0o700)
        print(args.output)


if __name__ == "__main__":
    main()
