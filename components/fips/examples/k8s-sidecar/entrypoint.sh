#!/bin/bash
# FIPS Kubernetes sidecar entrypoint.
#
# Generates /etc/fips/fips.yaml from environment variables, rewrites the
# pod's resolv.conf to route .fips DNS through dnsmasq, applies iptables
# isolation rules so that the shared pod network namespace can only reach
# the outside world via the FIPS mesh, then launches the FIPS daemon.
#
# Required environment variables:
#   FIPS_NSEC           Node secret key (hex or nsec1 bech32)
#
# Optional environment variables (single peer shorthand):
#   FIPS_PEER_NPUB      Peer's npub
#   FIPS_PEER_ADDR      Peer's transport address  (e.g. 203.0.113.10:2121)
#   FIPS_PEER_ALIAS     Human-readable peer name  (default: peer)
#   FIPS_PEER_TRANSPORT Transport type            (default: udp)
#
# Multiple peers via JSON (overrides single-peer vars when set):
#   FIPS_PEERS_JSON     JSON array of peer objects, e.g.:
#                       '[{"npub":"npub1...","alias":"gw","addr":"1.2.3.4:2121","transport":"udp"}]'
#
# Transport / TUN tuning:
#   FIPS_UDP_BIND       UDP bind address          (default: 0.0.0.0:2121)
#   FIPS_UDP_PORT       UDP transport port        (derived from FIPS_UDP_BIND when unset)
#   FIPS_TCP_BIND       TCP bind address          (default: disabled)
#   FIPS_TUN_NAME       TUN interface name        (default: fips0)
#   FIPS_TUN_MTU        TUN interface MTU         (default: 1280, IPv6 minimum)
#
# Network isolation:
#   FIPS_ISOLATE        Apply iptables isolation  (default: false)
#                       Set to "true" for mesh-only deployments where the app
#                       must not communicate outside the FIPS mesh.
#                       Set to "false" to add fips0 alongside normal cluster
#                       networking without restricting eth0.
#   FIPS_POD_IFACE      Pod network interface     (default: eth0)
#                       Adjust if your CNI uses a different name (e.g. ens3).
#
# DNS:
#   FIPS_REWRITE_DNS    Rewrite /etc/resolv.conf  (default: true)
#                       Set to "false" if you manage DNS via another mechanism.
#
# Logging:
#   RUST_LOG            FIPS log level            (default: info)

set -euo pipefail

# ---------------------------------------------------------------------------
# IPv6 kernel configuration
#
# net.ipv6.conf.all.disable_ipv6, net.ipv6.conf.default.disable_ipv6, and
# net.ipv6.bindv6only are set via the pod securityContext.sysctls field in
# pod.yaml so that kubelet applies them before any container starts.
# Nothing to do here.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

FIPS_NSEC="${FIPS_NSEC:?FIPS_NSEC is required — provide your node secret key}"

FIPS_UDP_BIND="${FIPS_UDP_BIND:-0.0.0.0:2121}"
FIPS_TCP_BIND="${FIPS_TCP_BIND:-}"
FIPS_TUN_NAME="${FIPS_TUN_NAME:-fips0}"
FIPS_TUN_MTU="${FIPS_TUN_MTU:-1280}"
FIPS_ISOLATE="${FIPS_ISOLATE:-false}"
FIPS_POD_IFACE="${FIPS_POD_IFACE:-eth0}"
FIPS_REWRITE_DNS="${FIPS_REWRITE_DNS:-true}"

FIPS_PEER_TRANSPORT="${FIPS_PEER_TRANSPORT:-udp}"
FIPS_PEER_ALIAS="${FIPS_PEER_ALIAS:-peer}"

# Derive the UDP port for iptables rules from FIPS_UDP_BIND (last colon-field).
FIPS_UDP_PORT="${FIPS_UDP_PORT:-${FIPS_UDP_BIND##*:}}"

mkdir -p /etc/fips

# ---------------------------------------------------------------------------
# Build peers YAML section
# ---------------------------------------------------------------------------

