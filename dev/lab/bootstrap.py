#!/usr/bin/env python3
"""Create private, persistent lab identities and reciprocal peer configs."""

import json
import os
from pathlib import Path
import subprocess


ROOT = Path("/state")
KEYGEN = Path("/workspace/components/fips/target/release/fipsctl")


def ensure_identity(name):
    directory = ROOT / name
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    if not (directory / "fips.key").exists():
        subprocess.run([str(KEYGEN), "keygen", "--dir", str(directory)], check=True)
    public = (directory / "fips.pub").read_text().strip()
    if not public.startswith("npub1"):
        raise ValueError("Invalid lab identity")
    return public


def write_config(name, peer, peer_name):
    directory = ROOT / name
    config = {
        "node": {"identity": {"persistent": True},
                 "control": {"socket_path": str(directory / "control.sock")}},
        "tun": {"enabled": True, "name": "fips0", "mtu": 1280},
        "dns": {"enabled": False},
        "transports": {"udp": {"bind_addr": "0.0.0.0:2121"}},
        "peers": [{"npub": peer, "addresses": [{"transport": "udp", "addr": f"{peer_name}:2121"}],
                   "connect_policy": "auto_connect"}],
    }
    path = directory / "fips.yaml"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(config, sort_keys=True) + "\n")
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    settings = {"enabled": True, "udp_port": 2121, "tcp_port": 8443,
                "gateway_enabled": False, "peers": [{"npub": peer,
                "transport": "udp", "address": f"{peer_name}:2121"}],
                "mesh_tcp_ports": [], "mesh_udp_ports": []}
    router = directory / "router"
    router.mkdir(mode=0o700, exist_ok=True)
    os.chmod(router, 0o700)
    settings_path = router / "settings.json"
    if not settings_path.exists():
        settings_path.write_text(json.dumps(settings, sort_keys=True) + "\n")
        os.chmod(settings_path, 0o600)


def main():
    a = ensure_identity("a")
    b = ensure_identity("b")
    write_config("a", b, "node-b")
    write_config("b", a, "node-a")
    print("Lab identities and peer configs ready")


if __name__ == "__main__":
    main()
