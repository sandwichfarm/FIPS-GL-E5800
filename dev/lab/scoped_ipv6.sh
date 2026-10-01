#!/bin/sh
# Run only in an isolated, privileged Docker network namespace.
set -eu

work=$(mktemp -d)
pid=
cleanup() {
    if [ -n "$pid" ]; then
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
    fi
    rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM

cat > "$work/config.json" <<EOF
{"node":{"identity":{"persistent":true},"control":{"socket_path":"$work/control.sock"}},"tun":{"enabled":true,"name":"fips0","mtu":1280},"dns":{"enabled":false},"transports":{"udp":{"bind_addr":"0.0.0.0:2121"}},"peers":[]}
EOF
sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null
sysctl -w net.ipv6.conf.default.disable_ipv6=1 >/dev/null
/workspace/components/fips/target/release/fips --config "$work/config.json" >"$work/daemon.log" 2>&1 &
pid=$!
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if [ -S "$work/control.sock" ] && [ -e /proc/sys/net/ipv6/conf/fips0/disable_ipv6 ]; then
        break
    fi
    sleep 1
done
if ! python3 /workspace/dev/lab/health.py "$work/control.sock" >/dev/null; then
    cat "$work/daemon.log" >&2
    exit 1
fi
test "$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6)" = 1
test "$(cat /proc/sys/net/ipv6/conf/default/disable_ipv6)" = 1
test "$(cat /proc/sys/net/ipv6/conf/fips0/disable_ipv6)" = 0
ip -6 addr show dev fips0 | grep -q 'inet6 fd'
echo FIPS_TUN_SCOPED_IPV6_OK
