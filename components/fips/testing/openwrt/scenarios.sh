#!/bin/sh
# OpenWrt maintainer-script and init-guard scenarios, run under ash.
#
# Driven by testing/openwrt/maintainer-scripts-test.sh, which starts a busybox
# container so /bin/sh here is ash, the shell OpenWrt runs these scripts under.
# Nothing in this file needs opkg: the call order, the arguments and the
# PKG_UPGRADE environment are taken from opkg-lede's own sources, so what is
# exercised is the scripts' behaviour given that contract, not opkg itself.
# A real `opkg upgrade` on a router image stays uncovered.
#
# POSTINST and PRERM may be pointed at other files. That is the seam used to
# see a scenario red against the previously released scripts, and to re-break
# the fixed ones during a break-check.
#
# APK_SCRIPTS names a directory holding the four scripts the .apk registers
# (post-install, pre-upgrade, post-upgrade, pre-deinstall), as captured from
# the real build-apk.sh by package-test.sh --keep. Scenarios 8 to 10 execute
# them directly with apk-tools v3's argv and PATH-only environment, so the
# kernel reads their #! line and ash runs them. A missing directory or script
# fails those scenarios; it is never a skip.

set -u

REPO="${REPO:-/src}"
POSTINST="${POSTINST:-$REPO/packaging/openwrt-ipk/scripts/postinst}"
PRERM="${PRERM:-$REPO/packaging/openwrt-ipk/scripts/prerm}"
RELEASED_PRERM="$REPO/testing/openwrt/fixtures/released-prerm"
INIT_GATEWAY="$REPO/packaging/openwrt-ipk/files/etc/init.d/fips-gateway"
APK_SCRIPTS="${APK_SCRIPTS:-}"
SHIPPED_YAML="$REPO/packaging/openwrt-ipk/files/etc/fips/fips.yaml"
# The fips.yaml every release up to 0.5.1 shipped, from before the gateway's
# default DNS port moved.
RELEASED_YAML="$REPO/testing/openwrt/fixtures/released-fips.yaml"
GATEWAY_RS="$REPO/src/config/gateway.rs"
SETUP_SCRIPT="$REPO/packaging/openwrt-ipk/files/etc/uci-defaults/90-fips-setup"
LEGACY_LISTEN='    listen: "[::1]:5353"'
SHIPPED_LISTEN='    # listen: "[::1]:5365"   # the default; the init script points dnsmasq at this port'
MIGRATED_MSG='fips: moved gateway.dns.listen off the mDNS port 5353 to the default [::1]:5365'

WORK=/tmp/fips-openwrt-scenarios
UPGRADE_MARKER=/tmp/fips-prerm-upgrade
# The uci stub's state and the directory holding the executable stubs. Fixed
# paths, because the .apk scripts run with only PATH in their environment.
UCI_DIR=/tmp/fips-openwrt-uci
STUB_BIN=/tmp/fips-openwrt-bin
DNSMASQ_OPT='dhcp.@dnsmasq[0].server'

FAILURES=0
CASES=0

note() { echo "  $*"; }

ok() {
    CASES=$((CASES + 1))
    echo "  ok   $*"
    return 0
}

bad() {
    CASES=$((CASES + 1))
    FAILURES=$((FAILURES + 1))
    echo "  FAIL $*"
    return 0
}

# Stub init scripts that record every call and keep an enable state file, so a
# scenario can assert both what was invoked and what the package left behind.
install_stubs() {
    mkdir -p /etc/init.d /etc/uci-defaults

    cat > /etc/init.d/fips-gateway <<'STUB'
#!/bin/sh
echo "fips-gateway $1" >> "$CALLS"
case "$1" in
    enable)  echo 1 > "$GW_STATE" ;;
    disable) echo 0 > "$GW_STATE" ;;
    enabled) [ "$(cat "$GW_STATE")" = 1 ] ;;
esac
STUB

    cat > /etc/init.d/fips <<'STUB'
#!/bin/sh
echo "fips $1" >> "$CALLS"
case "$1" in
    enable)  echo 1 > "$FIPS_STATE" ;;
    disable) echo 0 > "$FIPS_STATE" ;;
    enabled) [ "$(cat "$FIPS_STATE")" = 1 ] ;;
esac
STUB

    cat > /etc/uci-defaults/90-fips-setup <<'STUB'
