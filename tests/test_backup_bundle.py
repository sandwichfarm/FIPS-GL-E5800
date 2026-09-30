"""Check private backup archive safety and the encrypted round trip when age exists."""

from __future__ import annotations

import base64
import io
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from tools.backup_bundle import (inspect_plain, read_plain, require_enabled_fips,
                                 validate_gateway_ipv6_probe, verify_encrypted)
from tools.capture_backup import ROOT as REPOSITORY_ROOT, capture, capture_received
from tools.stage_backup import stage


CONFIG = {
    "etc/config/network": b"config interface 'lan'\n",
    "etc/config/firewall": b"config defaults\n",
    "etc/config/dhcp": b"config dhcp 'lan'\n",
}
IDENTITY = {
    "etc/fips/fips.key": b"synthetic-secret-for-test-only",
    "etc/fips/fips.yaml": b"synthetic daemon configuration",
    "etc/fips/router/settings.json": b'{"enabled":true}',
    "etc/fips/router/mesh.nft": b"table inet fips {}",
}


def archive(files: dict[str, bytes], extra: tarfile.TarInfo | None = None) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as bundle:
        for name, data in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            member.mode = 0o600
            bundle.addfile(member, io.BytesIO(data))
        if extra is not None:
            bundle.addfile(extra)
    return output.getvalue()


