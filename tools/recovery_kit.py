#!/usr/bin/env python3
"""Assemble an offline, private recovery kit from reviewed local artifacts."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

import yaml

from ipk import inspect
from verify_artifacts import ARTIFACTS, EXPECTED, ROOT


COPIES = (
    "ansible/ansible.cfg",
    "ansible/deploy.yml",
    "ansible/stage_previous.yml",
    "ansible/inventory/router.yml",
    "ansible/vars/defaults.yml",
    "docs/recovery.md",
    "docs/firmware.md",
    "packaging/recovery/guard.sh",
    "packaging/recovery/fips-recovery.init",
    "tools/ipk.py",
    "tools/stage_previous.py",
    "upstream/sources.json",
)


def verified_copy(source: Path, destination: Path) -> str:
    if source.is_symlink() or not source.is_file():
        raise ValueError(f"Missing or linked kit input: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    destination.chmod(0o600)
    return hashlib.sha256(destination.read_bytes()).hexdigest()


def build(profile_path: Path, encrypted_backup: Path, kit_id: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", kit_id):
        raise ValueError("Invalid kit ID")
    if encrypted_backup.is_symlink() or not encrypted_backup.is_file():
        raise ValueError("Encrypted backup is missing or linked")
    if encrypted_backup.suffix != ".age" or not encrypted_backup.read_bytes().startswith(b"age-encryption.org/v1\n"):
        raise ValueError("Provide an age-formatted identity/configuration backup")
    profile = yaml.safe_load(profile_path.read_text())
    if not profile.get("approved_profiles") or not profile.get("restore_components"):
        raise ValueError("A reviewed profile is required")
    parent = ROOT / "private/recovery-kits"
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent.chmod(0o700)
    output = parent / kit_id
    output.mkdir(mode=0o700, exist_ok=False)
    records = {}
    try:
        for relative in COPIES:
            records[relative] = verified_copy(ROOT / relative, output / relative)
        for source in sorted((ROOT / "ansible/roles").glob("*/tasks/*.yml")):
            relative = source.relative_to(ROOT).as_posix()
            records[relative] = verified_copy(source, output / relative)
        for component in profile["restore_components"]:
            filename = EXPECTED[component]
            source = ARTIFACTS / filename
            manifest = json.loads((ARTIFACTS / (filename + ".json")).read_text())
            selected = profile["package_artifacts"][component]
            if Path(selected["path"]).resolve() != source.resolve() or selected["sha256"] != manifest["sha256"]:
                raise ValueError(f"Candidate not pinned to current build: {component}")
            inspect(source, manifest["sha256"], component)
            for file in (source, ARTIFACTS / (filename + ".json")):
                records[f"candidate/{file.name}"] = verified_copy(file, output / "candidate" / file.name)
        for component, item in profile.get("known_good_artifacts", {}).items():
            source = Path(item["path"])
            inspect(source, item["sha256"], component)
            records[f"previous/{component}.ipk"] = verified_copy(source, output / "previous" / (component + ".ipk"))
        records["private/identity-config-backup.age"] = verified_copy(
            encrypted_backup, output / "private/identity-config-backup.age"
        )
        manifest_path = output / "manifest.json"
        manifest_path.write_text(json.dumps({"kit_id": kit_id, "sha256": records}, indent=2, sort_keys=True) + "\n")
        manifest_path.chmod(0o600)
        return output
    except Exception:
        shutil.rmtree(output)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--encrypted-backup", type=Path, required=True)
    parser.add_argument("--kit-id", required=True)
    args = parser.parse_args()
    print(build(args.profile, args.encrypted_backup, args.kit_id))


if __name__ == "__main__":
    main()
