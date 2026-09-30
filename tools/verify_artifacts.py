#!/usr/bin/env python3
"""Check all locally built IPKs against their emitted provenance manifests."""

import argparse
import json
from pathlib import Path

from ipk import inspect


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
EXPECTED = {
    "fips": "fips_0.5.2-1_aarch64_cortex-a53.ipk",
    "web_ui": "gl-sdk4-ui-fips_0.1.0-1_all.ipk",
    "device_ui": "gl-e5800-dashboard_3.2.1-2_aarch64_cortex-a53.ipk",
}


def verify(component=None, announce=True) -> None:
    sources = {
        item["path"]: item
        for item in json.loads((ROOT / "upstream/sources.json").read_text())["sources"]
    }
    target = json.loads((ROOT / "upstream/targets.json").read_text())
    if target.get("status") != "candidate_unverified":
        raise ValueError("Target profile must remain unverified before hardware acceptance")
    source_paths = {
        "fips": "components/fips",
        "web_ui": "components/web-ui",
        "device_ui": "components/device-ui",
    }
    for selected, filename in EXPECTED.items():
        if component and selected != component:
            continue
        package = ARTIFACTS / filename
        manifest = json.loads((ARTIFACTS / (filename + ".json")).read_text())
        info, _ = inspect(package, manifest["sha256"], selected, candidate=True)
        if (info["version"] != manifest["version"] or info["package"] != manifest["package"]
                or info["architecture"] != manifest["architecture"]):
            raise ValueError(f"Manifest disagrees with package: {filename}")
        if manifest.get("source") != sources[source_paths[selected]]:
            raise ValueError(f"Artifact source record is stale: {filename}")
        if manifest.get("target_device") != target:
            raise ValueError(f"Artifact target profile is stale: {filename}")
        actual_payload = {}
        for check in info["checks"]:
            digest, path = check.split(None, 1)
            actual_payload[path.lstrip("/")] = digest
        if actual_payload != manifest["payload"]:
            raise ValueError(f"Payload digest disagrees with manifest: {filename}")
        if selected == "fips":
            from build_provenance import verify_record
            verify_record(manifest.get("build_provenance"), actual_payload)
        if selected == "device_ui":
            from vendor_pillow import payload as vendor_pillow_payload
            from offline_runtime import manifest as runtime_manifest, check_candidate_dependencies
            _, record = vendor_pillow_payload()
            if manifest.get("bundled_dependency") != record:
                raise ValueError("Bundled Pillow source record is stale")
            check_candidate_dependencies(info["depends"], runtime_manifest())
        if announce:
            print(f"{selected}: {manifest['sha256']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--component", choices=EXPECTED)
    args = parser.parse_args()
    verify(args.component)


if __name__ == "__main__":
    main()
