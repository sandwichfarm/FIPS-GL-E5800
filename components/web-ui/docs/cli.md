# CLI Workflow

The CLI is organized around a project-local plugin and an optional project-local
router target. It never stores router passwords.

## First Run

```bash
glplugin init router-tool --profile full-stack --install
cd router-tool

glplugin target add beryl root@192.168.8.1 --use
glplugin check
glplugin capabilities
glplugin doctor
glplugin install
```

The generated full-stack page immediately calls its packaged, session-protected
CGI endpoint and displays UCI state plus router uptime. This keeps the first
install executable end to end; replace the example response with product behavior
rather than wiring the frontend, session validation, and backend from scratch.

Every generated project pins the exact toolkit version that created it in
`devDependencies`. `--install` runs `npm install` immediately without a shell and
creates the lockfile; omit the flag when installation needs to happen later or in
an offline environment. An install failure leaves the generated project intact and
reports its path instead of deleting source files.

`install` runs project checks, builds the view, creates the `.ipk`, performs a
strict router platform preflight, uploads it to `/tmp`, and invokes `opkg install`.
Use `--no-build` to package and install an existing build artifact. The temporary
router-side `.ipk` is removed after the install attempt while preserving the
`opkg` exit status.

`capabilities` is local and does not connect to a router. It lists the IDs accepted
by `compatibility.requiredCapabilities`, the read-only RPC method used to verify
each ID, and any feature gate. `doctor` loads those requirements from the current
project; a missing requirement fails before `install` is attempted in the workflow
above.

## Views

The primary page created by `init` remains the required plugin entry. Additional
pages can be managed without editing `gl-plugin.json` by hand:

```bash
# Add a level 2 page below the primary plugin menu
glplugin view add devices --title "Devices" --icon network

# Add a separate level 1 menu item
glplugin view add reports --title "Reports" --top-level --index 90

glplugin view list
glplugin view remove reports
glplugin view remove devices --delete-files
```

`view add` creates both the Vue source and menu JSON, then declares them in the
manifest. A `--parent` must name a declared level 1 page; the CLI rejects a third
menu level because the firmware menu contract supports only levels 1 and 2.
Existing files are never overwritten. Short command IDs are automatically prefixed
with the primary plugin ID because view IDs, bundle names, and menu destinations
share a global router namespace. For example, `router-tool` plus `devices` becomes
`router-tool-devices`; `--parent devices` and `view remove devices` accept the same
short form.

`view remove` cannot remove the primary page or a page that still has declared
children. It preserves files by default so a mistaken manifest edit is reversible;
`--delete-files` removes only files no longer referenced by another view.

## Platform Preflight

`deploy`, the first `dev` cycle, and `install` inspect the router before uploading
project files. The preflight requires:

- firmware at or above the project's declared minimum (4.8 by default);
- an exact model, normalized firmware, and admin bundle fingerprint tuple from
  the verified catalog;
- the modern SDK4 view loader, `$rpcRequest`, and required portable components;
- `opkg`, `gl-sdk4-ui-core`, UI/menu paths, and OpenWrt lifecycle dispatch;
- a package architecture accepted by the router and at least 2 MiB free overlay
  space.

Unknown exact tuples are rejected even when their static contract looks
modern. To investigate a newly released firmware without claiming support, use
`--allow-unverified` explicitly:

```bash
glplugin doctor --allow-unverified
glplugin deploy --build --allow-unverified
glplugin install --allow-unverified
```

Save the JSON result and reduce it to a local compatibility candidate when
investigating a new tuple:

```bash
glplugin doctor router.local --allow-unverified --json > doctor.json
glplugin compatibility capture doctor.json --output candidate.json
glplugin compatibility verify candidate.json --bundle admin-app.js.gz
```

`capture` accepts both successful doctor JSON and the structured `error.details`
output produced when an unknown tuple is checked without `--allow-unverified`. It
removes the target, hostname, auth metadata, capability results, and raw errors.
It refuses to overwrite an existing output file.

`verify` reads the supplied admin bundle, recomputes its decompressed SHA-256,
checks the loader/RPC contract and static portable-component signals, and confirms
that they agree with the candidate before checking the firmware catalog.
`ready-for-review` is evidence for the next manual investigation step; it does not
prove the runtime Vue registry, modify the catalog, or make router-changing commands
trust the tuple.

