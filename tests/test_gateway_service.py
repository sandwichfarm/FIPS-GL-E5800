"""Exercise the packaged OpenWrt gateway service against fake UCI and kernel tools."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


INIT = Path(__file__).resolve().parents[1] / "packaging/fips/files/etc/init.d/fips-gateway"


class GatewayServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "fake-bin"
        self.bin.mkdir()
        self.state = self.root / "uci.json"
        self.state.write_text(json.dumps({
            "dhcp.lan.ra_default": "1",
            "dhcp.lan.ra": "server",
            "dhcp.@dnsmasq[0].server": ["/fips/::1#5354", "8.8.8.8"],
        }))
        self.log = self.root / "commands.log"
        self.file("etc/fips/router/settings.json",
                  json.dumps({"enabled": True, "gateway_enabled": True}))
        self.file("etc/fips/fips.yaml", "{}")
        self.file("usr/bin/fips-gateway", "#!/bin/sh\n", executable=True)
        self.file("usr/bin/fips-router-admin", "#!/bin/sh\n", executable=True)
        self.file("sys/class/net/br-lan/address", "02:11:22:33:44:55\n")
        self.file("proc/sys/net/ipv6/conf/all/forwarding", "0\n")
        self.file("proc/sys/net/ipv6/conf/all/proxy_ndp", "0\n")
        self.file("proc/sys/kernel/random/boot_id", "boot-a\n")
        for name in ("odhcpd", "dnsmasq"):
            self.file(f"etc/init.d/{name}",
                      '#!/bin/sh\necho "' + name + ' $1" >> "$FIPS_TEST_COMMAND_LOG"\n'
                      '[ "${FIPS_FAIL_SERVICE:-}" != "' + name + '" ]\n',
                      executable=True)
        self.bin_file("jsonfilter", """#!/usr/bin/env python3
import json, sys
data = json.load(open(sys.argv[sys.argv.index('-i') + 1])) if '-i' in sys.argv else json.load(sys.stdin)
expression = sys.argv[sys.argv.index('-e') + 1]
if expression == "@['fips-gateway'].instances.route.running":
    value = data.get('fips-gateway', {}).get('instances', {}).get('route', {}).get('running', '')
else:
    value = data[expression[2:]]
print(str(value).lower())
""")
        self.bin_file("ubus", """#!/bin/sh
echo "ubus $*" >> "$FIPS_TEST_COMMAND_LOG"
case "$*" in
  'call service list '*)
    if [ -e "$FIPS_TEST_FS_ROOT/route-running" ]; then running=true; else running=false; fi
    printf '{"fips-gateway":{"instances":{"route":{"running":%s}}}}\\n' "$running"
    ;;
  'call service delete '*)
    [ ! -e "$FIPS_TEST_FS_ROOT/ra-alias" ] || echo 'alias present before service delete' >> "$FIPS_TEST_COMMAND_LOG"
    [ "${FIPS_TEST_KEEP_ROUTE_RUNNING:-}" = yes ] || rm -f "$FIPS_TEST_FS_ROOT/route-running"
    ;;
  *) exit 1;;
esac
""")
        self.bin_file("uci", """#!/usr/bin/env python3
import json, os, sys
path = os.environ['FIPS_TEST_UCI_STATE']
with open(path) as source: data = json.load(source)
args = [arg for arg in sys.argv[1:] if arg != '-q']
operation, *args = args
key = args[0].split('=', 1)[0] if args else ''
value = args[0].split('=', 1)[1] if args and '=' in args[0] else ''
if operation == 'get':
    if key not in data: sys.exit(1)
    item = data[key]
    print(' '.join(item) if isinstance(item, list) else item)
elif operation == 'set': data[key] = value
elif operation == 'delete':
    for item in list(data):
        if item == key or item.startswith(key + '.'): data.pop(item)
elif operation == 'add_list': data.setdefault(key, []).append(value)
elif operation == 'del_list':
    if key in data and value in data[key]: data[key].remove(value)
elif operation != 'commit': sys.exit(2)
with open(path, 'w') as output: json.dump(data, output)
""")
        self.bin_file("ip", """#!/bin/sh
echo "ip $*" >> "$FIPS_TEST_COMMAND_LOG"
case "$*" in *'addr show dev br-lan scope global'*) [ "${FIPS_TEST_LAN_IPV6:-yes}" != no ] && echo "2: br-lan inet6 fd12:3456:789a::1/${FIPS_TEST_LAN_IPV6:-64} scope global";;
  *'addr show dev br-lan scope link'*) [ ! -f "$FIPS_TEST_FS_ROOT/ra-alias" ] || echo "2: br-lan inet6 $(cat "$FIPS_TEST_FS_ROOT/ra-alias") scope link ${FIPS_TEST_DAD_STATE:-}";;
  *'addr add fe80::'*) printf '%s\n' "$4" > "$FIPS_TEST_FS_ROOT/ra-alias";;
  *'addr del fe80::'*) rm -f "$FIPS_TEST_FS_ROOT/ra-alias";;
  *'addr show'*) test -e "$FIPS_TEST_FS_ROOT/prefix-present";;
  *'addr add'*) touch "$FIPS_TEST_FS_ROOT/prefix-present";;
  *'addr del'*) rm -f "$FIPS_TEST_FS_ROOT/prefix-present";;
  *'route show default'*) [ "${FIPS_TEST_IPV6_DEFAULT:-}" = yes ] && echo 'default via fe80::1 dev wan6';; esac
