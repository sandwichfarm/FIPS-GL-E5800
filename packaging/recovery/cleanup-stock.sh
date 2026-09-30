#!/bin/sh
# Final cleanup after a verified first-install rollback to stock firmware state.
# Run only after saving the transaction evidence off-router.
set -eu

TEST_ROOT=${FIPS_TEST_FS_ROOT:-}
RECOVERY="$TEST_ROOT/etc/fips-recovery"
INIT="$TEST_ROOT/etc/init.d/fips-recovery"
STOCK="$TEST_ROOT/etc/init.d/gl_screen"
LOCK="$TEST_ROOT/tmp/fips-recovery"
txn=${1:-}

fail() { echo "stock rollback cleanup: $*" >&2; exit 1; }
case "$txn" in ''|*[!A-Za-z0-9_-]*) fail 'invalid transaction ID';; esac

command -v opkg >/dev/null 2>&1 || fail 'opkg is unavailable'
for package in fips gl-sdk4-ui-fips gl-e5800-dashboard; do
    if opkg status "$package" 2>/dev/null | grep -q '^Package:'; then
        fail "candidate package is still present: $package"
    fi
done
[ -x "$STOCK" ] || fail 'stock screen service is missing'
"$STOCK" enabled >/dev/null 2>&1 || fail 'stock screen is disabled'
"$STOCK" status >/dev/null 2>&1 || fail 'stock screen is not running'
for name in citydash homebutton fips fips-gateway; do
    [ ! -e "$TEST_ROOT/etc/init.d/$name" ] && [ ! -L "$TEST_ROOT/etc/init.d/$name" ] ||
        fail "candidate service remains: $name"
done

if [ ! -e "$RECOVERY" ] && [ ! -L "$RECOVERY" ] &&
   [ ! -e "$INIT" ] && [ ! -L "$INIT" ]; then
    echo STOCK_CLEAN
    exit 0
fi
[ -d "$RECOVERY" ] && [ ! -L "$RECOVERY" ] || fail 'recovery directory is invalid'
[ -x "$INIT" ] && [ ! -L "$INIT" ] || fail 'recovery init script is invalid'
[ ! -e "$RECOVERY/pending" ] && [ ! -L "$RECOVERY/pending" ] || fail 'rollback is still pending'
[ -f "$RECOVERY/$txn/result" ] && [ ! -L "$RECOVERY/$txn/result" ] ||
    fail 'rollback result is missing'
[ "$(cat "$RECOVERY/$txn/result")" = "ROLLED_BACK $txn" ] || fail 'transaction did not roll back'

"$INIT" disable || fail 'cannot disable recovery service'
"$INIT" stop || fail 'cannot stop recovery service'
for link in "$TEST_ROOT"/etc/rc.d/*fips-recovery; do
    [ ! -e "$link" ] && [ ! -L "$link" ] || fail 'recovery boot link remains'
done
rm -f "$INIT" || fail 'cannot remove recovery init script'
rm -rf "$RECOVERY" || fail 'cannot remove recovery files'
rm -rf "$LOCK" || fail 'cannot remove recovery lock directory'
sync
echo STOCK_CLEAN