#!/bin/sh
echo "uci-defaults" >> "$CALLS"
STUB

    chmod 0755 /etc/init.d/fips-gateway /etc/init.d/fips /etc/uci-defaults/90-fips-setup
    return 0
}

reset_state() {
    rm -rf "$WORK"
    mkdir -p "$WORK"
    CALLS="$WORK/calls"
    GW_STATE="$WORK/gateway-enabled"
    FIPS_STATE="$WORK/fips-enabled"
    export CALLS GW_STATE FIPS_STATE
    : > "$CALLS"
    echo 0 > "$GW_STATE"
    echo 0 > "$FIPS_STATE"
    rm -f "$UPGRADE_MARKER"
    unset PKG_UPGRADE
    install_stubs
    return 0
}

calls_oneline() {
    tr '\n' ';' < "$CALLS"
    return 0
}

assert_called() {
    # assert_called <expected call line> <what it means>
    if grep -qxF "$1" "$CALLS"; then
        ok "$2"
    else
        bad "$2 — '$1' is not among: $(calls_oneline)"
    fi
    return 0
}

assert_not_called() {
    if grep -qxF "$1" "$CALLS"; then
        bad "$2 — '$1' was called: $(calls_oneline)"
    else
        ok "$2"
    fi
    return 0
}

assert_none_called_with_prefix() {
    # assert_none_called_with_prefix <prefix> <what it means>
    # Fails if any recorded call begins with <prefix>, whatever follows it.
    if [ ! -r "$CALLS" ]; then
        bad "$2 — the call log $CALLS cannot be read"
        return 0
    fi
    matched=""
    while IFS= read -r line; do
        case "$line" in
        "$1"*) matched="$matched$line;" ;;
        esac
    done < "$CALLS"
    if [ -n "$matched" ]; then
        bad "$2 — called: $matched"
    else
        ok "$2"
    fi
    return 0
}

assert_file_is() {
    # assert_file_is <file> <expected contents> <what it means>
    got="$(cat "$1" 2>/dev/null)"
    if [ "$got" = "$2" ]; then
        ok "$3"
    else
        bad "$3 — expected '$2', got '$got'"
    fi
    return 0
}

assert_equals() {
    # assert_equals <got> <want> <what it means>
    if [ "$1" = "$2" ]; then
        ok "$3"
    else
        bad "$3 — expected '$2', got '$1'"
    fi
    return 0
}

assert_absent() {
    if [ -e "$1" ]; then
        bad "$2 — $1 still exists"
    else
        ok "$2"
    fi
    return 0
}

assert_present() {
    if [ -e "$1" ]; then
        ok "$2"
    else
        bad "$2 — $1 does not exist"
    fi
    return 0
}

first_call_line() {
    grep -nxF "$1" "$CALLS" | head -n 1 | cut -d: -f1
    return 0
}

assert_order() {
    # assert_order <first call> <second call> <what it means>
    first="$(first_call_line "$1")"
    second="$(first_call_line "$2")"
    if [ -z "$first" ] || [ -z "$second" ]; then
        bad "$3 — '$1' and '$2' were not both called: $(calls_oneline)"
    elif [ "$first" -lt "$second" ]; then
        ok "$3"
    else
        bad "$3 — '$2' came before '$1': $(calls_oneline)"
    fi
    return 0
}

# Install an executable uci that keeps each option as a file of values, one per
# line, under $UCI_DIR. Like the real uci, "get" prints a list on one line
# separated by single spaces and fails for an option with no values, and
# del_list removes every copy of the value. Other commands are only logged.
install_uci_stub() {
    rm -rf "$UCI_DIR"
    mkdir -p "$UCI_DIR" "$STUB_BIN"
    {
        echo '#!/bin/sh'
        echo "dir=$UCI_DIR"
        cat <<'STUB'
[ "${1:-}" = "-q" ] && shift
cmd="${1:-}"
[ $# -gt 0 ] && shift
echo "uci $cmd $*" >> "$dir/log"
file_of() {
    printf '%s/%s' "$dir" "$(printf '%s' "$1" | sed 's/[^A-Za-z0-9._-]/_/g')"
}
case "$cmd" in
get)
    f="$(file_of "$1")"
    [ -s "$f" ] || exit 1
    tr '\n' ' ' < "$f" | sed 's/ $//'
    echo
    ;;
add_list)
    echo "${1#*=}" >> "$(file_of "${1%%=*}")"
    ;;
del_list)
    f="$(file_of "${1%%=*}")"
    if [ -f "$f" ]; then
        grep -vxF -- "${1#*=}" "$f" > "$f.new"
        mv "$f.new" "$f"
    fi
    ;;
