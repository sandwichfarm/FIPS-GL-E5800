#!/usr/bin/env python3
"""Fail CI for accidentally tracked private router state or obvious credentials."""

from pathlib import Path
import re
import subprocess
import sys


FORBIDDEN_PATH = re.compile(r"(^|/)(private|id_ed25519|id_rsa)(/|$)|\.(pem|key|p12)$")
VENDORED_EXAMPLE_ENV = {
    "components/fips/examples/sidecar-nostr-mixnet-relay/.env",
    "components/fips/examples/sidecar-nostr-relay/.env",
    "components/fips/testing/sidecar/.env",
    "components/fips/testing/static/.env",
}
FORBIDDEN_TEXT = re.compile(
    rb"-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----"
    rb"|\bAKIA[0-9A-Z]{16}\b"
    rb"|\bgh[pousr]_[A-Za-z0-9_]{36,}\b"
)


def scan() -> list[str]:
    tracked = subprocess.check_output(["git", "ls-files", "-z"]).split(b"\0")
    findings = []
    for encoded in filter(None, tracked):
        path = Path(encoded.decode())
        if FORBIDDEN_PATH.search(path.as_posix()) or (path.name == ".env" and path.as_posix() not in VENDORED_EXAMPLE_ENV):
            findings.append(f"forbidden tracked path: {path}")
            continue
        if path.is_file() and FORBIDDEN_TEXT.search(path.read_bytes()):
            findings.append(f"possible credential in: {path}")
    return findings


if __name__ == "__main__":
    problems = scan()
    for problem in problems:
        print(problem, file=sys.stderr)
    sys.exit(bool(problems))
