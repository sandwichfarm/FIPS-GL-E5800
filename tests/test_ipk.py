import hashlib
import importlib.util
import io
import os
import shutil
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("ipk", Path(__file__).resolve().parents[1] / "tools/ipk.py")
ipk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ipk)


def archive(files):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as tar:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            tar.addfile(entry, io.BytesIO(data))
    return stream.getvalue()


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def package(self, name="fips", arch="aarch64_cortex-a53", payload="usr/bin/fips"):
        control = f"Package: {name}\nVersion: v0.5.2\nArchitecture: {arch}\n".encode()
        blob = archive({"./debian-binary": b"2.0\n", "./control.tar.gz": archive({
            "./control": control, "./conffiles": b"/etc/fips/fips.yaml\n"}),
            "./data.tar.gz": archive({payload: b"binary", "etc/fips/fips.yaml": b"config",
                                        "etc/uci-defaults/90-fips-setup": b"setup"})})
        path = self.root / "test.ipk"
        path.write_bytes(blob)
        return path, hashlib.sha256(blob).hexdigest()

    def test_metadata_and_mutable_files(self):
        path, digest = self.package()
        info, _ = ipk.inspect(path, digest, "fips")
        self.assertEqual(info["package"], "fips")
        self.assertEqual(len(info["checks"]), 1)
        self.assertTrue(info["checks"][0].endswith("/usr/bin/fips"))

    def test_tampered_download_rejected(self):
        path, digest = self.package()
        path.write_bytes(path.read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            ipk.inspect(path, digest, "fips")

    def test_vendor_package_rejected(self):
        path, digest = self.package(name="gl-sdk4-ui-core")
        with self.assertRaisesRegex(ValueError, "not allowed"):
            ipk.inspect(path, digest, "web_ui")

    def test_wrong_architecture_rejected(self):
        path, digest = self.package(arch="x86_64")
        with self.assertRaisesRegex(ValueError, "architecture"):
            ipk.inspect(path, digest, "fips")

    def test_path_traversal_rejected(self):
        path, digest = self.package(payload="../../etc/passwd")
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            ipk.inspect(path, digest, "fips")

    def run_installer(self, installed, drift=False, user_installed=False, openssl_only=False):
        path, digest = self.package()
        info, blob = ipk.inspect(path, digest, "fips")
        script = self.root / "installer.sh"
        script.write_text(ipk.render(info, blob))
        subprocess.run(["sh", "-n", str(script)], check=True)
        # Fake package manager and checksum verifier keep this entirely local;
        # assert that installed/unchanged, absent, and drift take distinct paths.
        bindir = self.root / "bin"
        bindir.mkdir()
        state = self.root / "installed"
        if installed:
            state.touch()
        (bindir / "opkg").write_text("""#!/bin/sh
if [ "$1" = status ]; then
  if [ -f "$TEST_STATE" ]; then
    printf 'Version: v0.5.2\nStatus: install %s installed\n' "$TEST_FLAG"
  fi
else
  cmp "$2" "$TEST_PACKAGE" || exit 9
  echo "$*" >> "$TEST_LOG"
  touch "$TEST_STATE"
fi
""")
        (bindir / "sha256sum").write_text("#!/bin/sh\nexit " + ("1" if drift else "0") + "\n")
        for tool in bindir.iterdir():
            tool.chmod(0o755)
        search_path = str(bindir) + ":" + os.environ["PATH"]
        if openssl_only:
            for command in ("mktemp", "rm", "cat", "sed", "awk", "cmp", "touch", "openssl"):
                (bindir / command).symlink_to(shutil.which(command))
            search_path = str(bindir)
        env = dict(os.environ, PATH=search_path,
                   TEST_STATE=str(state), TEST_LOG=str(self.root / "install.log"),
                   TEST_PACKAGE=str(path),
                   TEST_FLAG="user" if user_installed else "ok")
        result = subprocess.run(["/bin/sh", str(script)], env=env, text=True, capture_output=True)
        return result, self.root / "install.log"

    def test_unchanged_does_not_install(self):
        result, log = self.run_installer(installed=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("STACK_UNCHANGED", result.stdout)
        self.assertFalse(log.exists())

    def test_missing_package_installs_once(self):
        result, log = self.run_installer(installed=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("STACK_CHANGED", result.stdout)
        self.assertEqual(len(log.read_text().splitlines()), 1)

    def test_openwrt_user_installed_is_unchanged(self):
        result, log = self.run_installer(installed=True, user_installed=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("STACK_UNCHANGED", result.stdout)
        self.assertFalse(log.exists())

    def test_openssl_only_router_decodes_original_package(self):
        result, log = self.run_installer(installed=False, openssl_only=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("STACK_CHANGED", result.stdout)
        self.assertTrue(log.exists())

    def test_drift_does_not_force_reinstall(self):
        result, log = self.run_installer(installed=True, drift=True)
        self.assertEqual(result.returncode, 3)
        self.assertFalse(log.exists())


if __name__ == "__main__":
    unittest.main()
