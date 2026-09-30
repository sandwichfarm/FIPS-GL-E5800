#!/bin/sh
# Router-local deployment guard. Install outside the replaceable FIPS packages.
# Ansible stages previous IPKs and enables the boot service before calling arm.
set -u

TEST_ROOT=${FIPS_TEST_FS_ROOT:-}
DEVICE_ETC="$TEST_ROOT/etc"
ROOT="$DEVICE_ETC/fips-recovery"
PENDING="$ROOT/pending"
LOCK_DIR="$TEST_ROOT/tmp/fips-recovery"
LOCK="$LOCK_DIR/guard.lock"
PACKAGES='fips gl-sdk4-ui-fips gl-e5800-dashboard'
RUNTIME_LIST="$ROOT/runtime-packages"

fail() { echo "fips recovery: $*" >&2; exit 1; }
now() { if [ -n "${FIPS_TEST_NOW:-}" ]; then echo "$FIPS_TEST_NOW"; else date +%s; fi; }
uptime() { if [ -n "${FIPS_TEST_UPTIME:-}" ]; then echo "$FIPS_TEST_UPTIME"; else cut -d. -f1 /proc/uptime; fi; }
boot_id() { if [ -n "${FIPS_TEST_BOOT_ID:-}" ]; then echo "$FIPS_TEST_BOOT_ID"; else cat /proc/sys/kernel/random/boot_id; fi; }
valid_id() { case "$1" in ''|*[!A-Za-z0-9_-]*) return 1;; *) return 0;; esac; }
valid_package() { case "$1" in ''|*[!A-Za-z0-9_.+-]*) return 1;; *) return 0;; esac; }
installed() {
    opkg status "$1" 2>/dev/null | awk -v name="$1" '
        /^Package:/ { selected=($2 == name) }
        /^Status:/ && selected && $4 == "installed" { found=1 }
        END { exit !found }'
}
present() { opkg status "$1" 2>/dev/null | awk -v name="$1" '/^Package:/ && $2 == name { found=1 } END { exit !found }'; }
service() { [ -x "$DEVICE_ETC/init.d/$1" ] && "$DEVICE_ETC/init.d/$1" "$2"; }

release_lock() {
    [ "$(readlink "$LOCK" 2>/dev/null)" = "$$" ] && rm -f "$LOCK"
    return 0
}
prepare_lock_dir() {
    [ ! -L "$LOCK_DIR" ] || return 1
    mkdir -p "$LOCK_DIR" || return 1
    [ ! -L "$LOCK_DIR" ] && [ -d "$LOCK_DIR" ] || return 1
    chown "$(id -u):$(id -g)" "$LOCK_DIR" || return 1
    chmod 0700 "$LOCK_DIR" || return 1
}
try_lock() {
    prepare_lock_dir || return 1
    ln -s "$$" "$LOCK" 2>/dev/null || return 1
    trap 'release_lock' 0
    trap 'exit 1' 1 2 3 15
}
require_lock() { try_lock || fail 'another recovery guard operation is running'; }
clear_stale_lock() {
    prepare_lock_dir || return 1
    [ -L "$LOCK" ] || return 0
    holder=$(readlink "$LOCK") || return 1
    case "$holder" in ''|*[!0-9]*) return 1;; esac
    kill -0 "$holder" 2>/dev/null || rm -f "$LOCK"
}

