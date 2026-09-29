# Firmware Compatibility

`gl-sdk4-plugin-kit` supports the modern GL.iNet SDK4 runtime used by firmware
4.8 and newer. Compatibility is not inferred from the model name or the `4.x`
major version. The CLI fingerprints the exact decompressed admin app bundle and
matches the model, normalized firmware version, and SHA-256 tuple against the
verified firmware catalog.

## Support Policy

- Minimum supported firmware: `4.8.0`.
- `live-supported`: the exact model/firmware/bundle tuple passed artifact checks and a live
  `doctor -> install -> test -> uninstall` workflow.
- `artifact-verified`: the exact official firmware image and tuple passed all static
  router runtime and packaging contract checks.
- `unverified`: the firmware is modern and exposes the expected static runtime,
  but its model/firmware/bundle tuple is not in the catalog. Router-changing
  commands reject it by default.
- `unsupported`: firmware is too old or is missing a required runtime contract.

`--allow-unverified` is an explicit development override for a new bundle that
still passes the modern static contract. It cannot override old firmware,
missing platform paths, an incompatible package architecture, or missing
lifecycle dispatch.

## Verified Matrix

| Model | Firmware | OpenWrt base | Package architecture | Component evidence | Validation |
|---|---|---|---|---|---|
| GL-MT3000 | 4.8.1 `release8` | 21.02 snapshot | `aarch64_cortex-a53` | Runtime registry | Live supported |
| GL-AXT1800 | 4.8.3 `release1` | 23.05 snapshot | `aarch64_cortex-a53_neon-vfpv4` | Static signals only | Artifact verified |
| GL-SFT1200 | 4.8.3 `release4` | LEDE/18.06 | `mips_siflower` | Static signals only | Artifact verified |
| GL-MT6000 | 4.9.1 `release1` | 21.02 snapshot | `aarch64_cortex-a53` | Static signals only | Artifact verified |

The catalog stores the official download URL, complete firmware SHA-256,
SquashFS root location, decompressed app bundle SHA-256, OpenWrt base, and
package architecture. Firmware metadata comes from the official endpoints:

- `https://firmware-api.gl-inet.com/cloud-api/model/info?model=MT3000`
- `https://firmware-api.gl-inet.com/cloud-api/model/info?model=AXT1800`
- `https://firmware-api.gl-inet.com/cloud-api/model/info?model=SFT1200`
- `https://firmware-api.gl-inet.com/cloud-api/model/info?model=MT6000`

No firmware image or extracted vendor bundle is committed to this repository.

`artifact-verified` does not by itself satisfy a project's `requiredComponents`.
The AXT1800, SFT1200, and MT6000 rows remain blocked for generated projects until
their exact bundle fingerprints also have a runtime component-registry capture.

## Modern Runtime Contract

The `sdk4-modern-v1` contract requires all of the following:

- the admin loader requests `/views/gl-sdk4-ui-<view>.common.js` and evaluates
  the returned component;
- `Vue.prototype.$rpcRequest` is registered;
- required portable components are present in a fingerprint-bound runtime capture
  of `Vue.options.components`; static registration strings are diagnostics only;
- login uses Unix crypt selected by `challenge.alg`, followed by the modern
  SHA-256 outer hash through `$getHash`;
- `/www/views` and `/usr/share/oui/menu.d` exist;
- `opkg` and `gl-sdk4-ui-core` are installed;
- `/lib/functions.sh` dispatches `default_postinst`, `postinst-pkg`,
  `default_prerm`, and `prerm-pkg`.

Projects declare their minimum firmware and required portable components in
`gl-plugin.json`:

```json
{
  "compatibility": {
    "minimumFirmware": "4.8.0",
    "requiredComponents": ["gl-card", "gl-title"],
    "requiredCapabilities": ["wifi", "repeater"]
  }
}
```

Packages also contain `X-GL-Firmware-Min`, `X-GL-UI-Contract`, and, when declared,
`X-GL-RPC-Capabilities` metadata.

## Project Capability Contract

