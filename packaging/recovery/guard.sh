#!/bin/sh
# Router-local deployment guard. Install outside the replaceable FIPS packages.
# Ansible stages previous IPKs and enables the boot service before calling arm.
set -u

TEST_ROOT=${FIPS_TEST_FS_ROOT:-}
DEVICE_ETC="$TEST_ROOT/etc"
ROOT="$DEVICE_ETC/fips-recovery"
PENDING="$ROOT/pending"
PACKAGES='fips gl-sdk4-ui-fips gl-e5800-dashboard'

fail() { echo "fips recovery: $*" >&2; exit 1; }
now() { if [ -n "${FIPS_TEST_NOW:-}" ]; then echo "$FIPS_TEST_NOW"; else date +%s; fi; }
uptime() { if [ -n "${FIPS_TEST_UPTIME:-}" ]; then echo "$FIPS_TEST_UPTIME"; else cut -d. -f1 /proc/uptime; fi; }
boot_id() { if [ -n "${FIPS_TEST_BOOT_ID:-}" ]; then echo "$FIPS_TEST_BOOT_ID"; else cat /proc/sys/kernel/random/boot_id; fi; }
valid_id() { case "$1" in ''|*[!A-Za-z0-9_-]*) return 1;; *) return 0;; esac; }
installed() { opkg status "$1" 2>/dev/null | awk '/^Status:/ { if ($4 == "installed") found=1 } END { exit !found }'; }
service() { [ -x "$DEVICE_ETC/init.d/$1" ] && "$DEVICE_ETC/init.d/$1" "$2"; }

read_pending() {
    [ -f "$PENDING" ] || return 1
    IFS=' ' read -r txn wall_limit uptime_limit original_boot < "$PENDING" || return 1
    valid_id "$txn" || return 1
    case "$wall_limit:$uptime_limit" in *[!0-9:]*) return 1;; esac
    [ -d "$ROOT/$txn" ] || return 1
}

verify_previous() {
    package=$1
    archive="$ROOT/$txn/previous/$package.ipk"
    digest_file="$ROOT/$txn/previous/$package.sha256"
    [ -f "$archive" ] && [ -f "$digest_file" ] || fail "missing known-good package: $package"
    expected=$(cat "$digest_file")
    case "$expected" in *[!0-9a-f]*|'') fail "invalid package checksum: $package";; esac
    [ "${#expected}" -eq 64 ] || fail "invalid package checksum length: $package"
    actual=$(sha256sum "$archive" | awk '{print $1}')
    [ "$actual" = "$expected" ] || fail "known-good checksum mismatch: $package"
}

arm() {
    txn=${1:-}
    seconds=${2:-}
    valid_id "$txn" || fail 'invalid transaction ID'
    case "$seconds" in *[!0-9]*|'') fail 'invalid deadline';; esac
    [ "$seconds" -ge 60 ] && [ "$seconds" -le 900 ] || fail 'deadline must be 60..900 seconds'
    [ ! -e "$PENDING" ] || fail 'another deployment is pending'
    [ -d "$ROOT/$txn/previous" ] || fail 'known-good directory missing'
    [ -x "$DEVICE_ETC/init.d/fips-recovery" ] || fail 'boot guard is missing'
    # The init script must be enabled before any package or network change.
    "$DEVICE_ETC/init.d/fips-recovery" enabled >/dev/null 2>&1 || fail 'boot guard is disabled'
    "$DEVICE_ETC/init.d/fips-recovery" status >/dev/null 2>&1 || fail 'boot guard is not running'
    mkdir -p "$ROOT/$txn/backup" || fail 'cannot create backup directory'
    chmod 0700 "$ROOT" "$ROOT/$txn" "$ROOT/$txn/backup" || fail 'cannot protect backup directory'
    : > "$ROOT/$txn/backup/installed"
    for package in $PACKAGES; do
        if installed "$package"; then
            verify_previous "$package"
            expected_version=$(cat "$ROOT/$txn/previous/$package.version" 2>/dev/null) || fail "known-good version missing: $package"
            current_version=$(opkg status "$package" | sed -n 's/^Version: //p')
            [ "$current_version" = "$expected_version" ] || fail "known-good version differs from installed: $package"
            echo "$package" >> "$ROOT/$txn/backup/installed"
        fi
    done
    if [ -d "$DEVICE_ETC/fips" ]; then
        tar -czf "$ROOT/$txn/backup/fips.tar.gz" -C "$DEVICE_ETC" fips || fail 'FIPS backup failed'
        chmod 0600 "$ROOT/$txn/backup/fips.tar.gz"
    fi
    for name in firewall network dhcp; do
        if [ -f "$DEVICE_ETC/config/$name" ]; then
            cp "$DEVICE_ETC/config/$name" "$ROOT/$txn/backup/$name" || fail "backup failed: $name"
            chmod 0600 "$ROOT/$txn/backup/$name"
        fi
    done
    echo "$(now) $(uptime) $(boot_id)" > "$ROOT/$txn/backup/armed-at"
    chmod 0600 "$ROOT/$txn/backup/armed-at"
    wall_limit=$(($(now) + seconds))
    uptime_limit=$(($(uptime) + seconds))
    original_boot=$(boot_id)
    printf '%s %s %s %s\n' "$txn" "$wall_limit" "$uptime_limit" "$original_boot" > "$PENDING.tmp" || fail 'cannot arm guard'
    chmod 0600 "$PENDING.tmp"
    mv "$PENDING.tmp" "$PENDING" || fail 'cannot arm guard'
    sync
    echo "ARMED $txn"
}

