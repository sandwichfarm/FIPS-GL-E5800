# Changelog

All notable changes to this project are documented in this file. The format is
based on Keep a Changelog, and versions follow Semantic Versioning.

## [Unreleased]

## [0.9.0] - 2026-08-18

### Added

- `glplugin init --install` for optional one-command project scaffolding and
  dependency installation without shell interpolation.
- A hybrid full-stack development loop: initial package installation, fast UI
  deploys for frontend changes, and debounced package reinstalls for overlay,
  lifecycle, and package-manifest changes.
- Typed public package entrypoints for the stable Node.js toolkit API and the
  browser-only RPC mixin, chart adapter, and admin-session helper.
- Native ESM and CommonJS consumers resolve the same frozen toolkit namespaces.
- Generated RPC declarations cover all catalog namespaces and methods, with
  evidence-backed parameter, response, and observed response-key types.

### Changed

- Generated projects pin the exact toolkit version that created them, so npm
  scripts no longer depend on a globally installed `glplugin` after scaffolding.
- New integrations can use the package root while legacy `lib/*` imports remain
  resolvable for compatibility.
- `glplugin dev` now watches manifest-defined overlay and lifecycle paths and
  reuses its verified SSH/platform session across both deploy strategies. Package
  cycles force reinstall the unchanged development version so backend files apply;
  failed package cycles stay dirty and retry without dropping file watchers.

## [0.8.0] - 2026-08-17

### Added

- A buildable generic full-stack reference plugin connecting a native Vue page
  to a packaged read-only shell CGI backend and UCI conffile.
- A firmware- and live-verified authentication contract for sensitive custom CGI
  endpoints, including explicit SID transport, `gl-session` validation, and CSRF
  boundaries.
- Browser and plugin-scoped shell helpers implementing that contract for generated
  full-stack projects.

### Changed

- `glplugin init --profile full-stack` now generates the same working UI-to-CGI
  path instead of an unconnected libexec placeholder, with root-session validation
  enabled by default.
- Finite RPC commands log out in a cleanup path, and the standalone Node client
  exposes an idempotent `close()` method.

## [0.7.0] - 2026-08-16

### Added

- Experimental `glplugin compatibility capture` and `compatibility verify`
  commands for reducing doctor JSON to a redacted candidate and validating it
  against the actual admin bundle without modifying the trusted catalog.
- Complete, buildable `hello-world` and `network-info` example projects.
- An official GL.iNet Beryl AX product image identifying the live reference router.
- A typed `GlStableLineChart` adapter with stable polling updates, rounded sticky
  Y-axis limits, timeline bands, and no additional chart engine.
- Firmware evidence for the exact `gl-line-chart-v1` prop and behavior contract on
  GL-MT3000 4.8.1 and GL-MT6000 4.9.1.
- Public card and chart runtime styles available through the generated webpack alias.

### Changed

- Deploy records exact project-owned router assets and removes stale entries without
  globbing across another plugin's namespace.
- Dev mode refreshes its watcher set and repeats platform preflight after manifest
  changes.
- Firmware component claims now distinguish static bundle signals from
  fingerprint-bound runtime `Vue.options.components` evidence.
- The firmware CI matrix is generated directly from the runtime catalog.

## [0.6.0] - 2026-08-16

### Added

- `glplugin view add`, `view list`, and `view remove` commands for safely managing
  multi-view manifests, Vue entry files, and level 1/2 menu entries.

### Changed

- Short page IDs created through the CLI are automatically prefixed with the
  primary plugin ID to avoid collisions in the router's global view namespace.

### Validation

- A three-page fixture was built, packaged, installed, verified through
  `ui.get_menu_list`, evaluated as Vue components, and removed on a live GL-MT3000
  running firmware 4.8.1 `release8`.

## [0.5.0] - 2026-08-16

### Added

- Generic multi-view plugin manifests. Build, check, package, deploy, dev, and
  router tests now process every declared Vue entry and menu file while keeping
  the existing single-view defaults.

