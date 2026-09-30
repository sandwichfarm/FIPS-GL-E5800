#!/usr/bin/env python3
"""Emit a deterministic compatibility record and checksums for verified IPKs."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from verify_artifacts import ARTIFACTS, EXPECTED, ROOT, verify


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def collect(artifact_dir: Path, target: dict) -> tuple[dict, dict[str, str]]:
    components = {}
    checksums = {}
    for component, filename in sorted(EXPECTED.items()):
        package = artifact_dir / filename
        provenance = artifact_dir / f"{filename}.json"
        record = json.loads(provenance.read_text())
        if record["component"] != component or record["target_device"] != target:
            raise ValueError(f"Inconsistent component or target: {filename}")
        if digest(package) != record["sha256"]:
            raise ValueError(f"Package checksum changed: {filename}")
        source = record["source"]
        components[component] = {
            "file": filename,
            "package": record["package"],
            "version": record["version"],
            "architecture": record["architecture"],
            "sha256": record["sha256"],
            "provenance_file": provenance.name,
            "provenance_sha256": digest(provenance),
            "upstream": {
                "url": source["url"], "ref": source["ref"],
                "commit": source["commit"], "tree_sha256": source["tree_sha256"],
            },
        }
        checksums[filename] = record["sha256"]
        checksums[provenance.name] = digest(provenance)
    return {"schema": 1, "target": target, "components": components}, checksums


def emit() -> None:
    # Candidate validation, including FIPS build provenance, must pass before
    # this summary can be published as a release artifact.
    verify(announce=False)
    target = json.loads((ROOT / "upstream/targets.json").read_text())
    compatibility, checksums = collect(ARTIFACTS, target)
    compatibility_path = ARTIFACTS / "compatibility.json"
    compatibility_path.write_text(json.dumps(compatibility, indent=2, sort_keys=True) + "\n")
    checksums[compatibility_path.name] = digest(compatibility_path)
    (ARTIFACTS / "checksums.sha256").write_text(
        "".join(f"{checksum}  {name}\n" for name, checksum in sorted(checksums.items()))
    )
    print(f"Wrote {compatibility_path} and {ARTIFACTS / 'checksums.sha256'}")


if __name__ == "__main__":
    try:
        emit()
    except (ValueError, FileNotFoundError, KeyError) as error:
        raise SystemExit(f"compatibility: {error}") from error
