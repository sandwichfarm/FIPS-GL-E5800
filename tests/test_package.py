import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import ipk
import package
import build_provenance


def elf_fixture(name):
    data = bytearray(120)
    data[:7] = b"\x7fELF\x02\x01\x01"
    struct.pack_into("<HHI", data, 16, 2, 183, 1)
    struct.pack_into("<Q", data, 32, 64)
    struct.pack_into("<HHH", data, 52, 64, 56, 1)
    struct.pack_into("<I", data, 64, 1)
    return bytes(data) + name.encode()


class DeterministicPackageTests(unittest.TestCase):
    def test_web_make_target_does_not_invalidate_arm64_build_recipe(self):
        makefile = (build_provenance.ROOT / "Makefile").read_text()
        original = build_provenance.build_recipe_digest(makefile)
        self.assertEqual(
            original,
            build_provenance.build_recipe_digest(makefile.replace("web-preview:", "web-preview-local:", 1)),
        )
        self.assertNotEqual(
            original,
            build_provenance.build_recipe_digest(makefile.replace("aarch64-unknown-linux-musl", "aarch64-unknown-linux-gnu", 1)),
        )
        self.assertNotEqual(
            original,
            build_provenance.build_recipe_digest(makefile.replace("BUILD_PLATFORM := linux/arm64", "BUILD_PLATFORM := linux/amd64", 1)),
        )

    def test_touchscreen_package_declares_all_runtime_dependencies(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            name, blob, manifest = package.build("device_ui", None, 1788220800)
            artifact = root / name
            artifact.write_bytes(blob)
            inspected, _ = ipk.inspect(artifact, manifest["sha256"], "device_ui", candidate=True)
            declared = set(inspected["depends"].split(", "))
            self.assertEqual(declared, {
                "gl-sdk4-screen-large (= git-2026.237.10575-dd8a031-1)",
                "python3", "python3-numpy", "libjpeg", "libtiff6", "zlib", "libwebp",
                "zoneinfo-europe", "zoneinfo-asia", "zoneinfo-america",
                "zoneinfo-australia-nz", "zoneinfo-pacific",
            })
            self.assertEqual(inspected["architecture"], "aarch64_cortex-a53")
            self.assertIn("root/dashboard/vendor/PIL/_imagingft.cpython-311-aarch64-linux-musl.so", manifest["payload"])

    def test_fips_package_repeats_and_preserves_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for binary in ("fips", "fipsctl", "fips-gateway", "fips-router-admin"):
                (root / binary).write_bytes(elf_fixture(binary))
            (root / "build.json").write_text(json.dumps(build_provenance.record_for_bins(root)))
            name, first, manifest = package.build("fips", root, 1788220800)
            self.assertEqual(first, package.build("fips", root, 1788220800)[1])
            self.assertEqual(manifest["sha256"], hashlib.sha256(first).hexdigest())
            artifact = root / name
            artifact.write_bytes(first)
            inspected, _ = ipk.inspect(artifact, manifest["sha256"], "fips", candidate=True)
            self.assertEqual(inspected["architecture"], "aarch64_cortex-a53")
            self.assertTrue(any(line.endswith("/usr/bin/fips-router-admin") for line in inspected["checks"]))
            self.assertIn("etc/init.d/fips-gateway", manifest["payload"])
            (root / "fips").write_bytes(elf_fixture("changed"))
            with self.assertRaisesRegex(ValueError, "changed after cross-build"):
                package.build("fips", root, 1788220800)

    def test_linked_binary_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for binary in ("fips", "fipsctl", "fips-gateway", "fips-router-admin"):
                (root / binary).write_bytes(b"fixture")
            (root / "fips").unlink()
            (root / "fips").symlink_to(root / "fipsctl")
            with self.assertRaisesRegex(ValueError, "linked"):
                package.build("fips", root, 1788220800)

    def test_stale_source_stamp_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for binary in ("fips", "fipsctl", "fips-gateway", "fips-router-admin"):
                (root / binary).write_bytes(elf_fixture(binary))
            stamp = build_provenance.record_for_bins(root)
            stamp["admin_tree_sha256"] = "0" * 64
            (root / "build.json").write_text(json.dumps(stamp))
            with self.assertRaisesRegex(ValueError, "stale: admin_tree_sha256"):
                package.build("fips", root, 1788220800)

    def test_other_builder_architecture_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for binary in ("fips", "fipsctl", "fips-gateway", "fips-router-admin"):
                (root / binary).write_bytes(elf_fixture(binary))
            stamp = build_provenance.record_for_bins(root)
            stamp["builder_arch"] = "x86_64"
            (root / "build.json").write_text(json.dumps(stamp))
            with self.assertRaisesRegex(ValueError, "unsupported builder"):
                package.build("fips", root, 1788220800)

    def test_prior_provenance_is_readable_only_offline(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for binary in ("fips", "fipsctl", "fips-gateway", "fips-router-admin"):
                (root / binary).write_bytes(elf_fixture(binary))
            stamp = build_provenance.record_for_bins(root)
            stamp["schema"] = 2
            del stamp["builder_arch"]
            build_provenance.verify_record(stamp, binary_dir=root, current=False)
            (root / "build.json").write_text(json.dumps(stamp))
            with self.assertRaisesRegex(ValueError, "Missing or malformed"):
                package.build("fips", root, 1788220800)


if __name__ == "__main__":
    unittest.main()
