#!/bin/sh
# Remove only a completed upgrade transaction after its evidence is encrypted off-router.
set -eu

TEST_ROOT=${FIPS_TEST_FS_ROOT:-}
ROOT="$TEST_ROOT/etc/fips-recovery"
INIT="$TEST_ROOT/etc/init.d/fips-recovery"
txn=${1:-}

fail() { echo "upgrade rollback cleanup: $*" >&2; exit 1; }
file_metadata() {
    stat -c '%a:%u:%g:%Y' "$1" 2>/dev/null || stat -f '%Lp:%u:%g:%m' "$1"
}
case "$txn" in ''|*[!A-Za-z0-9_-]*) fail 'invalid transaction ID';; esac
[ -d "$ROOT" ] && [ ! -L "$ROOT" ] || fail 'recovery directory is invalid'
[ -x "$ROOT/guard.sh" ] && [ ! -L "$ROOT/guard.sh" ] || fail 'recovery guard is invalid'
[ -x "$INIT" ] && [ ! -L "$INIT" ] || fail 'recovery init script is invalid'
[ ! -e "$ROOT/pending" ] && [ ! -L "$ROOT/pending" ] || fail 'rollback is still pending'
[ "$(/bin/sh "$ROOT/guard.sh" status)" = NONE ] || fail 'recovery guard is pending'
"$INIT" enabled >/dev/null 2>&1 || fail 'recovery init script is disabled'
"$INIT" status >/dev/null 2>&1 || fail 'recovery service is not running'

marker="$ROOT/.cleanup-$txn"
transaction="$ROOT/$txn"
if [ ! -e "$marker" ] && [ ! -L "$marker" ]; then
    if [ ! -e "$transaction" ] && [ ! -L "$transaction" ]; then
        echo UPGRADE_CLEAN
        exit 0
    fi
    [ -d "$transaction" ] && [ ! -L "$transaction" ] || fail 'transaction directory is invalid'
    [ -f "$transaction/result" ] && [ ! -L "$transaction/result" ] || fail 'rollback result is missing'
    [ "$(cat "$transaction/result")" = "ROLLED_BACK $txn" ] || fail 'transaction did not roll back'
    for name in guard.sh health.sh probes.json apply-initial.sh runtime-packages init; do
        case "$name" in
            init) target="$INIT" ;;
            *) target="$ROOT/$name" ;;
        esac
        state="$transaction/backup/guard-files/$name.state"
        [ -f "$state" ] && [ ! -L "$state" ] || fail "saved guard state is missing: $name"
        case "$(cat "$state")" in
            present)
                [ -f "$target" ] && [ ! -L "$target" ] || fail "prior guard file is missing: $name"
                saved="$transaction/backup/guard-files/$name"
                [ -f "$saved" ] && [ ! -L "$saved" ] || fail "saved guard file is missing: $name"
                cmp -s "$saved" "$target" ||
                    fail "prior guard file differs: $name"
                [ "$(file_metadata "$saved")" = "$(file_metadata "$target")" ] ||
                    fail "prior guard metadata differs: $name"
                ;;
            absent) [ ! -e "$target" ] && [ ! -L "$target" ] || fail "new guard file remains: $name" ;;
            *) fail "saved guard state is invalid: $name" ;;
        esac
    done
    umask 077
    printf 'CLEANUP_AUTHORIZED %s\n' "$txn" > "$marker" || fail 'cannot mark cleanup'
fi
[ -f "$marker" ] && [ ! -L "$marker" ] || fail 'cleanup marker is invalid'
[ "$(cat "$marker")" = "CLEANUP_AUTHORIZED $txn" ] || fail 'cleanup marker differs'
for path in "$ROOT/guard.sh.tmp" "$ROOT/health.sh.tmp" "$ROOT/probes.json.tmp" \
            "$ROOT/apply-initial.sh.tmp" "$ROOT/runtime-packages.tmp" \
            "$TEST_ROOT/etc/init.d/fips-recovery.tmp"; do
    rm -f "$path" || fail 'cannot remove staged guard file'
done
rm -rf "$transaction" || fail 'cannot remove transaction evidence'
rm -f "$marker" || fail 'cannot remove cleanup marker'
sync
echo UPGRADE_CLEAN
