# End-to-end implementation tracker

Objective: complete the runtime, both interfaces, local development, CI/CD, and
deployment/disaster recovery described in the user's attached goal. Hardware
inspection is authorized; hardware deployment requires a concrete, separately
authorized plan after independent local work is finished.

## Acceptance and evidence

- [x] Reproducible ARM64 packages from pinned sources/toolchains; clean-checkout build.
- [ ] Persistent identity, validated configuration, supervised daemon and health checks.
- [ ] Dedicated mesh firewall and node are implemented. Optional LAN gateway has a packaged
  procd service, guarded activation, DNS setup and rollback. The former DHCP `route6`
  section was ignored by odhcpd. A route-only RFC 4191 advertiser is now
  packaged within the management binary and supervised as a second procd
  instance. It uses a distinct link-local source and zero default-router
  lifetime, so it cannot withdraw odhcpd's default route. Packet encoding,
  Router Solicitation validation, alias lifecycle and missing-instance checks
  have local tests. The Linux sender now replies to valid solicitations; this
  receive path has not run on a LAN client. IPv4-only WAN
  activation remains gated on a public IPv6 probe until real LAN client route
  and DNS behavior can be tested. On normal stop, alias removal now waits for
  the procd route instance to exit so the sender can withdraw its route. A
  stuck sender keeps the alias and state for a later cleanup retry; a crash can
  still leave a route for its 90-second lifetime. The service and health check reject a LAN without a
  SLAAC-capable /64 before changing DNS or forwarding. LAN clients and normal
  networking still need router hardware validation.
  See [RFC 4861 §6.3.4](https://www.rfc-editor.org/rfc/rfc4861.html#section-6.3.4)
  for default-router lifetime handling and
  [RFC 4191 §2.3](https://www.rfc-editor.org/rfc/rfc4191.html#section-2.3)
  for Route Information Options.
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
- Docker CLI 29.1.3 and the pinned Rust, Node, and Playwright images now run
  locally. Locked npm installation succeeds inside the pinned Node image.
- The original package restore flow was made check-only; guarded deployment
  and configuration activation now use a separate router-local watchdog.
- Rust backend: all 22 tests pass in Docker. Authenticated CGI: 5 tests pass;
  web panel/API: 5 tests pass.
  The backend previously read live lab daemon status and peer list.
- Two ARM64 Linux containers establish FIPS UDP links through separate network
  namespaces. A real IPv6 ping over `fips0` passes. A forced node crash followed
  by restart preserves the public identity and reconnects the mesh.
- Web bundle builds and a deterministic IPK puts it at GL.iNet's expected
  `/www/views/gl-sdk4-ui-fips.common.js.gz` path. Touchscreen source overlay
  builds and its FIPS panel renders offline and against a live lab daemon.
  Playwright validates its synthetic online, offline, request-error, stage,
  confirm, and rollback flows at desktop and mobile widths. Screenshots were
  inspected locally. Integration with the proprietary GL.iNet shell remains
  unverified.
- The pinned Rust 1.94.1/Zig 0.13.0 container cross-builds all four static
  ARM64 binaries, including the Router Solicitation handler. All three current
  IPKs pass payload and provenance verification, and the consolidated
  compatibility manifest is emitted. A fresh local checkout reproduced all
  three IPKs byte for byte, passed the browser and offline-kit checks, and
  re-established the two-node mesh after a forced node restart. A hosted CI
  run remains to be observed.
- The router-local guard and new transactional Ansible playbook are authored.
  Ninety-three Python tests pass locally with no skips, including the age
  encryption round trip and fake-opkg deadline, reboot, checksum, interrupted
  install, DNS/UI health failures, identity and configuration rollback.
  An interrupted opkg install left in `unpacked` state is now removed on
  rollback; a failed removal retains the pending transaction for retry.
  Package rollback also requires the stock screen service to enable, start,
  and report running before clearing the pending marker. A simulated failed
  start retains the transaction and succeeds on the next watchdog retry.
  The touchscreen removal script now restores the stock screen directly when a
  partial install lacks `toggle.sh`; a local fake-service test covers success
  and a failed stock start. The rebuilt device candidate passes payload checks.
  Fake OpenWrt gateway service tests cover start/restart/stop, disabled-state
  cleanup, failed DNS restart, a stuck route sender and a simulated firmware reboot, including
  restoration of prior DNS and sysctl state without replaying a
  stale LAN snapshot.
  First-install Ansible preflight checks the gateway's dnsmasq, odhcpd, IPv6
  forwarding and LAN interface prerequisites read-only when gateway mode is
  requested. It now also checks a required reviewed public IPv6 route and ping
  target. Gateway activation requires an existing IPv6
  default route and LAN RA service; it no longer forces a default RA or assigns
  a benchmarking prefix. The previous `route6` entry under DHCP was ignored by
  upstream odhcpd. The packaged route-only advertiser is unverified on a Linux
  LAN client and IPv4-only WAN activation remains gated. Package and
  later configuration confirmation recheck the target before disarming rollback.
  The confirmation playbook reads the probes staged on the router
  and rejects profile drift.
  Actual OpenWrt LAN clients and WAN/VPN behavior remain unverified.
  Ansible syntax checks pass. No router
  installation or rollback has been attempted.
- Package deployment now leaves its guard pending. A separate confirmation
  playbook rechecks management, normal networking and enabled FIPS links, and
  requires an operator to verify both selected interfaces before confirmation.
  The router-staged probe record now pins the full selected component set;
  confirmation rejects a changed or narrowed controller profile before running
  health checks. A local test renders and executes that confirmation path.
  Reviewed initial FIPS settings can be activated within the package rollback
  window, so a first install must establish a live link before confirmation.
  The router-side initial-settings sequence has standalone fault tests; it
  rejects unsafe transaction IDs and stops before activation if staging fails.
  A selected touchscreen dashboard is activated within that window; health
  checks require its service and button watcher running with the stock screen
  stopped. Package rollback returns the stock display; configuration-only
  rollback preserves the current display owner.
- Configuration-only activation now arms the same guard for 3 minutes. A staged
  change can be applied from web or touchscreen; the web page confirms it only
  after daemon reachability, a private persistent key file, and read-only
  management/route/ping/DNS probes are verified. The deployment profile pins
  those probes on the router; a disabled node uses network-only confirmation.
  Local tests cover activation failure, explicit rollback, missing identity,
  restored nft rules and service state. Generated nft syntax passes `nft -c`
  in a privileged local container; OpenWrt behavior remains unverified.
- [nftables verdict semantics](https://www.netfilter.org/projects/nftables/manpage.html)
  mean a separate early input-chain `accept` cannot authorize mesh ingress
  through fw4's later input chain. The backend now installs a dedicated `fips_mesh`
  fw4 zone bound to `fips0` after its restrictive nft table is loaded. Its input
  and forwarding policies reject by default; explicit IPv6 input rules allow
  configured mesh ports and essential ICMPv6. Health checks require the
  named zone and both nft layers. Host tests verify the UCI commands, reject
  a conflicting preexisting firewall section, and cover missing-layer
  rejection; traffic through GL.iNet's fw4 build is unverified.
  Gateway mode additionally creates an IPv6-only `lan` → `fips_mesh`
  forwarding section. Turning gateway mode off deletes only that forwarding;
  mesh-initiated forwarding into LAN remains closed. Host tests cover the UCI
  transition and health rejects a missing forwarding. LAN packet flow remains
  unverified.
- GitHub CI and manual deployment workflows are authored, including a secret
  path scan, vendored license/source digest check, locked Cargo/npm dependency
  license and checksum inventory, Rust formatting/Clippy, and local
  artifact/profile verification. Package manifests pin the observed web and
  stock-screen hashes through `upstream/targets.json` while retaining an
  unverified compatibility status. An origin remote is configured, but
  no trusted hardware runner is configured and neither workflow has run.
- CI now emits one compatibility manifest linking all three verified candidate
  package versions and checksums to the firmware target and pinned upstream
  revisions, plus a SHA-256 list for the IPKs, provenance files, and manifest.
  Local generation passed with the pinned cross-build. Both ordinary and
  post-firmware identity-restore offline-kit smoke checks pass with age.
- The controller rejects an IPK whose architecture field or FIPS ELF machine
  disagrees with AArch64, and its profile check rejects stale artifact source
  records before a deployment transaction can start. FIPS packaging now also
  requires a build stamp from the pinned toolchain that matches current source
  bytes and all four ARM64 binaries. IPK payload paths are restricted to files
  owned by each component, preventing direct payload overwrites of stock web or
  touchscreen files and rejecting packaged FIPS identity keys. Candidate
  packages also reject extra control files, and touchscreen maintainer scripts
  must byte-match the reviewed local sources. Prior recovery packages retain
  their separately pinned digests and still need script review before deployment.
- GL.iNet's current guide says GL-E5800 cannot flash through U-Boot. The
  recovery runbook reflects the model-specific soft reset and support path.
- An offline kit assembler copies reviewed IPKs, prior IPKs, Ansible roles,
  checksums, a kit-local deployment profile, recovery instructions and an
  encrypted private backup. Real kits require an age identity to decrypt and
  inspect the backup before assembly and verification. Synthetic kits pass
  integrity/tamper checks, Ansible syntax, and an age round trip locally.
  A real router capture and restore
  rehearsal are still required.
- The deployment playbook now accepts a reviewed encrypted backup for
  post-firmware FIPS identity restoration. It validates the backup before router
  writes, then renders and runs a restore script only under the active rollback
  guard. A local isolated-filesystem test verifies identity/config restoration,
  idempotence and no automatic replay of old network files. Router behavior is
  unverified.
- A second isolated-filesystem test now arms the router-local guard, restores
  a backed-up identity after a simulated firmware update, then loses controller
  confirmation. Deadline rollback removes the partial restore and preserves
  the new firmware's network configuration.
- Guarded backup restore now restarts an enabled gateway only when files or
  service state need repair. Disabling a previously active gateway marks the
  operation changed; a repeated restore leaves services alone. These behaviors
  pass fake-service tests and remain unverified on OpenWrt.
- The touchscreen package now declares all five zoneinfo regions used by the
  dashboard; a package test checks the exact dependency set. Its Pillow feed
  conflict remains unresolved. No candidate
  package is approved for hardware installation. A dedicated read-only
  dependency inspector is prepared to collect opkg file ownership and Python
  import paths once SSH access works. The latest read-only SSH attempt was
  denied authentication, so current firmware and dependency state remain
  unconfirmed. Browser rendering inside the vendor shell and complete
  gateway/client behavior also remain unverified.
