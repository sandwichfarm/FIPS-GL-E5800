#!/bin/sh
# Read-only deployment probes. Interface rendering still requires operator review.
set -eu

ROOT=${FIPS_TEST_FS_ROOT:-}
probe_ip=${1:-}
probe_name=${2:-}
components=${3:-}
minimum_links=${4:-1}
probe_ipv6=${5:-}

fail() { echo "fips health: $*" >&2; exit 1; }
case "$probe_ip" in ''|*[!0-9.]*) fail 'invalid probe IP';; esac
case "$probe_name" in ''|*[!A-Za-z0-9.-]*) fail 'invalid probe name';; esac
case "$components" in ''|*[!a-z_,]*) fail 'invalid component list';; esac
case "$minimum_links" in ''|*[!0-9]*) fail 'invalid minimum link count';; esac
[ "$minimum_links" -ge 1 ] || fail 'minimum link count must be positive'
case "$probe_ipv6" in *[!0-9A-Fa-f:.]*) fail 'invalid IPv6 probe';; esac

set -f
IFS=,
set -- $components
IFS=' '
for component in "$@"; do
    case "$component" in network|fips|web_ui|device_ui) ;; *) fail "invalid component: $component";; esac
done

timeout 2 ubus call system board >/dev/null
timeout 2 ip -4 route get "$probe_ip" >/dev/null
timeout 4 ping -c 1 -W 3 "$probe_ip" >/dev/null
timeout 4 nslookup "$probe_name" >/dev/null

case ",$components," in
    *,fips,*)
        admin="$ROOT/usr/bin/fips-router-admin"
        settings="$ROOT/etc/fips/router/settings.json"
        test -x "$ROOT/usr/bin/fips"
        test -x "$admin"
        test -x "$ROOT/etc/init.d/fips"
        printf '{"operation":"configuration"}\n' | "$admin" | jsonfilter -e '@.status' | grep -qx ok
        test -s "$settings" || fail 'FIPS settings missing'
        enabled=$(jsonfilter -i "$settings" -e '@.enabled')
        [ "$enabled" = true ] || fail 'FIPS node is disabled'
        [ "$(uci -q get firewall.fips_mesh 2>/dev/null)" = zone ] || fail 'mesh firewall zone is missing'
        [ "$(uci -q get firewall.fips_mesh.name 2>/dev/null)" = fips_mesh ] || fail 'mesh firewall zone is invalid'
        [ "$(uci -q get firewall.fips_mesh.device 2>/dev/null)" = fips0 ] || fail 'mesh firewall device is invalid'
        [ "$(uci -q get firewall.fips_mesh.family 2>/dev/null)" = ipv6 ] || fail 'mesh firewall family is invalid'
        [ "$(uci -q get firewall.fips_mesh.input 2>/dev/null)" = REJECT ] || fail 'mesh firewall input policy is invalid'
        [ "$(uci -q get firewall.fips_mesh.output 2>/dev/null)" = ACCEPT ] || fail 'mesh firewall output policy is invalid'
        [ "$(uci -q get firewall.fips_mesh.forward 2>/dev/null)" = REJECT ] || fail 'mesh firewall forwarding policy is invalid'
        [ "$(uci -q get firewall.fips_icmp 2>/dev/null)" = rule ] || fail 'mesh ICMPv6 rule is missing'
        [ "$(uci -q get firewall.fips_icmp.src 2>/dev/null)" = fips_mesh ] || fail 'mesh ICMPv6 source is invalid'
        [ "$(uci -q get firewall.fips_icmp.family 2>/dev/null)" = ipv6 ] || fail 'mesh ICMPv6 family is invalid'
        [ "$(uci -q get firewall.fips_icmp.proto 2>/dev/null)" = icmp ] || fail 'mesh ICMPv6 protocol is invalid'
        [ "$(uci -q get firewall.fips_icmp.icmp_type 2>/dev/null)" = 'echo-request destination-unreachable packet-too-big time-exceeded' ] || fail 'mesh ICMPv6 types are invalid'
        [ "$(uci -q get firewall.fips_icmp.target 2>/dev/null)" = ACCEPT ] || fail 'mesh ICMPv6 target is invalid'
        timeout 3 nft list table inet fips >/dev/null || fail 'mesh ingress policy is missing'
        timeout 3 nft list chain inet fw4 input_fips_mesh >/dev/null || fail 'mesh firewall zone is not active'
        if [ "$(jsonfilter -i "$settings" -e '@.gateway_enabled' 2>/dev/null)" = true ]; then
            [ "$(uci -q get firewall.fips_lan 2>/dev/null)" = forwarding ] || fail 'LAN mesh forwarding is missing'
            [ "$(uci -q get firewall.fips_lan.src 2>/dev/null)" = lan ] || fail 'LAN mesh forwarding source is invalid'
            [ "$(uci -q get firewall.fips_lan.dest 2>/dev/null)" = fips_mesh ] || fail 'LAN mesh forwarding destination is invalid'
            [ "$(uci -q get firewall.fips_lan.family 2>/dev/null)" = ipv6 ] || fail 'LAN mesh forwarding family is invalid'
            timeout 2 ip -6 route show default | grep -q . || fail 'IPv6 default route unavailable for LAN gateway'
            case "$(uci -q get dhcp.lan.ra 2>/dev/null)" in
                server|relay|hybrid) ;;
                *) fail 'LAN router advertisements are unavailable';;
            esac
            timeout 2 ip -6 -o addr show dev br-lan scope global | grep -Eq ' inet6 [0-9A-Fa-f:]+/64 ' || fail 'LAN has no usable IPv6 /64'
            [ -n "$probe_ipv6" ] || fail 'gateway public IPv6 probe is missing'
            timeout 2 ip -6 route get "$probe_ipv6" >/dev/null || fail 'IPv6 route unavailable'
            timeout 4 ping -6 -c 1 -W 3 "$probe_ipv6" >/dev/null || fail 'IPv6 connectivity unavailable'
            route_state="$ROOT/etc/fips/router/gateway-state/ra-address"
            test -s "$route_state" || fail 'LAN route advertisement source missing'
            ra_source=$(cat "$route_state")
            timeout 2 ip -6 -o addr show dev br-lan scope link | grep -Fq " $ra_source/64 " || fail 'LAN route advertisement address missing'
            gateway_instances=$(timeout 2 ubus call service list '{"name":"fips-gateway","verbose":true}')
            gateway_running=$(printf '%s\n' "$gateway_instances" | jsonfilter -e "@['fips-gateway'].instances.gateway.running")
            [ "$gateway_running" = true ] || fail 'gateway process is not running'
            route_running=$(printf '%s\n' "$gateway_instances" | jsonfilter -e "@['fips-gateway'].instances.route.running")
            [ "$route_running" = true ] || fail 'LAN route advertiser is not running'
        elif uci -q get firewall.fips_lan >/dev/null 2>&1; then
            fail 'LAN mesh forwarding is enabled while gateway is disabled'
        fi
        "$ROOT/etc/init.d/fips" status >/dev/null
        test -S "$ROOT/run/fips/control.sock"
        status=$(printf '{"operation":"status"}\n' | "$admin")
        printf '%s\n' "$status" | jsonfilter -e '@.data.persistent' | grep -qx true
        state=$(printf '%s\n' "$status" | jsonfilter -e '@.data.state' | tr '[:upper:]' '[:lower:]')
        test "$state" = running
        links=$(printf '%s\n' "$status" | jsonfilter -e '@.data.link_count')
        case "$links" in ''|*[!0-9]*) fail 'invalid link count';; esac
        [ "$links" -ge "$minimum_links" ] || fail 'insufficient FIPS links'
        if [ "$(jsonfilter -i "$settings" -e '@.gateway_enabled' 2>/dev/null)" = true ]; then
            test -x "$ROOT/usr/bin/fips-gateway" || fail 'gateway binary missing'
            test -x "$ROOT/etc/init.d/fips-gateway" || fail 'gateway service missing'
            "$ROOT/etc/init.d/fips-gateway" status >/dev/null || fail 'gateway is not running'
            test -S "$ROOT/run/fips/gateway.sock" || fail 'gateway control socket missing'
            case " $(uci -q get 'dhcp.@dnsmasq[0].server') " in
                *' /fips/::1#5365 '*) ;;
                *) fail 'LAN DNS does not forward .fips to gateway';;
            esac
            [ "$(cat "$ROOT/proc/sys/net/ipv6/conf/all/forwarding")" = 1 ] || fail 'IPv6 forwarding disabled'
        fi
        ;;
