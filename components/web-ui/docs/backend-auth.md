# Authentication for Custom Backends

SDK4 has two different backend paths. Do not treat them as equivalent:

- `$rpcRequest` calls `/rpc`; the firmware validates the SID and applies its RPC
  access rules.
- a plugin-owned `/cgi-bin/*` endpoint runs through nginx and `fcgiwrap`; loading
  the admin page does not authorize that endpoint.

The generated full-stack reference exposes only read-only uptime and UCI state,
but still demonstrates the complete session check. Keep that gate when replacing
the example response with product behavior.

## Verified firmware behavior

The following behavior was verified against the official GL-MT3000 4.8.1
firmware and on a live GL-MT3000 running that contract:

- `/usr/share/gl-ngx/oui-access.lua` handles local access, HTTPS redirection,
  initialization state, and host redirection. It does not validate an admin
  session.
- `/cgi-bin/` is passed to `fcgiwrap`. Request headers become `HTTP_*` CGI
  variables, and the request body is available on standard input.
- login creates a 32-character alphanumeric SID, stores it in the
  `Admin-Token` cookie, and registers it with `gl-session`.
- `ubus call gl-session session '{"sid":"..."}'` returns the session and extends
  its inactivity timeout. Missing, expired, logged-out, and unknown SIDs fail.
- the session result contains `username` and `aclgroup`; the normal administrator
  session has `aclgroup: root`.
- logout invalidates the SID immediately. The live CGI test returned `401` for a
  missing SID, an unknown SID, and the same SID after logout; a current root SID
  returned `200`.

The firmware's own `/rpc`, `/upload`, and `/download` handlers use the same
principle: the frontend sends the SID as request data, and the backend asks
`gl-session` whether it is current. The existence of `/tmp/gl_token_<sid>` is not
the authoritative session check.

The official firmware catalog also verifies the modern RPC/auth runtime in the
4.8 and 4.9 firmware families. A new firmware tuple still has to pass the normal
`glplugin doctor` and compatibility checks before deployment.

## Recommended contract

For plugin-owned CGI endpoints, use this request contract:

1. Read the current SID with the admin runtime's
   `window.$getCookie('Admin-Token')` helper.
2. Send it in an `X-GL-Admin-Token` request header over a same-origin request.
3. Read `HTTP_X_GL_ADMIN_TOKEN` in the CGI process.
4. Require exactly 32 ASCII alphanumeric characters before using the value.
5. Call `gl-session.session` through ubus and require a returned session with
   `aclgroup == "root"`.
6. Perform authorization before parsing or acting on application input.

The toolkit ships this frontend behavior in
`@gl-sdk4-plugin-kit/admin-session`:

```js
import { createAdminSessionHeaders } from '@gl-sdk4-plugin-kit/admin-session';

var response = await fetch('/cgi-bin/gl-sdk4-ui-example', {
  method: 'POST',
  credentials: 'same-origin',
  cache: 'no-store',
  headers: {
    ...createAdminSessionHeaders(window),
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ action: 'refresh' }),
});
```

A generated full-stack project installs its shell helper at
`/usr/libexec/<plugin-id>/admin-session.sh`. Source it and authorize before
application logic:

```sh
. /usr/libexec/example/admin-session.sh
gl_sdk4_require_admin_session
```

The helper validates the header format before constructing the ubus request,
requires a current root session, emits the failure response, and terminates the
CGI. Generated packages declare direct dependencies on `gl-oui-rpc`, `ubus`, and
`jsonfilter` rather than relying on packages that happen to be present in one
firmware image.

## Response policy

- `401 Unauthorized`: SID is absent, malformed, unknown, expired, or logged out.
- `403 Forbidden`: a current session does not have the required access group.
- `503 Service Unavailable`: required session-validation tools are unavailable.
- `405 Method Not Allowed`: the endpoint does not support the HTTP method.
- `413 Content Too Large`: the request exceeds the endpoint's explicit body limit.

Authenticated responses should still send `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff`. Authentication is only the first gate: validate
content type, body size, JSON shape, action names, paths, and every argument before
executing backend logic.

## CSRF and token handling

Do not use the automatically attached `Admin-Token` cookie as the only credential
for state-changing CGI requests. A cookie-authenticated endpoint can be triggered
without the plugin frontend and therefore needs a separate CSRF defense.

The custom header follows the firmware's explicit-SID model and forces a browser
CORS preflight for cross-origin JavaScript. The live SDK4 nginx configuration
rejected that preflight with `403`. Plugin endpoints must not add permissive CORS
headers that would remove this boundary.

Never:

- accept the SID in the query string;
- log the SID, request header, cookie, or raw auth body;
- authorize by checking only `/tmp/gl_token_*`;
- trust `REMOTE_ADDR`, page visibility, or `oui-access.lua` as admin auth;
- add a localhost bypass to a sensitive plugin endpoint;
- expose write operations over `GET`.

If an endpoint needs delegated, non-root accounts, a root-group check is not a
complete authorization model. That requires a plugin-specific permission design;
do not silently treat every current session as an administrator.
