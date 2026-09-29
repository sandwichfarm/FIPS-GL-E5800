# Full-stack Reference

This example demonstrates the smallest complete router-side plugin:

- a native Vue page;
- a session-protected, read-only shell CGI endpoint at
  `/cgi-bin/gl-sdk4-ui-full-stack`;
- a UCI configuration file preserved as an opkg conffile;
- idempotent install and remove lifecycle hooks.

The endpoint accepts `GET` only and returns non-sensitive runtime state. It does
not change router configuration or start a background service. SDK4 firmware
routes `/cgi-bin` through nginx and `fcgiwrap`; the package therefore declares
`gl-oui-rpc`, which owns that runtime path, plus `ubus` and `jsonfilter` for
session validation.

The nginx access hook is not an application authorization mechanism. The Vue page
sends the current SID with the toolkit browser helper, and the plugin-scoped shell
helper validates it through `gl-session` before the endpoint reads any state. The
[custom backend authentication contract](../../docs/backend-auth.md) documents
the verified SID transport and CSRF boundary.

```bash
npm install
npm run check
npm run package
glplugin install
```

Use `glplugin install`, not `deploy`, when testing this project. Development
deploy only updates UI assets and intentionally does not copy the router overlay.
