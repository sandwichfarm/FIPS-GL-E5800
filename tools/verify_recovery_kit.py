#!/usr/bin/env python3
"""Verify an offline recovery kit's files, profile, and IPK payloads."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

import yaml

from ipk import inspect
from build_provenance import verify_record
from backup_bundle import read_encrypted, validate_gateway_ipv6_probe
from offline_runtime import verify as verify_offline_runtime, check_candidate_dependencies


PACKAGES = {
    "fips": "fips_0.5.2-1_aarch64_cortex-a53.ipk",
    "web_ui": "gl-sdk4-ui-fips_0.1.0-1_all.ipk",
    "device_ui": "gl-e5800-dashboard_3.2.1-2_aarch64_cortex-a53.ipk",
}
SOURCES = {
    "fips": "components/fips",
    "web_ui": "components/web-ui",
    "device_ui": "components/device-ui",
}
REQUIRED_KIT_FILES = {
    "ansible/ansible.cfg", "ansible/deploy.yml", "ansible/confirm.yml",
    "ansible/inspect.yml", "ansible/inspect-dependencies.yml", "ansible/restore.yml",
    "ansible/inventory/router.yml",
    "ansible/stage_previous.yml", "ansible/vars/defaults.yml",
    "ansible/roles/device_ui/tasks/main.yml", "ansible/roles/fips/tasks/main.yml",
    "ansible/roles/offline_runtime/tasks/main.yml",
    "ansible/roles/package_restore/tasks/main.yml",
    "ansible/roles/package_validate/tasks/main.yml",
    "ansible/roles/preflight/tasks/main.yml",
    "ansible/roles/prerequisites/tasks/main.yml",
    "ansible/roles/web_ui/tasks/main.yml",
    "packaging/recovery/guard.sh", "packaging/recovery/health.sh",
    "packaging/recovery/apply-initial.sh", "packaging/recovery/cleanup-stock.sh",
    "packaging/recovery/cleanup-upgrade.sh",
    "packaging/recovery/fips-recovery.init",
    "packaging/device-ui/control/postinst", "packaging/device-ui/control/prerm",
    "tools/ipk.py", "tools/build_provenance.py", "tools/vendor_pillow.py", "tools/offline_runtime.py",
    "tools/backup_bundle.py", "tools/capture_backup.py", "tools/compare_backups.py",
    "tools/finalize_stock_rollback.py", "tools/finalize_upgrade_rollback.py",
    "tools/router_inventory.py", "tools/switch_mode.py", "tools/stage_backup.py",
    "tools/render_backup_restore.py", "private/deploy.yml",
    "private/identity-config-backup.age", "upstream/sources.json",
    "upstream/targets.json", "upstream/vendor/pillow.json", "upstream/vendor/runtime.json",
    "upstream/vendor/python3-pillow_9.5.0-2_aarch64_cortex-a53.ipk",
}


def verify(kit: Path, identity: Path | None = None) -> None:
    kit = kit.resolve()
    manifest = json.loads((kit / "manifest.json").read_text())
    if manifest.get("kit_id") != kit.name or not re.fullmatch(r"[A-Za-z0-9_-]+", kit.name):
        raise ValueError("Kit ID mismatch")
    records = manifest.get("sha256")
    if not isinstance(records, dict):
        raise ValueError("Kit manifest has no file records")
    if not REQUIRED_KIT_FILES.issubset(records):
        raise ValueError("Kit manifest omits required recovery files")
    seen = set()
    for relative, expected in records.items():
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts or not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise ValueError(f"Invalid kit file record: {relative}")
        source = kit / path
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"Missing or linked kit file: {relative}")
        if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Kit file checksum mismatch: {relative}")
        seen.add(path.as_posix())
    actual = {path.relative_to(kit).as_posix() for path in kit.rglob("*") if path.is_file() or path.is_symlink()}
    if actual != seen | {"manifest.json"}:
        raise ValueError("Kit contains missing or unrecorded files")
    backup = kit / "private/identity-config-backup.age"
    with backup.open("rb") as ciphertext:
        backup_header = ciphertext.read(22)
    if backup_header != b"age-encryption.org/v1\n":
        raise ValueError("Encrypted backup header is invalid")
    profile = yaml.safe_load((kit / "private/deploy.yml").read_text())
    if not isinstance(profile, dict) or not profile.get("approved_profiles"):
        raise ValueError("Reviewed deployment profile is missing")
    if profile.get("check_only_fixture") is not True:
        predeploy = profile.get("predeploy_backup")
        if (not isinstance(predeploy, dict)
                or not isinstance(predeploy.get("recipient"), str)
                or not re.fullmatch(r"age1[0-9a-z]+", predeploy["recipient"])
                or not isinstance(predeploy.get("identity"), str)
                or not Path(predeploy["identity"]).is_absolute()
                or not isinstance(predeploy.get("directory"), str)
                or not Path(predeploy["directory"]).is_absolute()
                or Path(predeploy["directory"]).resolve().is_relative_to(kit)):
            raise ValueError("Kit needs a private off-kit backup destination")
    decrypted = None
    if identity is None:
        if profile.get("check_only_fixture") is not True:
            raise ValueError("An age identity is required to verify the real recovery backup")
    else:
        decrypted = read_encrypted(backup, identity,
                                   "recovery_backup" in profile or "fips" in profile.get("known_good_artifacts", {}))
    selected = profile.get("restore_components")
    if not isinstance(selected, list) or not selected or len(set(selected)) != len(selected):
        raise ValueError("Invalid selected components")
    runtime_record = verify_offline_runtime(kit) if "device_ui" in selected else None
    if "recovery_backup" in profile:
        recovery = profile["recovery_backup"]
        if (not isinstance(recovery, dict) or recovery.get("path") != "private/identity-config-backup.age"
                or not recovery.get("identity") or "fips" not in selected
                or "initial_fips_settings" in profile):
            raise ValueError("Invalid kit-local recovery identity profile")
        if identity is not None and Path(recovery["identity"]).resolve() != identity.resolve():
            raise ValueError("Kit recovery identity differs from the supplied age identity")
        if decrypted is None:
            raise ValueError("Recovery identity must be decrypted to validate gateway probes")
        validate_gateway_ipv6_probe(decrypted, profile.get("recovery_probe_ipv6", ""))
    if "initial_fips_settings" in profile:
        settings = profile["initial_fips_settings"]
        if ("fips" not in selected or not isinstance(settings, dict)
                or settings.get("enabled") is not True or not isinstance(settings.get("peers"), list)
                or not settings["peers"]):
            raise ValueError("Initial FIPS settings need an enabled selected package and at least one peer")
        validate_gateway_ipv6_probe(
            {"etc/fips/router/settings.json": json.dumps(settings).encode()},
            profile.get("recovery_probe_ipv6", ""),
        )
    sources = {
        item["path"]: item
        for item in json.loads((kit / "upstream/sources.json").read_text())["sources"]
    }
    target = json.loads((kit / "upstream/targets.json").read_text())
    if target.get("status") != "candidate_unverified":
        raise ValueError("Kit target profile must remain unverified")
    expected_profile = {key: target[key] for key in ("firmware", "architecture", "app_sha256", "screen_sha256")}
    if expected_profile not in profile["approved_profiles"]:
        raise ValueError("Reviewed firmware profile differs from kit target")
    for component in selected:
        filename = PACKAGES[component]
        relative = f"candidate/{filename}"
        item = profile["package_artifacts"][component]
        if item["path"] != relative:
            raise ValueError(f"Candidate path is not kit-local: {component}")
        package_manifest = json.loads((kit / (relative + ".json")).read_text())
        if item["sha256"] != package_manifest["sha256"]:
            raise ValueError(f"Candidate digest differs from profile: {component}")
        if package_manifest.get("source") != sources[SOURCES[component]]:
            raise ValueError(f"Candidate source record differs from kit: {component}")
        if package_manifest.get("target_device") != target:
            raise ValueError(f"Candidate target profile differs from kit: {component}")
        info, _ = inspect(kit / relative, item["sha256"], component, candidate=True)
        if (info["package"] != package_manifest.get("package")
                or info["version"] != package_manifest.get("version")
                or info["architecture"] != package_manifest.get("architecture")):
            raise ValueError(f"Candidate metadata differs from kit manifest: {component}")
        payload = {path.lstrip("/"): digest for check in info["checks"] for digest, path in [check.split(None, 1)]}
        if payload != package_manifest["payload"]:
            raise ValueError(f"Candidate payload differs from manifest: {component}")
        if component == "fips":
            verify_record(package_manifest.get("build_provenance"), payload, current=False)
            if package_manifest["build_provenance"]["source"] != package_manifest["source"]:
                raise ValueError("FIPS build source differs from package source")
        if component == "device_ui":
            from vendor_pillow import payload as vendor_pillow_payload
            _, record = vendor_pillow_payload()
            if package_manifest.get("bundled_dependency") != record:
                raise ValueError("Dashboard bundled Pillow source differs from kit")
            check_candidate_dependencies(info["depends"], runtime_record)
    for component, item in profile.get("known_good_artifacts", {}).items():
        if component not in PACKAGES or item["path"] != f"previous/{component}.ipk":
            raise ValueError(f"Known-good path is not kit-local: {component}")
        inspect(kit / item["path"], item["sha256"], component)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kit", type=Path)
    parser.add_argument("--identity", type=Path)
    args = parser.parse_args()
    verify(args.kit, args.identity)
    print(f"verified {args.kit}")
