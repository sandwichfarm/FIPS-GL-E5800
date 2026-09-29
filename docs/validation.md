# Preparation validation

Validated on 2026-09-29. No package installation or configuration writes were made
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
