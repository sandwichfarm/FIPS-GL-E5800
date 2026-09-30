#!/usr/bin/env python3
"""Bind OpenWrt binaries to the pinned builder and exact current source bytes."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
BINARIES = ("fips", "fipsctl", "fips-gateway", "fips-router-admin")
TOOLCHAIN = {"rustc": "1.94.1", "zig": "0.13.0", "cargo-zigbuild": "0.19.8"}
BUILD_VARIABLES = ("DEV_IMAGE", "PROJECT_MOUNT", "RUST_RUN")


def digest(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Missing or linked build input: {path}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def admin_tree_digest() -> str:
    base = ROOT / "apps/router-admin"
    paths = [base / "Cargo.toml", base / "Cargo.lock"]
    if (base / "build.rs").exists():
        paths.append(base / "build.rs")
    paths.extend(path for path in (base / "src").rglob("*") if path.is_file() or path.is_symlink())
    checksum = hashlib.sha256()
    for path in sorted(paths):
        relative = path.relative_to(ROOT).as_posix()
        checksum.update(relative.encode() + b"\0" + bytes.fromhex(digest(path)))
    return checksum.hexdigest()


def build_recipe_digest(makefile: str) -> str:
    """Hash only Make inputs that can change the pinned ARM64 build."""
    lines = makefile.splitlines()
    selected = []
    for name in BUILD_VARIABLES:
        matches = [line for line in lines if line.startswith(f"{name} :=")]
        if len(matches) != 1 or matches[0].endswith("\\"):
            raise ValueError(f"Missing or multiline OpenWrt build variable: {name}")
        selected.extend(matches)
    targets = [index for index, line in enumerate(lines) if line == "openwrt-build:"]
    if len(targets) != 1:
        raise ValueError("Missing or duplicate OpenWrt build target")
    recipe = []
    for line in lines[targets[0] + 1:]:
        if not line.startswith("\t"):
            break
        recipe.append(line)
    if not recipe:
        raise ValueError("OpenWrt build target has no recipe")
    selected.extend(["openwrt-build:", *recipe])
    return hashlib.sha256(("\n".join(selected) + "\n").encode()).hexdigest()


def current_context() -> dict:
    from check_sources import check

    source_trees = check()
    source = next(item for item in json.loads((ROOT / "upstream/sources.json").read_text())["sources"]
                  if item["path"] == "components/fips")
    if source["tree_sha256"] != source_trees["components/fips"]:
        raise ValueError("Pinned FIPS tree changed")
    return {
        "source": source,
        "admin_tree_sha256": admin_tree_digest(),
        "dockerfile_sha256": digest(ROOT / "dev/Dockerfile"),
        "git_shim_sha256": digest(ROOT / "dev/tool-shims/git"),
        "build_recipe_sha256": build_recipe_digest((ROOT / "Makefile").read_text()),
    }


def record_for_bins(binary_dir: Path) -> dict:
    return {
        "schema": 2,
        "target": "aarch64-unknown-linux-musl",
        "toolchain": TOOLCHAIN,
        **current_context(),
        "binaries": {name: digest(binary_dir / name) for name in BINARIES},
    }


def require_pinned_toolchain() -> None:
    if shutil.which("zig") != "/opt/zig/zig":
        raise ValueError("Pinned Zig executable must come from the development image")
    commands = {
        "rustc": ["rustc", "--version"],
        "zig": ["zig", "version"],
        "cargo-zigbuild": ["cargo-zigbuild", "--version"],
    }
    observed = {}
    for name, command in commands.items():
        output = subprocess.check_output(command, text=True).strip().split()
        observed[name] = output[0] if name == "zig" else output[1]
    if observed != TOOLCHAIN:
        raise ValueError(f"Unpinned OpenWrt build toolchain: {observed}")


def verify_record(record: dict, payload: dict[str, str] | None = None,
                  binary_dir: Path | None = None, current: bool = True) -> None:
    if not isinstance(record, dict) or set(record) != {
        "schema", "target", "toolchain", "source", "admin_tree_sha256",
        "dockerfile_sha256", "git_shim_sha256", "build_recipe_sha256", "binaries",
    }:
        raise ValueError("Missing or malformed FIPS build provenance")
    if record["schema"] != 2 or record["target"] != "aarch64-unknown-linux-musl" or record["toolchain"] != TOOLCHAIN:
        raise ValueError("FIPS build provenance has an unsupported builder")
    source = record["source"]
    if (not isinstance(source, dict) or set(source) != {"path", "url", "ref", "commit", "license", "tree_sha256"}
            or source["path"] != "components/fips" or source["license"] != "MIT"
            or not isinstance(source["commit"], str) or len(source["commit"]) != 40
            or any(c not in "0123456789abcdef" for c in source["commit"])):
        raise ValueError("FIPS build provenance has an invalid source record")
    for value in (source["tree_sha256"], record["admin_tree_sha256"],
                  record["dockerfile_sha256"], record["git_shim_sha256"], record["build_recipe_sha256"]):
        if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
            raise ValueError("FIPS build provenance has an invalid source checksum")
    binaries = record["binaries"]
    if not isinstance(binaries, dict) or set(binaries) != set(BINARIES):
        raise ValueError("FIPS build provenance has incomplete binaries")
    if any(not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value)
           for value in binaries.values()):
        raise ValueError("FIPS build provenance has invalid binary checksums")
    if current:
        context = current_context()
        for key, value in context.items():
            if record[key] != value:
                raise ValueError(f"FIPS build provenance is stale: {key}")
    if binary_dir is not None:
        for name in BINARIES:
            if binaries[name] != digest(binary_dir / name):
                raise ValueError(f"FIPS binary changed after cross-build: {name}")
    if payload is not None:
        for name in BINARIES:
            if payload.get(f"usr/bin/{name}") != binaries[name]:
                raise ValueError(f"FIPS package differs from cross-build: {name}")


def verify_binary_dir(binary_dir: Path) -> dict:
    path = binary_dir / "build.json"
    if path.is_symlink() or not path.is_file():
        raise ValueError("Pinned FIPS build stamp missing; run make openwrt-build")
    try:
        stamp = json.loads(path.read_text())
    except json.JSONDecodeError as error:
        raise ValueError("Pinned FIPS build stamp is malformed") from error
    verify_record(stamp, binary_dir=binary_dir)
    return stamp


def emit(binary_dir: Path) -> None:
    require_pinned_toolchain()
    stamp = record_for_bins(binary_dir)
    path = binary_dir / "build.json"
    path.write_text(json.dumps(stamp, indent=2, sort_keys=True) + "\n")
    verify_binary_dir(binary_dir)
    print("stamped pinned ARM64 build")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary_dir", type=Path)
    parser.add_argument("--emit", action="store_true")
    args = parser.parse_args()
    if args.emit:
        emit(args.binary_dir)
    else:
        verify_binary_dir(args.binary_dir)
        print("verified pinned ARM64 build")
