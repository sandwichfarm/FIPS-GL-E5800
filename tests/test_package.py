import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import ipk
import package


class DeterministicPackageTests(unittest.TestCase):
    def test_fips_package_repeats_and_preserves_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for binary in ("fips", "fipsctl", "fips-gateway", "fips-router-admin"):
                (root / binary).write_bytes((binary + "-fixture").encode())
            name, first, manifest = package.build("fips", root, 1788220800)
            self.assertEqual(first, package.build("fips", root, 1788220800)[1])
            self.assertEqual(manifest["sha256"], hashlib.sha256(first).hexdigest())
            artifact = root / name
            artifact.write_bytes(first)
            inspected, _ = ipk.inspect(artifact, manifest["sha256"], "fips")
            self.assertEqual(inspected["architecture"], "aarch64_cortex-a53")
            self.assertTrue(any(line.endswith("/usr/bin/fips-router-admin") for line in inspected["checks"]))
            (root / "fips").write_bytes(b"changed")
            self.assertNotEqual(first, package.build("fips", root, 1788220800)[1])

    def test_linked_binary_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for binary in ("fips", "fipsctl", "fips-gateway", "fips-router-admin"):
                (root / binary).write_bytes(b"fixture")
            (root / "fips").unlink()
            (root / "fips").symlink_to(root / "fipsctl")
            with self.assertRaisesRegex(ValueError, "linked"):
                package.build("fips", root, 1788220800)


if __name__ == "__main__":
    unittest.main()
