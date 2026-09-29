# Package Manifest and Profiles

`gl-plugin.json` is the authoritative router package manifest. `package.json`
contains only Node.js build metadata, including the package version used for the
`.ipk` version.

## Profiles

`ui-only` is the default. It packages:

- `/www/views/gl-sdk4-ui-<id>.common.js.gz`
- `/usr/share/oui/menu.d/<id>.json`
- JSON translations from `i18n/` into `/www/i18n/`

`full-stack` includes the same UI files and copies every entry below the declared
`overlay` directory into the package root. Use it for shell/Lua backends, UCI
config, CGI files, init scripts, and other router-side assets.

`glplugin init <name> --profile full-stack` generates a working version of this
contract: the profile-specific Vue page calls `/cgi-bin/gl-sdk4-ui-<name>`, while
the endpoint validates the current root admin session, reads
`/etc/config/<name>`, and returns a small JSON response.

The buildable [`examples/full-stack`](../examples/full-stack/) project shows the
smallest complete UI-to-backend path. It installs an executable below
`/www/cgi-bin`, reads a packaged UCI conffile, and returns JSON to the native Vue
page without starting a daemon. Official MT3000 4.8.1 and MT6000 4.9.1 firmware
route `/cgi-bin` from nginx to `fcgiwrap`; both ship that contract in the
`gl-oui-rpc` package. The generated package declares `gl-oui-rpc`, `ubus`, and
`jsonfilter` for routing and session validation.

The firmware's nginx access hook handles routing and initialization state, not
application authorization. The reference endpoint is read-only, but still uses
the generated browser and shell helpers to validate the admin session. Preserve
that gate when replacing the example response with private data or write
operations. See [Authentication for Custom Backends](backend-auth.md); page
visibility alone is not authorization for `/cgi-bin/*`.

Neither profile changes router network configuration during build or package.
Installing a full-stack package only performs actions explicitly present in its
files and lifecycle scripts.

`glplugin deploy` remains a fast frontend development command: it uploads the
view, menu, and translations only. It prints a warning for `full-stack` projects.
`glplugin dev` installs the complete package on its first full-stack cycle, uses
that fast deploy path for later frontend changes, and reinstalls the package for
overlay, lifecycle, or package-manifest changes. This preserves opkg ownership,
conffiles, and lifecycle behavior without reinstalling for every Vue edit. Dev
reinstalls explicitly use `--force-reinstall` because the package version normally
stays unchanged during an editing session.

A plugin can expose several native admin pages from one package. Declare each
view's bundle ID, Vue entry, and menu file in `views`; the primary plugin `id`
must be present:

```json
"views": [
  { "id": "my-plugin", "entry": "src/index.vue", "menu": "menu.json" },
  { "id": "my-plugin-tools", "entry": "src/tools.vue", "menu": "menus/tools.json" }
]
```

The generated webpack configuration emits
`dist/gl-sdk4-ui-<view-id>.common.js` for every declaration. Build, check,
package, deploy, dev, and router tests then process every view. Custom webpack
configurations must preserve that output naming contract. When `views` is
omitted, the single-view defaults remain `src/index.vue` and `menu.json`,
preserving compatibility with existing projects.

## Manifest

```json
{
  "$schema": "https://raw.githubusercontent.com/go-wombat/gl-sdk4-plugin-kit/main/schema/gl-plugin.schema.json",
  "schemaVersion": 1,
  "id": "my-plugin",
  "profile": "full-stack",
  "compatibility": {
    "minimumFirmware": "4.8.0",
    "requiredComponents": ["gl-card", "gl-title"],
    "requiredCapabilities": ["wifi", "repeater"]
  },
  "package": {
    "name": "gl-sdk4-ui-my-plugin",
    "architecture": "all",
    "section": "base",
    "source": "gl-sdk4-plugin-kit",
    "description": "My router plugin",
    "depends": ["libc", "gl-sdk4-ui-core", "lua-cjson"],
    "conffiles": ["/etc/config/my-plugin"]
  },
  "overlay": "overlay",
  "lifecycle": {
    "postinst": "hooks/postinst",
    "prerm": "hooks/prerm"
  }
}
```