esac
exit 0
STUB
    } > "$STUB_BIN/uci"
    chmod 0755 "$STUB_BIN/uci"

    cat > /etc/init.d/dnsmasq <<'STUB'
#!/bin/sh
echo "dnsmasq $1" >> "$CALLS"
STUB
    chmod 0755 /etc/init.d/dnsmasq
    return 0
}

uci_seed() {
    # uci_seed <option> <value>...
    opt="$1"
    shift
    for value in "$@"; do
        "$STUB_BIN/uci" add_list "$opt=$value"
    done
    return 0
}

uci_sorted() {
    # uci_sorted <option>: the option's values, sorted, on one line.
    "$STUB_BIN/uci" -q get "$1" | tr ' ' '\n' | sort | tr '\n' ' '
    return 0
}

sorted_words() {
    printf '%s\n' "$@" | sort | tr '\n' ' '
    return 0
}

run_apk_script() {
    # run_apk_script <phase> <args...>
    # Runs one captured .apk script the way apk-tools v3 does: executed
    # directly, with only PATH in the environment. The stubs' own state
    # variables are passed through so they can record the calls.
    phase="$1"
    shift
    script="$APK_SCRIPTS/$phase"
    if [ -z "$APK_SCRIPTS" ] || [ ! -x "$script" ]; then
        bad "the .apk $phase script is not available at '$script'"
        return 1
    fi
    env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
        CALLS="$CALLS" GW_STATE="$GW_STATE" FIPS_STATE="$FIPS_STATE" \
        "$script" "$@" >/dev/null 2>&1
    return 0
}

# ── 1. Fresh install ────────────────────────────────────────────────────────
# opkg runs the postinst with "configure"; PKG_UPGRADE is set only on upgrades,
# so both its absence and an explicit 0 must leave the gateway alone.
scenario_fresh_install() {
    for pkg_upgrade in unset 0; do
        note "scenario 1: fresh install (PKG_UPGRADE $pkg_upgrade)"
        reset_state
        if [ "$pkg_upgrade" = "0" ]; then
            PKG_UPGRADE=0 sh "$POSTINST" configure >/dev/null 2>&1
        else
            sh "$POSTINST" configure >/dev/null 2>&1
        fi

        assert_called "fips enable" "the daemon is enabled on a fresh install"
        assert_called "fips start" "the daemon is started on a fresh install"
        assert_not_called "fips-gateway enable" "the gateway is not enabled on a fresh install"
        assert_not_called "fips-gateway start" "the gateway is not started on a fresh install"
        assert_file_is "$GW_STATE" "0" "the gateway is left disabled on a fresh install"
    done
    return 0
}

# ── 2. Upgrade from a released package ──────────────────────────────────────
# Its prerm disabled the gateway on its way out and left no marker, so the
# incoming postinst cannot tell an enabled gateway from a disabled one and
# re-enables it.
scenario_upgrade_from_released() {
    note "scenario 2: upgrade from a released package"
    reset_state
    echo 1 > "$GW_STATE"
    echo 1 > "$FIPS_STATE"

    sh "$RELEASED_PRERM" upgrade 0.5.1 >/dev/null 2>&1
    PKG_UPGRADE=1 sh "$POSTINST" configure >/dev/null 2>&1

    assert_called "fips-gateway enable" "the gateway is re-enabled after a released prerm disabled it"
    assert_called "fips-gateway start" "the gateway is started again"
    assert_file_is "$GW_STATE" "1" "the gateway ends up enabled"
    return 0
}

# ── 3. Upgrade from a package carrying these scripts, gateway enabled ───────
scenario_upgrade_enabled() {
    note "scenario 3: upgrade from these scripts, gateway enabled"
    reset_state
    echo 1 > "$GW_STATE"
    echo 1 > "$FIPS_STATE"

    sh "$PRERM" upgrade 0.5.2 >/dev/null 2>&1
    assert_file_is "$GW_STATE" "1" "the outgoing prerm does not disable the gateway on an upgrade"
    assert_not_called "fips-gateway disable" "the outgoing prerm does not call disable on an upgrade"
    assert_called "fips-gateway stop" "the outgoing prerm still stops the gateway"

    PKG_UPGRADE=1 sh "$POSTINST" configure >/dev/null 2>&1
    assert_file_is "$GW_STATE" "1" "the gateway stays enabled across the upgrade"
    assert_called "fips-gateway start" "an enabled gateway is started again"
    assert_not_called "fips-gateway enable" "an enabled gateway does not need re-enabling"
    assert_absent "$UPGRADE_MARKER" "the postinst removes the upgrade marker"
    return 0
}

