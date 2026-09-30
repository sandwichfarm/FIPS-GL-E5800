# Preparation validation

Validated through 2026-09-30. No package installation or configuration writes were made
on the router. The user's firmware update is outside this automation.

- Ten local unit/installer tests passed: package metadata, config exclusion,
  tampered checksum rejection, vendor-package rejection, wrong architecture,
  path traversal, unchanged install, absent install, same-version drift rejection,
  OpenWrt user-installed status, and OpenSSL-only base64 decoding (some checks
  share a test case). Installer execution tests use a fake local opkg and do not
  execute package maintainer scripts.
- Both Ansible playbooks passed syntax validation.
- Live `inspect.yml` against GL-E5800 4.10.0: 4 tasks OK, changed=0, failed=0.
- Live `restore.yml --check` for the pinned FIPS artifact: 16 tasks OK,
  changed=0, failed=0. Only read-only remote commands ran; upload/install tasks
  were skipped.
- FIPS IPK SHA-256 matches the release's `checksums-openwrt.txt`:
  `81556f760cbe3b159ae266bc9eac40c074bb85c3f5583b2b7cbe7b25193e8e5d`.
- Community dashboard 3.2.1 IPK built from the imported source and passed local
  metadata/payload validation. Its checksum is recorded in private/artifacts.json;
  the upstream build embeds timestamps, so rebuilding may change that checksum.

Not validated: actual package installation/removal, FIPS traffic, browser rendering
of a FIPS extension, touchscreen behavior, dependency conflict resolution, service
activation, or a future firmware-upgrade/recovery cycle. Those require a separately
requested deployment/testing pass. Firmware tuples remain unapproved by default.

## Subsequent local development

