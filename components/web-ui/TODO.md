# Roadmap

## Toolkit stabilization

- [x] Use `template/` as the only scaffold source
- [x] Preserve valid hyphenated plugin IDs and reject empty names
- [x] Validate all shipped JavaScript, including JSDoc type definitions
- [x] Test `init -> build -> package -> inspect`
- [x] Match the official SDK4 UI package paths and lifecycle scripts
- [x] Support configurable `Depends`, `Architecture`, and `Section` metadata
- [x] Generate browser and Node APIs from one RPC catalog
- [x] Preserve RPC errors instead of returning ambiguous `null` values
- [x] Run the test suite on Linux and macOS in GitHub Actions

## CLI usability

- [x] Add side-effect-free command and target-action help
- [x] Add global `--cwd`, `--json`, `--quiet`, and `--verbose` options
- [x] Add project-local router targets without credential storage
- [x] Add project checks and safe `.ipk` inspection
- [x] Add build-and-deploy, install, uninstall, and watch workflows
- [x] Use one feature-gated capability catalog for doctor and router tests
- [x] Define stable usage, validation, connectivity, and runtime exit codes
- [x] Add safe CLI commands for multi-view page and menu management
- [x] Make generated projects pin their local toolkit and support `init --install`

## Release readiness

- [x] Publish the first npm package
- [x] Add a changelog and release process
- [x] Add contributing and security policies
- [x] Add sanitized auth fixtures from official 4.8.1 and 4.9.0 firmware contracts
- [ ] Add sanitized API response fixtures from multiple models

## Full-stack packages

- [x] Define `ui-only` and `full-stack` package profiles
- [x] Add a router filesystem overlay to generated packages
- [x] Support backend package dependencies and custom lifecycle hooks
- [x] Add a generic full-stack reference plugin
- [x] Ship tested browser and CGI auth helpers for sensitive custom endpoints
- [x] Make `glplugin dev` install backend changes and fast-deploy UI changes

## Firmware compatibility

- [x] Add `glplugin doctor` for model, firmware, and capability detection
- [ ] Version extracted API catalogs by model and firmware
- [x] Make doctor RPC checks feature-gated instead of treating optional modules as failures
- [x] Build and publish a tested compatibility matrix
- [x] Let projects declare required RPC capabilities and enforce them in doctor/test
- [x] Capture and locally verify redacted compatibility candidates from doctor JSON

## API and types

- [x] Publish a typed stable Node.js and browser package entrypoint
- [x] Generate `.d.ts` declarations from the shared RPC catalog and response fixtures
- [ ] Generate API documentation and test cases from the same catalog
- [ ] Map extracted form validation to write-method parameter types
- [ ] Document unverified and feature-gated methods explicitly

## CLI security

- [x] Negotiate authentication from `challenge.alg` across supported firmware versions
- [x] Remove passwords from command-line arguments
- [x] Add a hidden password prompt and `--password-stdin`
- [x] Replace remaining SSH shell interpolation with argument-based process execution
- [x] Reuse one authenticated SSH connection across deploy, install, extract, and dev cycles
- [x] Log out finite RPC command sessions and expose `close()` on the Node API client