# ── 4. Upgrade from a package carrying these scripts, gateway disabled ──────
scenario_upgrade_disabled() {
    note "scenario 4: upgrade from these scripts, gateway disabled"
    reset_state
    echo 1 > "$FIPS_STATE"

    sh "$PRERM" upgrade 0.5.2 >/dev/null 2>&1
    PKG_UPGRADE=1 sh "$POSTINST" configure >/dev/null 2>&1

    assert_file_is "$GW_STATE" "0" "a disabled gateway stays disabled across the upgrade"
    assert_not_called "fips-gateway enable" "a disabled gateway is not enabled by the upgrade"
    assert_not_called "fips-gateway start" "a disabled gateway is not started by the upgrade"
    assert_absent "$UPGRADE_MARKER" "the postinst removes the upgrade marker"
    return 0
}

# ── 5. Removal ──────────────────────────────────────────────────────────────
scenario_removal() {
    note "scenario 5: removal"
    reset_state
    echo 1 > "$GW_STATE"
    echo 1 > "$FIPS_STATE"

    sh "$PRERM" remove >/dev/null 2>&1

    assert_called "fips-gateway stop" "removal stops the gateway"
    assert_called "fips-gateway disable" "removal disables the gateway"
    assert_called "fips stop" "removal stops the daemon"
    assert_called "fips disable" "removal disables the daemon"
    assert_file_is "$GW_STATE" "0" "the gateway ends up disabled"
    assert_absent "$UPGRADE_MARKER" "removal leaves no upgrade marker"
    return 0
}

# ── 6. gateway_config_enabled reads the config ──────────────────────────────
scenario_config_reader() {
    note "scenario 6: gateway_config_enabled"
    reset_state

    # shellcheck source=/dev/null
    . "$INIT_GATEWAY"

    CONFIG="$SHIPPED_YAML"
    assert_equals "$(gateway_config_enabled)" "true" "the shipped fips.yaml reads as true"

    CONFIG="$WORK/disabled.yaml"
    cat > "$CONFIG" <<'YAML'
identity:
  key_file: "/etc/fips/node.key"

gateway:
  enabled: false
  pool: "fd01::/112"

peers: []
YAML
    assert_equals "$(gateway_config_enabled)" "false" "an explicitly disabled gateway reads as false"

    CONFIG="$WORK/no-gateway.yaml"
    cat > "$CONFIG" <<'YAML'
identity:
  key_file: "/etc/fips/node.key"

dns:
  enabled: true

peers: []
YAML
    assert_equals "$(gateway_config_enabled)" "" "a config with no gateway block reads as empty"
    return 0
}

# ── 7. start_service refuses to touch dnsmasq for a disabled gateway ────────
# The init script's helpers are redefined after sourcing it, so start_service
# runs its own decision against recorded stubs instead of uci, procd and the
# network.
scenario_start_service_guard() {
    note "scenario 7: start_service guard"

    # shellcheck source=/dev/null
    . "$INIT_GATEWAY"

    sysctl() { return 0; }
    modprobe() { return 0; }
    logger() { return 0; }
    sleep() { return 0; }
    procd_set_param() { return 0; }
    procd_close_instance() { return 0; }
    dnsmasq_swap_fips_upstream() { echo "dnsmasq_swap $1" >> "$CALLS"; return 0; }
    gateway_add_global_prefix() { echo "add_global_prefix" >> "$CALLS"; return 0; }
    gateway_add_ra_route() { echo "add_ra_route" >> "$CALLS"; return 0; }
    procd_open_instance() { echo "procd_open_instance" >> "$CALLS"; return 0; }

    reset_state
    CONFIG="$SHIPPED_YAML"
    start_service >/dev/null 2>&1
    assert_called "dnsmasq_swap 5365" "an enabled gateway redirects dnsmasq to the default port"
    assert_called "procd_open_instance" "an enabled gateway still starts the daemon"

    reset_state
    CONFIG="$WORK/explicit-5353.yaml"
    cat > "$CONFIG" <<'YAML'
gateway:
  enabled: true
  pool: "fd01::/112"
  dns:
    listen: "[::1]:5353"
YAML
    start_service >/dev/null 2>&1
    assert_called "dnsmasq_swap 5353" "dnsmasq follows an explicit gateway.dns.listen"

    reset_state
    CONFIG="$WORK/disabled.yaml"
    cat > "$CONFIG" <<'YAML'
gateway:
  enabled: false
  pool: "fd01::/112"
YAML
    start_service >/dev/null 2>&1
    assert_none_called_with_prefix "dnsmasq_swap " "a disabled gateway does not redirect dnsmasq"
    assert_not_called "add_global_prefix" "a disabled gateway does not add the LAN prefix"
    assert_not_called "add_ra_route" "a disabled gateway does not advertise the pool route"
    assert_not_called "procd_open_instance" "a disabled gateway does not start the daemon"
    return 0
}

