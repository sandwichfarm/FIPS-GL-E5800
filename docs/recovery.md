# Deployment and recovery for GL-E5800

This workspace builds three separate packages: the FIPS daemon/management binary,
a GL.iNet web extension, and the community replacement touchscreen dashboard.
The stock web and touchscreen applications are proprietary captures, not source
packages. Do not replay their files across firmware versions. This procedure has
only been tested with local fake-opkg fault tests; hardware deployment remains
unapproved and unverified.

## Before any deployment

1. Back up the router's `/etc/fips/` identity/configuration, dashboard settings,
   `/etc/config/{network,firewall,dhcp}`, and the installed known-good IPKs to
   encrypted private storage. Verify the backup can be read. Do not commit keys,
   backups, router config, or passwords. Preserve the exact prior IPK and SHA-256
   for every already-installed component; the guard refuses to arm otherwise.
2. Run `make check`, `make lab-build lab-up lab-test`, `make openwrt-build`,
   `make package-fips package-web package-device`, and
   `python3 tools/verify_artifacts.py`. Keep the emitted IPKs/manifests together.
3. Reinspect the firmware with `ansible-playbook ansible/inspect.yml --ask-pass`
   and compare the exact model, architecture, web bundle and screen fingerprints.
   A matching hash identifies the release; it does not establish app compatibility.
   Review FIPS kernel dependencies, GL web extension integration, and Pillow
   package ownership before approving that tuple.
4. Create ignored `ansible/vars/local.yml` with selected `restore_components`,
   exact `package_artifacts` paths/hashes, `known_good_artifacts` paths/hashes,
   the reviewed `approved_profiles`, `recovery_probe_ip`, and
   `recovery_probe_name`. Use a network probe reachable in normal operation.
   Do not store the SSH password; use `--ask-pass` or an authorized key.
5. Run a read-only dry run:
   `ansible-playbook ansible/deploy.yml --ask-pass --check -e @ansible/vars/local.yml -e recovery_transaction=review1`.
   The project keeps `approved_profiles: []` by default, so installation is
   blocked until an actual reviewed profile is supplied privately.

Example local variable shape (replace every placeholder with reviewed evidence):

```yaml
restore_components: [fips, web_ui]
approved_profiles:
  - firmware: '4.10.0'
    architecture: aarch64_cortex-a53
    app_sha256: '<reviewed SHA-256>'
    screen_sha256: '<reviewed SHA-256>'
package_artifacts:
  fips: {path: /absolute/path/artifacts/fips_0.5.2-1_aarch64_cortex-a53.ipk, sha256: '<SHA-256>'}
  web_ui: {path: /absolute/path/artifacts/gl-sdk4-ui-fips_0.1.0-1_all.ipk, sha256: '<SHA-256>'}
known_good_artifacts:
  fips: {path: /absolute/path/prior/fips.ipk, sha256: '<SHA-256>'}
recovery_probe_ip: '1.1.1.1'
recovery_probe_name: 'example.com'
recovery_seconds: 300
```

`known_good_artifacts` is empty for a first installation. If FIPS is already
installed, its exact current-version prior IPK is mandatory. The same rule
applies to either UI package. The controller prevalidates selected packages;
the guard checks staged prior checksums and installed versions on the router.

## Deployment transaction

After explicit hardware deployment authorization and successful dry-run review:

```sh
ansible-playbook ansible/deploy.yml --ask-pass -e @ansible/vars/local.yml -e recovery_transaction=unique_reviewed_id
```

The playbook installs the guard outside the three replaceable packages, enables
its early boot service, stages known-good IPKs, backs up live identity and network
configuration in mode-0700 router storage, then arms a 60–900 second deadline.
Only then does it install packages. It confirms the transaction after SSH,
`ubus`, route, ping, DNS, and selected package checks pass. A failed task requests
immediate rollback. Controller loss, reboot, or deadline expiry triggers the
router-local guard. Review `/etc/fips-recovery/<ID>/result` and the actual
network/UI state after any failure; don't equate an Ansible exit code with full
recovery. Guard fault tests cover timeout, reboot, bad checksum, and confirmation
using fake opkg; actual OpenWrt rollback remains a hardware acceptance test.

The manual GitHub deployment workflow is restricted to `main`, a self-hosted LAN
runner, and the `hardware` environment. Configure environment reviewers and a
trusted local `/etc/gl-e5800/deploy.yml`; no router credentials or LAN runner are
available to pull requests. It rebuilds packages and checks the private profile's
candidate hashes before invoking the same Ansible transaction. This repository
has no upstream remote or hosted runner configured, so CI/CD is authored but
not yet observed running on GitHub.

## Recovery ladder

- If SSH works, inspect the guard with
  `/bin/sh /etc/fips-recovery/guard.sh status`. For a pending transaction, use
  `/bin/sh /etc/fips-recovery/guard.sh rollback`; confirm only after independent
  network, daemon, web and screen checks. The guard restores prior IPKs and the
  saved identity/config, then returns to the stock screen.
- If SSH is lost, wait for the guard's deadline and reconnect. A reboot also
  makes a pending transaction roll back on boot. Do not overwrite the stock
  `/www` tree or `gl_screen` binary with an old capture.
- If management returns but networking remains broken, use the GL-E5800's
  documented **4-second soft reset** to repair network connectivity while
  preserving settings, then inspect and restore from the encrypted backup.
  The [GL-E5800 user guide](https://docs.gl-inet.com/router/en/4/user_guide/gl-e5800/)
  documents the soft reset, the **10-second factory reset** (which erases
  settings), and stock touchscreen/web firmware upgrade paths.
- If the device cannot boot or enter management, stop and use GL.iNet support's
  model-specific procedure. [GL.iNet's current debrick guide](https://docs.gl-inet.com/router/en/4/faq/debrick/)
  explicitly says **GL-E5800 does not support firmware flashing through U-Boot**.
  Do not follow a generic U-Boot flashing recipe for this model. Factory reset
  erases settings and is a last resort; restore identities only from a verified
  private backup and only after the exact firmware is known.

Assemble the ignored offline kit with
`python3 tools/recovery_kit.py --profile ansible/vars/local.yml --encrypted-backup /private/path/identity-config-backup.age --kit-id <unique-id>`.
It copies the reviewed candidate/prior IPKs, their checksums, rollback scripts,
Ansible playbook/roles, this runbook, and an age-formatted identity/configuration
backup under `private/recovery-kits/<ID>` with a manifest. The filename/header
check does not prove the backup decrypts: test decryption and restoration
offline with your private key before deployment. The kit does not include a
vendor firmware image or credentials. Keep it off the router and offline.
