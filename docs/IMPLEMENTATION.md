# End-to-end implementation tracker

Objective: complete the runtime, both interfaces, local development, CI/CD, and
deployment/disaster recovery described in the user's attached goal. Hardware
inspection is authorized; hardware deployment requires a concrete, separately
authorized plan after independent local work is finished.

## Acceptance and evidence

- [ ] Reproducible ARM64 packages from pinned sources/toolchains; clean-checkout build.
- [ ] Persistent identity, validated configuration, supervised daemon and health checks.
- [ ] Dedicated mesh firewall; node and optional LAN gateway; normal networking preserved.
- [ ] Native authenticated web extension: status, public identity, peers, settings, controls, diagnostics.
- [ ] Touchscreen status/controls, error states, stock-display recovery, compatible dependencies.
- [ ] Local bootstrap, build, test, preview, package, inspect, deploy and rollback commands.
- [x] Containerized real multi-node FIPS integration, separate from simulation.
- [ ] CI checks, package artifacts, checksums, provenance, compatibility manifest and secret scanning (workflow authored; hosted run pending).
- [ ] Manual-only deployment pipeline; no router access/secrets for pull requests (workflow authored; protected runner/environment pending).
- [ ] Private backup, known-good artifacts/configuration and router-local rollback deadline (local implementation tested; hardware pending).
- [ ] Independent confirmation checks for management, ordinary networking, FIPS and interfaces.
- [ ] Fault tests: interrupted install, controller loss, invalid config, crashes, DNS/firewall/UI failures.
- [ ] Identity-preserving backup restoration and idempotent recovery.
- [ ] Offline disaster recovery kit/runbook with model-specific verified vendor procedures.
- [ ] Authorized hardware validation; report simulated, local Linux and hardware evidence separately.

## Architecture decisions

- Keep pinned upstream imports in `components/`; own integration lives in `apps/`,
  `packaging/`, `dev/`, `ansible/`, and `tools/`.
- Use a small Rust management executable sharing the upstream FIPS configuration
  parser. Web CGI authenticates GL sessions before invoking it. Local touchscreen
  invokes the same management interface. Private identity never enters that API.
- Package files independently of vendor core UI. Firmware captures remain private.
- Build and test rollback before a hardware deployment request. Unknown firmware
  fingerprints must not be interpreted as compatibility proof.

## Current evidence

- Repository baseline `2e30eb3` is clean at start.
- Router read-only verification: GL.iNet 4.10.0, kernel 5.15.170-perf,
  `aarch64_cortex-a53`.
- Docker daemon was stopped; Docker Desktop started successfully (29.1.3).
- Existing recovery tooling performs package restore/checks, but does not yet
  implement transactional rollback or end-to-end acceptance.
- Rust backend: 6 tests pass; authenticated CGI: 5 tests pass; web API: 3 tests
  pass. The backend reads a live lab daemon status and peer list.
- Two ARM64 Linux containers establish FIPS UDP links through separate network
  namespaces. A real IPv6 ping over `fips0` passes. A forced node crash followed
  by restart preserves the public identity and reconnects the mesh.
- Web bundle builds and a deterministic IPK puts it at GL.iNet's expected
  `/www/views/gl-sdk4-ui-fips.common.js.gz` path. Touchscreen source overlay
  builds and its FIPS panel renders offline and against a live lab daemon.
- ARM64 cross-builds for all four binaries completed. The executable reports
  upstream revision `53a3ec4b2f`, and all three generated IPKs passed digest,
  architecture and payload checks. A clean-checkout CI build remains to be observed.
- The router-local guard and new transactional Ansible playbook are authored.
  Twenty-two Python tests pass, including fake-opkg deadline, reboot, checksum,
  identity and configuration rollback. Ansible syntax checks pass. No router
  installation or rollback has been attempted.
- GitHub CI and manual deployment workflows are authored, including a secret
  path scan and local artifact/profile verification. This repository has no
  remote or trusted hardware runner configured, so neither workflow has run.
- GL.iNet's current guide says GL-E5800 cannot flash through U-Boot. The
  recovery runbook reflects the model-specific soft reset and support path.
- An offline kit assembler copies reviewed IPKs, prior IPKs, Ansible roles,
  checksums, recovery instructions and an age-formatted private backup. A real
  encrypted backup and restore rehearsal are still required.
- The touchscreen's Pillow feed conflict remains unresolved. No candidate
  package is approved for hardware installation; activation remains absent.
