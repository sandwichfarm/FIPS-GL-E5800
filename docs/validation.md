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
and initial dashboard build. Ninety-three Python tests, including the age CLI
round trip, and Ansible syntax checks
pass. Fake OpenWrt gateway lifecycle tests restore DNS/RA and sysctl settings
after a failed start; LAN client and router hardware behavior are unverified.
A two-container Linux FIPS mesh connected and passed IPv6 ping after a
forced node restart while keeping the same identity. Fake-opkg tests exercise
the new local rollback guard under timeout, reboot, checksum failure, config-only
activation and explicit confirmation. All 21 Rust backend tests pass in the
pinned Docker environment; formatting and Clippy pass. The pinned Rust 1.94.1
and Zig 0.13.0 container built all four static ARM64 binaries and stamped their
source provenance. All three candidate IPKs pass payload, manifest, and source
verification, and a consolidated compatibility manifest was emitted. The
production and synthetic preview bundles build from the locked npm tree, all
five web tests pass, and Playwright checks online, offline, request error,
stage, confirm, rollback, and narrow viewport behavior. Desktop and mobile
screenshots were inspected locally. These checks do not prove integration with
GL.iNet's proprietary web shell. Two panel tests cover stale online state
after a failed refresh or peer request; the panel clears stale status and
configuration on either failure. Both synthetic offline-kit smoke paths pass,
including age encryption and post-firmware identity restore. Neither CI nor
the guarded deployment has been run against the
router, and firmware/UI compatibility remains unapproved.
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
tests pass. The Linux sender now replies to valid solicitations, but live
solicitation handling, LAN client route installation, and VPN coexistence
remain unverified. The existing public IPv6 gate still blocks IPv4-only WAN
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
