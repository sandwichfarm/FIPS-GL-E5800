#!/usr/bin/env python3
"""Check all locally built IPKs against their emitted provenance manifests."""

import json
from pathlib import Path

from ipk import inspect


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
EXPECTED = {
    "fips": "fips_0.5.2-1_aarch64_cortex-a53.ipk",
    "web_ui": "gl-sdk4-ui-fips_0.1.0-1_all.ipk",
    "device_ui": "gl-e5800-dashboard_3.2.1-1_all.ipk",
}


def main() -> None:
    for component, filename in EXPECTED.items():
        package = ARTIFACTS / filename
        manifest = json.loads((ARTIFACTS / (filename + ".json")).read_text())
        info, _ = inspect(package, manifest["sha256"], component)
        if info["version"] != manifest["version"] or info["package"] != manifest["package"]:
            raise ValueError(f"Manifest disagrees with package: {filename}")
        for check in info["checks"]:
            digest, path = check.split(None, 1)
            if manifest["payload"].get(path.lstrip("/")) != digest:
                raise ValueError(f"Payload digest disagrees with manifest: {path}")
        print(f"{component}: {manifest['sha256']}")


if __name__ == "__main__":
    main()
