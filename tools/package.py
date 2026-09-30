#!/usr/bin/env python3
"""Build deterministic OpenWrt IPKs from pinned local sources and built outputs."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import tarfile


ROOT = Path(__file__).resolve().parent.parent
VERSIONS = {
    "fips": ("fips", "0.5.2-1", "aarch64_cortex-a53"),
    "web_ui": ("gl-sdk4-ui-fips", "0.1.0-1", "all"),
    "device_ui": ("gl-e5800-dashboard", "3.2.1-1", "all"),
}


@dataclass(frozen=True)
class Entry:
    source: Path
    mode: int


def checked_file(path: Path) -> bytes:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Missing or linked package input: {path}")
    return path.read_bytes()


def add(tree: dict[str, Entry], name: str, source: Path, mode: int) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_./+@-]+", name) or name.startswith("/") or ".." in Path(name).parts:
        raise ValueError(f"Unsafe payload name: {name}")
    if name in tree:
        raise ValueError(f"Duplicate payload name: {name}")
    checked_file(source)
    tree[name] = Entry(source, mode)


def payload(component: str, binary_dir: Path | None) -> dict[str, Entry]:
    tree: dict[str, Entry] = {}
    if component == "fips":
        if binary_dir is None:
            raise ValueError("--bin-dir is required for fips")
        for name in ("fips", "fipsctl", "fips-gateway", "fips-router-admin"):
            add(tree, f"usr/bin/{name}", binary_dir / name, 0o755)
        add(tree, "etc/init.d/fips", ROOT / "packaging/fips/files/etc/init.d/fips", 0o755)
        add(tree, "etc/init.d/fips-gateway", ROOT / "packaging/fips/files/etc/init.d/fips-gateway", 0o755)
        add(tree, "lib/upgrade/keep.d/fips", ROOT / "packaging/fips/files/lib/upgrade/keep.d/fips", 0o644)
    elif component == "web_ui":
        base = ROOT / "packaging/web-ui/files"
        for source in sorted(base.rglob("*")):
            if source.is_file():
                relative = source.relative_to(base).as_posix()
                add(tree, relative, source, 0o755 if "/cgi-bin/" in f"/{relative}" else 0o644)
        add(tree, "www/views/gl-sdk4-ui-fips.common.js.gz", ROOT / "apps/web-ui/dist/gl-sdk4-ui-fips.common.js", 0o644)
    elif component == "device_ui":
        source_root = ROOT / "components/device-ui"
        for source in sorted((source_root / "src").iterdir()):
            if source.suffix in (".py", ".sh"):
                add(tree, f"root/dashboard/{source.name}", source, 0o755)
        for name in ("citydash", "homebutton"):
            add(tree, f"etc/init.d/{name}", source_root / "init.d" / name, 0o755)
        overlay = ROOT / "packaging/device-ui/files"
        if overlay.exists():
            for source in sorted(overlay.rglob("*")):
                if source.is_file():
                    relative = source.relative_to(overlay).as_posix()
                    tree[relative] = Entry(source, 0o755 if source.suffix in (".py", ".sh") else 0o644)
    else:
        raise ValueError(f"Unsupported component: {component}")
    return tree


def tar_gzip(files: dict[str, tuple[bytes, int]], epoch: int,
             order: list[str] | None = None) -> bytes:
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        directories = {"/".join(name.split("/")[:index]) for name in files for index in range(1, len(name.split("/")))}
        for name in sorted(directories):
            info = tarfile.TarInfo(name + "/")
            info.type = tarfile.DIRTYPE
            info.mode = 0o755
            info.uid = info.gid = 0
            info.uname = info.gname = "root"
            info.mtime = epoch
            archive.addfile(info)
        for name in (order if order is not None else sorted(files)):
            data, mode = files[name]
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = mode
            info.uid = info.gid = 0
            info.uname = info.gname = "root"
            info.mtime = epoch
            archive.addfile(info, io.BytesIO(data))
    compressed = io.BytesIO()
    with gzip.GzipFile(filename="", fileobj=compressed, mode="wb", mtime=epoch, compresslevel=9) as zipped:
        zipped.write(raw.getvalue())
    return compressed.getvalue()


def gzip_bytes(data: bytes, epoch: int) -> bytes:
    output = io.BytesIO()
    with gzip.GzipFile(filename="", fileobj=output, mode="wb", mtime=epoch, compresslevel=9) as zipped:
        zipped.write(data)
    return output.getvalue()


def build(component: str, binary_dir: Path | None, epoch: int) -> tuple[str, bytes, dict]:
    if epoch < 0:
        raise ValueError("SOURCE_DATE_EPOCH must be nonnegative")
    package, version, architecture = VERSIONS[component]
    entries = payload(component, binary_dir)
    files = {name: (checked_file(entry.source), entry.mode) for name, entry in entries.items()}
    build_stamp = None
    if component == "fips":
        from build_provenance import verify_binary_dir
        build_stamp = verify_binary_dir(binary_dir)
    if component == "web_ui":
        name = "www/views/gl-sdk4-ui-fips.common.js.gz"
        data, mode = files[name]
        files[name] = (gzip_bytes(data, epoch), mode)
    if component == "device_ui":
        sys.path.insert(0, str(ROOT / "dev"))
        from device_ui_patch import render
        name = "root/dashboard/dashboard.py"
        _, mode = files[name]
        files[name] = (render().encode(), mode)
    dependencies = {
        "fips": "kmod-tun, ip-full",
        "web_ui": "fips",
        "device_ui": "python3, python3-numpy, python3-pillow, libtiff6, zoneinfo-europe, zoneinfo-asia, zoneinfo-america, zoneinfo-australia-nz, zoneinfo-pacific",
    }[component]
    control = (f"Package: {package}\nVersion: {version}\nArchitecture: {architecture}\n"
               "Maintainer: GL-E5800 local integration\nSection: net\nPriority: optional\n"
               f"Depends: {dependencies}\nDescription: GL-E5800 FIPS integration\n").encode()
    metadata: dict[str, tuple[bytes, int]] = {"control": (control, 0o644)}
    if component == "device_ui":
        for name in ("postinst", "prerm"):
            metadata[name] = (checked_file(ROOT / "packaging/device-ui/control" / name), 0o755)
    data_blob = tar_gzip(files, epoch)
    control_blob = tar_gzip(metadata, epoch)
    outer = tar_gzip({"debian-binary": (b"2.0\n", 0o644),
                      "control.tar.gz": (control_blob, 0o644),
                      "data.tar.gz": (data_blob, 0o644)}, epoch,
                     ["debian-binary", "data.tar.gz", "control.tar.gz"])
    manifest = {"component": component, "package": package, "version": version,
                "architecture": architecture, "sha256": hashlib.sha256(outer).hexdigest(),
                "payload": {name: hashlib.sha256(data).hexdigest() for name, (data, _) in sorted(files.items())},
                "source": next(source for source in json.loads((ROOT / "upstream/sources.json").read_text())["sources"]
                               if source["path"] == {"fips": "components/fips", "web_ui": "components/web-ui",
                                                      "device_ui": "components/device-ui"}[component]),
                "target_device": json.loads((ROOT / "upstream/targets.json").read_text()),
                "source_date_epoch": epoch,
                "toolchain": {"fips": "Rust 1.94.1, Zig 0.13.0, cargo-zigbuild 0.19.8",
                              "web_ui": "Node.js 22.16.0, npm lockfile",
                              "device_ui": "Python 3.9+ deterministic tar builder"}[component]}
    if build_stamp is not None:
        manifest["build_provenance"] = build_stamp
    return f"{package}_{version}_{architecture}.ipk", outer, manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", choices=VERSIONS)
    parser.add_argument("--bin-dir", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts")
    parser.add_argument("--epoch", type=int, default=1788220800, help="pinned UTC build timestamp")
    args = parser.parse_args()
    try:
        name, blob, manifest = build(args.component, args.bin_dir, args.epoch)
    except (ValueError, FileNotFoundError) as error:
        parser.exit(2, f"package: {error}\n")
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / name).write_bytes(blob)
    (args.output / f"{name}.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"path": str(args.output / name), **{k: manifest[k] for k in ("sha256", "version", "architecture")}}))


if __name__ == "__main__":
    main()
