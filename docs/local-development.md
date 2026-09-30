# Local development

The pinned upstream source is in `components/`; integration code is in `apps/`,
`packaging/`, and `dev/`. Run commands from the repository root. Docker Desktop,
Python 3.9+ with Pillow and NumPy, Make, and Ansible are needed for the
documented workflows. Install the age CLI to run encrypted-backup tests and
build a real offline recovery kit.

## Bootstrap and focused iteration

```sh
make dev-image
make web-deps
make web-build web-test web-browser-test
make web-preview-serve
make rust-check
make rust-test
make check
```

`dev-image` pins the ARM64 Rust base image and Debian package snapshot. Its
Dockerfile verifies the Zig 0.13.0 archive checksum and installs pinned
`cargo-zigbuild` 0.19.8. `web-deps` uses the committed npm lockfile and pinned
Node 22.16.0 image. Once dependencies exist, `make web-build` rebuilds only the
web view. `make web-browser-test` runs the synthetic preview in the pinned
Playwright container. Set `FIPS_BROWSER_SHOTS=1` when running its test script
directly to save screenshots under `.cache/web-preview/`. `make rust-check`
runs Rust formatting and Clippy; `make rust-test`
rebuilds only the Rust backend. `make check` validates pinned source snapshots
and licenses, runs Python tests, and checks Ansible syntax.

## Real local FIPS network

```sh
make lab-build
make lab-up
make lab-test
make route-lan-test
make web-live-browser-test
make lab-down
```

The lab creates two persistent, private identities in a Docker volume and
starts separate Linux containers with `/dev/net/tun` and `NET_ADMIN`. Its test
requires two connected FIPS nodes and a successful IPv6 ping through `fips0`.
It then kills one node, restarts it, and checks the identity and link recover.
`web-live-browser-test` runs the web panel in Playwright against the real
management binary and node A's live control socket. It mounts the lab volume
read-only and tests status, public identity, peers, configuration, recovery,
and diagnostics. It does not use the router or GL.iNet's session service.
`lab-down` stops containers but retains the volume. Do not use `docker compose
down -v` unless you deliberately want to discard these **test** identities.

The lab exercises FIPS itself, not OpenWrt's service manager, firewall, package
manager, hardware screen, or the real router. Results from the lab must be
reported as local Linux evidence.
`route-lan-test` creates an isolated client network namespace in a privileged
container with no external network. It checks that the native sender waits for
the gateway socket, emits a route-only multicast RA, answers a client Router
Solicitation with hop limit 255, withdraws the route when the gateway disappears,
and leaves the client's existing default route alone. On kernels built with
`CONFIG_IPV6_ROUTE_INFO`, it also checks route installation and removal. Docker
Desktop's LinuxKit kernel lacks that option, so its test reports packet checks
only. With the ARM64 binary from `make openwrt-build`, the same test passed
route installation, renewal, and withdrawal on Colima 6.8.0-64-generic using
Alpine 3.20, Python 3.12.13, and iproute2 6.9.0-r0:

```sh
docker --context colima build -t fips-ra-colima:local - <<'EOF'
FROM alpine:3.20
RUN apk add --no-cache python3 iproute2
EOF
docker --context colima run --rm --privileged --network none \
  -e FIPS_RA_REQUIRE_ROUTE_INFO=1 \
  -e FIPS_RA_BINARY=/workspace/apps/router-admin/target/aarch64-unknown-linux-musl/release/fips-router-admin \
  -v "$PWD:/workspace:ro" -w /workspace fips-ra-colima:local \
  python3 dev/lab/route_advertisement.py
```

This is local Linux evidence; physical clients and VPN coexistence still need
hardware testing. Hosted CI sets `FIPS_RA_REQUIRE_ROUTE_INFO=1` so the LAN test
fails if its kernel cannot verify route installation.

## Interface previews

```sh
make device-preview
make device-preview-host
python3 dev/device_ui_patch.py .cache/generated-device-ui/dashboard.py
docker compose -f dev/lab/compose.yml exec -T node-a python3 /workspace/dev/lab/preview_device.py --output /tmp/fips-panel-online.png --socket /state/a/control.sock --state-dir /state/a/router
docker cp e5800-fips-lab-node-a-1:/tmp/fips-panel-online.png .cache/fips-panel-online.png
```

The Docker offline preview is `.cache/fips-panel-offline.png`; the host command
also works with local Pillow and NumPy installed. The online preview uses
the live lab backend. The generated touchscreen source stays outside Git. The
package builder applies exact hooks to the pinned upstream source and fails if
the expected source anchors change. The stock UI is never included or replaced.

The web view currently builds to `apps/web-ui/dist/`, then the package builder
places its gzip bundle under `/www/views/`. A browser mock preview is
available at `http://127.0.0.1:8787` after `make web-preview-serve`. It uses
synthetic status and configuration data, with online, offline, and request-error
modes; it never sends requests to the router. `make web-preview-host-serve`
uses an already installed host npm tree for faster UI iteration. Both preview
bundles remain under ignored `.cache/`. Playwright exercises the synthetic
status, error, stage, confirm, and rollback flows at desktop and mobile widths.
The live lab browser check uses actual backend responses for read-only views.
Neither check proves that the view works inside GL.iNet's application.

