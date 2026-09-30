#!/usr/bin/env python3
"""Exercise offline kit assembly, integrity checks, and Ansible syntax locally."""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile

import yaml


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from recovery_kit import build  # noqa: E402
from stage_backup import stage  # noqa: E402
from verify_artifacts import ARTIFACTS, EXPECTED  # noqa: E402
from verify_recovery_kit import verify  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--components", nargs="+", choices=EXPECTED, default=list(EXPECTED))
    parser.add_argument("--restore-identity", action="store_true",
                        help="exercise a post-firmware FIPS recovery profile (requires age)")
    args = parser.parse_args()
    components = list(dict.fromkeys(args.components))
    if args.restore_identity and ("fips" not in components or not shutil.which("age") or not shutil.which("age-keygen")):
        parser.error("--restore-identity requires FIPS and the age CLI")
    cache = ROOT / ".cache"
    cache.mkdir(exist_ok=True)
    kit_id = "synthetic_" + secrets.token_hex(6)
    kit = ROOT / "private/recovery-kits" / kit_id
    with tempfile.TemporaryDirectory(prefix="kit-smoke-", dir=cache) as temporary:
        temporary = Path(temporary)
        packages = {}
        for component in components:
            filename = EXPECTED[component]
            manifest = json.loads((ARTIFACTS / (filename + ".json")).read_text())
            packages[component] = {
                "path": str(ARTIFACTS / filename),
                "sha256": manifest["sha256"],
            }
        target = json.loads((ROOT / "upstream/targets.json").read_text())
        profile = {
            "approved_profiles": [{key: target[key] for key in ("firmware", "architecture", "app_sha256", "screen_sha256")}],
            "check_only_fixture": True,
            "restore_components": components,
            "package_artifacts": packages,
            "known_good_artifacts": {components[0]: dict(packages[components[0]])},
            "recovery_probe_ip": "1.1.1.1",
            "recovery_probe_name": "example.com",
        }
        if "fips" in components and not args.restore_identity:
            profile["initial_fips_settings"] = {
                "enabled": True,
                "udp_port": 2121,
                "tcp_port": 8443,
                "gateway_enabled": False,
                "peers": [{"npub": "synthetic-test-only", "transport": "udp", "address": "peer.example:2121"}],
                "mesh_tcp_ports": [],
                "mesh_udp_ports": [],
            }
        profile_path = temporary / "profile.yml"
        backup = temporary / "backup.age"
        identity_path = None
        if shutil.which("age") and shutil.which("age-keygen"):
            identity_path = temporary / "identity.txt"
            subprocess.run(["age-keygen", "-o", str(identity_path)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            recipient = subprocess.check_output(["age-keygen", "-y", str(identity_path)], text=True).strip()
            plaintext = temporary / "backup.tar.gz"
            expected_files = {
                    "etc/config/network": b"synthetic network",
                    "etc/config/firewall": b"synthetic firewall",
                    "etc/config/dhcp": b"synthetic dhcp",
                    "etc/fips/fips.key": b"synthetic identity",
                    "etc/fips/fips.yaml": b"synthetic daemon configuration",
                    "etc/fips/hosts": b"test npub1synthetic\n",
                    "etc/fips/router/settings.json": b'{"enabled":true}',
                    "etc/fips/router/mesh.nft": b"table inet fips {}",
            }
            with tarfile.open(plaintext, "w:gz") as archive:
                for name, data in expected_files.items():
                    member = tarfile.TarInfo(name)
                    member.size = len(data)
                    member.mode = 0o600
                    archive.addfile(member, io.BytesIO(data))
            subprocess.run(["age", "-r", recipient, "-o", str(backup), str(plaintext)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            backup.write_bytes(b"age-encryption.org/v1\nsynthetic-test-only\n")
        if args.restore_identity:
            profile["recovery_backup"] = {"path": str(backup), "identity": str(identity_path)}
        profile_path.write_text(yaml.safe_dump(profile))
        try:
            build(profile_path, backup, kit_id, identity_path)
            verify(kit, identity_path)
            relocated = temporary / "relocated" / kit_id
            relocated.parent.mkdir()
            shutil.copytree(kit, relocated)
            if "device_ui" in components:
                runtime_installer = temporary / "runtime-install.sh"
                subprocess.run([sys.executable, "tools/offline_runtime.py", "verify", "--root", "."],
                               cwd=relocated, check=True)
                subprocess.run([sys.executable, "tools/offline_runtime.py", "render", "--root", ".",
                                "--output", str(runtime_installer)], cwd=relocated, check=True)
                subprocess.run(["sh", "-n", str(runtime_installer)], check=True)
            controller_probe = relocated / "ansible/controller-path-probe.yml"
            controller_probe.write_text(
                "- hosts: localhost\n"
                "  connection: local\n"
                "  gather_facts: false\n"
                "  vars_files:\n"
                "    - vars/defaults.yml\n"
                "    - ../private/deploy.yml\n"
                "  tasks:\n"
                "    - ansible.builtin.include_role:\n"
                "        name: package_validate\n"
                "      loop: '{{ restore_components }}'\n"
                "      loop_control:\n"
                "        loop_var: stack_component\n"
            )
            probe_environment = os.environ | {
                "ANSIBLE_CONFIG": str(relocated / "ansible/ansible.cfg"),
                "ANSIBLE_LOCAL_TEMP": str(temporary / "ansible-tmp"),
                "ANSIBLE_REMOTE_TEMP": str(temporary / "ansible-remote"),
            }
            subprocess.run(
                ["ansible-playbook", "-i", "localhost,", "-c", "local", str(controller_probe)],
                cwd=temporary, env=probe_environment, check=True,
            )
            kit_verify = [sys.executable, "tools/verify_recovery_kit.py", "."]
            if identity_path is not None:
                kit_verify.extend(["--identity", str(identity_path)])
            subprocess.run(kit_verify, cwd=kit, check=True)
            for component in components:
                filename = EXPECTED[component]
                installer = temporary / f"{component}-install.sh"
                subprocess.run(
                    [sys.executable, "tools/ipk.py", f"candidate/{filename}",
                     "--sha256", packages[component]["sha256"],
                     "--component", component, "--candidate", "--render", str(installer)],
                    cwd=kit, check=True,
                )
                subprocess.run(["sh", "-n", str(installer)], check=True)
            if identity_path is not None:
                restored = temporary / "restored"
                stage(kit / "private/identity-config-backup.age", identity_path, restored, True)
                for name, data in expected_files.items():
                    assert (restored / name).read_bytes() == data
                if args.restore_identity:
                    private_scripts = temporary / "private-scripts"
                    private_scripts.mkdir(mode=0o700)
                    restore_script = private_scripts / "restore.sh"
                    subprocess.run(
                        [sys.executable, "tools/render_backup_restore.py",
                         "private/identity-config-backup.age", "--identity", str(identity_path),
                         "--transaction", "synthetic_kit", "--output", str(restore_script)],
                        cwd=kit, check=True,
                    )
                    subprocess.run(["sh", "-n", str(restore_script)], check=True)
            kit_profile = yaml.safe_load((kit / "private/deploy.yml").read_text())
            for component in components:
                assert kit_profile["package_artifacts"][component]["path"] == f"candidate/{EXPECTED[component]}"
            assert kit_profile["known_good_artifacts"][components[0]]["path"] == f"previous/{components[0]}.ipk"
            if "fips" in components:
                if args.restore_identity:
                    assert kit_profile["recovery_backup"]["path"] == "private/identity-config-backup.age"
                    assert kit_profile["recovery_backup"]["identity"] == str(identity_path)
                else:
                    assert kit_profile["initial_fips_settings"] == profile["initial_fips_settings"]
            candidate = kit / "candidate" / EXPECTED[components[0]]
            original = candidate.read_bytes()
            candidate.write_bytes(original + b"tampered")
            try:
                verify(kit, identity_path)
            except ValueError as error:
                assert "checksum mismatch" in str(error), error
            else:
                raise AssertionError("Tampered kit package was accepted")
            candidate.write_bytes(original)
            extra = kit / "unexpected.txt"
            extra.write_text("extra")
            try:
                verify(kit, identity_path)
            except ValueError as error:
                assert "unrecorded" in str(error), error
            else:
                raise AssertionError("Unrecorded kit file was accepted")
            extra.unlink()
            verify(kit, identity_path)
            required = kit / "tools/render_backup_restore.py"
            required_bytes = required.read_bytes()
            manifest_path = kit / "manifest.json"
            original_manifest = manifest_path.read_bytes()
            required.unlink()
            missing_manifest = json.loads(original_manifest)
            del missing_manifest["sha256"]["tools/render_backup_restore.py"]
            manifest_path.write_text(json.dumps(missing_manifest))
            try:
                verify(kit, identity_path)
            except ValueError as error:
                assert "omits required" in str(error), error
            else:
                raise AssertionError("Incomplete kit manifest was accepted")
            required.write_bytes(required_bytes)
            required.chmod(0o600)
            manifest_path.write_bytes(original_manifest)
            verify(kit, identity_path)
            environment = os.environ | {
                "ANSIBLE_CONFIG": "ansible/ansible.cfg",
                "ANSIBLE_LOCAL_TEMP": str(temporary / "ansible-tmp"),
            }
            subprocess.run(
                ["ansible-playbook", "ansible/deploy.yml", "--syntax-check"],
                cwd=kit, env=environment, check=True,
            )
            subprocess.run(
                ["ansible-playbook", "ansible/confirm.yml", "--syntax-check"],
                cwd=kit, env=environment, check=True,
            )
            print("offline kit smoke passed: " + ", ".join(components))
        finally:
            if kit.exists():
                manifest = json.loads((kit / "manifest.json").read_text())
                assert manifest["kit_id"] == kit_id
                shutil.rmtree(kit)


if __name__ == "__main__":
    main()