class BackupBundleTests(unittest.TestCase):
    def test_config_and_identity_requirements(self) -> None:
        self.assertEqual(inspect_plain(io.BytesIO(archive(CONFIG)), False), set(CONFIG))
        complete_uci = CONFIG | {"etc/config/wireless": b"config wifi-device 'radio0'\n",
                                 "etc/config/vpn": b"config vpn 'main'\n"}
        self.assertEqual(inspect_plain(io.BytesIO(archive(complete_uci)), False), set(complete_uci))
        self.assertEqual(read_plain(io.BytesIO(archive(CONFIG | IDENTITY)), True), CONFIG | IDENTITY)
        require_enabled_fips(IDENTITY)
        validate_gateway_ipv6_probe(IDENTITY, "")
        gateway = IDENTITY | {"etc/fips/router/settings.json":
                              b'{"enabled":true,"gateway_enabled":true}'}
        validate_gateway_ipv6_probe(gateway, "")
        with self.assertRaisesRegex(ValueError, "public address"):
            validate_gateway_ipv6_probe(gateway, "fd01::1")
        validate_gateway_ipv6_probe(gateway, "2606:4700:4700::1111")
        with self.assertRaisesRegex(ValueError, "must be enabled"):
            require_enabled_fips(IDENTITY | {"etc/fips/router/settings.json": b'{"enabled":false}'})
        self.assertEqual(read_plain(io.BytesIO(archive(CONFIG | {"etc/fips/optional.flag": b""})), False),
                         CONFIG | {"etc/fips/optional.flag": b""})
        with self.assertRaisesRegex(ValueError, "missing required"):
            inspect_plain(io.BytesIO(archive(CONFIG)), True)
        self.assertEqual(inspect_plain(io.BytesIO(archive(CONFIG | IDENTITY)), True),
                         set(CONFIG | IDENTITY))

    def test_rejects_links_and_unexpected_paths(self) -> None:
        link = tarfile.TarInfo("etc/fips/fips.key")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/shadow"
        with self.assertRaisesRegex(ValueError, "link or special"):
            inspect_plain(io.BytesIO(archive(CONFIG, link)), False)
        for path in ("../etc/config/network", "etc/passwd"):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "Unsafe|unexpected"):
                inspect_plain(io.BytesIO(archive(CONFIG | {path: b"unsafe"})), False)

    def test_private_restore_staging_preserves_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary) / "private"
            parent.mkdir(mode=0o700)
            destination = parent / "restored"
            with patch("tools.stage_backup.read_encrypted", return_value=CONFIG | IDENTITY):
                digests = stage(Path("unused.age"), Path("unused-key"), destination, True)
                self.assertEqual(set(digests), set(CONFIG | IDENTITY))
                for name, data in (CONFIG | IDENTITY).items():
                    self.assertEqual((destination / name).read_bytes(), data)
                    self.assertEqual((destination / name).stat().st_mode & 0o777, 0o600)
                with self.assertRaisesRegex(ValueError, "must be new"):
                    stage(Path("unused.age"), Path("unused-key"), destination, True)
                parent.chmod(0o755)
                with self.assertRaisesRegex(ValueError, "private directory"):
                    stage(Path("unused.age"), Path("unused-key"), parent / "unsafe", True)

    @unittest.skipUnless(shutil.which("age") and shutil.which("age-keygen"), "age CLI unavailable")
    def test_real_age_encryption_and_decryption(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            identity = root / "identity.txt"
            subprocess.run(["age-keygen", "-o", str(identity)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            recipient = subprocess.check_output(["age-keygen", "-y", str(identity)], text=True).strip()
            plaintext = root / "backup.tar.gz"
            plaintext.write_bytes(archive(CONFIG | IDENTITY))
            encrypted = root / "backup.age"
            subprocess.run(["age", "-r", recipient, "-o", str(encrypted), str(plaintext)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.assertEqual(verify_encrypted(encrypted, identity, True), set(CONFIG | IDENTITY))
            fake_bin = root / "fake-bin"
            fake_bin.mkdir()
            fake_ssh = fake_bin / "ssh"
            fake_ssh.write_text('#!/bin/sh\ncat "$FIPS_FAKE_BACKUP"\n')
            fake_ssh.chmod(0o755)
            output_dir = root / "output"
            output_dir.mkdir(mode=0o700)
            captured = output_dir / "router-backup.age"
            with patch.dict(os.environ, {
                "PATH": f"{fake_bin}:{os.environ['PATH']}",
                "FIPS_FAKE_BACKUP": str(plaintext),
            }):
                self.assertEqual(capture("root@synthetic", recipient, identity, captured, True), captured)
            self.assertEqual(verify_encrypted(captured, identity, True), set(CONFIG | IDENTITY))
            restored = output_dir / "restored"
            digests = stage(captured, identity, restored, True)
            self.assertEqual(set(digests), set(CONFIG | IDENTITY))
            for name, data in (CONFIG | IDENTITY).items():
                self.assertEqual((restored / name).read_bytes(), data)
                self.assertEqual((restored / name).stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(ValueError, "must be new"):
                stage(captured, identity, restored, True)

    @unittest.skipUnless(shutil.which("age") and shutil.which("age-keygen"), "age CLI unavailable")
    def test_ansible_stream_creates_verified_private_backup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            identity = root / "identity.txt"
            subprocess.run(["age-keygen", "-o", str(identity)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            recipient = subprocess.check_output(["age-keygen", "-y", str(identity)], text=True).strip()
            destination = root / "private/predeploy/tx1.age"
            files = CONFIG | {"etc/config/wireless": b"config wifi-device 'radio0'\n"} | IDENTITY
            streamed = b"FIPS_PRESENT=1\n" + base64.b64encode(archive(files)) + b"\n"
            self.assertEqual(capture_received(streamed, recipient, identity, destination), destination)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            self.assertEqual(destination.parent.stat().st_mode & 0o777, 0o700)
            self.assertEqual(verify_encrypted(destination, identity, True), set(files))
            with self.assertRaisesRegex(ValueError, "Choose a new"):
                capture_received(streamed, recipient, identity, destination)
            with self.assertRaisesRegex(ValueError, "marker differs"):
                capture_received(streamed.replace(b"FIPS_PRESENT=1", b"FIPS_PRESENT=0"),
                                 recipient, identity, root / "private/predeploy/tx2.age")
            self.assertFalse((root / "private/predeploy/tx2.age").exists())
            identity.chmod(0o644)
            with self.assertRaisesRegex(ValueError, "identity file must be private"):
                capture_received(streamed, recipient, identity,
                                 root / "private/predeploy/tx3.age")
            identity.chmod(0o600)
            with self.assertRaisesRegex(ValueError, "ignored private"):
                capture_received(streamed, recipient, identity,
                                 REPOSITORY_ROOT / "docs/unsafe-backup.age")

    def test_encrypted_capture_precedes_any_persistent_router_write(self) -> None:
        import yaml
        play = yaml.safe_load((Path(__file__).resolve().parents[1] / "ansible/deploy.yml").read_text())[0]
        tasks = play["tasks"]
        backup = next(index for index, task in enumerate(tasks)
                      if task["name"].startswith("Read the current router configuration"))
        deployment = next(index for index, task in enumerate(tasks)
                          if task["name"].startswith("Install with a router-local"))
        self.assertLess(backup, deployment)
        self.assertTrue(all(task.get("no_log") is True for task in tasks[backup]["block"]))

    @unittest.skipUnless(shutil.which("openssl"), "OpenSSL unavailable")
    def test_first_install_capture_reads_all_uci_files_without_fips_identity(self) -> None:
        import yaml
        play = yaml.safe_load((Path(__file__).resolve().parents[1] / "ansible/deploy.yml").read_text())[0]
        block = next(task["block"] for task in play["tasks"]
                     if task["name"].startswith("Read the current router configuration"))
        script = block[0]["ansible.builtin.raw"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, content in (CONFIG | {"etc/config/wireless": b"wifi settings\n"}).items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            script = script.replace("mktemp /tmp/fips-predeploy.XXXXXX",
                                    f"mktemp {shlex.quote(str(root / 'fips-predeploy.XXXXXX'))}")
            script = script.replace("/etc/fips", shlex.quote(str(root / "etc/fips")))
            script = script.replace("/root/dashboard/config.json",
                                    shlex.quote(str(root / "root/dashboard/config.json")))
            script = script.replace('tar -czf "$archive" -C / "$@"',
                                    f'tar -czf "$archive" -C {shlex.quote(str(root))} "$@"')
            process = subprocess.run(["sh", "-c", script], capture_output=True, check=True,
                                     env=os.environ | {"COPYFILE_DISABLE": "1"})
            marker, encoded = process.stdout.split(b"\n", 1)
            self.assertEqual(marker, b"FIPS_PRESENT=0")
            self.assertEqual(read_plain(io.BytesIO(base64.b64decode(encoded)), False),
                             CONFIG | {"etc/config/wireless": b"wifi settings\n"})
            self.assertEqual(list(root.glob("fips-predeploy.*")), [])


if __name__ == "__main__":
    unittest.main()