The preparation record above describes the original imported packages. Current
candidate packages are built by `tools/package.py` and verified by
`tools/verify_artifacts.py`; their digests differ from the imported FIPS release
and initial dashboard build. Ninety-four Python tests, including the age CLI
round trip, and Ansible syntax checks
pass. Fake OpenWrt gateway lifecycle tests restore DNS/RA and sysctl settings
after a failed start; physical LAN client and router hardware behavior are unverified.
A two-container Linux FIPS mesh connected and passed IPv6 ping after a
forced node restart while keeping the same identity. Fake-opkg tests exercise
the new local rollback guard under timeout, reboot, checksum failure, config-only
activation and explicit confirmation. All 22 Rust backend tests pass in the
pinned Docker environment; formatting and Clippy pass. The pinned Rust 1.94.1
and Zig 0.13.0 container built all four static ARM64 binaries and stamped their
source provenance. All three candidate IPKs pass payload, manifest, and source
verification, and a consolidated compatibility manifest was emitted. The
production and synthetic preview bundles build from the locked npm tree, all
five web tests pass, and Playwright checks online, offline, request error,
stage, confirm, rollback, and narrow viewport behavior. Desktop and mobile
screenshots were inspected locally. These checks do not prove integration with
GL.iNet's proprietary web shell. A separate Playwright run used the live lab
node and management binary for read-only status, public identity, peers,
configuration, recovery, and diagnostics; it mounted the lab state read-only
and had no external network access. Two panel tests cover stale online state
after a failed refresh or peer request; the panel clears stale status and
configuration on either failure. Both synthetic offline-kit smoke paths pass,
including age encryption and post-firmware identity restore. Neither CI nor
the guarded deployment has been run against the
router, and firmware/UI compatibility remains unapproved.
The configuration lock now retries transient `EAGAIN` for up to 200 ms before
returning `configuration_busy`; a lock-release test and 50 repeated parallel
Rust-suite runs passed after the change.
An isolated-filesystem rehearsal of the post-firmware restore script preserved
the synthetic FIPS key and active settings, did not replay older network files
or a stale staged candidate, rejected a mismatched guard transaction, and made
no file changes on a second run. It does not prove OpenWrt service recovery.
Another local rehearsal arms the guard, restores identity after a simulated
firmware update, then lets the deadline expire without controller confirmation;
the guard removes the restored files and leaves the firmware network config.
The restore now includes captured host aliases, peer ACLs and optional FIPS
nft policy files documented by upstream, while excluding old packaged scripts
and runtime state. The real-age kit smoke also renders its own guarded
restore script and checks shell syntax; that branch passed locally.
Gateway mode now requires a reviewed public IPv6 connectivity probe. Local
fault tests reject an invalid supplied probe, missing IPv6
route, and failed IPv6 ping. The packaged gateway now refuses activation
without an existing IPv6 default route and LAN RA service. It no longer forces
a default RA or assigns the upstream benchmarking prefix. The old `route6`
section under DHCP was ignored by upstream odhcpd. A separate route-only
advertiser now sends an RFC 4191 option from a dedicated link-local alias.
Packet encoding, Router Solicitation validation, and fake procd/address lifecycle
tests pass. An isolated Linux client now receives multicast advertisements,
solicits a unicast reply with hop limit 255, and sees a zero-lifetime withdrawal;
its default route remains unchanged. That test caught and fixed the sender's
former unicast hop limit of 64. Docker Desktop's LinuxKit kernel lacks
`CONFIG_IPV6_ROUTE_INFO`; on Colima's Linux 6.8.0-64-generic kernel the same
test additionally passed route installation, renewal after solicitation, and
removal on withdrawal. Physical clients and VPN coexistence remain unverified.
The existing public IPv6 gate still blocks IPv4-only WAN
activation until that client path is proven.
The service and confirmation health now also require a LAN IPv6 /64 before
starting gateway mode. Fake-router tests reject absent and /128 LAN addresses
without changing DNS or forwarding. This checks for a plausible client source
prefix; it does not prove that odhcpd actually advertises it. The route sender
uses a separate link-local source to avoid withdrawing odhcpd's default route.
Controller health rejects a missing alias or stopped gateway/route instance.
The stop callback now retains the alias until procd reports the route sender
exited, allowing its withdrawal to use the source address. A local test covers
that order and preserves alias/state for retry if the sender remains running.
A sender crash can still leave a route until its 90-second lifetime expires.
OpenWrt shutdown behavior remains unverified on the device.
The mesh policy now has a dedicated fw4 zone as well as the earlier restrictive
nft chain. The fw4 zone rejects mesh input by default and adds explicit IPv6
allow rules for configured TCP/UDP ports and essential ICMPv6. Local Rust tests
check the UCI commands; fake-router health tests reject a missing zone or nft
table, an open zone input policy, or a missing ICMPv6 rule. This addresses the documented
nftables behavior where an early `accept` can still be dropped by fw4's later
chain. A backend test rejects a conflicting preexisting firewall section before
UCI writes. OpenWrt packet flow and firewall reload effects remain unverified.
Gateway mode now adds a one-way IPv6 forwarding from `lan` to `fips_mesh`.
Local tests show the backend removes this section when gateway mode is disabled
and confirmation rejects an enabled gateway without it. Return traffic,
physical LAN clients, and VPN coexistence remain unverified.
The touchscreen package conflict remains unresolved; a read-only dependency
inspection playbook has passed syntax and shell checks. A current read-only SSH
attempt failed authentication, so the post-update router state is unconfirmed.
Deployment health now decompresses the web bundle, executes the CGI's rejected
GET path, parses the dashboard source, and renders a Pillow frame in memory.
Local fault tests reject a corrupt gzip bundle, broken CGI response, and
dashboard syntax error. Playwright establishes rendering only in the synthetic
preview; physical touchscreen and vendor-shell behavior remain unverified.
The packaging gate rejects the host toolchain and stale or modified ARM64
binaries before labeling a FIPS candidate with current source provenance.
Local rollback fault tests now cover a newly introduced package left in opkg's
`unpacked` state. The guard attempts to remove it, keeps its pending marker if
removal fails, and retries on the next watchdog check. OpenWrt's real opkg
behavior remains unverified on hardware.
Guard fault tests also reject confirmation after the wall-clock or uptime
deadline, after a reboot, and when the pending deadline is malformed. The
pending transaction remains for rollback in each case.
An isolated concurrency test holds rollback during a package restore and
confirms that simultaneous confirmation fails. Another test leaves a stale
temporary lock and verifies the watchdog clears it before rolling back. These
tests do not establish process-lock behavior on OpenWrt hardware.
Deployment now refuses preexisting uncommitted UCI changes in network, DHCP or
firewall. Rollback removes deltas created during the guarded transaction before
restoring the saved config files, including when an edit failed before commit.
An isolated fake-UCI test covers this path; live OpenWrt behavior is unverified.
The guarded post-firmware restore now avoids restarting an already healthy
gateway on a repeated run. A fake-service test also confirms that stopping and
disabling an unwanted gateway is reported as a change, then does nothing on a
second run. OpenWrt service behavior remains unverified.
A linked temporary lock directory blocks guard arming before a package change.
Package rollback retains its pending marker if the stock touchscreen service
fails to start. An isolated fake-service test demonstrates a subsequent watchdog
retry completes once that service succeeds; physical display recovery remains
unverified.
The touchscreen removal script no longer relies on `toggle.sh`, which can be
absent in an interrupted install. Its fake-service test restores the stock
screen and fails removal when that service does not start. The resulting device
IPK passes candidate validation; OpenWrt opkg behavior remains unverified.
Deployment now records the complete selected component list with the router's
network probes. A local test renders the Ansible staging expression and runs
the confirmation health script against a fixture: a narrowed component list
fails before health checks, while the exact set succeeds. Live Ansible/router
behavior remains unverified.
IPK validation now restricts payload files to each component's owned paths,
rejecting stock web/touchscreen files and packaged identity keys. The current
web and device packages, plus the imported FIPS and dashboard packages, pass
that path validation; package maintainer scripts and hardware effects still
require review before deployment.
Candidate validation now also rejects extra control files and requires the
touchscreen maintainer scripts to match the reviewed local source byte for byte.
It requires every runtime file and declared dependency used by the three
candidate packages, so incomplete packages fail before router writes.
The offline two-UI kit passes this validation; prior packages remain separately
pinned by digest and are accepted as recovery inputs without candidate-script
requirements. The kit smoke check now invokes the verifier and candidate
installer renderer from the copied kit itself, and checks each rendered shell
installer's syntax.
It also copies a synthetic kit to a second location and runs Ansible's actual
controller package-validation role there. Both UI candidates resolve from the
new kit root without router access. Known-good staging and real recovery still
need an OpenWrt hardware pass.
The consolidated compatibility generator's unit tests link all three package
versions and upstream revisions to one firmware target and reject changed IPK
bytes or a mismatched target. Its real run emitted the current manifest after
the pinned cross-build and candidate verification.

