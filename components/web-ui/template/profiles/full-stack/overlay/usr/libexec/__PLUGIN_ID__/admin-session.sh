#!/bin/sh

gl_sdk4_auth_response() {
	printf 'Status: %s\r\n' "$1"
	printf 'Content-Type: application/json\r\n'
	printf 'Cache-Control: no-store\r\n'
	printf 'X-Content-Type-Options: nosniff\r\n\r\n'
	printf '{"status":"error","error":"%s"}\n' "$2"
	exit 0
}

gl_sdk4_require_admin_session() {
	local sid session_json aclgroup

	sid="${HTTP_X_GL_ADMIN_TOKEN:-}"
	[ "${#sid}" -eq 32 ] || gl_sdk4_auth_response '401 Unauthorized' 'unauthorized'
	case "$sid" in
		*[!0-9A-Za-z]*) gl_sdk4_auth_response '401 Unauthorized' 'unauthorized' ;;
	esac

	command -v ubus >/dev/null 2>&1 || \
		gl_sdk4_auth_response '503 Service Unavailable' 'auth_unavailable'
	command -v jsonfilter >/dev/null 2>&1 || \
		gl_sdk4_auth_response '503 Service Unavailable' 'auth_unavailable'

	if ! session_json="$(ubus call gl-session session "{\"sid\":\"$sid\"}" 2>/dev/null)"; then
		gl_sdk4_auth_response '401 Unauthorized' 'unauthorized'
	fi
	aclgroup="$(jsonfilter -q -s "$session_json" -e '@.aclgroup' 2>/dev/null)"
	[ "$aclgroup" = 'root' ] || gl_sdk4_auth_response '403 Forbidden' 'forbidden'

	unset sid session_json aclgroup
}