""")
        self.bin_file("sysctl", '#!/bin/sh\necho "sysctl $*" >> "$FIPS_TEST_COMMAND_LOG"\n')
        self.bin_file("modprobe", '#!/bin/sh\nexit 0\n')
        self.env = os.environ | {
            "FIPS_TEST_FS_ROOT": str(self.root),
            "FIPS_GATEWAY_INIT": str(INIT),
            "FIPS_TEST_UCI_STATE": str(self.state),
            "FIPS_TEST_COMMAND_LOG": str(self.log),
            "FIPS_TEST_IPV6_DEFAULT": "yes",
            "PATH": f"{self.bin}:{os.environ['PATH']}",
        }

    def file(self, relative: str, content: str, executable: bool = False) -> Path:
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        target.chmod(0o755 if executable else 0o644)
        return target

    def bin_file(self, name: str, content: str) -> None:
        target = self.bin / name
        target.write_text(content)
        target.chmod(0o755)

    def service(self, action: str, expected: int = 0) -> None:
        script = ('. "$FIPS_GATEWAY_INIT"; '
                  'procd_open_instance() { FIPS_TEST_INSTANCE="$1"; echo "instance $*" >> "$FIPS_TEST_COMMAND_LOG"; }; '
                  'procd_set_param() { echo "procd $*" >> "$FIPS_TEST_COMMAND_LOG"; }; '
                  'procd_close_instance() { [ "$FIPS_TEST_INSTANCE" != route ] || touch "$FIPS_TEST_FS_ROOT/route-running"; }; ' +
                  ('stop_service; stop_result=$?; ubus call service delete \'{"name":"fips-gateway"}\' >/dev/null; '
                   'service_stopped; cleanup_result=$?; [ "$stop_result" -eq 0 ] && [ "$cleanup_result" -eq 0 ]'
                   if action == "stop" else action + '_service'))
        result = subprocess.run(["sh", "-c", script], env=self.env,
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)

    def test_start_restart_stop_preserve_prior_lan_settings(self) -> None:
        self.service("start")
        self.assertTrue((self.root / "ra-alias").exists())
        ra_source = (self.root / "ra-alias").read_text().strip().removesuffix("/64")
        self.assertTrue(ra_source.startswith("fe80::"))
        self.assertIn("instance route", self.log.read_text())
        self.assertIn(f"procd command {self.root}/usr/bin/fips-router-admin --advertise-route {ra_source}",
                      self.log.read_text())
        running = json.loads(self.state.read_text())
        self.assertEqual(running["dhcp.lan.ra_default"], "1")
        self.assertFalse(any(key.startswith("dhcp.fips_gateway_route") for key in running))
        self.assertEqual(running["dhcp.@dnsmasq[0].server"], ["8.8.8.8", "/fips/::1#5365"])
        self.assertFalse((self.root / "prefix-present").exists())
        self.service("start")
        self.service("stop")
        restored = json.loads(self.state.read_text())
        self.assertEqual(restored["dhcp.lan.ra_default"], "1")
        self.assertEqual(restored["dhcp.@dnsmasq[0].server"], ["8.8.8.8", "/fips/::1#5354"])
        self.assertFalse((self.root / "prefix-present").exists())
        self.assertFalse((self.root / "etc/fips/router/gateway-state").exists())
        self.assertFalse((self.root / "ra-alias").exists())
        self.assertIn("sysctl -w net.ipv6.conf.all.forwarding=0", self.log.read_text())
        commands = self.log.read_text()
        self.assertIn("alias present before service delete", commands)
        self.assertLess(commands.index("ubus call service delete"), commands.rindex("ip -6 addr del"))

    def test_disabled_gateway_does_not_change_lan(self) -> None:
        self.file("etc/fips/router/settings.json",
                  json.dumps({"enabled": True, "gateway_enabled": False}))
        self.service("start")
        self.assertEqual(json.loads(self.state.read_text())["dhcp.lan.ra_default"], "1")
        self.assertFalse(self.log.exists())

    def test_ipv4_only_wan_does_not_modify_lan(self) -> None:
        initial = json.loads(self.state.read_text())
        self.env.pop("FIPS_TEST_IPV6_DEFAULT")
        self.service("start", expected=1)
        self.assertEqual(json.loads(self.state.read_text()), initial)
        self.assertFalse((self.root / "etc/fips/router/gateway-state").exists())

    def test_lan_without_ipv6_prefix_does_not_modify_lan(self) -> None:
        initial = json.loads(self.state.read_text())
        self.env["FIPS_TEST_LAN_IPV6"] = "no"
        self.service("start", expected=1)
        self.assertEqual(json.loads(self.state.read_text()), initial)
        self.assertFalse((self.root / "etc/fips/router/gateway-state").exists())
        self.env["FIPS_TEST_LAN_IPV6"] = "128"
        self.service("start", expected=1)
        self.assertEqual(json.loads(self.state.read_text()), initial)

    def test_failed_duplicate_address_detection_restores_added_alias(self) -> None:
        initial = json.loads(self.state.read_text())
        self.env["FIPS_TEST_DAD_STATE"] = "dadfailed"
        self.service("start", expected=1)
        self.assertTrue((self.root / "ra-alias").exists())
        self.env.pop("FIPS_TEST_DAD_STATE")
        self.service("stop")
        self.assertFalse((self.root / "ra-alias").exists())
        self.assertEqual(json.loads(self.state.read_text()), initial)
        self.assertFalse((self.root / "etc/fips/router/gateway-state").exists())

    def test_disabled_gateway_cleans_up_prior_active_settings(self) -> None:
        self.service("start")
        self.file("etc/fips/router/settings.json",
                  json.dumps({"enabled": True, "gateway_enabled": False}))
        self.service("start")
        restored = json.loads(self.state.read_text())
        self.assertEqual(restored["dhcp.lan.ra_default"], "1")
        self.assertIn("/fips/::1#5354", restored["dhcp.@dnsmasq[0].server"])
        self.assertNotIn("/fips/::1#5365", restored["dhcp.@dnsmasq[0].server"])

    def test_unrelated_route_is_untouched(self) -> None:
        initial = json.loads(self.state.read_text())
        initial["dhcp.fips_gateway_route"] = "route6"
        self.state.write_text(json.dumps(initial))
        self.service("start")
        self.assertEqual(json.loads(self.state.read_text())["dhcp.fips_gateway_route"], "route6")
        self.service("stop")
        restored = json.loads(self.state.read_text())
        self.assertEqual(restored.pop("dhcp.@dnsmasq[0].server"), ["8.8.8.8", "/fips/::1#5354"])
        self.assertEqual(restored, {key: value for key, value in initial.items()
                                    if key != "dhcp.@dnsmasq[0].server"})

    def test_failed_dns_restart_can_be_rolled_back_without_lan_drift(self) -> None:
        initial = json.loads(self.state.read_text())
        self.env["FIPS_FAIL_SERVICE"] = "dnsmasq"
        self.service("start", expected=1)
        self.env.pop("FIPS_FAIL_SERVICE")
        self.service("stop")
        restored = json.loads(self.state.read_text())
        self.assertEqual(restored["dhcp.lan.ra_default"], initial["dhcp.lan.ra_default"])
        self.assertEqual(set(restored["dhcp.@dnsmasq[0].server"]),
                         set(initial["dhcp.@dnsmasq[0].server"]))
        self.assertFalse((self.root / "prefix-present").exists())

    def test_restart_failure_does_not_replace_original_snapshot(self) -> None:
        self.service("start")
        snapshot = self.root / "etc/fips/router/gateway-state/forwarding"
        self.assertEqual(snapshot.read_text(), "0\n")
        self.env["FIPS_FAIL_SERVICE"] = "dnsmasq"
        self.service("start", expected=1)
        self.assertEqual(snapshot.read_text(), "0\n")
        self.env.pop("FIPS_FAIL_SERVICE")
        self.service("stop")
        self.assertEqual(json.loads(self.state.read_text())["dhcp.lan.ra_default"], "1")

    def test_stuck_route_sender_preserves_alias_for_withdrawal_retry(self) -> None:
        self.service("start")
        self.bin_file("sleep", "#!/bin/sh\nexit 0\n")
        self.env["FIPS_TEST_KEEP_ROUTE_RUNNING"] = "yes"
        self.service("stop", expected=1)
        self.assertTrue((self.root / "ra-alias").exists())
        self.assertTrue((self.root / "etc/fips/router/gateway-state").exists())
        self.env.pop("FIPS_TEST_KEEP_ROUTE_RUNNING")
        self.service("stop")
        self.assertFalse((self.root / "ra-alias").exists())
        self.assertFalse((self.root / "etc/fips/router/gateway-state").exists())

    def test_firmware_reboot_does_not_replay_stale_lan_snapshot(self) -> None:
        self.service("start")
        fresh = {"dhcp.lan.ra_default": "0",
                 "dhcp.lan.ra": "server",
                 "dhcp.@dnsmasq[0].server": ["1.1.1.1"]}
        self.state.write_text(json.dumps(fresh))
        self.file("proc/sys/kernel/random/boot_id", "boot-b\n")
        (self.root / "ra-alias").unlink()
        self.service("start")
        self.assertEqual(json.loads(self.state.read_text())["dhcp.lan.ra_default"], "0")
        self.service("stop")
        restored = json.loads(self.state.read_text())
        self.assertEqual(restored["dhcp.lan.ra_default"], "0")
        self.assertEqual(restored["dhcp.@dnsmasq[0].server"], ["1.1.1.1"])


if __name__ == "__main__":
    unittest.main()