The locked dependency audit inventories 374 Cargo crates and 163 npm packages,
including checksums and declared licenses. It detects new or missing license
identifiers; the inventory is not a legal compliance determination. In
particular, the Rust dependency graph includes GPL-3.0-or-later components,
which need distribution review before publishing packages.
The npm audit reports two inherited Vue 2 issues (one low, one moderate).
The webpack advisory was removed by pinning webpack 5.105.0. Replacing the
remaining Vue 2 toolchain requires a separate migration of the community UI
extension toolkit.

A fresh checkout at `c7fa229` rebuilt the pinned development image, installed
the locked web dependencies, passed the web unit and Playwright browser checks,
passed all 93 Python tests, and rebuilt all four ARM64 binaries and all three
candidate packages. Package SHA-256 values matched the existing workspace
byte for byte: FIPS `96fd35b0e8f7d8400780e12b33a4c5f2754f24d624ae306ccf65ba54bd7eb962`,
web `c6dfa3e704773897d168168d987b55cf111cb496931226e9d6f88adff22ee72b`,
and device `5bd4c9858df3414d592042d2221723fbea760d8f2281bf15ae77f90e9d315a22`.
Artifact verification, compatibility generation, dependency audit, both
encrypted offline-kit smoke paths, and the device offline preview passed in
that checkout. Its two-node Docker lab passed IPv6 mesh ping and recovered
the same identity and link after a forced node crash. Hosted GitHub CI has
not run, and no candidate has been installed on the router.
The later unicast-hop-limit fix changed the FIPS candidate to
`a546192757f8f5d6985a9fa028e7c27ddf8c988f812ffcd897b5fa5e1f67c0b0`;
its pinned ARM64 build and artifact verification passed locally. A second
clean checkout at `6ae9b0a` installed the locked web dependencies, passed the
web unit and Playwright browser tests, rebuilt all four ARM64 binaries, and
packaged all three candidates. Byte comparisons against the workspace IPKs
passed: FIPS `a546192757f8f5d6985a9fa028e7c27ddf8c988f812ffcd897b5fa5e1f67c0b0`,
web `c6dfa3e704773897d168168d987b55cf111cb496931226e9d6f88adff22ee72b`,
and device `5bd4c9858df3414d592042d2221723fbea760d8f2281bf15ae77f90e9d315a22`.
Artifact verification and compatibility generation passed in that checkout.

A second isolated checkout at `8181176` passed 94 Python tests, the locked web
build and unit tests, synthetic and live-lab Playwright checks, the two-node
crash/reconnect test, both encrypted recovery-kit paths, and the dependency
audit. It reproduced the same three IPK hashes above with provenance schema 2,
which hashes the ARM64 build recipe without invalidating FIPS for web-only Make
changes. Its compatibility manifest generated successfully. Hardware and hosted
CI gates remain open.

