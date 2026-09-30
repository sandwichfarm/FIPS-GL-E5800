#!/usr/bin/env python3
"""Check vendored snapshot pins, licenses, and tracked source bytes."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parent.parent
EXPECTED = {"components/fips", "components/web-ui", "components/device-ui"}


def tracked_files() -> list[Path]:
    output = subprocess.check_output(["git", "ls-files", "-z", "--", "components"], cwd=ROOT)
    return sorted(Path(name.decode()) for name in output.split(b"\0") if name)


def digest_tree(prefix: str, paths: list[Path]) -> str:
    digest = hashlib.sha256()
    selected = [path for path in paths if path.parts[:2] == tuple(prefix.split("/"))]
    if not selected:
        raise ValueError(f"No tracked files in {prefix}")
    for path in selected:
        source = ROOT / path
        if source.is_symlink():
            content = b"symlink\0" + os.readlink(source).encode()
        elif source.is_file():
            content = b"file\0" + source.read_bytes()
        else:
            raise ValueError(f"Missing source: {path}")
        digest.update(path.as_posix().encode() + b"\0")
        digest.update(hashlib.sha256(content).digest())
    return digest.hexdigest()


def check(print_digests: bool = False) -> dict[str, str]:
    target = json.loads((ROOT / "upstream/targets.json").read_text())
    if set(target) != {"model", "firmware", "openwrt", "architecture", "app_sha256", "screen_sha256", "status"}:
        raise ValueError("Target profile fields changed without review")
    if target["model"] != "GL-E5800" or target["architecture"] != "aarch64_cortex-a53" or target["status"] != "candidate_unverified":
        raise ValueError("Unsupported target profile")
    for key in ("app_sha256", "screen_sha256"):
        if not re.fullmatch(r"[0-9a-f]{64}", target[key]):
            raise ValueError(f"Invalid target fingerprint: {key}")
    sources = json.loads((ROOT / "upstream/sources.json").read_text())["sources"]
    if {item["path"] for item in sources} != EXPECTED or len(sources) != len(EXPECTED):
        raise ValueError("Source inventory must list each vendored component exactly once")
    paths = tracked_files()
    extra = subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard", "-z", "--", "components"],
        cwd=ROOT,
    )
    if extra:
        raise ValueError("Untracked files in vendored source snapshots")
    digests = {}
    for item in sources:
        prefix = item["path"]
        if not re.fullmatch(r"[0-9a-f]{40}", item["commit"]):
            raise ValueError(f"Invalid source commit: {prefix}")
        if not item["url"].startswith("https://") or not item["ref"]:
            raise ValueError(f"Unpinned source reference: {prefix}")
        if item["license"] != "MIT":
            raise ValueError(f"Review source license: {prefix}")
        license_path = Path(prefix) / "LICENSE"
        if license_path not in paths or not (ROOT / license_path).read_text().startswith("MIT License\n"):
            raise ValueError(f"MIT license missing or changed: {prefix}")
        digests[prefix] = digest_tree(prefix, paths)
        if not print_digests and item.get("tree_sha256") != digests[prefix]:
            raise ValueError(f"Snapshot changed without source record update: {prefix}")
    return digests


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--print-digests", action="store_true")
    args = parser.parse_args()
    print(json.dumps(check(args.print_digests), indent=2, sort_keys=True))
