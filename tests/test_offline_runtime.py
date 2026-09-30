"""Verify the offline feed bundle before it can reach a router transaction."""

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import offline_runtime


def archive(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as tar:
        for name, content in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(content)
            tar.addfile(entry, io.BytesIO(content))
    return output.getvalue()


def fixture(root):
    (root / "upstream/vendor").mkdir(parents=True)
    (root / "upstream/targets.json").write_text(json.dumps({"firmware": "4.10.0"}))
    runtime = root / "runtime"
    runtime.mkdir()
    packages = []
    for name, depends in (("python3-light", ""), ("python3-numpy", "python3-light")):
        filename = f"{name}_1-1_aarch64_cortex-a53.ipk"
        control = (f"Package: {name}\nVersion: 1-1\nArchitecture: aarch64_cortex-a53\n"
                   f"License: MIT\nSource: fixture/{name}\nDepends: {depends}\n").encode()
        blob = archive({"./debian-binary": b"2.0\n",
                        "./control.tar.gz": archive({"./control": control}),
                        "./data.tar.gz": archive({f"./usr/share/{name}.txt": b"payload"})})
        (runtime / filename).write_bytes(blob)
        packages.append({"name": name, "version": "1-1", "architecture": "aarch64_cortex-a53",
                         "feed": "packages", "filename": filename, "sha256": hashlib.sha256(blob).hexdigest(),
                         "size": len(blob), "license": "MIT", "source": f"fixture/{name}",
                         "license_files": "", "depends": depends})
    record = {"schema": 1, "target_firmware": "4.10.0", "feeds": {
        "packages": {"url": "https://example.invalid/Packages.gz", "sha256": "0" * 64}},
        "baseline_packages": [], "baseline_provides": {}, "packages": packages,
        "roots": ["python3-numpy"], "install_order": ["python3-light", "python3-numpy"],
        "remove_order": ["python3-numpy", "python3-light"]}
    (root / "upstream/vendor/runtime.json").write_text(json.dumps(record))
    return record


class OfflineRuntimeTests(unittest.TestCase):
    def test_installer_is_verified_and_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture(root)
            offline_runtime.check_candidate_dependencies(
                "gl-sdk4-screen-large (= 1), python3-numpy", offline_runtime.manifest(root))
            with self.assertRaisesRegex(ValueError, "differ"):
                offline_runtime.check_candidate_dependencies("python3-light", offline_runtime.manifest(root))
            script = root / "install.sh"
            script.write_text(offline_runtime.render(root))
            subprocess.run(["sh", "-n", str(script)], check=True)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            opkg = fake_bin / "opkg"
            opkg.write_text("""#!/bin/sh
case "$1" in
  status)
    if grep -qx "$2" "$RUNTIME_STATE"; then
      printf 'Package: %s\nVersion: 1-1\nStatus: install user installed\n' "$2"
    fi
    ;;
  install)
    shift
    for path in "$@"; do
      name=$(basename "$path" | cut -d_ -f1)
      echo "$name" >> "$RUNTIME_STATE"
    done
    ;;
  *) exit 2;;
esac
""")
            opkg.chmod(0o755)
            state = root / "installed"
            state.touch()
            env = os.environ | {"PATH": str(fake_bin) + ":" + os.environ["PATH"],
                                "RUNTIME_STATE": str(state)}
            first = subprocess.run(["sh", str(script)], env=env, text=True, capture_output=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertIn("RUNTIME_CHANGED", first.stdout)
            self.assertIn("RUNTIME_READY", first.stdout)
            self.assertEqual(state.read_text().splitlines(), ["python3-light", "python3-numpy"])
            second = subprocess.run(["sh", str(script)], env=env, text=True, capture_output=True)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertIn("RUNTIME_UNCHANGED", second.stdout)
            self.assertEqual(state.read_text().splitlines(), ["python3-light", "python3-numpy"])

    def test_tampered_ipk_and_incomplete_dependency_closure_fail(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            record = fixture(root)
            path = root / "runtime" / record["packages"][0]["filename"]
            path.write_bytes(path.read_bytes() + b"tampered")
            with self.assertRaisesRegex(ValueError, "checksum or size"):
                offline_runtime.verify(root)
            record["packages"][1]["depends"] = "missing-package"
            (root / "upstream/vendor/runtime.json").write_text(json.dumps(record))
            with self.assertRaisesRegex(ValueError, "closure"):
                offline_runtime.manifest(root)

    def test_manifest_rejects_shell_metacharacters_before_rendering(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            record = fixture(root)
            record["packages"][0]["version"] = "1';touch /tmp/unsafe;#"
            (root / "upstream/vendor/runtime.json").write_text(json.dumps(record))
            with self.assertRaisesRegex(ValueError, "Invalid pinned runtime package"):
                offline_runtime.render(root)


if __name__ == "__main__":
    unittest.main()
