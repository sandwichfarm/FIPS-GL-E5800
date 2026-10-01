"""Exercise read-only deployment probes against an isolated router filesystem."""

from __future__ import annotations

import gzip
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest


HEALTH = Path(__file__).resolve().parents[1] / "packaging/recovery/health.sh"


class HealthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fake_bin = self.root / "fake-bin"
        fake_bin.mkdir()
        for name in ("ubus", "ip", "ping", "nslookup"):
            command = fake_bin / name
            command.write_text("#!/bin/sh\nname=$(basename \"$0\")\n"
                               "echo \"$name\" >> \"$FIPS_PROBE_LOG\"\n"
                               "if [ \"$name\" = ubus ]; then\n"
                               "  case \" $* \" in *' service list '*) echo \"{\\\"fips-gateway\\\":{\\\"instances\\\":{\\\"gateway\\\":{\\\"running\\\":${FIPS_GATEWAY_RUNNING:-true}},\\\"route\\\":{\\\"running\\\":${FIPS_ROUTE_RUNNING:-true}}}}}\"; exit 0;; esac\n"
                               "fi\n"
                               "if [ \"$name\" = ip ] && [ \"${FIPS_FAIL_IPV6_ROUTE:-}\" = yes ]; then\n"
                               "  case \" $* \" in *' -6 route get '*) exit 1;; esac\n"
                               "fi\n"
                               "if [ \"$name\" = ip ]; then\n"
                               "  case \" $* \" in *' -4 route get '*)\n"
                               "    if [ \"${FIPS_IPV4_VIA_MESH:-}\" = yes ]; then echo '1.1.1.1 dev fips0 src 10.0.0.1'; else echo '1.1.1.1 dev wan src 192.0.2.2'; fi; exit 0;; esac\n"
                               "  case \" $* \" in *' -6 route show default '*)\n"
                               "    if [ \"${FIPS_IPV6_VIA_MESH:-}\" = yes ]; then echo 'default dev fips0'; elif [ \"${FIPS_NO_IPV6_DEFAULT:-}\" != yes ]; then echo 'default via fe80::1 dev wan6'; fi; exit 0;; esac\n"
                               "  case \" $* \" in *' -6 -o addr show dev br-lan scope global '*)\n"
                               "    [ \"${FIPS_NO_LAN_IPV6:-}\" != yes ] && echo \"2: br-lan inet6 fd12:3456:789a::1/${FIPS_LAN_PREFIX_LENGTH:-64} scope global\"; exit 0;; esac\n"
                               "  case \" $* \" in *' -6 -o addr show dev br-lan scope link '*)\n"
                               "    [ -z \"${FIPS_ROUTE_ADDRESS:-}\" ] || echo \"2: br-lan inet6 $FIPS_ROUTE_ADDRESS/64 scope link\"; exit 0;; esac\n"
                               "fi\n"
                               "if [ \"$name\" = ping ] && [ \"${FIPS_FAIL_IPV6:-}\" = yes ]; then\n"
                               "  case \" $* \" in *' -6 '*) exit 1;; esac\n"
                               "fi\n"
                               "[ \"${FIPS_FAIL_PROBE:-}\" != \"$name\" ]\n")
            command.chmod(0o755)
        timeout = fake_bin / "timeout"
        timeout.write_text("#!/bin/sh\nshift\nexec \"$@\"\n")
        timeout.chmod(0o755)
        uci = fake_bin / "uci"
        uci.write_text("""#!/bin/sh
[ "${FIPS_FAIL_FW4:-}" != yes ] || exit 1
case "$3" in
  firewall.fips_mesh) echo zone;;
  firewall.fips_mesh.name) echo fips_mesh;;
  firewall.fips_mesh.device) echo fips0;;
  firewall.fips_mesh.family) echo ipv6;;
  firewall.fips_mesh.input) [ "${FIPS_BAD_INPUT:-}" != yes ] || { echo ACCEPT; exit 0; }; echo REJECT;;
  firewall.fips_mesh.output) echo ACCEPT;;
  firewall.fips_mesh.forward) echo REJECT;;
  firewall.fips_icmp) [ "${FIPS_MISSING_ICMP:-}" != yes ] || exit 1; echo rule;;
  firewall.fips_icmp.src) echo fips_mesh;;
  firewall.fips_icmp.family) echo ipv6;;
  firewall.fips_icmp.proto) echo icmp;;
  firewall.fips_icmp.icmp_type) echo 'echo-request destination-unreachable packet-too-big time-exceeded';;
  firewall.fips_icmp.target) echo ACCEPT;;
  firewall.fips_lan) [ "${FIPS_TEST_LAN_FORWARD:-}" = yes ] || exit 1; echo forwarding;;
  firewall.fips_lan.src) echo lan;;
  firewall.fips_lan.dest) echo fips_mesh;;
  firewall.fips_lan.family) echo ipv6;;
  dhcp.lan.ra) echo server;;
  *) exit 1;;
esac
""")
        uci.chmod(0o755)
        nft = fake_bin / "nft"
        nft.write_text("#!/bin/sh\n[ \"${FIPS_FAIL_NFT:-}\" != yes ]\n")
        nft.chmod(0o755)
        jsonfilter = fake_bin / "jsonfilter"
        jsonfilter.write_text("""#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
if '-i' in args:
    data = json.load(open(args[args.index('-i') + 1]))
else:
    data = json.load(sys.stdin)
expression = args[args.index('-e') + 1][1:].replace("['", '.').replace("']", '').lstrip('.')
for part in expression.split('.'):
    data = data[part]
print(str(data).lower() if isinstance(data, bool) else data)
""")
        jsonfilter.chmod(0o755)
        admin = self.root / "usr/bin/fips-router-admin"
        admin.parent.mkdir(parents=True)
        admin.write_text("""#!/usr/bin/env python3
import json, os, sys
operation = json.load(sys.stdin)['operation']
if operation == 'configuration':
    data = {'settings': {'enabled': True}}
else:
    data = {'persistent': os.environ.get('FIPS_TEST_PERSISTENT', 'true') == 'true',
            'state': 'Running', 'link_count': int(os.environ.get('FIPS_TEST_LINKS', '1'))}
print(json.dumps({'status': 'ok', 'data': data}))
""")
        admin.chmod(0o755)
        self.file("usr/bin/fips", "binary", executable=True)
        self.file("etc/init.d/fips", "#!/bin/sh\nexit 0\n", executable=True)
        bundle = self.file("www/views/gl-sdk4-ui-fips.common.js.gz", "")
        bundle.write_bytes(gzip.compress(b"web bundle"))
        cgi = self.file("www/cgi-bin/gl-sdk4-ui-fips", "", executable=True)
        cgi.write_bytes((HEALTH.parents[2] / "packaging/web-ui/files/www/cgi-bin/gl-sdk4-ui-fips").read_bytes())
        self.file("root/dashboard/dashboard.py", "# dashboard\n")
        self.file("root/dashboard/toggle.sh", "#!/bin/sh\n", executable=True)
        for name in ("citydash", "homebutton"):
            self.file(f"etc/init.d/{name}",
                      "#!/bin/sh\n[ \"$1\" = status ] || exit 1\n"
                      "[ \"$(basename \"$0\")\" != \"${FIPS_FAIL_SERVICE:-}\" ]\n",
                      executable=True)
        self.file("etc/init.d/gl_screen",
                  "#!/bin/sh\n[ \"$1\" = status ] && [ \"${FIPS_STOCK_ACTIVE:-0}\" = 1 ]\n",
                  executable=True)
        self.file("etc/fips/router/settings.json", json.dumps({"enabled": False}))
        self.env = os.environ | {
            "FIPS_TEST_FS_ROOT": str(self.root),
            "FIPS_PROBE_LOG": str(self.root / "probes.log"),
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
        }

    def file(self, relative: str, content: str, executable: bool = False) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        path.chmod(0o755 if executable else 0o644)
        return path

    def run_health(self, components: str = "fips,web_ui,device_ui", env: dict | None = None,
                   ipv6: str = "") -> subprocess.CompletedProcess:
        return subprocess.run(
            ["sh", str(HEALTH), "1.1.1.1", "example.com", components, "1", ipv6],
            env=env or self.env, text=True, capture_output=True, check=False,
        )

    def test_gateway_checks_public_ipv6_probe(self) -> None:
        self.file("etc/fips/router/settings.json",
                  json.dumps({"enabled": True, "gateway_enabled": True}))
        malformed = self.run_health("fips", ipv6="not-an-address")
        self.assertNotEqual(malformed.returncode, 0)
        self.assertIn("invalid IPv6 probe", malformed.stderr)
        no_route = self.run_health("fips", self.env | {
            "FIPS_FAIL_IPV6_ROUTE": "yes", "FIPS_TEST_LAN_FORWARD": "yes"},
                                   ipv6="2606:4700:4700::1111")
        self.assertIn("IPv6 route unavailable", no_route.stderr)
        no_connectivity = self.run_health("fips", self.env | {
            "FIPS_FAIL_IPV6": "yes", "FIPS_TEST_LAN_FORWARD": "yes"},
                                          ipv6="2606:4700:4700::1111")
        self.assertIn("IPv6 connectivity unavailable", no_connectivity.stderr)

    def test_gateway_requires_explicit_lan_to_mesh_forwarding(self) -> None:
        self.file("etc/fips/router/settings.json",
                  json.dumps({"enabled": True, "gateway_enabled": True}))
        missing = self.run_health("fips")
        self.assertIn("LAN mesh forwarding is missing", missing.stderr)
        present = self.run_health("fips", self.env | {"FIPS_TEST_LAN_FORWARD": "yes"})
        self.assertIn("gateway public IPv6 probe is missing", present.stderr)
        no_default = self.run_health("fips", self.env | {
            "FIPS_TEST_LAN_FORWARD": "yes", "FIPS_NO_IPV6_DEFAULT": "yes"
        })
        self.assertIn("IPv6 default route unavailable", no_default.stderr)
        no_lan_address = self.run_health("fips", self.env | {
            "FIPS_TEST_LAN_FORWARD": "yes", "FIPS_NO_LAN_IPV6": "yes"
        }, ipv6="2606:4700:4700::1111")
        self.assertIn("LAN has no usable IPv6 /64", no_lan_address.stderr)
        wrong_prefix = self.run_health("fips", self.env | {
            "FIPS_TEST_LAN_FORWARD": "yes", "FIPS_LAN_PREFIX_LENGTH": "128"
        }, ipv6="2606:4700:4700::1111")
        self.assertIn("LAN has no usable IPv6 /64", wrong_prefix.stderr)

    def test_gateway_requires_live_route_advertiser(self) -> None:
        self.file("etc/fips/router/settings.json",
                  json.dumps({"enabled": True, "gateway_enabled": True}))
        base = self.env | {"FIPS_TEST_LAN_FORWARD": "yes"}
        probe = "2606:4700:4700::1111"
        missing = self.run_health("fips", base, ipv6=probe)
        self.assertIn("LAN route advertisement source missing", missing.stderr)
        self.file("etc/fips/router/gateway-state/ra-address", "fe80::abcd\n")
        absent = self.run_health("fips", base, ipv6=probe)
        self.assertIn("LAN route advertisement address missing", absent.stderr)
        stopped = self.run_health("fips", base | {
            "FIPS_ROUTE_ADDRESS": "fe80::abcd", "FIPS_ROUTE_RUNNING": "false"
        }, ipv6=probe)
        self.assertIn("LAN route advertiser is not running", stopped.stderr)
        gateway_stopped = self.run_health("fips", base | {
            "FIPS_ROUTE_ADDRESS": "fe80::abcd", "FIPS_GATEWAY_RUNNING": "false"
        }, ipv6=probe)
        self.assertIn("gateway process is not running", gateway_stopped.stderr)

    def test_disabled_node_blocks_fips_confirmation(self) -> None:
        result = self.run_health()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FIPS node is disabled", result.stderr)
        self.assertNotIn("FIPS_HEALTHY", result.stdout)
        self.assertEqual((self.root / "probes.log").read_text().splitlines(),
                         ["ubus", "ip", "ip", "ping", "nslookup"])

    def test_ui_package_health_without_fips(self) -> None:
        result = self.run_health("web_ui,device_ui")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("FIPS_HEALTHY", result.stdout)

    def test_network_only_health_for_disabling_node(self) -> None:
        result = self.run_health("network")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "probes.log").read_text().splitlines(),
                         ["ubus", "ip", "ip", "ping", "nslookup"])
        failed = self.run_health("network", self.env | {"FIPS_FAIL_PROBE": "nslookup"})
        self.assertNotEqual(failed.returncode, 0)

    def test_ordinary_internet_must_not_use_fips_interface(self) -> None:
        for variable, family in (("FIPS_IPV4_VIA_MESH", "IPv4"),
                                 ("FIPS_IPV6_VIA_MESH", "IPv6")):
            with self.subTest(family=family):
                result = self.run_health("network", self.env | {variable: "yes"})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"ordinary {family} internet is routed through FIPS", result.stderr)

    def test_dns_regression_blocks_confirmation(self) -> None:
        result = self.run_health(env=self.env | {"FIPS_FAIL_PROBE": "nslookup"})
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("FIPS_HEALTHY", result.stdout)

    def test_dashboard_must_own_the_display(self) -> None:
        for service in ("citydash", "homebutton"):
            with self.subTest(service=service):
                result = self.run_health("device_ui", self.env | {"FIPS_FAIL_SERVICE": service})
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("FIPS_HEALTHY", result.stdout)
        result = self.run_health("device_ui", self.env | {"FIPS_STOCK_ACTIVE": "1"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stock screen still owns the display", result.stderr)
        (self.root / "etc/init.d/gl_screen").unlink()
        result = self.run_health("device_ui")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stock screen fallback is missing", result.stderr)

    def test_broken_web_or_touchscreen_payload_blocks_confirmation(self) -> None:
        for relative in ("www/views/gl-sdk4-ui-fips.common.js.gz", "root/dashboard/dashboard.py"):
            with self.subTest(relative=relative):
                target = self.root / relative
                original = target.read_bytes()
                target.unlink()
                result = self.run_health("web_ui,device_ui")
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("FIPS_HEALTHY", result.stdout)
                target.write_bytes(original)

    def test_corrupt_web_bundle_or_cgi_blocks_confirmation(self) -> None:
        bundle = self.root / "www/views/gl-sdk4-ui-fips.common.js.gz"
        original = bundle.read_bytes()
        bundle.write_bytes(b"not gzip")
        broken = self.run_health("web_ui")
        self.assertNotEqual(broken.returncode, 0)
        self.assertIn("web bundle is corrupt", broken.stderr)
        bundle.write_bytes(original)

        cgi = self.root / "www/cgi-bin/gl-sdk4-ui-fips"
        original = cgi.read_bytes()
        cgi.write_text("#!/bin/sh\nexit 0\n")
        broken = self.run_health("web_ui")
        self.assertNotEqual(broken.returncode, 0)
        self.assertIn("web CGI rejected request incorrectly", broken.stderr)
        cgi.write_bytes(original)

    def test_syntax_broken_dashboard_blocks_confirmation(self) -> None:
        dashboard = self.root / "root/dashboard/dashboard.py"
        dashboard.write_text("def broken(:\n")
        broken = self.run_health("device_ui")
        self.assertNotEqual(broken.returncode, 0)
        self.assertIn("dashboard Python or rendering dependency failed", broken.stderr)

    def test_enabled_node_requires_persistent_identity_and_live_link(self) -> None:
        self.file("etc/fips/router/settings.json", json.dumps({"enabled": True}))
        socket_path = self.root / "run/fips/control.sock"
        socket_path.parent.mkdir(parents=True)
        listener = socket.socket(socket.AF_UNIX)
        try:
            try:
                listener.bind(str(socket_path))
            except PermissionError:
                self.skipTest("Unix socket binding denied by host sandbox")
            self.assertEqual(self.run_health().returncode, 0)
            self.assertNotEqual(self.run_health(env=self.env | {"FIPS_TEST_LINKS": "0"}).returncode, 0)
            self.assertNotEqual(self.run_health(env=self.env | {"FIPS_TEST_PERSISTENT": "false"}).returncode, 0)
        finally:
            listener.close()

    def test_enabled_node_requires_both_mesh_firewall_layers(self) -> None:
        self.file("etc/fips/router/settings.json", json.dumps({"enabled": True}))
        no_zone = self.run_health("fips", self.env | {"FIPS_FAIL_FW4": "yes"})
        self.assertIn("mesh firewall zone is missing", no_zone.stderr)
        no_nft = self.run_health("fips", self.env | {"FIPS_FAIL_NFT": "yes"})
        self.assertIn("mesh ingress policy is missing", no_nft.stderr)
        open_zone = self.run_health("fips", self.env | {"FIPS_BAD_INPUT": "yes"})
        self.assertIn("mesh firewall input policy is invalid", open_zone.stderr)
        no_icmp = self.run_health("fips", self.env | {"FIPS_MISSING_ICMP": "yes"})
        self.assertIn("mesh ICMPv6 rule is missing", no_icmp.stderr)


if __name__ == "__main__":
    unittest.main()