Run `glplugin capabilities` to list valid IDs, their read-only RPC probes, and any
software or hardware feature gate. `requiredCapabilities` uses these stable IDs
rather than internal module/method strings.

When `doctor` or `test` runs inside a plugin project, every required capability must
have status `available`. `unavailable`, `not-supported`, `error`, and `not-probed`
all fail the project contract. Capabilities not declared by the project remain
diagnostic and may be skipped when the router does not expose them.

## CLI Enforcement

`glplugin doctor` authenticates, fingerprints the HTTP admin bundle, evaluates
the firmware policy, and reports the exact catalog entry. In a project directory it
also loads the manifest and evaluates required capabilities. Unknown tuples make
doctor fail unless the explicit override is supplied.

### Candidate Workflow

For an unknown modern tuple, preserve and locally validate the minimum evidence:

```bash
glplugin doctor router.local --allow-unverified --json > doctor.json
glplugin compatibility capture doctor.json --output candidate.json
glplugin compatibility verify candidate.json --bundle admin-app.js.gz
```

The candidate retains the canonical model, normalized firmware, release type,
architecture, OpenWrt version, runtime contract, decompressed app bundle SHA-256,
and static component signals. It omits the router address, hostname, auth metadata,
capability responses, and admin bundle path.

Verification recomputes evidence from the supplied bundle and returns
`ready-for-review` for a complete unknown tuple and
`already-supported` for an exact catalog match. Neither result edits the catalog.
It does not turn static strings into runtime component evidence. Official artifact
metadata and contract verification are still required before an entry becomes
`artifact-verified`; a runtime registry capture and live plugin cycle are required for
`live-supported`.

`glplugin install` and `glplugin deploy` perform an SSH platform preflight before
uploading project files. The preflight checks the exact bundle, firmware,
`opkg`, UI core package, accepted package architectures, required filesystem
paths, lifecycle functions, and free overlay space. A failed preflight leaves
the router unchanged.

`glplugin test` additionally calls `ui.get_menu_list` and requires the current
project view to be present. It then downloads the installed view and verifies
that the router's `eval()` loader receives a Vue component. It also turns every
missing required capability into an explicit failed check instead of an optional
skip.

## Artifact CI

The `firmware-contract` GitHub Actions matrix downloads each official release,
verifies the published firmware SHA-256, extracts only the required SquashFS
files, and proves the artifact-visible parts of `sdk4-modern-v1`. Runtime component
claims are accepted only from a separate fingerprint-bound registry capture. A vendor firmware
change therefore fails CI before its fingerprint can be marked verified.

Run one entry locally with:

```bash
node scripts/verify-firmware.js gl-mt6000-4.9.1-release1 --download
```

## Live Validation

GL-MT3000 4.8.1 `release8` was revalidated on 2026-08-15 after strict platform
enforcement was added:

- HTTP doctor matched app bundle SHA-256
  `0409574b320a74de904a690df723134fc07471cddf5d622691ebbaa403116705`;
- SSH preflight reported `live-supported` before upload;
- the generated `.ipk` installed and configured through `opkg`;
- `ui.get_menu_list` returned the generated view;
- the installed gzip view evaluated to a Vue component;
- uninstall removed the temporary package.

The raw report is not committed because it contains router identity and network
metadata. Passwords, SIDs, challenge salts, and nonces are never included in
compatibility output.

## Boundaries

- Stock OpenWrt/LuCI is not SDK4 and is outside this package contract.
- Firmware before 4.8 is intentionally unsupported.
- Full-stack dependency availability remains project-specific. `opkg` is the
  authority for packages declared in `Depends`; native overlays must use the
  correct target architecture rather than `all`.
- Artifact verification proves the filesystem, package, auth, loader, RPC, and
  static component-signal contracts. Global component registration and
  hardware-specific RPC behavior still require live
  capability test when a plugin depends on it.
- Preservation of third-party packages across vendor firmware upgrades remains
  firmware-upgrade behavior, not an installation guarantee from this toolkit.
