#!/usr/bin/env python3
"""Ensure an offline reviewed deployment profile pins this build's exact IPKs."""

import argparse
import json
from pathlib import Path

from verify_artifacts import ARTIFACTS, EXPECTED


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", type=Path)
    args = parser.parse_args()
    try:
        import yaml
    except ImportError as error:
        raise SystemExit("PyYAML is required on the trusted deployment runner") from error
    profile = yaml.safe_load(args.profile.read_text())
    for component in profile["restore_components"]:
        expected = ARTIFACTS / EXPECTED[component]
        artifact = profile["package_artifacts"][component]
        manifest = json.loads((ARTIFACTS / (EXPECTED[component] + ".json")).read_text())
        if Path(artifact["path"]).resolve() != expected.resolve() or artifact["sha256"] != manifest["sha256"]:
            raise ValueError(f"Profile does not pin the current build: {component}")
    if not profile.get("approved_profiles"):
        raise ValueError("No reviewed firmware profile")
    if not profile.get("recovery_probe_ip") or not profile.get("recovery_probe_name"):
        raise ValueError("Missing independent connectivity probes")
    print("Deployment profile matches locally built candidate artifacts")


if __name__ == "__main__":
    main()