Configuration changes are staged, then activated under a 3-minute router-local
guard. The web page confirms only after the daemon and persistent identity are
healthy. Gateway mode requires a reviewed public IPv6 route and ping probe
saved during deployment. Gateway
activation requires an existing IPv6 default route and LAN RA service. The
route-only advertiser has passed packet exchange with an isolated Linux client;
route installation passed on Colima Linux 6.8 but remains unverified on
physical LAN clients.
IPv4-only WAN activation remains gated until client routing and DNS behavior
are tested; native IPv6 gateway behavior still requires hardware testing.
The touchscreen needs a second tap to apply and the web page to confirm;
otherwise the timer restores the prior configuration. Local tests use fake
services and opkg. This flow is not yet validated on OpenWrt hardware.

## Candidate packages

```sh
make openwrt-build
make package-fips
make package-web
make package-device
make vendor-deps
python3 tools/verify_artifacts.py
python3 tools/compatibility_manifest.py
python3 tools/ipk.py artifacts/gl-sdk4-ui-fips_0.1.0-1_all.ipk --sha256 DIGEST --component web_ui --candidate
make dependency-audit
```

The package builder writes deterministic IPKs and JSON manifests to ignored
`artifacts/`. The manifest records SHA-256 checksums, payload digests, pinned
upstream revisions, toolchain, and the observed 4.10.0 target. Its compatibility
status is `candidate_unverified`; architecture and firmware fingerprints alone
do not prove safe installation.
The compatibility generator requires all three candidates to pass validation,
then writes `artifacts/compatibility.json` and `artifacts/checksums.sha256`.
Candidate inspection also restricts owned payload paths and control scripts;
the touchscreen scripts must match the reviewed local package sources.
`make openwrt-build` writes a build stamp from inside the pinned Rust/Zig image.
`make package-fips` rejects binaries changed since that build, current source
edits missing from the stamp, or a stamp from another toolchain. The stamp hashes
only the ARM64 build recipe and its Make variables, so web-only Make edits do
not force another FIPS cross-build. A host-only
cross-build is useful for diagnosis but cannot produce an approved FIPS IPK.
The tracked `upstream/targets.json` pins the observed web and stock-screen
hashes used by every package manifest. A reviewed deployment profile must
match that exact tuple; changing firmware requires new read-only inspection
and a rebuilt candidate set.
The dependency audit writes `artifacts/dependencies.json` from both Cargo locks,
the npm lock and pinned OpenWrt runtime IPKs. It checks lockfile integrity
records, the local IPK checksums, and known license identifiers;
the inventory is for review and does not establish legal compliance.

Run `python3 tools/verify_artifacts.py` after packaging to compare all three
candidate IPKs with their manifests. The pinned FIPS upstream revision is
reported by `.cache/openwrt-bin/fips --version` inside the development image.
For focused UI work, pass `--component web_ui` or `--component device_ui`.

The touchscreen package privately bundles the pinned `python3-pillow` 9.5.0
payload from the 4.10.0 GL.iNet feed. It does not depend on or install the
feed IPK: that package depends on `libfreetype`, whose payload collides with
the stock `gl-sdk4-screen-large` library. The private payload is loaded only
by the dashboard launcher. The package requires the exact stock screen version;
Ansible checks its FreeType symlink and SHA-256 before installation. A local
ARM64 emulation test rendered a TrueType glyph using the router's musl loader
and stock FreeType. This is an ABI compatibility check, not a hardware service
test. Keep the pinned IPK, source record, and bundled license together. Run
`make inspect-dependencies` for a fresh read-only dependency report after any
firmware update.

The router's opkg index directory is empty after the 4.10.0 update. The
dashboard needs Python, NumPy and supporting libraries, so `make vendor-deps`
fetches their exact feed IPKs to `artifacts/runtime/` on the controller.
Ansible verifies all 34 IPKs before router writes, installs only missing ones
under the rollback deadline and removes only those introduced by that
transaction if it rolls back. The offline kit copies them for recovery without
router-side feed access. Rebuild this pin set for a different firmware feed.

`ansible/deploy.yml` stages known-good IPKs and arms the router-local rollback
guardian before any package change. It leaves successful installs pending until
`ansible/confirm.yml` rechecks health after an operator verifies both interfaces.
For a first FIPS install, reviewed `initial_fips_settings` activate inside that
same guard; the health probe requires an enabled node with a live link.
`ansible/restore.yml` is now check-only.
The new deployment workflow has passed local syntax and fake-opkg fault tests,
but has not run on the router. An explicit approved hardware pass remains
required. The hosted CI and manual LAN-runner workflows have also not yet run.

For a read-only encrypted configuration capture and offline kit, follow
`docs/recovery.md`. Real kits require the age private identity to verify that
the backup decrypts and contains expected files; CI exercises that round trip
with synthetic identity and configuration data. The optional `recovery_backup`
deployment profile restores existing FIPS identity/configuration under the
package guard after a firmware update; a local test rehearses its generated
router script without writing to hardware.
