#!/bin/sh
# Clean a first-install guard that never armed. No FIPS package may be present.
set -eu

TEST_ROOT=${FIPS_TEST_FS_ROOT:-}
ROOT="$TEST_ROOT/etc/fips-recovery"
INIT="$TEST_ROOT/etc/init.d/fips-recovery"
STOCK="$TEST_ROOT/etc/init.d/gl_screen"
LOCK="$TEST_ROOT/tmp/fips-recovery"
txn=${1:-}

fail() { echo "bootstrap cleanup: $*" >&2; exit 1; }
case "$txn" in ''|*[!A-Za-z0-9_-]*) fail 'invalid transaction ID';; esac

[ ! -e "$ROOT/pending" ] && [ ! -L "$ROOT/pending" ] || fail 'rollback is armed or pending'
[ ! -e "$ROOT/$txn/result" ] && [ ! -L "$ROOT/$txn/result" ] ||
    fail 'transaction already has a result'
command -v opkg >/dev/null 2>&1 || fail 'opkg is unavailable'
opkg list-installed >/dev/null || fail 'opkg status is unavailable'
for package in fips gl-sdk4-ui-fips gl-e5800-dashboard; do
    package_status=$(opkg status "$package" 2>/dev/null || true)
    if printf '%s\n' "$package_status" | grep -q '^Package:'; then
        fail "candidate package is present: $package"
    fi
done
[ -x "$STOCK" ] || fail 'stock screen service is missing'
"$STOCK" enabled >/dev/null 2>&1 || fail 'stock screen is disabled'
"$STOCK" status >/dev/null 2>&1 || fail 'stock screen is not running'
for name in fips fips-gateway citydash homebutton; do
    [ ! -e "$TEST_ROOT/etc/init.d/$name" ] && [ ! -L "$TEST_ROOT/etc/init.d/$name" ] ||
        fail "candidate service remains: $name"
done

[ ! -L "$ROOT" ] && { [ -d "$ROOT" ] || [ ! -e "$ROOT" ]; } ||
    fail 'recovery directory is invalid'
[ ! -L "$INIT" ] && { [ -f "$INIT" ] || [ ! -e "$INIT" ]; } ||
    fail 'recovery init script is invalid'

if [ -d "$ROOT" ]; then
    for path in "$ROOT"/* "$ROOT"/.[!.]*; do
        [ -e "$path" ] || [ -L "$path" ] || continue
        [ ! -L "$path" ] || fail 'linked recovery file is unsafe'
        name=${path##*/}
        case "$name" in
            guard.sh|health.sh|probes.json|apply-initial.sh|runtime-packages|guard.sh.tmp|health.sh.tmp|probes.json.tmp|apply-initial.sh.tmp|runtime-packages.tmp|pending.tmp)
                [ -f "$path" ] || fail "recovery file is invalid: $name" ;;
            "$txn") [ -d "$path" ] || fail 'transaction directory is invalid' ;;
            *) fail "unrecognized recovery file: $name" ;;
        esac
    done
fi
if [ -e "$LOCK" ] || [ -L "$LOCK" ]; then
    [ -d "$LOCK" ] && [ ! -L "$LOCK" ] || fail 'recovery lock directory is invalid'
    for path in "$LOCK"/* "$LOCK"/.[!.]*; do
        [ -e "$path" ] || [ -L "$path" ] || continue
        [ "${path##*/}" = guard.lock ] && [ -L "$path" ] ||
            fail 'unrecognized recovery lock file'
    done
    if [ -L "$LOCK/guard.lock" ]; then
        holder=$(readlink "$LOCK/guard.lock") || fail 'cannot read recovery lock'
        case "$holder" in ''|*[!0-9]*) fail 'recovery lock owner is invalid';; esac
        kill -0 "$holder" 2>/dev/null && fail 'recovery guard operation is still running'
    fi
fi

if [ -x "$INIT" ]; then
    "$INIT" disable || fail 'cannot disable recovery service'
    "$INIT" stop || fail 'cannot stop recovery service'
    if "$INIT" status >/dev/null 2>&1; then
        fail 'recovery service remains running'
    fi
fi
for link in "$TEST_ROOT"/etc/rc.d/*fips-recovery; do
    [ ! -e "$link" ] && [ ! -L "$link" ] || rm -f "$link" || fail 'cannot remove boot link'
done
rm -f "$INIT" "$TEST_ROOT/etc/init.d/fips-recovery.tmp" || fail 'cannot remove recovery init'
rm -rf "$ROOT" "$LOCK" || fail 'cannot remove unarmed recovery files'
sync
echo BOOTSTRAP_CLEAN