esac

case ",$components," in
    *,web_ui,*)
        bundle="$ROOT/www/views/gl-sdk4-ui-fips.common.js.gz"
        cgi="$ROOT/www/cgi-bin/gl-sdk4-ui-fips"
        test -s "$bundle" || fail 'web bundle missing'
        timeout 3 gzip -dc "$bundle" >/dev/null || fail 'web bundle is corrupt'
        test -x "$cgi" || fail 'web CGI missing'
        rejection=$(REQUEST_METHOD=GET timeout 2 "$cgi") || fail 'web CGI failed to execute'
        case "$rejection" in 'Status: 405 Method Not Allowed'*) ;; *) fail 'web CGI rejected request incorrectly';; esac
        ;;
esac

case ",$components," in
    *,device_ui,*)
        dashboard="$ROOT/root/dashboard/dashboard.py"
        test -s "$dashboard" || fail 'dashboard source missing'
        PYTHONPATH="$ROOT/root/dashboard/vendor${PYTHONPATH:+:$PYTHONPATH}" PYTHONDONTWRITEBYTECODE=1 python3 -B -c '
import ast, sys
from PIL import Image, ImageDraw, ImageFont, _imagingft
import numpy
ast.parse(open(sys.argv[1], encoding="utf-8").read(), filename=sys.argv[1])
frame = Image.new("RGB", (16, 16))
ImageDraw.Draw(frame).text((0, 0), "F", font=ImageFont.load_default())
' "$dashboard" || fail 'dashboard Python or rendering dependency failed'
        test -x "$ROOT/root/dashboard/toggle.sh"
        test -x "$ROOT/etc/init.d/gl_screen" || fail 'stock screen fallback is missing'
        "$ROOT/etc/init.d/citydash" status >/dev/null || fail 'dashboard is not running'
        "$ROOT/etc/init.d/homebutton" status >/dev/null || fail 'touchscreen switch is not running'
        if "$ROOT/etc/init.d/gl_screen" status >/dev/null 2>&1; then
            fail 'stock screen still owns the display'
        fi
        ;;
esac

echo FIPS_HEALTHY
