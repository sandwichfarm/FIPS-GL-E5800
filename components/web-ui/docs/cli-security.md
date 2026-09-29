# CLI Security

The developer CLI talks to routers through two independent transports:

- HTTP or HTTPS JSON-RPC for `doctor`, `test`, and RPC extraction
- OpenSSH for UI deployment and firmware extraction

These controls apply to the developer CLI only. A plugin running inside the GL.iNet
admin UI reuses the authenticated browser session and does not ask the user to log
in again. Standard RPC requests are authorized by the firmware. Plugin-owned CGI
endpoints must perform the separate session validation described in
[Authentication for Custom Backends](backend-auth.md).

Project-local router aliases are stored in `.glpluginrc.json`. The file is ignored
by generated projects and written with mode `0600`. Its schema does not permit
passwords, tokens, session IDs, nonces, or salts; it stores connection coordinates
and transport policy only.

## Router credentials

Router passwords are accepted through a hidden TTY prompt or one stdin line with
`--password-stdin`. They are not accepted as positional arguments and are never
placed in an `openssl`, `ssh`, or `scp` argument list.

The RPC client reads `challenge.alg` and supports the Unix crypt algorithms observed
in the inspected official firmware contracts. Unsupported algorithms fail instead
of silently falling back to a different hash.

## SSH and SCP

The toolkit starts `ssh` and `scp` directly with argument arrays and `shell: false`.
Targets, uploaded filenames, and router paths are validated before a process starts.
This prevents user-controlled values from becoming local shell syntax.

OpenSSH still invokes the router's shell for a remote command. The toolkit therefore
uses fixed remote command strings; plugin metadata and CLI input are never inserted
into those strings. Uploads use legacy `scp -O` for OpenWrt compatibility, so remote
destinations are restricted to normalized absolute paths with conservative ASCII
characters.

Host-key checking defaults to `accept-new`: the first key is stored and subsequent
key changes fail. `--insecure-host-key` explicitly switches checking off. It is a
compatibility escape hatch, not the recommended default.

Multi-step operations use OpenSSH connection multiplexing. The toolkit creates a
private temporary directory, starts a `ControlMaster` only after normal SSH host-key
and password authentication, passes its `ControlPath` to child `ssh`/`scp` calls,
and closes and removes it in a `finally` path. `deploy`, `install`, and SSH extraction
scope the master to one command. `dev` scopes it to the watcher lifetime and closes
it on `Ctrl+C`. This stores a local Unix socket, not a password, and does not install
a daemon or change the router SSH configuration.

## Extracted data

`glplugin extract --rpc` calls read methods that can return plaintext Wi-Fi keys,
VPN private keys, and service tokens. The JSON output preserves the response shape
but replaces recognized secret fields with `<redacted>`.

`--include-sensitive` disables redaction for local reverse-engineering. Treat that
file as a credential export: do not commit it, attach it to an issue, or share it
without manual review.

SSH extraction stores the public admin bundle analysis, menu documents, and firmware
version. It does not store SSH credentials or session identifiers.

## Build toolchain

GL.iNet's SDK4 admin runtime requires Vue 2 components. Generated projects therefore
use `vue-template-compiler@2.7.16` as a development-only build tool. The unresolved
moderate advisory `GHSA-g3ch-rx76-35fx` covers every Vue 2 compiler release; there is
no compatible patched Vue 2 version. The compiler is not installed as a production
CLI dependency and is not included in generated router packages. Only trusted local
`.vue` source is supported as compiler input.