The override applies only to an unknown modern bundle fingerprint. It cannot
bypass the minimum firmware, missing platform files, architecture mismatch, or
missing lifecycle support.

## Targets

Targets are stored in `.glpluginrc.json` in the project root. New projects ignore
this file in Git. The file is written with mode `0600` and may contain only:

- SSH target and optional separate RPC host
- RPC username
- HTTP/HTTPS and TLS verification settings
- SSH host-key policy

Passwords, session IDs, tokens, and challenge values are never accepted or stored.
Passwords continue to use the hidden prompt or `--password-stdin`.

```bash
glplugin target add beryl root@192.168.8.1
glplugin target add lab admin@lab-router.local --rpc-host lab-router.local --https
glplugin target list
glplugin target use beryl
glplugin target show
glplugin target remove lab
```

Router commands resolve their target in this order:

1. Explicit target alias or host argument
2. `GLPLUGIN_HOST`
3. Current project target

Command-line transport flags override target defaults. Use `--http`/`--secure` to
override stored `--https`/`--insecure` settings and `--strict-host-key` to override
a stored insecure SSH policy.

## Development

```bash
glplugin check
glplugin deploy --build
glplugin dev
```

`deploy --build` validates, builds, and uploads the view, menu, and locale files.
For a UI-only project, `dev` performs that cycle once and then watches source,
locale, menu, manifest, and webpack configuration files with debounced rebuilds.

For a full-stack project, the first `dev` cycle builds and installs the complete
`.ipk`. Later Vue, menu, locale, Babel, and webpack changes use the fast UI deploy
path. Changes under the manifest-defined overlay or lifecycle paths reinstall the
package, as do `gl-plugin.json` and `package.json` changes. If frontend and backend
events share one debounce window, one package install handles both. Development
installs use opkg's `--force-reinstall`, so backend changes apply even when the
package version has not changed. If a package sync fails, the watchers remain
active and the next relevant edit retries the package before fast UI deploys
resume.

Multi-step SSH commands open one temporary OpenSSH master connection per command,
so `deploy`, `install`, and SSH extraction require one SSH authentication instead
of one prompt per transferred file or remote probe. `dev` keeps that connection
until the watcher stops and reuses it for every rebuild. The connection is closed
on normal completion, failure, or `Ctrl+C`; no password is written to the target
configuration.

Direct `glplugin deploy` remains UI-only. The hybrid behavior belongs to `dev`,
which applies backend files through the package manager instead of copying them
around opkg ownership and lifecycle handling.

## Packages

```bash
glplugin build
glplugin package
glplugin inspect dist/gl-sdk4-ui-router-tool_1.0.0_all.ipk
glplugin install --no-build
glplugin uninstall
```

`inspect` validates archive paths before reading package members. It reports control
metadata, dependencies, lifecycle scripts, conffiles, view files, menu files, and
the complete data file list.

Do not use the exit code of `opkg status <package>` alone to verify removal. The
`opkg` version observed on GL-MT3000 firmware 4.8.1 returns status 0 even when it
prints no package record. Parse the status/list output or verify package files.

## Global Options

Global options can appear before or after the command:

| Option | Behavior |
|---|---|
| `--cwd <dir>` | Run against another project directory |
| `--json` | Emit one JSON object to stdout |
| `--quiet`, `-q` | Suppress human progress and subprocess output |
| `--verbose`, `-v` | Print additional diagnostics to stderr |
| `--help`, `-h` | Print help without executing the command |
| `--version` | Print the toolkit version |

Examples:

```bash
glplugin build --help
glplugin --cwd ../router-tool check --json
glplugin doctor --json
```

Successful JSON output has the shape `{ "ok": true, "result": ... }`. Errors use
`{ "ok": false, "error": { "message": ..., "exitCode": ... } }`. Validation and
connectivity failures can additionally include a structured `details` report.

## Exit Codes

| Code | Meaning |
|---:|---|
| `0` | Success |
| `1` | Runtime/tool failure |
| `2` | Invalid command or arguments |
| `3` | Project/package validation failure |
| `4` | Router connectivity, authentication, SCP, or SSH failure |

Core modules return data or throw `CliError`; they do not terminate the Node process.
This keeps the toolkit usable from tests and other JavaScript programs.
