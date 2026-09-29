# Local development

The pinned upstream source is in `components/`; integration code is in `apps/`,
`packaging/`, and `dev/`. Run commands from the repository root. Docker Desktop,
Python 3.9+, Make, and Ansible are needed for the documented workflows.

## Bootstrap and focused iteration

```sh
make dev-image
make web-deps
make web-build web-test
cargo test --locked --manifest-path apps/router-admin/Cargo.toml
python3 -m unittest discover -s tests -v
```

`dev-image` pins the ARM64 Rust base image and Debian package snapshot. Its
Dockerfile verifies the Zig 0.13.0 archive checksum and installs pinned
`cargo-zigbuild` 0.19.8. `web-deps` uses the committed npm lockfile and pinned
Node 22.16.0 image. Once dependencies exist, `make web-build` rebuilds only the
web view. `cargo test` rebuilds only the Rust backend. Existing Ansible syntax
checks remain in `make check`.

## Real local FIPS network

```sh
make lab-build
make lab-up
make lab-test
make lab-down
```

The lab creates two persistent, private identities in a Docker volume and
starts separate Linux containers with `/dev/net/tun` and `NET_ADMIN`. Its test
requires two connected FIPS nodes and a successful IPv6 ping through `fips0`.
It then kills one node, restarts it, and checks the identity and link recover.
`lab-down` stops containers but retains the volume. Do not use `docker compose
down -v` unless you deliberately want to discard these **test** identities.

The lab exercises FIPS itself, not OpenWrt's service manager, firewall, package
manager, hardware screen, or the real router. Results from the lab must be
reported as local Linux evidence.

## Interface previews

```sh
make device-preview
python3 dev/device_ui_patch.py .cache/generated-device-ui/dashboard.py
docker compose -f dev/lab/compose.yml exec -T node-a python3 /workspace/dev/lab/preview_device.py --output /tmp/fips-panel-online.png --socket /state/a/control.sock --state-dir /state/a/router
docker cp e5800-fips-lab-node-a-1:/tmp/fips-panel-online.png .cache/fips-panel-online.png
```

The offline preview is `.cache/fips-panel-offline.png`; the online preview uses
the live lab backend. The generated touchscreen source stays outside Git. The
package builder applies exact hooks to the pinned upstream source and fails if
the expected source anchors change. The stock UI is never included or replaced.

The web view currently builds to `apps/web-ui/dist/`, then the package builder
places its gzip bundle under `/www/views/`. A browser mock preview is still
needed; a successful webpack build alone does not prove the view works inside
GL.iNet's application.

## Candidate packages

```sh
make openwrt-build
make package-fips
make package-web
make package-device
python3 tools/ipk.py artifacts/gl-sdk4-ui-fips_0.1.0-1_all.ipk --sha256 DIGEST --component web_ui
```

The package builder writes deterministic IPKs and JSON manifests to ignored
`artifacts/`. The manifest records SHA-256 checksums, payload digests, pinned
upstream revisions, toolchain, and the observed 4.10.0 target. Its compatibility
status is `candidate_unverified`; architecture and firmware fingerprints alone
do not prove safe installation.

Run `python3 tools/verify_artifacts.py` after packaging to compare all three
candidate IPKs with their manifests. The pinned FIPS upstream revision is
reported by `.cache/openwrt-bin/fips --version` inside the development image.

The touchscreen candidate declares `python3-pillow` as a dependency. On this
firmware, the feed package reportedly conflicts with a file owned by
`gl-sdk4-screen-large`. This conflict must be resolved with compatible package
ownership before deployment. Do not bypass dependency checks.

`ansible/deploy.yml` stages known-good IPKs and arms the router-local rollback
guardian before any package change. `ansible/restore.yml` is now check-only.
The new deployment workflow has passed local syntax and fake-opkg fault tests,
but has not run on the router. An explicit approved hardware pass remains
required. The hosted CI and manual LAN-runner workflows have also not yet run.