Read-only SSH after the firmware update confirmed GL 4.10.0/OpenWrt 23.05.4,
kernel 5.15.170-perf, and both pinned stock UI fingerprints. The installed
`gl-sdk4-screen-large` package is `git-2026.237.10575-dd8a031-1` and owns
`/usr/lib/libfreetype.so.6.20.4` (SHA-256
`cc5c4e7e52f9278b334248b924d49ea169c3a80d5dba2b1a5929404ffe93e6bb`).
The vendor feed's `python3-pillow` 9.5.0-2 depends on `libfreetype` 2.11.1-1,
which owns the same SONAME path as the stock screen. No package was installed.
The router currently has no IPv6 default route or active LAN /64 and has
`dhcp.lan.ra=disabled`; the gateway preflight correctly blocks activation in
that state.

The revised touchscreen IPK `gl-e5800-dashboard_3.2.1-2_aarch64_cortex-a53.ipk`
has SHA-256 `d2ba1d04d3c5cdc2f1421a40722aeaafa63bbff1c0b7d5819dd236a7adfd35e3`.
It bundles the checksum-pinned vendor Pillow Python payload privately, with
no FreeType file or feed Pillow dependency. A local ARM64 container ran the
packaged payload's Pillow 9.5.0 TrueType render with the copied router musl
loader, stock FreeType 2.14.1 and stock screen font. This proves the tested
local ABI path; it does not prove `opkg` installation or display service
operation on the router. The current 95-test Python suite and Ansible syntax
checks pass. Both full-stack and post-firmware identity offline-kit smoke
checks pass after relocating the kit. All three IPKs and the compatibility
manifest verify locally. Hardware deployment and hosted CI remain outstanding.