restore_config() {
    name=$1
    backup="$ROOT/$txn/backup/$name"
    target="$DEVICE_ETC/config/$name"
    if [ ! -e "$backup" ]; then
        if [ -e "$target" ] || [ -L "$target" ]; then
            rm -f "$target" || return 1
            return 2
        fi
        return 0
    fi
    [ ! -L "$target" ] || return 1
    if [ -f "$backup" ] && { [ ! -f "$target" ] || ! cmp -s "$backup" "$target"; }; then
        mkdir -p "$DEVICE_ETC/config" || return 1
        cp "$backup" "$target" || return 1
        chmod 0600 "$target" || return 1
        return 2
    fi
    return 0
}

rollback() {
    read_pending || fail 'no valid pending deployment'
    # Return to the vendor display even if a custom dashboard is crash-looping.
    if [ -x "$TEST_ROOT/root/dashboard/toggle.sh" ]; then
        "$TEST_ROOT/root/dashboard/toggle.sh" off >/dev/null 2>&1 || true
    fi
    service citydash stop >/dev/null 2>&1 || true
    service gl_screen enable >/dev/null 2>&1 || true
    service gl_screen start >/dev/null 2>&1 || true
    service fips stop >/dev/null 2>&1 || true

    network_changed=0
    firewall_changed=0
    restore_config network; rc=$?
    [ "$rc" -eq 0 ] || [ "$rc" -eq 2 ] || return 1
    [ "$rc" -eq 2 ] && network_changed=1
    restore_config dhcp; rc=$?
    [ "$rc" -eq 0 ] || [ "$rc" -eq 2 ] || return 1
    [ "$rc" -eq 2 ] && network_changed=1
    restore_config firewall; rc=$?
    [ "$rc" -eq 0 ] || [ "$rc" -eq 2 ] || return 1
    [ "$rc" -eq 2 ] && firewall_changed=1
    [ "$network_changed" -eq 0 ] || service network reload >/dev/null 2>&1 || return 1
    [ "$firewall_changed" -eq 0 ] || service firewall restart >/dev/null 2>&1 || return 1

    # Remove newly introduced packages first, then restore exact prior IPKs.
    for package in gl-sdk4-ui-fips gl-e5800-dashboard fips; do
        if ! grep -qx "$package" "$ROOT/$txn/backup/installed" && installed "$package"; then
            opkg remove "$package" || return 1
        fi
    done
    for package in $PACKAGES; do
        if grep -qx "$package" "$ROOT/$txn/backup/installed"; then
            verify_previous "$package"
            opkg install --force-downgrade "$ROOT/$txn/previous/$package.ipk" || return 1
        fi
    done
    if [ -f "$ROOT/$txn/backup/fips.tar.gz" ]; then
        mkdir -p "$DEVICE_ETC" || return 1
        tar -xzf "$ROOT/$txn/backup/fips.tar.gz" -C "$DEVICE_ETC" || return 1
    else
        rm -rf "$DEVICE_ETC/fips" || return 1
    fi
    service fips restart >/dev/null 2>&1 || true
    # A dashboard postinst can start its watcher; leave the stock display active.
    if [ -x "$TEST_ROOT/root/dashboard/toggle.sh" ]; then
        "$TEST_ROOT/root/dashboard/toggle.sh" off >/dev/null 2>&1 || true
    fi
    service citydash stop >/dev/null 2>&1 || true
    service gl_screen enable >/dev/null 2>&1 || true
    service gl_screen start >/dev/null 2>&1 || true
    printf '%s\n' "ROLLED_BACK $txn" > "$ROOT/$txn/result"
    chmod 0600 "$ROOT/$txn/result"
    rm -f "$PENDING"
    sync
    echo "ROLLED_BACK $txn"
}

check() {
    [ -e "$PENDING" ] || return 0
    read_pending || fail 'pending marker is invalid; manual recovery required'
    current_boot=$(boot_id)
    current_wall=$(now)
    current_uptime=$(uptime)
    if [ "$current_boot" != "$original_boot" ] ||
       [ "$current_wall" -ge "$wall_limit" ] ||
       [ "$current_uptime" -ge "$uptime_limit" ]; then
        rollback
    fi
}

confirm() {
    read_pending || fail 'no pending deployment'
    [ "$txn" = "${1:-}" ] || fail 'transaction ID mismatch'
    printf '%s\n' "CONFIRMED $txn" > "$ROOT/$txn/result"
    chmod 0600 "$ROOT/$txn/result"
    rm -f "$PENDING"
    sync
    echo "CONFIRMED $txn"
}

watch() {
    while :; do
        check || true
        sleep 2
    done
}

case "${1:-}" in
    arm) shift; arm "$@";;
    check) check;;
    rollback) rollback;;
    confirm) shift; confirm "$@";;
    watch) watch;;
    status) if read_pending; then echo "PENDING $txn $wall_limit"; else echo NONE; fi;;
    *) fail 'usage: guard.sh arm ID SECONDS | check | rollback | confirm ID | watch | status';;
esac
