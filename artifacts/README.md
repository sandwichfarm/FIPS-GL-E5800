# Local package artifacts

Candidate IPKs and their JSON manifests are generated here and ignored by Git.
From a clean checkout, follow [local development](../docs/local-development.md):

```sh
make dev-image web-deps web-build check rust-check rust-test
make vendor-deps
make lab-build lab-up lab-test lab-down
make openwrt-build package-fips package-web package-device
python3 tools/verify_artifacts.py
python3 tools/compatibility_manifest.py
```

The FIPS package requires the pinned Docker/Rust/Zig cross-build and its matching
build stamp. The web and touchscreen packages can be rebuilt independently once
their inputs are ready. The verifier checks payload hashes, source records,
target profile and FIPS build provenance; it does not prove opkg compatibility on
the current router firmware.
The compatibility generator runs that verifier before writing a unified
`compatibility.json` with all three package versions, hashes, upstream revisions,
and the target firmware. `checksums.sha256` covers each IPK, per-package JSON
manifest, and the compatibility manifest. Both files remain absent until a
complete candidate stack passes verification.

The touchscreen package declares all five regional zoneinfo dependencies and
bundles a checksum-pinned copy of the vendor feed's Pillow 9.5.0 Python payload
under the dashboard's private path. It does not install the feed package or its
conflicting `libfreetype` dependency. The package requires the exact stock
screen version and verifies its FreeType hash before deployment. ARM64 emulation
passed a TrueType render using the router's musl loader and stock FreeType, but
OpenWrt service operation is still unverified. Register
only reviewed candidate and exact known-good IPK paths and SHA-256 values in an
ignored private Ansible profile. Do not register stock UI packages as candidates.
`make vendor-deps` downloads and verifies 34 checksum-pinned OpenWrt runtime
IPKs into ignored `artifacts/runtime/`. The compatibility manifest and offline
recovery kit include them, so installation does not require a router-side feed
refresh. Their source and license records are pinned in
`upstream/vendor/runtime.json` and checked by the dependency audit.