The [official public FIPS test node](https://learn.fips.network/lessons/13-try-it)
was reachable from a fresh local Docker FIPS node on 2026-09-30: the daemon
reported an active peer and a nonzero link count over UDP `217.77.8.91:2121`.
The first run exposed a local test-harness issue because Docker Desktop bind
mounts could not host the Unix control socket; moving that socket to the
container's `/tmp` made the control query pass. This is an external peer
link check from the controller's network, not a router connectivity test.
The first-install Ansible profile in ignored `ansible/vars/local.yml` pins the
current three candidate hashes and public test peer with
`check_only_fixture: true`, so a real deployment cannot use it accidentally.
The added free-space preflight passed a local Ansible role run and rejected an
injected insufficient-space threshold. Read-only router checks found 2.8 GiB
available on `/` and 800 MiB on `/tmp`; the observed 4.10.0 profile passed
the full three-component Ansible check-mode run with zero changes. The chosen
IPv4 ping and DNS probes also succeeded from the router.

The live router has no opkg feed indexes and is missing Python, NumPy, TIFF,
WebP and regional timezone packages required by the dashboard. A pinned
dependency closure from the 4.10.0 vendor feeds contains 34 IPKs (16.0 MB
compressed). A read-only comparison of their 1,982 non-directory payload paths
against the live router found zero existing-file collisions. The controller
verifies pinned IPK checksums, control metadata, source/license records and protected
stock paths before staging. Local fake-opkg tests cover first install,
idempotence, a missing/dependent package, and rollback that removes only
new runtime packages after controller loss. The relocated offline kit verifies
all runtime IPKs and renders a syntactically valid installer without feed
access. The complete Python suite now passes 101 tests; actual opkg installation
and rollback of these feed IPKs remain hardware gates.

An isolated export of commit `7e3f724` fetched the 34 pinned IPKs, installed
the locked web dependencies, rebuilt the development image, cross-built the
ARM64 FIPS binaries, and packaged all three components. The resulting SHA-256
digests matched the reviewed candidates exactly: FIPS
`a546192757f8f5d6985a9fa028e7c27ddf8c988f812ffcd897b5fa5e1f67c0b0`,
web `c6dfa3e704773897d168168d987b55cf111cb496931226e9d6f88adff22ee72b`,
and touchscreen
`d2ba1d04d3c5cdc2f1421a40722aeaafa63bbff1c0b7d5819dd236a7adfd35e3`.
The export needed a Git index for `check_sources.py` provenance checks;
a normal checkout supplies it. Web unit and browser preview tests passed in
the export, as did artifact verification, compatibility emission, dependency
audit, and a relocated recovery kit with encrypted identity restore.

The post-update `restore.yml --check` now validates touchscreen dependencies
from the controller's pinned offline bundle. Its former router-side Python/Pillow
probe could not pass on the observed fresh 4.10.0 firmware, which has neither
installed. This dry run remains read-only and does not substitute for guarded
installation or a hardware acceptance test.

The guarded deploy play now requires a fresh age-encrypted controller backup
before the first persistent router write. Its capture includes the complete
`/etc/config/` tree, existing `/etc/fips/` identity/configuration, and dashboard
settings. It rejects an insecure identity file, a public backup directory,
invalid or incomplete tar content, and reuse of a transaction's backup path.
Local tests exercised the actual capture shell against a synthetic router tree,
age encryption/decryption, first-install and existing-identity cases, and
backup-before-guard ordering. The Python suite passes 104 tests.

On 2026-09-30, a dedicated local Ed25519 administration key with fingerprint
`SHA256:N/oyVdhxyLhGKlMfb+BhUJBa1/yJUnWXEdQmeUAuHqU` was installed in the
router's `/etc/dropbear/authorized_keys`. A fresh key-only login succeeded
against firmware 4.10.0. The private key is in ignored `private/ssh/` and is
not on the router. A read-only capture of the stock router configuration was
encrypted to ignored `private/predeploy/backups/router-20260930T175806Z.age`;
the standalone validator decrypted and checked 108 allowed files. That check
exposed and prompted a fix for stock backups with no FIPS settings. This is a
verified off-router backup, not a tested restore. The guarded deployment must
still capture a fresh backup before its first persistent write. Hardware
rollback, stock/FIPS switching, and normal internet access remain deployment
gates requiring explicit approval before the trial.

A further read-only check found that the stock router's network, firewall, and
DHCP files use modes `606`, `646`, and `606`. The prior rollback forced changed
files to `600`, so it could not restore that predeployment state exactly. The
router-local guard now preserves file metadata, dashboard settings, and the
enabled/running state of the stock screen, community dashboard, and button
watcher. A local upgrade test restores an active dashboard; a failed dashboard
restart leaves rollback pending for retry. `make check` passes 106 Python tests,
shell syntax, and Ansible syntax. These remain local tests; the actual router
has not had a FIPS package installed or rolled back.

The new read-only state audit was exercised against the untouched 4.10.0
router on 2026-09-30. Two independently encrypted configuration captures
matched in file contents, modes and ownership; only the modification time of
`etc/config/cellular/slot_map.json` changed between captures. The strict
comparison reported that difference, while the explicit `--ignore-mtime`
comparison passed. Two private inventories matched across all 1,062 opkg
records and the selected service states. This establishes a baseline and
shows natural timestamp drift; it does not demonstrate post-deployment
rollback equivalence. A first-install rollback also leaves the recovery guard
installed, which the inventory comparison reports. Cleanup is prepared below
but has not been exercised on hardware.

The state-audit tools now ship in the private offline recovery kit. The
read-only inventory command captured the current firmware, 1,062 opkg records,
and eleven service states over the dedicated SSH key. The keyed backup command
also captured and validated a fresh encrypted archive without using a shared
SSH agent. A locally assembled kit containing both audit tools passed
`verify_recovery_kit.py` with the stock backup. `make check` passes 115 Python
tests plus shell and Ansible syntax checks. The audit tools are ready for a
guarded trial, but no post-deployment comparison exists yet.

A first-install stock rollback cleanup is now prepared. Isolated tests require
the exact `ROLLED_BACK` transaction result, no pending marker or candidate
package/service, and a running stock screen before removing the standalone
guard. The controller tool rejects package/configuration drift beyond the
guard, encrypts and verifies the guard evidence before cleanup, then captures
and compares final inventory and configuration again. A read-only run against
the untouched stock router returned `STOCK_ALREADY_CLEAN`; no cleanup was run
on hardware. A second private offline kit containing these tools passed
verification. The route is only prepared for a first installation; restoring
an older preexisting guard on an upgrade is still an open edge. The latest
`make check` passes 122 Python tests plus shell and Ansible syntax checks.
The inventory now also fingerprints the stock web app bundle and touchscreen
binary. Two read-only v2 inventories on the live router matched, and both
fingerprints still equal the reviewed 4.10.0 values. A read-only cleanup
preflight using that inventory again returned `STOCK_ALREADY_CLEAN`.

The FIPS/stock operating-mode controller is now in the offline kit. Its local
tests cover peer preservation, gateway-off staging, transaction matching,
confirmation before touchscreen switching, rollback without display changes,
screen retry checks, and the return-button service. `make check` passes 129
Python tests plus shell and Ansible syntax checks. A fresh private kit
`mode_switch_20260930` assembled with the encrypted stock backup and passed
`verify_recovery_kit.py`. Neither operating-mode transition has been run on the
GL-E5800. Ordinary LAN internet, DNS, VPN, router administration, FIPS link,
and physical screen operation must be checked before the first hardware
confirmation. The controller intentionally keeps LAN gateway mode disabled.