# ── 8. apk fresh install ────────────────────────────────────────────────────
# apk-tools v3 runs only post-install, with the new version as its argument.
scenario_apk_fresh_install() {
    note "scenario 8: apk fresh install"
    reset_state

    run_apk_script post-install 0.6.0-r1 || return 0

    assert_called "fips enable" "an apk install enables the daemon"
    assert_called "fips start" "an apk install starts the daemon"
    assert_not_called "fips-gateway enable" "an apk install does not enable the gateway"
    assert_not_called "fips-gateway start" "an apk install does not start the gateway"
    assert_file_is "$GW_STATE" "0" "an apk install leaves the gateway disabled"
    return 0
}

# ── 9. apk upgrade, gateway enabled ─────────────────────────────────────────
# apk-tools v3 runs only the new package's pre-upgrade and post-upgrade, with
# "<new-version> <old-version>"; the old package runs nothing.
scenario_apk_upgrade_enabled() {
    note "scenario 9: apk upgrade, gateway enabled"
    reset_state
    echo 1 > "$GW_STATE"
    echo 1 > "$FIPS_STATE"

    run_apk_script pre-upgrade 0.6.0-r1 0.5.2-r1 || return 0
    assert_called "fips-gateway stop" "pre-upgrade stops the gateway"
    assert_called "fips stop" "pre-upgrade stops the daemon"
    assert_not_called "fips-gateway disable" "pre-upgrade does not disable the gateway"
    assert_not_called "fips disable" "pre-upgrade does not disable the daemon"
    assert_file_is "$GW_STATE" "1" "the gateway is still enabled after pre-upgrade"
    assert_present "$UPGRADE_MARKER" "pre-upgrade leaves the upgrade marker"

    run_apk_script post-upgrade 0.6.0-r1 0.5.2-r1 || return 0
    assert_order "fips stop" "fips start" "the daemon is started again after it was stopped"
    assert_order "fips-gateway stop" "fips-gateway start" "the gateway is started again after it was stopped"
    assert_not_called "fips-gateway enable" "an enabled gateway does not need re-enabling"
    assert_file_is "$GW_STATE" "1" "the gateway stays enabled across the apk upgrade"
    assert_absent "$UPGRADE_MARKER" "post-upgrade removes the upgrade marker"
    return 0
}

# ── 10. apk upgrade, gateway disabled ───────────────────────────────────────
scenario_apk_upgrade_disabled() {
    note "scenario 10: apk upgrade, gateway disabled"
    reset_state
    echo 1 > "$FIPS_STATE"

    run_apk_script pre-upgrade 0.6.0-r1 0.5.2-r1 || return 0
    run_apk_script post-upgrade 0.6.0-r1 0.5.2-r1 || return 0

    assert_order "fips stop" "fips start" "the daemon is started again after it was stopped"
    assert_file_is "$GW_STATE" "0" "a disabled gateway stays disabled across the apk upgrade"
    assert_not_called "fips-gateway enable" "a disabled gateway is not enabled by the apk upgrade"
    assert_not_called "fips-gateway start" "a disabled gateway is not started by the apk upgrade"
    assert_absent "$UPGRADE_MARKER" "post-upgrade removes the upgrade marker"
    return 0
}

