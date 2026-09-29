#!/usr/bin/env python3
"""Query a FIPS control socket without exposing unrestricted daemon data."""

import argparse
import json
import socket


def query(path, command="show_status"):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(2)
        connection.connect(path)
        connection.sendall(json.dumps({"command": command}).encode() + b"\n")
        response = bytearray()
        while len(response) < 262144:
            byte = connection.recv(1)
            if not byte:
                break
            response.extend(byte)
            if byte == b"\n":
                break
    if not response.endswith(b"\n"):
        raise ValueError("Incomplete FIPS response")
    result = json.loads(response)
    if result.get("status") != "ok" or not isinstance(result.get("data"), dict):
        raise ValueError("FIPS query failed")
    return result["data"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("socket")
    parser.add_argument("--field", choices=("npub", "ipv6_addr", "peer_count", "link_count"))
    args = parser.parse_args()
    data = query(args.socket)
    if args.field:
        print(data[args.field])
