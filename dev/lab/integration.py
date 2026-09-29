#!/usr/bin/env python3
"""Assert two real FIPS processes connect through separate container networks."""

import ipaddress
import subprocess
import time

from health import query


def main():
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            a = query("/state/a/control.sock")
            b = query("/state/b/control.sock")
            if int(a["peer_count"]) >= 1 and int(b["peer_count"]) >= 1 and int(a["link_count"]) >= 1 and int(b["link_count"]) >= 1:
                break
        except (OSError, KeyError, ValueError):
            pass
        time.sleep(1)
    else:
        raise SystemExit("FIPS peers did not establish links within 45 seconds")
    destination = str(ipaddress.IPv6Address(b["ipv6_addr"]))
    if not destination.startswith("fd"):
        raise SystemExit("Peer address is not a FIPS ULA")
    subprocess.run(["ip", "link", "show", "fips0"], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["ping", "-6", "-c", "2", "-W", "3", destination], check=True)
    print("Two FIPS nodes linked; IPv6 mesh ping passed")


if __name__ == "__main__":
    main()
