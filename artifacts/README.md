# Local package artifacts

Candidate IPKs and their JSON manifests are generated here and ignored by Git.
From a clean checkout, follow [local development](../docs/local-development.md):

```sh
make dev-image web-deps web-build check rust-check rust-test
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
`python3-pillow`. Installation remains blocked pending a compatible Pillow
package on the actual GL-E5800; never bypass opkg dependency checks. Register
only reviewed candidate and exact known-good IPK paths and SHA-256 values in an
ignored private Ansible profile. Do not register stock UI packages as candidates.