build_peers_yaml() {
    # FIPS_PEERS_JSON wins when set (supports multiple peers).
    if [ -n "${FIPS_PEERS_JSON:-}" ]; then
        # Parse the JSON array with awk — no jq required.
        # Expected element keys: npub, alias, addr, transport, priority
        #
        # Note: This parser handles simple host:port addresses only.
        # IPv6 addresses with brackets ([::1]:2121) or values containing
        # commas/colons may not parse correctly. Use single-peer env vars
        # for complex configs or install jq and replace this block.
        echo "$FIPS_PEERS_JSON" | awk '
        BEGIN { RS="}"; FS="," }
        {
            npub=""; alias="peer"; addr=""; transport="udp"; priority=100
            for (i=1; i<=NF; i++) {
                gsub(/[{}\[\] \t\n\r]/, "", $i)
                if ($i ~ /"npub"/)      { split($i,a,":"); npub=a[2]; gsub(/"/,"",npub) }
                if ($i ~ /"alias"/)     { split($i,a,":"); alias=a[2]; gsub(/"/,"",alias) }
                if ($i ~ /"addr"/)      { n=split($i,a,":"); addr=a[2]":"a[3]; gsub(/"/,"",addr) }
                if ($i ~ /"transport"/) { split($i,a,":"); transport=a[2]; gsub(/"/,"",transport) }
                if ($i ~ /"priority"/)  { split($i,a,":"); priority=a[2]; gsub(/"/,"",priority) }
            }
            if (npub != "" && addr != "") {
                printf "  - npub: \"%s\"\n    alias: \"%s\"\n    addresses:\n      - transport: %s\n        addr: \"%s\"\n        priority: %s\n    connect_policy: auto_connect\n    auto_reconnect: true\n", npub, alias, transport, addr, priority
            }
        }'
        return
    fi

    # Single-peer shorthand via individual env vars.
    if [ -n "${FIPS_PEER_NPUB:-}" ] && [ -n "${FIPS_PEER_ADDR:-}" ]; then
        cat <<EOF
  - npub: "${FIPS_PEER_NPUB}"
    alias: "${FIPS_PEER_ALIAS}"
    addresses:
      - transport: ${FIPS_PEER_TRANSPORT}
        addr: "${FIPS_PEER_ADDR}"
    connect_policy: auto_connect
    auto_reconnect: true
EOF
        return
    fi

    # No peers configured — start standalone (useful for a new node joining
    # via discovery or when peers are added later via fipsctl).
    echo "  []"
}

# ---------------------------------------------------------------------------
# Build optional TCP transport stanza
# ---------------------------------------------------------------------------

build_tcp_yaml() {
    if [ -n "$FIPS_TCP_BIND" ]; then
        cat <<EOF
  tcp:
    bind_addr: "${FIPS_TCP_BIND}"
EOF
    fi
}

# ---------------------------------------------------------------------------
# Generate /etc/fips/fips.yaml
# ---------------------------------------------------------------------------

PEERS_YAML="$(build_peers_yaml)"
TCP_YAML="$(build_tcp_yaml)"

cat > /etc/fips/fips.yaml <<EOF
node:
  identity:
    nsec: "${FIPS_NSEC}"
  control:
    enabled: true
    socket_path: "/run/fips/control.sock"

tun:
  enabled: true
  name: ${FIPS_TUN_NAME}
  mtu: ${FIPS_TUN_MTU}

dns:
  enabled: true
  bind_addr: "127.0.0.1"
  port: 5354

transports:
  udp:
    bind_addr: "${FIPS_UDP_BIND}"
${TCP_YAML}
peers:
${PEERS_YAML}
EOF

echo "[fips-sidecar] Generated /etc/fips/fips.yaml"

# ---------------------------------------------------------------------------
# Rewrite /etc/resolv.conf to route .fips DNS through dnsmasq
#
# Strategy:
#   1. Harvest the nameservers the kubelet injected.
#   2. Write dnsmasq upstream rules for each harvested nameserver.
#   3. Point /etc/resolv.conf at 127.0.0.1 (dnsmasq).
#   4. dnsmasq forwards .fips → FIPS daemon (127.0.0.1:5354),
#      everything else → original cluster DNS (typically 169.254.20.10 or
#      the kube-dns ClusterIP injected by kubelet).
# ---------------------------------------------------------------------------

if [ "$FIPS_REWRITE_DNS" = "true" ]; then
    # Collect existing upstream nameservers before we overwrite resolv.conf.
    UPSTREAM_NS=()
    while IFS= read -r line; do
        if [[ "$line" =~ ^nameserver[[:space:]]+(.+)$ ]]; then
            ns="${BASH_REMATCH[1]}"
            # Skip loopback — we're about to replace it.
            if [[ "$ns" != "127."* ]] && [[ "$ns" != "::1" ]]; then
                UPSTREAM_NS+=("$ns")
            fi
        fi
    done < /etc/resolv.conf

    # Append upstream server lines to dnsmasq fips config.
    # (The placeholder in the image has no upstream server= lines yet.)
    for ns in "${UPSTREAM_NS[@]}"; do
        echo "server=${ns}" >> /etc/dnsmasq.d/fips.conf
    done

    # If no upstream was found fall back to Google (better than no resolution).
    if [ "${#UPSTREAM_NS[@]}" -eq 0 ]; then
        echo "[fips-sidecar] WARNING: no upstream nameserver found in /etc/resolv.conf; falling back to 8.8.8.8"
        echo "server=8.8.8.8" >> /etc/dnsmasq.d/fips.conf
    fi

    # Preserve the search/domain lines so pod DNS short-names still work.
    SEARCH_LINE=""
    while IFS= read -r line; do
        if [[ "$line" =~ ^(search|domain)[[:space:]] ]]; then
            SEARCH_LINE="$line"
            break
        fi
    done < /etc/resolv.conf

    {
        echo "nameserver 127.0.0.1"
        [ -n "$SEARCH_LINE" ] && echo "$SEARCH_LINE"
    } > /etc/resolv.conf

    echo "[fips-sidecar] DNS rewritten: upstream ${UPSTREAM_NS[*]:-8.8.8.8} → dnsmasq → fips/cluster"
fi

# ---------------------------------------------------------------------------
# iptables isolation
#
# Goal: only FIPS transport traffic may leave/enter the pod via the physical
# interface. All other pod-to-external traffic is dropped.  Traffic on the
# fips0 TUN and loopback is unrestricted.  The app container sharing this
# network namespace therefore can only communicate over the FIPS mesh.
#
# Skip when FIPS_ISOLATE=false (e.g. already handled by a NetworkPolicy,
# or when the operator wants unrestricted egress alongside mesh traffic).
# ---------------------------------------------------------------------------

if [ "$FIPS_ISOLATE" = "true" ]; then
    IFACE="$FIPS_POD_IFACE"
    UDP_PORT="$FIPS_UDP_PORT"

    # IPv4: allow loopback + FIPS UDP transport; drop everything else on
    # the pod's physical interface.
    iptables -A OUTPUT -o lo    -j ACCEPT
    iptables -A INPUT  -i lo    -j ACCEPT

    iptables -A OUTPUT -o "$IFACE" -p udp --dport "$UDP_PORT" -j ACCEPT
    iptables -A OUTPUT -o "$IFACE" -p udp --sport "$UDP_PORT" -j ACCEPT
    iptables -A INPUT  -i "$IFACE" -p udp --dport "$UDP_PORT" -j ACCEPT
    iptables -A INPUT  -i "$IFACE" -p udp --sport "$UDP_PORT" -j ACCEPT

    # Allow TCP transport port when configured.
    if [ -n "$FIPS_TCP_BIND" ]; then
        TCP_PORT="${FIPS_TCP_BIND##*:}"
        iptables -A OUTPUT -o "$IFACE" -p tcp --dport "$TCP_PORT" -j ACCEPT
        iptables -A INPUT  -i "$IFACE" -p tcp --sport "$TCP_PORT" -j ACCEPT
        iptables -A OUTPUT -o "$IFACE" -p tcp --sport "$TCP_PORT" -j ACCEPT
        iptables -A INPUT  -i "$IFACE" -p tcp --dport "$TCP_PORT" -j ACCEPT
    fi

    # Allow established/related so existing connections aren't torn down mid-flight.
    iptables -A INPUT  -i "$IFACE" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    iptables -A OUTPUT -o "$IFACE" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

    iptables -A OUTPUT -o "$IFACE" -j DROP
    iptables -A INPUT  -i "$IFACE" -j DROP

    # IPv6: allow loopback and fips TUN; block physical interface entirely.
    ip6tables -A OUTPUT -o lo           -j ACCEPT
    ip6tables -A INPUT  -i lo           -j ACCEPT
    ip6tables -A OUTPUT -o "$FIPS_TUN_NAME" -j ACCEPT
    ip6tables -A INPUT  -i "$FIPS_TUN_NAME" -j ACCEPT
    ip6tables -A OUTPUT -o "$IFACE"     -j DROP
    ip6tables -A INPUT  -i "$IFACE"     -j DROP

    echo "[fips-sidecar] iptables isolation applied on ${IFACE} (UDP ${UDP_PORT})"
fi

# ---------------------------------------------------------------------------
# TCP MSS clamping on fips0
#
# The kernel derives MSS from the TUN MTU: 1280 - 60 = 1220. But FIPS adds
# FIPS_IPV6_OVERHEAD (77) bytes of encapsulation that the kernel doesn't know
# Clamp the MSS in TCP SYN packets traversing fips0 to the path MTU so that
# segments fit within the effective MTU after FIPS encapsulation.
# This is applied regardless of FIPS_ISOLATE mode since it's needed for
# correct TCP negotiation even when normal network access is allowed.
# ---------------------------------------------------------------------------

ip6tables -t mangle -A FORWARD -o "$FIPS_TUN_NAME" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
ip6tables -t mangle -A FORWARD -i "$FIPS_TUN_NAME" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
ip6tables -t mangle -A OUTPUT  -o "$FIPS_TUN_NAME" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

echo "[fips-sidecar] TCP MSS clamped to PMTU on ${FIPS_TUN_NAME}"

# ---------------------------------------------------------------------------
# Start dnsmasq and launch FIPS daemon
# ---------------------------------------------------------------------------

dnsmasq --conf-dir=/etc/dnsmasq.d
echo "[fips-sidecar] dnsmasq started"

exec fips --config /etc/fips/fips.yaml
