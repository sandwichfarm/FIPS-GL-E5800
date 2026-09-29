#!/usr/bin/env python3
"""Render a verified prior IPK into a Python-free router staging script."""

import argparse
import base64
from pathlib import Path
import re
import shlex

from ipk import inspect


def render(path: Path, sha256: str, component: str, transaction: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", transaction):
        raise ValueError("Unsafe transaction ID")
    info, blob = inspect(path, sha256, component)
    package = info["package"]
    destination = shlex.quote(f"/etc/fips-recovery/{transaction}/previous")
    checksum = shlex.quote(info["sha256"])
    version = shlex.quote(info["version"])
    return f"""#!/bin/sh
set -eu
umask 077
destination={destination}
mkdir -p "$destination"
chmod 0700 "$destination"
decode_base64() {{
    if command -v base64 >/dev/null 2>&1; then base64 -d; else openssl base64 -d; fi
}}
decode_base64 > "$destination/{package}.ipk.tmp" <<'FIPS_PRIOR_IPK'
{base64.encodebytes(blob).decode()}FIPS_PRIOR_IPK
echo {checksum}'  '"$destination/{package}.ipk.tmp" | sha256sum -c - >/dev/null
mv "$destination/{package}.ipk.tmp" "$destination/{package}.ipk"
printf '%s\\n' {checksum} > "$destination/{package}.sha256"
printf '%s\\n' {version} > "$destination/{package}.version"
sync
echo 'STAGED {package}'
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--component", choices=("fips", "web_ui", "device_ui"), required=True)
    parser.add_argument("--transaction", required=True)
    parser.add_argument("--render", type=Path, required=True)
    args = parser.parse_args()
    script = args.render
    script.write_text(render(args.path, args.sha256, args.component, args.transaction))
    script.chmod(0o700)


if __name__ == "__main__":
    main()
