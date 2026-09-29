#!/usr/bin/env python3
"""Copy stock /rom UI files over SSH without writing to the router."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
PATHS = (
    "www", "usr/share/oui/menu.d", "etc/gl_screen", "usr/bin/gl_screen",
    "usr/bin/screen_boot", "usr/bin/screen_disp_switch", "etc/init.d/gl_screen",
    "usr/lib/oui-httpd", "usr/share/gl-validator.d", "lib/preinit/02_screen_boot",
    "etc/glversion", "etc/openwrt_release",
)


def inspect(archive, output):
    """Extract only regular files/directories, never archive links or device nodes."""
    root = output / "rootfs"
    root.mkdir(parents=True, exist_ok=True)
    manifest = []
    with tarfile.open(archive, "r:gz") as bundle:
        for entry in bundle:
            path = PurePosixPath(entry.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Unsafe archive path: " + entry.name)
            record = {"path": str(path), "size": entry.size}
            if entry.isfile():
                data = bundle.extractfile(entry).read()
                dest = root / str(path)
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
                record["sha256"] = hashlib.sha256(data).hexdigest()
                if str(path).endswith((".js.gz", ".css.gz")):
                    readable = output / "inspection" / str(path)[:-3]
                    readable.parent.mkdir(parents=True, exist_ok=True)
                    readable.write_bytes(gzip.decompress(data))
            elif entry.issym() or entry.islnk():
                record["link_not_extracted"] = entry.linkname
            manifest.append(record)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    app = sorted((root / "www/js").glob("app.*.js.gz"))
    profile = {
        "firmware": (root / "etc/glversion").read_text().strip(),
        "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "screen_sha256": hashlib.sha256((root / "usr/bin/gl_screen").read_bytes()).hexdigest(),
        "app_sha256": hashlib.sha256(app[0].read_bytes()).hexdigest() if len(app) == 1 else None,
        "source_maps": [r["path"] for r in manifest if r["path"].endswith((".map", ".map.gz"))],
        "status": "observed-only; not runtime compatibility approval",
    }
    (output / "profile.json").write_text(json.dumps(profile, indent=2) + "\n")
    print(json.dumps(profile, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="root@192.168.8.1")
    parser.add_argument("--label", required=True)
    parser.add_argument("--archive", type=Path, help="Inspect an existing local capture")
    args = parser.parse_args()
    if not args.label or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for c in args.label) or args.label in (".", ".."):
        parser.error("label must be a simple directory name")
    if args.host.startswith("-"):
        parser.error("invalid SSH host")
    output = ROOT / "private/device" / args.label
    archive = args.archive
    if archive is None:
        if output.exists():
            parser.error("capture label already exists; use a new label")
        output.mkdir(parents=True, mode=0o700)
        archive = output / "stock-ui.tar.gz"
        # /rom excludes mutable user settings and generated QR images.
        with archive.open("wb") as stream:
            subprocess.run(["ssh", "-T", "-o", "ConnectTimeout=8", args.host,
                            "tar -czf - -C /rom " + " ".join(PATHS)],
                           stdout=stream, check=True)
    output.mkdir(parents=True, exist_ok=True)
    inspect(archive, output)


if __name__ == "__main__":
    main()
