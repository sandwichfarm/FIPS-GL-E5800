#!/usr/bin/env python3
"""Render the integrated FIPS panel without a physical touchscreen."""

import argparse
import importlib.util
import json
from pathlib import Path
import subprocess

from PIL import ImageFont


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--socket", type=Path)
    parser.add_argument("--state-dir", type=Path)
    args = parser.parse_args()
    project_root = Path(__file__).resolve().parents[2]
    source = project_root / ".cache/generated-device-ui/dashboard.py"
    spec = importlib.util.spec_from_file_location("dashboard", source)
    dashboard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dashboard)
    preview_font = next((path for path in (
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    ) if path.exists()), None)
    dashboard.font = lambda name, size: (ImageFont.truetype(str(preview_font), size)
                                         if preview_font else ImageFont.load_default(size=size))
    if args.socket:
        if not args.state_dir:
            parser.error("--state-dir is required with --socket")

        def request(operation, **fields):
            result = subprocess.run([
                str(project_root / "apps/router-admin/target/release/fips-router-admin"),
                "--state-dir", str(args.state_dir), "--socket", str(args.socket)],
                input=json.dumps({"operation": operation, **fields}), text=True,
                capture_output=True, timeout=4, check=False)
            body = json.loads(result.stdout)
            if body.get("status") != "ok":
                raise ValueError(body.get("error", "FIPS unavailable"))
            return body["data"]

        dashboard.fips_request = request
    args.output.parent.mkdir(parents=True, exist_ok=True)
    dashboard.panel_fips().save(args.output)
    print(args.output)


if __name__ == "__main__":
    main()
