#!/usr/bin/env python3
"""Assemble an offline, private recovery kit from reviewed local artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

import yaml

from ipk import inspect
from backup_bundle import verify_encrypted
from verify_artifacts import ARTIFACTS, EXPECTED, ROOT, verify as verify_artifact
from verify_recovery_kit import verify


COPIES = (
    "ansible/ansible.cfg",
    "ansible/deploy.yml",
    "ansible/confirm.yml",
    "ansible/inspect.yml",
    "ansible/inspect-dependencies.yml",
    "ansible/restore.yml",
    "ansible/stage_previous.yml",
    "ansible/inventory/router.yml",
    "ansible/vars/defaults.yml",
    "docs/recovery.md",
    "docs/firmware.md",
    "packaging/recovery/guard.sh",
    "packaging/recovery/health.sh",
    "packaging/recovery/apply-initial.sh",
    "packaging/recovery/fips-recovery.init",
    "packaging/device-ui/control/postinst",
    "packaging/device-ui/control/prerm",
    "tools/ipk.py",
    "tools/vendor_pillow.py",
    "tools/build_provenance.py",
    "tools/backup_bundle.py",
    "tools/capture_backup.py",
    "tools/stage_backup.py",
    "tools/render_backup_restore.py",
    "tools/stage_previous.py",
    "tools/verify_recovery_kit.py",
    "upstream/sources.json",
    "upstream/targets.json",
    "upstream/vendor/pillow.json",
    "upstream/vendor/python3-pillow_9.5.0-2_aarch64_cortex-a53.ipk",
)


def verified_copy(source: Path, destination: Path) -> str:
    if source.is_symlink() or not source.is_file():
        raise ValueError(f"Missing or linked kit input: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    destination.chmod(0o600)
    return hashlib.sha256(destination.read_bytes()).hexdigest()


def build(profile_path: Path, encrypted_backup: Path, kit_id: str,
          identity_path: Path | None = None) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", kit_id):
        raise ValueError("Invalid kit ID")
    if encrypted_backup.is_symlink() or not encrypted_backup.is_file():
        raise ValueError("Encrypted backup is missing or linked")
    with encrypted_backup.open("rb") as ciphertext:
        backup_header = ciphertext.read(22)
    if encrypted_backup.suffix != ".age" or backup_header != b"age-encryption.org/v1\n":
        raise ValueError("Provide an age-formatted identity/configuration backup")
    profile = yaml.safe_load(profile_path.read_text())
    if not isinstance(profile, dict) or not profile.get("approved_profiles") or not profile.get("restore_components"):
        raise ValueError("A reviewed profile is required")
    if "recovery_backup" in profile:
        recovery = profile["recovery_backup"]
        if not isinstance(recovery, dict) or not recovery.get("path") or not recovery.get("identity"):
            raise ValueError("Recovery backup profile must include encrypted backup and age identity paths")
        selected_backup = Path(recovery["path"])
        if not selected_backup.is_absolute():
            selected_backup = ROOT / selected_backup
        if selected_backup.resolve() != encrypted_backup.resolve():
            raise ValueError("Recovery profile backup differs from kit backup")
        if identity_path is None or Path(recovery["identity"]).resolve() != identity_path.resolve():
            raise ValueError("Recovery profile identity differs from kit identity")
        if "fips" not in profile["restore_components"] or "initial_fips_settings" in profile:
            raise ValueError("Recovery identity restore requires selected FIPS without initial settings")
    if identity_path is None:
        if profile.get("check_only_fixture") is not True:
            raise ValueError("An age identity is required to verify a real recovery backup")
    else:
        verify_encrypted(encrypted_backup, identity_path,
                         "recovery_backup" in profile or "fips" in profile.get("known_good_artifacts", {}))
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
            verify_artifact(component, announce=False)
            filename = EXPECTED[component]
            source = ARTIFACTS / filename
            manifest = json.loads((ARTIFACTS / (filename + ".json")).read_text())
            selected = profile["package_artifacts"][component]
            if Path(selected["path"]).resolve() != source.resolve() or selected["sha256"] != manifest["sha256"]:
                raise ValueError(f"Candidate not pinned to current build: {component}")
            inspect(source, manifest["sha256"], component, candidate=True)
            for file in (source, ARTIFACTS / (filename + ".json")):
                records[f"candidate/{file.name}"] = verified_copy(file, output / "candidate" / file.name)
            profile["package_artifacts"][component]["path"] = f"candidate/{filename}"
        for component, item in profile.get("known_good_artifacts", {}).items():
            source = Path(item["path"])
            inspect(source, item["sha256"], component)
            records[f"previous/{component}.ipk"] = verified_copy(source, output / "previous" / (component + ".ipk"))
            item["path"] = f"previous/{component}.ipk"
        records["private/identity-config-backup.age"] = verified_copy(
            encrypted_backup, output / "private/identity-config-backup.age"
        )
        if "recovery_backup" in profile:
            profile["recovery_backup"]["path"] = "private/identity-config-backup.age"
        kit_profile = output / "private/deploy.yml"
        kit_profile.write_text(yaml.safe_dump(profile, sort_keys=True))
        kit_profile.chmod(0o600)
        records["private/deploy.yml"] = hashlib.sha256(kit_profile.read_bytes()).hexdigest()
        manifest_path = output / "manifest.json"
        manifest_path.write_text(json.dumps({"kit_id": kit_id, "sha256": records}, indent=2, sort_keys=True) + "\n")
        manifest_path.chmod(0o600)
        verify(output, identity_path)
        return output
    except Exception:
        shutil.rmtree(output)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--encrypted-backup", type=Path, required=True)
    parser.add_argument("--identity", type=Path, help="Private age identity used only to verify decryption")
    parser.add_argument("--kit-id", required=True)
    args = parser.parse_args()
    print(build(args.profile, args.encrypted_backup, args.kit_id, args.identity))


if __name__ == "__main__":
    main()