read_pending() {
    [ -f "$PENDING" ] || return 1
    IFS=' ' read -r txn wall_limit uptime_limit original_boot < "$PENDING" || return 1
    valid_id "$txn" || return 1
    case "$wall_limit" in ''|*[!0-9]*) return 1;; esac
    case "$uptime_limit" in ''|*[!0-9]*) return 1;; esac
    [ -n "$original_boot" ] || return 1
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
    mode=${3:-packages}
    valid_id "$txn" || fail 'invalid transaction ID'
    case "$mode" in packages|config_only) ;; *) fail 'invalid transaction mode';; esac
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
    printf '%s\n' "$mode" > "$ROOT/$txn/backup/mode"
    chmod 0600 "$ROOT/$txn/backup/mode"
    : > "$ROOT/$txn/backup/installed"
    : > "$ROOT/$txn/backup/runtime-packages"
    : > "$ROOT/$txn/backup/runtime-installed"
    if [ "$mode" = packages ] && [ -f "$RUNTIME_LIST" ]; then
        while IFS= read -r package; do
            valid_package "$package" || fail 'invalid offline runtime package list'
            printf '%s\n' "$package" >> "$ROOT/$txn/backup/runtime-packages"
            if installed "$package"; then
                printf '%s\n' "$package" >> "$ROOT/$txn/backup/runtime-installed"
            fi
        done < "$RUNTIME_LIST"
    fi
    chmod 0600 "$ROOT/$txn/backup/runtime-packages" "$ROOT/$txn/backup/runtime-installed"
    if [ "$mode" = packages ]; then
        for package in $PACKAGES; do
            if installed "$package"; then
                verify_previous "$package"
                expected_version=$(cat "$ROOT/$txn/previous/$package.version" 2>/dev/null) || fail "known-good version missing: $package"
                current_version=$(opkg status "$package" | sed -n 's/^Version: //p')
                [ "$current_version" = "$expected_version" ] || fail "known-good version differs from installed: $package"
                echo "$package" >> "$ROOT/$txn/backup/installed"
            fi
        done
    fi
    [ ! -L "$DEVICE_ETC/fips" ] || fail 'FIPS directory cannot be a symlink'
    if [ -d "$DEVICE_ETC/fips" ]; then
        tar -czf "$ROOT/$txn/backup/fips.tar.gz" -C "$DEVICE_ETC" fips || fail 'FIPS backup failed'
        chmod 0600 "$ROOT/$txn/backup/fips.tar.gz"
    fi
    if [ -x "$DEVICE_ETC/init.d/fips" ]; then
        if "$DEVICE_ETC/init.d/fips" enabled >/dev/null 2>&1; then
            echo enabled > "$ROOT/$txn/backup/fips-service"
        else
            echo disabled > "$ROOT/$txn/backup/fips-service"
        fi
    else
        echo absent > "$ROOT/$txn/backup/fips-service"
    fi
    chmod 0600 "$ROOT/$txn/backup/fips-service"
    if [ -x "$DEVICE_ETC/init.d/fips-gateway" ]; then
        if "$DEVICE_ETC/init.d/fips-gateway" enabled >/dev/null 2>&1; then
            echo enabled > "$ROOT/$txn/backup/gateway-service"
        else
            echo disabled > "$ROOT/$txn/backup/gateway-service"
        fi
    else
        echo absent > "$ROOT/$txn/backup/gateway-service"
    fi
    chmod 0600 "$ROOT/$txn/backup/gateway-service"
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
    mode=$(cat "$ROOT/$txn/backup/mode" 2>/dev/null) || return 1
    case "$mode" in packages|config_only) ;; *) return 1;; esac
    if [ "$mode" = packages ]; then
        # Replacing a dashboard package can leave the display crash-looping.
        # A FIPS configuration-only rollback must preserve its current owner.
        if [ -x "$TEST_ROOT/root/dashboard/toggle.sh" ]; then
            "$TEST_ROOT/root/dashboard/toggle.sh" off >/dev/null 2>&1 || true
        fi
        service citydash stop >/dev/null 2>&1 || true
        service gl_screen enable >/dev/null 2>&1 || true
        service gl_screen start >/dev/null 2>&1 || true
    fi
    service fips-gateway stop >/dev/null 2>&1 || true
    service fips stop >/dev/null 2>&1 || true
    if [ "$mode" = packages ]; then
        # Remove newly introduced packages first, then restore exact prior IPKs.
        for package in gl-sdk4-ui-fips gl-e5800-dashboard fips; do
            if ! grep -qx "$package" "$ROOT/$txn/backup/installed" && present "$package"; then
                opkg remove "$package" || return 1
            fi
        done
        # The list is in dependent-first order. Never remove a runtime package
        # that was present before this transaction, even after a partial install.
        while IFS= read -r package; do
            valid_package "$package" || return 1
            if ! grep -qx "$package" "$ROOT/$txn/backup/runtime-installed" && present "$package"; then
                opkg remove "$package" || return 1
            fi
        done < "$ROOT/$txn/backup/runtime-packages"
        for package in $PACKAGES; do
            if grep -qx "$package" "$ROOT/$txn/backup/installed"; then
                verify_previous "$package"
                opkg install --force-downgrade "$ROOT/$txn/previous/$package.ipk" || return 1
            fi
        done
    fi
    # A failed UCI edit may leave /tmp/.uci deltas even when the saved config
    # files still match the backup. Deployment refuses preexisting deltas, so
    # these belong to the guarded transaction and must be removed on rollback.
    command -v uci >/dev/null 2>&1 || return 1
    for name in network dhcp firewall; do
        uci -q revert "$name" || return 1
    done
    # Package maintainer scripts can touch these files; restore them last.
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

    if [ -f "$ROOT/$txn/backup/fips.tar.gz" ]; then
        tar -tzf "$ROOT/$txn/backup/fips.tar.gz" >/dev/null || return 1
        rm -rf "$DEVICE_ETC/fips" || return 1
        mkdir -p "$DEVICE_ETC" || return 1
        tar -xzf "$ROOT/$txn/backup/fips.tar.gz" -C "$DEVICE_ETC" || return 1
    else
        rm -rf "$DEVICE_ETC/fips" || return 1
    fi
    if command -v nft >/dev/null 2>&1; then
        nft delete table inet fips >/dev/null 2>&1 || true
        if [ -s "$DEVICE_ETC/fips/router/mesh.nft" ] &&
           [ "$(cat "$ROOT/$txn/backup/fips-service")" = enabled ] &&
           [ "$(jsonfilter -i "$DEVICE_ETC/fips/router/settings.json" -e '@.enabled' 2>/dev/null)" = true ]; then
            nft -f "$DEVICE_ETC/fips/router/mesh.nft" || return 1
        fi
    fi
    case "$(cat "$ROOT/$txn/backup/fips-service")" in
        enabled)
            service fips enable >/dev/null 2>&1 || return 1
            service fips restart >/dev/null 2>&1 || return 1
            ;;
        disabled)
            service fips stop >/dev/null 2>&1 || true
            service fips disable >/dev/null 2>&1 || return 1
            ;;
        absent) service fips stop >/dev/null 2>&1 || true ;;
        *) return 1 ;;
    esac
    case "$(cat "$ROOT/$txn/backup/gateway-service")" in
        enabled)
            service fips-gateway enable >/dev/null 2>&1 || return 1
            service fips-gateway restart >/dev/null 2>&1 || return 1
            ;;
        disabled)
            service fips-gateway stop >/dev/null 2>&1 || true
            service fips-gateway disable >/dev/null 2>&1 || return 1
            ;;
        absent) service fips-gateway stop >/dev/null 2>&1 || true ;;
        *) return 1 ;;
    esac
    if [ "$mode" = packages ]; then
        # A dashboard postinst can start its watcher; leave stock active.
        if [ -x "$TEST_ROOT/root/dashboard/toggle.sh" ]; then
            "$TEST_ROOT/root/dashboard/toggle.sh" off >/dev/null 2>&1 || true
        fi
        service citydash stop >/dev/null 2>&1 || true
        # Do not report rollback complete while the physical screen is dark.
        # Keep the pending marker so the watchdog can retry after a failure.
        service gl_screen enable >/dev/null 2>&1 || return 1
        service gl_screen start >/dev/null 2>&1 || return 1
        service gl_screen status >/dev/null 2>&1 || return 1
    fi
    printf '%s\n' "ROLLED_BACK $txn" > "$ROOT/$txn/result"
    chmod 0600 "$ROOT/$txn/result"
    rm -f "$PENDING"
    sync
    echo "ROLLED_BACK $txn"
}