# ── 11. gateway_dns_port reads the port the gateway will bind ───────────────
scenario_dns_port_reader() {
    note "scenario 11: gateway_dns_port"
    reset_state

    # shellcheck source=/dev/null
    . "$INIT_GATEWAY"

    CONFIG="$SHIPPED_YAML"
    assert_equals "$(gateway_dns_port)" "5365" "the shipped fips.yaml reads as the default port"

    CONFIG="$RELEASED_YAML"
    assert_equals "$(gateway_dns_port)" "5353" "the previously shipped fips.yaml reads as 5353"

    CONFIG="$WORK/v4.yaml"
    cat > "$CONFIG" <<'YAML'
gateway:
  enabled: true
  dns:
    listen: '127.0.0.1:5400'
YAML
    assert_equals "$(gateway_dns_port)" "5400" "a single-quoted IPv4 listen address reads as its port"

    CONFIG="$WORK/port-forward.yaml"
    cat > "$CONFIG" <<'YAML'
gateway:
  enabled: true
  pool: "fd01::/112"
  port_forwards:
    - listen_port: 8080
      proto: tcp
      target: "[fd00::1]:80"
YAML
    assert_equals "$(gateway_dns_port)" "5365" "a port forward's listen_port is not the DNS listen port"

    CONFIG="$WORK/transport-listen.yaml"
    cat > "$CONFIG" <<'YAML'
transports:
  ethernet:
    lan:
      interface: "br-lan"
      listen: true
gateway:
  enabled: true
  pool: "fd01::/112"
YAML
    assert_equals "$(gateway_dns_port)" "5365" "a listen key outside the gateway block is ignored"

    CONFIG="$WORK/commented.yaml"
    cat > "$CONFIG" <<'YAML'
gateway:
  enabled: true
  dns:
    # listen: "[::1]:5400"
    upstream: "[::1]:5354"
YAML
    assert_equals "$(gateway_dns_port)" "5365" "a commented listen line is ignored"

    CONFIG="$WORK/no-gateway.yaml"
    cat > "$CONFIG" <<'YAML'
dns:
  enabled: true

peers: []
YAML
    assert_equals "$(gateway_dns_port)" "5365" "a config with no gateway block reads as the default port"
    return 0
}

# ── 12. The init script's default port matches the gateway's ───────────────
scenario_default_port_parity() {
    note "scenario 12: GW_DNS_DEFAULT matches DEFAULT_DNS_LISTEN"

    # shellcheck source=/dev/null
    . "$INIT_GATEWAY"

    rust_listen="$(sed -n 's/^const DEFAULT_DNS_LISTEN: &str = "\(.*\)";$/\1/p' "$GATEWAY_RS" 2>/dev/null)"
    rust_port="${rust_listen##*:}"
    case "$rust_port" in
    '' | *[!0-9]*)
        bad "could not read a port from DEFAULT_DNS_LISTEN in $GATEWAY_RS (got '$rust_listen')"
        return 0
        ;;
    esac
    assert_equals "${GW_DNS_DEFAULT:-}" "$rust_port" "the init script's GW_DNS_DEFAULT is the gateway's default port"
    return 0
}

# ── 13. The swap clears every loopback .fips forward ────────────────────────
# The real dnsmasq_swap_fips_upstream runs against the uci stub.
scenario_swap_cleanup() {
    note "scenario 13: dnsmasq_swap_fips_upstream"
    reset_state
    install_uci_stub

    # shellcheck source=/dev/null
    . "$INIT_GATEWAY"

    saved_path="$PATH"
    PATH="$STUB_BIN:$PATH"

    uci_seed "$DNSMASQ_OPT" "/fips/::1#5353" "/fips/127.0.0.1#5400" "/fips/192.168.1.5#53" "/lan/192.168.1.2"
    lines="$(uci -q get "$DNSMASQ_OPT" | wc -l | tr -d ' ')"
    assert_equals "$lines" "1" "the uci stub prints a list on one line, as uci does"

    dnsmasq_swap_fips_upstream 5365 >/dev/null 2>&1
    assert_equals "$(uci_sorted "$DNSMASQ_OPT")" \
        "$(sorted_words /lan/192.168.1.2 /fips/192.168.1.5#53 /fips/::1#5365)" \
        "the swap to 5365 clears every loopback .fips forward and keeps the others"

    dnsmasq_swap_fips_upstream 5354 >/dev/null 2>&1
    assert_equals "$(uci_sorted "$DNSMASQ_OPT")" \
        "$(sorted_words /lan/192.168.1.2 /fips/192.168.1.5#53 /fips/::1#5354)" \
        "the swap back to 5354 leaves only the daemon's loopback forward"
    assert_called "dnsmasq restart" "the swap restarts dnsmasq"

    PATH="$saved_path"
    return 0
}

