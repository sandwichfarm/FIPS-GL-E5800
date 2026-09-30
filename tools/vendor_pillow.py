"""Read the checksum-pinned OpenWrt Pillow payload without its conflicting deps."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile


ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / "upstream/vendor/pillow.json"
IPK = ROOT / "upstream/vendor/python3-pillow_9.5.0-2_aarch64_cortex-a53.ipk"
SOURCE_PREFIX = "usr/lib/python3.11/site-packages/"
TARGET_PREFIX = "root/dashboard/vendor/"


def archive_members(data: bytes) -> dict[str, bytes]:
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for entry in archive:
            path = PurePosixPath(entry.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Unsafe Pillow archive path")
            name = str(path)
            if entry.isdir():
                continue
            if not entry.isfile() or name in files or entry.size > 10_000_000:
                raise ValueError("Unsupported or duplicate Pillow archive entry: " + name)
            files[name] = archive.extractfile(entry).read()
    return files


def payload() -> tuple[dict[str, tuple[bytes, int]], dict]:
    record = json.loads(RECORD.read_text())
    blob = IPK.read_bytes()
    if hashlib.sha256(blob).hexdigest() != record["sha256"]:
        raise ValueError("Pinned Pillow IPK checksum changed")
    outer = archive_members(blob)
    if set(outer) != {"debian-binary", "data.tar.gz", "control.tar.gz"}:
        raise ValueError("Unexpected Pillow IPK members")
    if outer["debian-binary"] != b"2.0\n":
        raise ValueError("Unsupported Pillow IPK format")
    control = archive_members(outer["control.tar.gz"])["control"].decode()
    fields = dict(line.split(": ", 1) for line in control.splitlines() if ": " in line and not line.startswith(" "))
    for key, expected in (("Package", record["package"]), ("Version", record["version"]),
                          ("Architecture", record["architecture"]), ("License", record["license"])):
        if fields.get(key) != expected:
            raise ValueError("Pinned Pillow metadata changed: " + key)
    source = archive_members(outer["data.tar.gz"])
    result = {}
    for name, data in source.items():
        if not name.startswith(SOURCE_PREFIX):
            raise ValueError("Pillow payload escaped site-packages: " + name)
        relative = name[len(SOURCE_PREFIX):]
        if not (relative.startswith("PIL/") or relative.startswith("Pillow-9.5.0.dist-info/")):
            raise ValueError("Unexpected Pillow site-packages path: " + name)
        result[TARGET_PREFIX + relative] = (data, 0o644)
    required = {
        TARGET_PREFIX + "PIL/__init__.pyc",
        TARGET_PREFIX + "PIL/_imaging.cpython-311-aarch64-linux-musl.so",
        TARGET_PREFIX + "PIL/_imagingft.cpython-311-aarch64-linux-musl.so",
        TARGET_PREFIX + "Pillow-9.5.0.dist-info/LICENSE",
    }
    if not required <= result.keys():
        raise ValueError("Pinned Pillow payload is incomplete")
    return result, record