## [0.4.0] - 2026-08-16

### Added

- Project-specific `compatibility.requiredCapabilities` manifest contract with
  schema validation and `X-GL-RPC-Capabilities` package metadata.
- Local `glplugin capabilities` discovery command for valid IDs, probes, and gates.

### Changed

- Project-aware `doctor` and `test` now fail when a declared RPC capability is not
  available while preserving skip behavior for optional capabilities.

## [0.3.0] - 2026-08-15

### Added

- Strict `sdk4-modern-v1` compatibility policy with a firmware 4.8 minimum,
  exact model/firmware/bundle tuples, portable component requirements, and an
  explicit `--allow-unverified` development override.
- Official firmware artifact matrix for GL-MT3000 4.8.1, GL-AXT1800 4.8.3,
  GL-SFT1200 4.8.3, and GL-MT6000 4.9.1.
- SSH platform preflight for firmware, UI runtime, `opkg`, package architecture,
  lifecycle dispatch, and free overlay space.
- Firmware contract CI that verifies vendor SHA-256 values and inspects the
  official SquashFS images.

### Changed

- `doctor` now identifies the exact HTTP admin bundle instead of treating every
  `4.x` firmware as compatible.
- `test` now requires the project menu entry from `ui.get_menu_list` in addition
  to the installed view and Vue export.
- Generated manifests and package metadata declare their firmware/runtime
  requirements.
- CI actions run on their supported Node 24 runtime.

### Validation

- Repeated the live MT3000 workflow with strict preflight: doctor, package install,
  menu RPC verification, view evaluation, and uninstall all passed.
- Production dependency audit reports zero vulnerabilities. The unpatched Vue 2
  compiler advisory remains documented as a build-time-only constraint.

## [0.2.0] - 2026-08-15

### Added

- Unified `glplugin` command dispatcher with command help, JSON output, quiet and
  verbose modes, stable exit codes, and `--cwd` support.
- Project-local router targets without credential storage.
- `check`, safe `.ipk` inspection, install, uninstall, and watch workflows.
- `ui-only` and `full-stack` manifests with filesystem overlays, dependencies,
  conffiles, and lifecycle hooks.
- Firmware doctor with challenge-algorithm negotiation and feature-gated RPC probes.
- Fingerprint-bound component catalogs for GL-MT3000 firmware 4.8.1 and 4.9.0 beta6.
- Linux and macOS CI plus an npm release workflow.

### Changed

- Router tests now reuse the doctor's capability catalog instead of probing a
  separate hard-coded method list.
- Deploy, install, extract, and development cycles reuse bounded OpenSSH master
  connections to avoid repeated password prompts.
- Install removes its temporary router-side `.ipk` while preserving the `opkg`
  result.
- Unknown firmware bundles fail closed instead of presenting static string matches
  as a verified global component registry.

### Security

- Router passwords are accepted only through a hidden TTY prompt or stdin and are
  never placed in process arguments.
- SSH/SCP use validated argument arrays with `shell: false` and host-key checking.
- RPC extraction redacts recognized credentials and private keys by default.
- Archive paths, package metadata, project paths, and lifecycle scripts are
  validated before packaging or inspection.

### Validation

- The complete CLI workflow was tested against a live GL-MT3000 running firmware
  4.8.1 `release8`, including full-stack install, backend execution, development
  redeploy, and package cleanup.

[Unreleased]: https://github.com/go-wombat/gl-sdk4-plugin-kit/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/go-wombat/gl-sdk4-plugin-kit/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/go-wombat/gl-sdk4-plugin-kit/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/go-wombat/gl-sdk4-plugin-kit/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/go-wombat/gl-sdk4-plugin-kit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/go-wombat/gl-sdk4-plugin-kit/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/go-wombat/gl-sdk4-plugin-kit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/go-wombat/gl-sdk4-plugin-kit/releases/tag/v0.2.0