# ── 14. 90-fips-setup migrates the previously shipped listen line ──────────
# The real 90-fips-setup runs, executed by the ipk postinst and the apk
# post-upgrade script, and sourced in a subshell as OpenWrt's default_postinst
# and first-boot uci-defaults run do. uci, logger, modprobe and sysctl are
# stubs on PATH, and in /usr/sbin for the apk script, whose PATH is fixed.

install_setup_stubs() {
    install_uci_stub
    for cmd in logger modprobe sysctl; do
        printf '#!/bin/sh\necho "%s $*" >> %s/stub-calls\n' "$cmd" "$UCI_DIR" > "$STUB_BIN/$cmd"
        chmod 0755 "$STUB_BIN/$cmd"
    done
    mkdir -p /usr/sbin /etc/modules.d /etc/fips
    # rm first: cp onto a busybox applet link would overwrite busybox itself.
    for cmd in uci logger modprobe sysctl; do
        rm -f "/usr/sbin/$cmd"
        cp "$STUB_BIN/$cmd" "/usr/sbin/$cmd"
    done
    cp "$SETUP_SCRIPT" /etc/uci-defaults/90-fips-setup
    chmod 0755 /etc/uci-defaults/90-fips-setup
    return 0
}

remove_setup_stubs() {
    for cmd in uci logger modprobe sysctl; do
        rm -f "/usr/sbin/$cmd"
    done
    rm -rf "$STUB_BIN" /etc/fips
    return 0
}

install_config() {
    # install_config <file>: installed mode 0644, so a mode check can fail.
    cp "$1" /etc/fips/fips.yaml
    chmod 0644 /etc/fips/fips.yaml
    return 0
}

assert_migrated() {
    # assert_migrated <how the script ran>
    CONFIG=/etc/fips/fips.yaml
    assert_equals "$(gateway_dns_port)" "5365" "$1: the init script reads the default port"
    changes="$(diff -U0 "$RELEASED_YAML" /etc/fips/fips.yaml 2>/dev/null | grep -v '^---' | grep -v '^+++' | grep '^[-+]')"
    assert_equals "$changes" "$(printf '%s\n%s' "-$LEGACY_LISTEN" "+$SHIPPED_LISTEN")" \
        "$1: only the listen line changed, to the shipped form"
    assert_equals "$(stat -c %a /etc/fips/fips.yaml 2>/dev/null)" "600" "$1: the file is mode 0600"
    return 0
}

run_setup() {
    # run_setup <output file>: executes the installed 90-fips-setup.
    sh /etc/uci-defaults/90-fips-setup > "$1" 2>&1
    return $?
}

