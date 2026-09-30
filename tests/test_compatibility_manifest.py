import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import compatibility_manifest as manifest_tool  # noqa: E402
from verify_artifacts import EXPECTED  # noqa: E402


class CompatibilityManifestTests(unittest.TestCase):
    def test_links_every_candidate_and_its_provenance_to_one_target(self):
        target = {"model": "GL-E5800", "firmware": "4.10.0", "status": "candidate_unverified"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for component, filename in EXPECTED.items():
                data = f"{component}-candidate".encode()
                (root / filename).write_bytes(data)
                (root / f"{filename}.json").write_text(json.dumps({
                    "component": component,
                    "target_device": target,
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "package": component,
                    "version": "1.2.3-1",
                    "architecture": "all",
                    "source": {"url": "https://example.invalid/source", "ref": "v1",
                               "commit": "a" * 40, "tree_sha256": "b" * 64},
                }))
            manifest, checksums = manifest_tool.collect(root, target)
            self.assertEqual(manifest["target"], target)
            self.assertEqual(set(manifest["components"]), set(EXPECTED))
            self.assertEqual(len(checksums), 2 * len(EXPECTED))
            for component, filename in EXPECTED.items():
                entry = manifest["components"][component]
                self.assertEqual(entry["file"], filename)
                self.assertEqual(entry["version"], "1.2.3-1")
                self.assertEqual(entry["upstream"]["commit"], "a" * 40)
                self.assertEqual(entry["sha256"], checksums[filename])
                self.assertEqual(entry["provenance_sha256"], checksums[f"{filename}.json"])

            (root / EXPECTED["web_ui"]).write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "Package checksum changed"):
                manifest_tool.collect(root, target)

            (root / EXPECTED["web_ui"]).write_bytes(b"web_ui-candidate")
            (root / "upstream").mkdir()
            (root / "upstream/targets.json").write_text(json.dumps(target))
            with patch.object(manifest_tool, "ARTIFACTS", root), patch.object(manifest_tool, "ROOT", root):
                with patch.object(manifest_tool, "verify", side_effect=ValueError("stale candidate")):
                    with self.assertRaisesRegex(ValueError, "stale candidate"):
                        manifest_tool.emit()
                self.assertFalse((root / "compatibility.json").exists())
                with patch.object(manifest_tool, "verify") as verifier:
                    manifest_tool.emit()
                    verifier.assert_called_once_with(announce=False)
            self.assertEqual(json.loads((root / "compatibility.json").read_text()), manifest)
            for line in (root / "checksums.sha256").read_text().splitlines():
                checksum, name = line.split("  ", 1)
                self.assertEqual(checksum, hashlib.sha256((root / name).read_bytes()).hexdigest())

    def test_rejects_a_component_with_a_different_target(self):
        target = {"model": "GL-E5800"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            component, filename = next(iter(sorted(EXPECTED.items())))
            (root / filename).write_bytes(b"candidate")
            (root / f"{filename}.json").write_text(json.dumps({
                "component": component, "target_device": {"model": "other"},
            }))
            with self.assertRaisesRegex(ValueError, "Inconsistent component or target"):
                manifest_tool.collect(root, target)


if __name__ == "__main__":
    unittest.main()
