#!/bin/sh
# Stage reviewed settings under an already armed package transaction.
# The Rust backend checks the guard mode, transaction ID, revision and config.
set -eu

transaction=${1:-}
case "$transaction" in ''|*[!A-Za-z0-9_-]*) echo 'invalid transaction ID' >&2; exit 2;; esac
admin=${FIPS_ADMIN_BIN:-/usr/bin/fips-router-admin}

settings=$(cat)
[ -n "$settings" ] || { echo 'initial FIPS settings are empty' >&2; exit 2; }
configuration=$(printf '{"operation":"configuration"}\n' | "$admin")
printf '%s\n' "$configuration" | jsonfilter -e '@.status' | grep -qx ok
revision=$(printf '%s\n' "$configuration" | jsonfilter -e '@.data.revision')
case "$revision" in *[!0-9a-f]*|'') echo 'invalid current revision' >&2; exit 1;; esac
[ "${#revision}" -eq 64 ] || { echo 'invalid current revision length' >&2; exit 1; }

staged=$(printf '{"operation":"stage","expected_revision":"%s","settings":%s}\n' "$revision" "$settings" | "$admin")
printf '%s\n' "$staged" | jsonfilter -e '@.status' | grep -qx ok
candidate=$(printf '%s\n' "$staged" | jsonfilter -e '@.data.revision')
case "$candidate" in *[!0-9a-f]*|'') echo 'invalid candidate revision' >&2; exit 1;; esac
[ "${#candidate}" -eq 64 ] || { echo 'invalid candidate revision length' >&2; exit 1; }

activated=$(printf '{"operation":"activate_package","expected_revision":"%s","transaction_id":"%s"}\n' "$candidate" "$transaction" | "$admin" --package-activation)
printf '%s\n' "$activated" | jsonfilter -e '@.status' | grep -qx ok
printf '%s\n' "$activated" | jsonfilter -e '@.data.transaction_id' | grep -qx "$transaction"
echo FIPS_CONFIG_APPLIED