`package.name`, `architecture`, `section`, `source`, `description`, and `depends`
become OpenWrt control fields. Keep `architecture: all` for portable shell/Lua
packages; set a concrete opkg architecture when the overlay contains native
binaries.

`compatibility.minimumFirmware` defaults to `4.8.0`. Required components must be
part of the verified portable UI contract for the target's exact admin bundle.
Required capabilities must be IDs from `glplugin capabilities`; `doctor` and `test`
require each declared read-only RPC probe to return `available`. The package control
file records these contracts as `X-GL-Firmware-Min`, `X-GL-UI-Contract`, and
`X-GL-RPC-Capabilities`. The SSH install preflight enforces the firmware and UI
contract; run `doctor` before installation when the project declares RPC
capabilities.

Every `conffiles` entry must be an absolute, normalized path to a regular file
that exists in the assembled package data. OpenWrt then preserves user-modified
configuration according to opkg conffile semantics. Generated menu/view/i18n
files are package-owned and cannot be overlaid.

Relative project paths must be normalized, cannot contain backslashes, and cannot
escape the project. Unknown manifest fields fail validation so metadata typos do
not silently change package behavior. The JSON Schema is published in
`schema/gl-plugin.schema.json`; runtime validation does not depend on a schema
library on the developer machine.

## Lifecycle Dispatch

Official MT3000 4.8.1, AXT1800 4.8.3, SFT1200 4.8.3, and MT6000 4.9.1 root
filesystem inspection confirmed the GL/OpenWrt dispatch contract in
`/lib/functions.sh`:

1. The package `postinst` wrapper sources `/lib/functions.sh` and calls
   `default_postinst`.
2. `default_postinst` performs standard overlay, UCI-defaults, and init-script
   handling, then executes `/usr/lib/opkg/info/<package>.postinst-pkg` when present.
3. The package `prerm` wrapper calls `default_prerm`, which executes
   `<package>.prerm-pkg` before standard init-script shutdown.

For that reason, a manifest `postinst` hook is packaged as `postinst-pkg`, and a
manifest `prerm` hook is packaged as `prerm-pkg`. The toolkit retains the standard
top-level wrappers instead of replacing firmware behavior. `preinst` and `postrm`
map directly to their standard control-script names.

Lifecycle sources must start with `#!/bin/sh`, pass `sh -n`, and are installed as
executable files. Hooks should be idempotent and must not assume that optional
services or hardware exist.

## Collision and Integrity Checks

Packaging fails when:

- a full-stack overlay is absent;
- overlay data collides with generated UI, menu, or translation files;
- a path traverses outside the project;
- a declared conffile is missing or is not a regular file;
- a lifecycle script is missing, has the wrong interpreter, or fails shell syntax validation;
- package metadata contains invalid control-file values.

The integration suite scaffolds, builds, packages, extracts, and inspects both
profiles. The full-stack fixture verifies executable mode preservation, conffiles,
default lifecycle wrappers, and `postinst-pkg/prerm-pkg` payloads.

Use `glplugin inspect <file.ipk>` to read the resulting control metadata, lifecycle
scripts, conffiles, view/menu paths, and data file list. Archive member paths are
validated before package members are read. `glplugin install` runs project checks,
builds and packages the project, performs strict platform/architecture/free-space
preflight, uploads the exact artifact, and invokes `opkg install`; `glplugin
install --no-build` reuses the current build artifact.

## Legacy Projects

Projects created before manifest support can still use `package.json.pluginName`
and `package.json.glPlugin`. They are interpreted as `ui-only`. New projects must
use `gl-plugin.json`; migrate legacy projects before adding router-side files.
