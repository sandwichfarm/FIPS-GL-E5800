#!/usr/bin/env python3
"""Ensure an offline reviewed deployment profile pins this build's exact IPKs."""

import argparse
import json
from pathlib import Path

from verify_artifacts import ARTIFACTS, EXPECTED, verify
from backup_bundle import read_encrypted, require_enabled_fips, validate_gateway_ipv6_probe
from offline_runtime import verify as verify_offline_runtime


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", type=Path)
    args = parser.parse_args()
    try:
        import yaml
    except ImportError as error:
        raise SystemExit("PyYAML is required on the trusted deployment runner") from error
    profile = yaml.safe_load(args.profile.read_text())
    if "device_ui" in profile["restore_components"]:
        verify_offline_runtime()
    for component in profile["restore_components"]:
        verify(component, announce=False)
        expected = ARTIFACTS / EXPECTED[component]
        artifact = profile["package_artifacts"][component]
        manifest = json.loads((ARTIFACTS / (EXPECTED[component] + ".json")).read_text())
        if Path(artifact["path"]).resolve() != expected.resolve() or artifact["sha256"] != manifest["sha256"]:
            raise ValueError(f"Profile does not pin the current build: {component}")
    target = json.loads((Path(__file__).resolve().parents[1] / "upstream/targets.json").read_text())
    expected_profile = {key: target[key] for key in ("firmware", "architecture", "app_sha256", "screen_sha256")}
    if expected_profile not in profile.get("approved_profiles", []):
        raise ValueError("No reviewed firmware profile matches the candidate target")
    if not profile.get("recovery_probe_ip") or not profile.get("recovery_probe_name"):
        raise ValueError("Missing independent connectivity probes")
    if "initial_fips_settings" in profile:
        settings = profile["initial_fips_settings"]
        if ("fips" not in profile["restore_components"] or not isinstance(settings, dict)
                or settings.get("enabled") is not True or not isinstance(settings.get("peers"), list)
                or not settings["peers"]):
            raise ValueError("Initial FIPS settings need an enabled selected package and at least one peer")
        validate_gateway_ipv6_probe(
            {"etc/fips/router/settings.json": json.dumps(settings).encode()},
            profile.get("recovery_probe_ipv6", ""),
        )
    if "recovery_backup" in profile:
        recovery = profile["recovery_backup"]
        if (not isinstance(recovery, dict) or "fips" not in profile["restore_components"]
                or "initial_fips_settings" in profile or not recovery.get("path")
                or not recovery.get("identity")):
            raise ValueError("Recovery backup requires FIPS and a separate age identity")
        files = read_encrypted(Path(recovery["path"]), Path(recovery["identity"]), True)
        require_enabled_fips(files)
        validate_gateway_ipv6_probe(files, profile.get("recovery_probe_ipv6", ""))
    print("Deployment profile matches locally built candidate artifacts")


if __name__ == "__main__":
    main()
