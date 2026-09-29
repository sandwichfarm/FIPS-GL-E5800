#!/usr/bin/env python3
"""Restart one local FIPS node and prove identity and mesh reconnection."""

from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ["docker", "compose", "-f", str(ROOT / "dev/lab/compose.yml")]


def run(*args):
    result = subprocess.run([*COMPOSE, *args], cwd=ROOT, check=False,
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"docker compose {args[0]} failed")
    return result.stdout.strip()


def identity():
    return run("exec", "-T", "node-b", "python3", "/workspace/dev/lab/health.py",
               "/state/b/control.sock", "--field", "npub")


def main():
    before = identity()
    if not before.startswith("npub1"):
        raise SystemExit("Node B has no valid public identity")
    # A SIGKILL models sudden process loss and tests recovery from persisted state.
    run("kill", "-s", "KILL", "node-b")
    run("up", "-d", "--wait", "node-b")
    after = identity()
    if after != before:
        raise SystemExit("FIPS identity changed after node crash")
    result = run("exec", "-T", "node-a", "python3", "/workspace/dev/lab/integration.py")
    print(result)
    print("Node B kept identity and reconnected after crash")


if __name__ == "__main__":
    main()
