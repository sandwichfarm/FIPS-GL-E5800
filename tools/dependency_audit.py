#!/usr/bin/env python3
"""Inventory locked Rust, npm, and OpenWrt dependencies and their licenses."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess

from offline_runtime import verify as verify_offline_runtime
from vendor_pillow import payload as vendor_pillow_payload


ROOT = Path(__file__).resolve().parents[1]
TARGET = "aarch64-unknown-linux-musl"
CRATES_IO = "registry+https://github.com/rust-lang/crates.io-index"
KNOWN_LICENSE_IDS = {
    "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BSL-1.0", "CC-BY-4.0",
    "CC0-1.0", "CDLA-Permissive-2.0", "GPL-3.0-or-later", "ISC",
    "LLVM-exception", "MIT", "MPL-2.0", "Unicode-3.0", "Unicode-DFS-2016",
    "Unlicense", "WTFPL", "Zlib", "Python-2.0.1", "0BSD",
    "Public-Domain", "libtiff", "HPND",
}


def check_license(expression: str, package: str) -> str:
    tokens = re.findall(r"[A-Za-z0-9.+-]+", expression)
    identifiers = [token for token in tokens if token not in {"AND", "OR", "WITH"}]
    if not identifiers or any(token not in KNOWN_LICENSE_IDS for token in identifiers):
        raise ValueError(f"Missing or unreviewed license expression for {package}: {expression!r}")
    return expression


def lock_checksums(path: Path) -> dict[tuple[str, str, str], str]:
    """Read the four scalar fields needed from Cargo's generated lock format."""
    records = {}
    item: dict[str, str] = {}
    for line in path.read_text().splitlines() + ["[[package]]"]:
        if line == "[[package]]":
            if item.get("source"):
                key = (item.get("name", ""), item.get("version", ""), item["source"])
                records[key] = item.get("checksum", "")
            item = {}
            continue
        match = re.fullmatch(r'(name|version|source|checksum) = "([^"]+)"', line)
        if match:
            item[match.group(1)] = match.group(2)
    return records


def cargo_inventory(manifest: Path) -> list[dict[str, str]]:
    result = subprocess.run(
        ["cargo", "metadata", "--locked", "--format-version", "1",
         "--filter-platform", TARGET, "--manifest-path", str(manifest)],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    metadata = json.loads(result.stdout)
    locked = lock_checksums(manifest.with_name("Cargo.lock"))
    records = []
    for item in metadata["packages"]:
        source = item.get("source")
        if source is None:
            continue  # Local source is checked separately by check_sources.py.
        name, version = item["name"], item["version"]
        if source != CRATES_IO:
            raise ValueError(f"Non-registry Rust dependency needs review: {name} {version}")
        checksum = locked.get((name, version, source))
        if not checksum or not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise ValueError(f"Missing locked checksum: {name} {version}")
        records.append({
            "name": name,
            "version": version,
            "license": check_license(item.get("license") or "", f"cargo:{name}@{version}"),
            "checksum": checksum,
            "source": source,
        })
    return records


def npm_inventory() -> list[dict[str, str]]:
    lock = json.loads((ROOT / "apps/web-ui/package-lock.json").read_text())
    if lock.get("lockfileVersion") != 3:
        raise ValueError("Unexpected npm lockfile version")
    records = []
    for path, item in lock["packages"].items():
        if not path:
            continue
        name, version = path, item["version"]
        license_expression = item.get("license")
        if not license_expression and path == "node_modules/@vue/compiler-sfc":
            notice = ROOT / "apps/web-ui" / path / "LICENSE"
            if not notice.read_text().startswith("The MIT License (MIT)\n"):
                raise ValueError("Missing Vue compiler license notice")
            license_expression = "MIT"
        resolved, integrity = item.get("resolved", ""), item.get("integrity", "")
        if not resolved.startswith("https://registry.npmjs.org/") or not integrity.startswith("sha512-"):
            raise ValueError(f"Unpinned npm dependency: {name}@{version}")
        records.append({
            "name": name,
            "version": version,
            "license": check_license(license_expression or "", f"npm:{name}@{version}"),
            "integrity": integrity,
            "resolved": resolved,
        })
    return records


def audit() -> dict:
    cargo = {}
    for relative in ("components/fips/Cargo.toml", "apps/router-admin/Cargo.toml"):
        for item in cargo_inventory(ROOT / relative):
            key = (item["name"], item["version"])
            if key in cargo and cargo[key] != item:
                raise ValueError(f"Conflicting Rust dependency record: {key}")
            cargo[key] = item
    runtime = verify_offline_runtime()
    _, pillow = vendor_pillow_payload()
    return {
        "target": TARGET,
        "cargo": [cargo[key] for key in sorted(cargo)],
        "npm": sorted(npm_inventory(), key=lambda item: item["name"]),
        "openwrt": [
            {"name": item["name"], "version": item["version"],
             "license": check_license(item["license"], "openwrt:" + item["name"]),
             "sha256": item["sha256"], "source": item["source"],
             "feed": runtime["feeds"][item["feed"]]["url"]}
            for item in runtime["packages"]
        ] + [{"name": pillow["package"], "version": pillow["version"],
              "license": check_license(pillow["license"], "openwrt:python3-pillow"),
              "sha256": pillow["sha256"], "feed": pillow["url"]}],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/dependencies.json")
    args = parser.parse_args()
    report = audit()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(f"audited {len(report['cargo'])} Cargo, {len(report['npm'])} npm, and {len(report['openwrt'])} OpenWrt dependencies")


if __name__ == "__main__":
    main()
