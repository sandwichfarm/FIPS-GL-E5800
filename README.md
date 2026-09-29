# GL-E5800 FIPS workspace

Monorepo for FIPS, a GL.iNet web extension, a touchscreen UI, and controlled package
restoration after firmware upgrades. Prepared against a GL-E5800 upgraded from
GL.iNet 4.8.3 to 4.10.0 (OpenWrt 23.05.4, aarch64_cortex-a53).

## Contents

| Path | Contents |
| --- | --- |
| `components/fips/` | Complete upstream FIPS v0.5.2 source snapshot |
| `components/web-ui/` | Community gl-sdk4-plugin-kit source; foundation for a new FIPS web panel |
| `components/device-ui/` | Community GL-E5800 dashboard source; foundation for a FIPS screen |
| `apps/router-admin/` | FIPS management backend shared by both interfaces |
| `apps/web-ui/` | Native GL.iNet FIPS web view |
| `dev/lab/` | Two-node Linux integration environment and screen preview |
| `packaging/` | Independently built package payloads and touchscreen integration |
| `ansible/` | Read-only inspection and guarded deployment roles |
| `tools/capture.py` | SSH capture of stock UI assets from `/rom` |
| `tools/ipk.py` | Pinned IPK validation and Python-free remote installer generation |
| `upstream/sources.json` | Source URLs, exact imported commits and licenses |
| `private/device/` | Local-only stock firmware captures, extracted assets, readable JS, checksums |
| `artifacts/` | Local-only downloaded/built packages |

The components are ordinary tracked files, not submodules. Vendor imports are
unchanged; each retains its original license. Our deployment tooling is separate.

## What was recovered from the device

Both 4.8.3 and 4.10.0 stock UI captures are available locally. Web assets include
compiled JavaScript, CSS, translations, menu definitions, and backend files. No
source maps were found. Touchscreen assets include layouts, images, readable
Lua/shell helpers, a compiled ARM64 `gl_screen` executable, and Lua-bytecode RPC.
The original Vue source tree and touchscreen C/C++ source are not on the device.

These proprietary reference files are ignored by Git. We captured `/rom` rather
than mutable configuration, SMS, credentials, or generated Wi-Fi QR images. The
decompressed JavaScript is still compiled code, not recovered original source.

## Status

- Source imports and pre/post-upgrade firmware captures are complete.
- The management backend validates and stages configuration. It reads a live FIPS
  control socket and excludes private identity data from responses.
- The web view and touchscreen FIPS panel build locally. The touchscreen package
  still needs a compatible Pillow dependency package before device installation.
- Two real Linux FIPS nodes connected in containers; IPv6 mesh ping and identity
  preservation after an abrupt process crash passed locally.
- All ARM64 binaries and three deterministic candidate packages build locally.
  Router-local rollback passes fake-opkg fault tests. CI/CD and guarded Ansible
  deployment are authored, with hosted and hardware verification still pending.
- Configuration activation, isolated gateway/firewall behavior, touchscreen
  Pillow packaging, and a complete offline recovery kit remain in progress.
- No package or configuration has been installed on the router by this project.
- 4.10.0 has been observed; neither community UI nor FIPS has been runtime-tested
  on the GL-E5800. No recovery profile is approved for installation by default.

Read [recovery instructions](docs/recovery.md) before using the playbooks and
[firmware observations](docs/firmware.md) for the source availability findings.
See [local development](docs/local-development.md) for build, lab, preview, and
package commands. [Implementation tracker](docs/IMPLEMENTATION.md) lists the
remaining acceptance gates.

## Local checks

```sh
make check
python3 tools/secret_scan.py
```

Read-only router inspection (SSH key or prompted password):

```sh
cd ansible
ansible-playbook inspect.yml --ask-pass
```

## Upstream work

Keep changes within their relevant component and contribute focused diffs against
the commit in `upstream/sources.json`. FIPS is already packaged for OpenWrt.
The web toolkit and touchscreen dashboard are independent community projects;
they do not grant access to GL.iNet's proprietary UI source. Do not submit captured
vendor binaries/assets to those repositories.