scenario_listen_migration() {
    note "scenario 14: 90-fips-setup migrates the shipped gateway listen line"

    # shellcheck source=/dev/null
    . "$INIT_GATEWAY"
    saved_path="$PATH"
    PATH="$STUB_BIN:$PATH"

    # 1. Executed by the ipk postinst on an upgrade.
    reset_state
    install_setup_stubs
    install_config "$RELEASED_YAML"
    touch "$UPGRADE_MARKER"
    PKG_UPGRADE=1 sh "$POSTINST" configure > "$WORK/postinst.out" 2>&1
    assert_migrated "ipk upgrade"
    if grep -qxF "$MIGRATED_MSG" "$WORK/postinst.out"; then
        ok "ipk upgrade: the migration is reported on stdout"
    else
        bad "ipk upgrade: no migration message in: $(tr '\n' ';' < "$WORK/postinst.out")"
    fi
    assert_absent /etc/uci-defaults/90-fips-setup "ipk upgrade: the postinst removed 90-fips-setup, so it exited 0"

    # 2. Executed by the apk post-upgrade script.
    reset_state
    install_setup_stubs
    install_config "$RELEASED_YAML"
    touch "$UPGRADE_MARKER"
    if run_apk_script post-upgrade 0.6.0-r1 0.5.2-r1; then
        assert_migrated "apk upgrade"
        assert_absent /etc/uci-defaults/90-fips-setup "apk upgrade: post-upgrade removed 90-fips-setup, so it exited 0"
    fi

    # 3. Sourced in a subshell, without the functions earlier scenarios define.
    reset_state
    install_setup_stubs
    install_config "$RELEASED_YAML"
    (
        unset -f logger modprobe sysctl sleep 2>/dev/null
        cd /etc/uci-defaults && . ./90-fips-setup
    ) > "$WORK/sourced.out" 2>&1
    assert_equals "$?" "0" "sourced: the subshell exits 0"
    assert_migrated "sourced"

    # 4. Anything but the exact shipped line is left byte-identical.
    for variant in other-port indent comment no-gateway; do
        reset_state
        install_setup_stubs
        input="$WORK/$variant.yaml"
        case "$variant" in
        other-port) sed 's|^    listen: "\[::1\]:5353"$|    listen: "[::1]:5400"|' "$RELEASED_YAML" > "$input" ;;
        indent) sed 's|^    listen: "\[::1\]:5353"$|      listen: "[::1]:5353"|' "$RELEASED_YAML" > "$input" ;;
        comment) sed 's|^    listen: "\[::1\]:5353"$|    listen: "[::1]:5353"  # kept|' "$RELEASED_YAML" > "$input" ;;
        no-gateway) printf 'node:\n  identity:\n    persistent: true\n\npeers: []\n' > "$input" ;;
        esac
        if [ "$variant" != "no-gateway" ] && cmp -s "$input" "$RELEASED_YAML"; then
            bad "negative case $variant: the fixture edit changed nothing, so the case would prove nothing"
            continue
        fi
        install_config "$input"
        run_setup "$WORK/$variant.out"
        if cmp -s "$input" /etc/fips/fips.yaml; then
            ok "negative case $variant: the file is left byte-identical"
        else
            bad "negative case $variant: the file was changed"
        fi
    done

    # 5. No config file.
    reset_state
    install_setup_stubs
    rm -f /etc/fips/fips.yaml
    run_setup "$WORK/no-config.out"
    assert_equals "$?" "0" "no config: the script exits 0"
    assert_absent /etc/fips/fips.yaml "no config: no file is created"
    if grep -qF "$MIGRATED_MSG" "$WORK/no-config.out"; then
        bad "no config: a migration was reported"
    else
        ok "no config: no migration is reported"
    fi

    # 6. A second run changes nothing.
    reset_state
    install_setup_stubs
    install_config "$RELEASED_YAML"
    run_setup "$WORK/first.out"
    cp /etc/fips/fips.yaml "$WORK/migrated.yaml"
    run_setup "$WORK/second.out"
    if cmp -s "$WORK/migrated.yaml" /etc/fips/fips.yaml; then
        ok "a second run leaves the migrated file byte-identical"
    else
        bad "a second run changed the migrated file"
    fi

    # 7. Stale loopback gateway entries for 5353 are removed; others are kept.
    reset_state
    install_setup_stubs
    install_config "$SHIPPED_YAML"
    uci_seed "$DNSMASQ_OPT" "/fips/::1#5353" "/fips/127.0.0.1#5353" "/fips/192.168.1.5#53"
    run_setup "$WORK/entries.out"
    assert_equals "$(uci_sorted "$DNSMASQ_OPT")" \
        "$(sorted_words /fips/192.168.1.5#53 /fips/::1#5354)" \
        "the legacy 5353 entries are removed and the daemon's entry is added"

    PATH="$saved_path"
    remove_setup_stubs
    return 0
}

echo "OpenWrt maintainer-script scenarios (shell: $(readlink -f /proc/$$/exe 2>/dev/null || echo sh))"
echo "  postinst: $POSTINST"
echo "  prerm:    $PRERM"
echo "  apk:      ${APK_SCRIPTS:-(not set)}"

scenario_fresh_install
scenario_upgrade_from_released
scenario_upgrade_enabled
scenario_upgrade_disabled
scenario_removal
scenario_config_reader
scenario_start_service_guard
scenario_apk_fresh_install
scenario_apk_upgrade_enabled
scenario_apk_upgrade_disabled
scenario_dns_port_reader
scenario_default_port_parity
scenario_swap_cleanup
scenario_listen_migration

echo ""
if [ "$FAILURES" -eq 0 ]; then
    echo "openwrt-scripts: all $CASES checks passed"
    exit 0
fi
echo "openwrt-scripts: $FAILURES of $CASES checks failed"
exit 1
