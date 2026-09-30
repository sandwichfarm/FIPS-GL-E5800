#!/usr/bin/env python3
"""Exercise the native route advertiser against a real Linux IPv6 client.

Run only inside an isolated, privileged Docker container with --network none.
"""

import ipaddress
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path


NAMESPACE = "fips-ra-client"
ROUTE = "fd01::/112"
SOCKET = Path("/run/fips/gateway.sock")
BINARY = os.environ.get(
    "FIPS_RA_BINARY", "/workspace/apps/router-admin/target/release/fips-router-admin"
)


def run(*args, namespace=False):
    command = (["ip", "netns", "exec", NAMESPACE] if namespace else []) + list(args)
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout.strip()


def client_route(prefix):
    return run("ip", "-6", "route", "show", prefix, namespace=True)


def await_route(present, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        route = client_route(ROUTE)
        if bool(route) == present:
            return route
        time.sleep(0.1)
    raise AssertionError(f"route presence {present} timed out: {route!r}")


def send_solicitation():
    run("python3", __file__, "send-rs", namespace=True)


def start_observer():
    process = subprocess.Popen(
        ["ip", "netns", "exec", NAMESPACE, "python3", __file__, "observe-ra"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    time.sleep(0.1)
    return process


def finish_observer(process, lifetime, destination):
    output, error = process.communicate(timeout=10)
    assert process.returncode == 0, error
    observation = json.loads(output)
    packet = bytes.fromhex(observation["packet"])
    assert observation["source"] == "fe80::53", observation
    assert observation["hop_limit"] == 255, observation
    assert observation["destination"] == destination, observation
    assert packet[0:2] == bytes([134, 0]), observation
    assert int.from_bytes(packet[6:8], "big") == 0, "RA must not advertise a default router"
    assert packet[16:20] == bytes([24, 3, 112, 0]), observation
    assert int.from_bytes(packet[20:24], "big") == lifetime, observation
    assert packet[24:] == bytes.fromhex("fd010000000000000000000000000000"), observation


def socket_server(stop):
    with socket.socket(socket.AF_UNIX) as server:
        server.bind(str(SOCKET))
        server.listen(8)
        server.settimeout(0.2)
        while not stop.is_set():
            try:
                connection, _ = server.accept()
            except TimeoutError:
                continue
            connection.close()


def setup():
    run("ip", "netns", "add", NAMESPACE)
    run("ip", "link", "add", "br-lan", "type", "bridge")
    run("ip", "link", "add", "ra-router", "type", "veth", "peer", "name", "ra-client")
    run("ip", "link", "set", "ra-router", "master", "br-lan")
    run("ip", "link", "set", "ra-client", "netns", NAMESPACE)
    run("ip", "link", "set", "br-lan", "up")
    run("ip", "link", "set", "ra-router", "up")
    run("ip", "-6", "addr", "add", "fe80::1/64", "dev", "br-lan")
    run("ip", "-6", "addr", "add", "fe80::53/64", "dev", "br-lan")
    run("ip", "link", "set", "lo", "up", namespace=True)
    run("ip", "link", "set", "ra-client", "up", namespace=True)
    run("ip", "-6", "addr", "add", "fe80::2/64", "dev", "ra-client", namespace=True)
    run("sysctl", "-qw", "net.ipv6.conf.ra-client.accept_ra=2", namespace=True)
    run("ip", "-6", "route", "add", "default", "via", "fe80::1", "dev", "ra-client", namespace=True)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if "tentative" not in run("ip", "-6", "addr", "show", "dev", "br-lan"):
            return
        time.sleep(0.1)
    raise AssertionError("router link-local address did not finish DAD")


def cleanup(advertiser, stop, thread):
    if advertiser is not None and advertiser.poll() is None:
        advertiser.send_signal(signal.SIGTERM)
        try:
            advertiser.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            advertiser.kill()
            advertiser.communicate()
    stop.set()
    if thread is not None:
        thread.join(timeout=2)
    SOCKET.unlink(missing_ok=True)
    subprocess.run(["ip", "netns", "del", NAMESPACE], check=False, capture_output=True)
    subprocess.run(["ip", "link", "del", "br-lan"], check=False, capture_output=True)


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "send-rs":
        with socket.socket(socket.AF_INET6, socket.SOCK_RAW, socket.IPPROTO_ICMPV6) as sender:
            sender.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_MULTICAST_HOPS, 255)
            sender.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_MULTICAST_IF, socket.if_nametoindex("ra-client"))
            sender.bind(("fe80::2", 0, 0, socket.if_nametoindex("ra-client")))
            sender.sendto(bytes([133, 0, 0, 0, 0, 0, 0, 0]), ("ff02::2", 0, 0, socket.if_nametoindex("ra-client")))
        return
    if len(sys.argv) == 2 and sys.argv[1] == "observe-ra":
        with socket.socket(socket.AF_INET6, socket.SOCK_RAW, socket.IPPROTO_ICMPV6) as receiver:
            receiver.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_RECVHOPLIMIT, 1)
            receiver.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_RECVPKTINFO, 1)
            receiver.bind(("::", 0, 0, socket.if_nametoindex("ra-client")))
            receiver.settimeout(10)
            while True:
                packet, ancillary, _, source = receiver.recvmsg(2048, 128)
                if packet[0] == 134:
                    hops = [int.from_bytes(value, sys.byteorder, signed=True) for level, kind, value in ancillary if level == socket.IPPROTO_IPV6 and kind == socket.IPV6_HOPLIMIT]
                    destinations = [str(ipaddress.IPv6Address(value[:16])) for level, kind, value in ancillary if level == socket.IPPROTO_IPV6 and kind == socket.IPV6_PKTINFO]
                    print(json.dumps({"source": source[0], "destination": destinations[0], "hop_limit": hops[0], "packet": packet.hex()}), flush=True)
                    return
    if len(sys.argv) != 1:
        raise SystemExit("usage: route_advertisement.py [send-rs]")
    if not Path("/.dockerenv").exists():
        raise SystemExit("run this privileged network test only inside Docker")
    advertiser = None
    observer = None
    thread = None
    stop = threading.Event()
    try:
        setup()
        default = client_route("default")
        assert default.startswith("default via fe80::1 "), default
        advertiser = subprocess.Popen([BINARY, "--advertise-route", "fe80::53"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        time.sleep(1.5)
        assert advertiser.poll() is None, advertiser.communicate()
        assert not client_route(ROUTE), "advertised before gateway socket was ready"
        route_info = "/proc/sys/net/ipv6/conf/ra-client/accept_ra_rt_info_max_plen"
        supported = subprocess.run(
            ["ip", "netns", "exec", NAMESPACE, "test", "-e", route_info],
            check=False, capture_output=True,
        ).returncode == 0
        if not supported and os.environ.get("FIPS_RA_REQUIRE_ROUTE_INFO") == "1":
            raise AssertionError("kernel lacks CONFIG_IPV6_ROUTE_INFO required by CI")
        if supported:
            run("sysctl", "-qw", "net.ipv6.conf.ra-client.accept_ra_rt_info_max_plen=128", namespace=True)
        observer = start_observer()
        SOCKET.parent.mkdir(parents=True, exist_ok=True)
        thread = threading.Thread(target=socket_server, args=(stop,), daemon=True)
        thread.start()
        finish_observer(observer, 90, "ff02::1")
        observer = None
        if supported:
            route = await_route(True)
            assert "via fe80::53" in route, route
            run("ip", "-6", "route", "del", ROUTE, namespace=True)
        assert client_route("default") == default, "route-only RA changed the default route"
        observer = start_observer()
        send_solicitation()
        finish_observer(observer, 90, "fe80::2")
        observer = None
        if supported:
            route = await_route(True)
            assert "via fe80::53" in route, route
        observer = start_observer()
        SOCKET.unlink()
        finish_observer(observer, 0, "ff02::1")
        observer = None
        if supported:
            await_route(False)
        assert client_route("default") == default, "withdrawal changed the default route"
        if supported:
            print("Linux LAN client: readiness gate, route install, RS reply, withdrawal, default route passed")
        else:
            print("Linux LAN client: RA/RS/withdrawal packets passed; kernel lacks CONFIG_IPV6_ROUTE_INFO, so route installation was not exercised")
    finally:
        if observer is not None and observer.poll() is None:
            observer.kill()
            observer.communicate()
        cleanup(advertiser, stop, thread)


if __name__ == "__main__":
    main()