deadline_expired() {
    [ "$(boot_id)" != "$original_boot" ] ||
    [ "$(now)" -ge "$wall_limit" ] ||
    [ "$(uptime)" -ge "$uptime_limit" ]
}

check() {
    [ -e "$PENDING" ] || return 0
    read_pending || fail 'pending marker is invalid; manual recovery required'
    if deadline_expired; then rollback; fi
}

confirm() {
    read_pending || fail 'no pending deployment'
    [ "$txn" = "${1:-}" ] || fail 'transaction ID mismatch'
    deadline_expired && fail 'deployment deadline expired; rollback remains pending'
    printf '%s\n' "CONFIRMED $txn" > "$ROOT/$txn/result"
    chmod 0600 "$ROOT/$txn/result"
    rm -f "$PENDING"
    sync
    echo "CONFIRMED $txn"
}

watch() {
    while :; do
        if ! clear_stale_lock; then
            echo 'fips recovery: invalid guard lock' >&2
        elif try_lock; then
            check || true
            release_lock
        fi
        sleep 2
    done
}

case "${1:-}" in
    arm) shift; require_lock; arm "$@";;
    check) require_lock; check;;
    rollback) require_lock; rollback;;
    confirm) shift; require_lock; confirm "$@";;
    watch) watch;;
    status) if [ -e "$PENDING" ]; then read_pending || fail 'invalid pending marker'; echo "PENDING $txn $wall_limit"; else echo NONE; fi;;
    *) fail 'usage: guard.sh arm ID SECONDS | check | rollback | confirm ID | watch | status';;
esac
