# Deployment and recovery for GL-E5800

This workspace builds three separate packages: the FIPS daemon/management binary,
a GL.iNet web extension, and the community replacement touchscreen dashboard.
The stock web and touchscreen applications are proprietary captures, not source
packages. Do not replay their files across firmware versions. The rollback,
encrypted backup, and offline-kit paths have local tests; hardware deployment
remains unapproved and unverified.

Before requesting a hardware trial, review the rollback against the exact
predeployment package, configuration, service, and display state. The owner
also requires a practical FIPS/stock switch and proof that ordinary internet,
DNS, VPN, and router administration still work in both modes. A guarded trial
still needs explicit approval while this router is in use; local tests and a
matching firmware fingerprint are not approval or hardware verification.

## Before any deployment

1. Back up the router's `/etc/fips/` identity/configuration, dashboard settings,
   the complete `/etc/config/` UCI tree, and the installed known-good IPKs to
   encrypted private storage. Verify the backup can be decrypted. Do not commit keys,
   backups, router config, or passwords. Preserve the exact prior IPK and SHA-256
   for every already-installed component; the guard refuses to arm otherwise.

   For an optional read-only backup rehearsal, create and safeguard a local age identity,
   then stream the configuration directly from SSH into encrypted private
   storage. The identity must stay outside Git and outside the recovery kit:

   ```sh
   age-keygen -o /secure/path/gl-e5800-age-key.txt
   age-keygen -y /secure/path/gl-e5800-age-key.txt
   chmod 0700 private
   python3 tools/capture_backup.py --recipient 'age1...from-previous-command' --identity /secure/path/gl-e5800-age-key.txt --output private/identity-config-backup.age
   python3 tools/backup_bundle.py private/identity-config-backup.age --identity /secure/path/gl-e5800-age-key.txt
   ```

   Add `--require-fips-identity` to both Python commands when FIPS is already
   installed. The capture refuses a mismatched recipient or a backup directory
   accessible to other users. It verifies the decrypted archive in memory and
   leaves no plaintext file. Use the official age CLI and protect the identity
   separately from this repository and the kit. The live deploy playbook also
   captures and verifies a fresh encrypted controller backup before its first
   persistent router write. It refuses an existing backup filename, so each
   transaction must use a new ID. A successful archive check is still not a
   restore rehearsal.
2. Run `make check`, `make lab-build lab-up lab-test`, `make openwrt-build`,
   `make package-fips package-web package-device vendor-deps`, and
   `python3 tools/verify_artifacts.py`, and
   `python3 tools/compatibility_manifest.py`. Keep the emitted IPKs, per-package
   provenance, `compatibility.json`, and `checksums.sha256` together. The
   compatibility generator rejects any stale or incomplete candidate stack.
   The router's 4.10.0 opkg index directory is empty, so the dashboard's 34
   pinned Python/NumPy and library IPKs must be present in `artifacts/runtime/`.
   The controller checks their hashes and metadata before any router write.
   Installation occurs only after the local rollback guard is armed; rollback
   removes runtime packages absent at the start of the transaction.
3. Reinspect the firmware with `ansible-playbook ansible/inspect.yml --ask-pass`
   and compare the exact model, architecture, web bundle and screen fingerprints.
   A matching hash identifies the release; it does not establish app compatibility.
   Review FIPS kernel dependencies, GL web extension integration, and Pillow
   package ownership before approving that tuple. Run
   `ansible-playbook ansible/inspect-dependencies.yml --ask-pass` for the
   read-only touchscreen dependency report.
   The deployment preflight also requires at least 128 MiB free on `/` and
   128 MiB free on `/tmp` for dependency installation, installer transfer and
   the router-local rollback. These conservative thresholds can be raised in
   the private profile; the deployment refuses lower values.
4. Create ignored `ansible/vars/local.yml` with selected `restore_components`,
   exact `package_artifacts` paths/hashes, `known_good_artifacts` paths/hashes,
   the reviewed `approved_profiles`, `recovery_probe_ip`, and
   `recovery_probe_name`. Add `predeploy_backup` with the public age recipient,
   its private identity path, and an absolute mode-0700 controller backup
   directory. The playbook writes `<directory>/<transaction>.age` before
   installing the guard. Use a network probe reachable in normal operation.
   Do not store the SSH password; use `--ask-pass` or an authorized key.
5. Run a read-only dry run:
   `ansible-playbook ansible/deploy.yml --ask-pass --check -e @ansible/vars/local.yml -e recovery_transaction=review1`.
   The project keeps `approved_profiles: []` by default, so installation is
   blocked until an actual reviewed profile is supplied privately.
   `ansible/restore.yml --check` also validates the pinned offline dashboard
   bundle on the controller. It does not require Python or Pillow to be installed
   on a freshly updated router.

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
predeploy_backup:
  recipient: 'age1...from-age-keygen-y'
  identity: '/secure/path/gl-e5800-age-key.txt'
  directory: '/secure/gl-e5800-backups'
# Optional for a gateway with working upstream IPv6; choose a public IPv6
# address that responds to ping from this router.
# recovery_probe_ipv6: '2606:4700:4700::1111'
recovery_seconds: 300
fips_required_link_count: 1
initial_fips_settings:
  enabled: true
  udp_port: 2121
  tcp_port: 8443
  gateway_enabled: false
  peers:
    - {npub: '<reviewed peer npub>', transport: udp, address: 'peer.example:2121'}
  mesh_tcp_ports: []
  mesh_udp_ports: []
```

For a first hardware link test, the [official FIPS tutorial](https://learn.fips.network/lessons/13-try-it)
publishes `fips-test-node` at UDP `217.77.8.91:2121`, with npub
`npub1qmc3cvfz0yu2hx96nq3gp55zdan2qclealn7xshgr448d3nh6lks7zel98`.
The [peer discovery page](https://join.fips.network/) lists other nodes.
Recheck the endpoint immediately before use; public availability is not a
deployment guarantee. The pinned local FIPS binary established a link to the
test node from an isolated Docker container on 2026-09-30. The router's own
UDP path remains untested. Put the chosen peer only in the ignored private
deployment profile, and keep `gateway_enabled: false` on the current router:
its observed WAN has no IPv6 default route and LAN RA is disabled. The
router-node test does not require changes to existing LAN or WAN settings.

For a firmware update that removed an existing FIPS installation, replace
`initial_fips_settings` with the reviewed, decryptable backup and its local
age identity. These options are mutually exclusive:

```yaml
recovery_backup:
  path: /absolute/private/path/identity-config-backup.age
  identity: /absolute/secure/path/gl-e5800-age-key.txt
```

The deployment playbook decrypts and validates that backup on the controller,
including that the saved FIPS node is enabled,
before router writes. After the guard is armed and the packages are installed,
it restores the four active FIPS identity/configuration files, and optional dashboard
settings when selected. It also restores captured `/etc/fips/hosts`,
`peers.allow`, `peers.deny`, `fips.nft`, and `fips.d/*.nft` user policy files.
It does not replay old network, firewall, DHCP, runtime state, packaged scripts,
or a stale staged FIPS candidate across firmware versions; those remain in the
encrypted backup for deliberate manual recovery. Review restored optional
policy files for the new firmware before confirmation. The temporary controller
restore script contains encoded
private data and is deleted by Ansible after use. A controller crash can leave
that mode-0600 script or its transferred copy in a private temporary directory,
which must be cleaned up during incident review. The router-local deadline still rolls back the
partially restored files if controller contact is lost.
Rerunning a guarded restore with the same files leaves a healthy FIPS service
and enabled gateway running without another restart. If the restored settings
disable gateway mode, the restore stops and disables an active gateway once.

`known_good_artifacts` is empty for a first installation. If FIPS is already
installed, its exact current-version prior IPK is mandatory. The same rule
applies to either UI package. The controller prevalidates selected packages;
the guard checks staged prior checksums and installed versions on the router.
When FIPS is enabled, confirmation requires at least one live link by default;
set `fips_required_link_count` higher for the intended topology.
For a first FIPS installation, supply reviewed `initial_fips_settings` with a
reachable peer. Ansible stages and activates them under the same package guard.
For an upgrade with existing enabled settings, omit this key to preserve the
current configuration. After a firmware update that erased those settings,
use `recovery_backup` to restore the original identity before checking links.
A failed validation or missing live link rolls back the
whole package transaction. The 300-second example may be too short for a first
peer link; review the 60–900 second deadline before deployment.

Gateway mode currently requires an existing IPv6 default route and LAN Router
Advertisements. It does not force a new default route or assign the upstream
benchmarking prefix to `br-lan`. The upstream integration's `route6` section
under `/etc/config/dhcp` is not read by [odhcpd's section parser](https://github.com/openwrt/odhcpd/blob/master/src/config.c),
so this package does not claim to distribute a route to clients on IPv4-only
WANs. Those clients need a separately verified route advertisement mechanism;
IPv4-only gateway deployment is not supported yet. Supply `recovery_probe_ipv6`
for a reviewed public IPv6 destination. Router checks cannot prove that every
LAN client's ordinary internet or VPN traffic is unaffected; verify those on
hardware before confirmation.
The FIPS service also owns a `fips_mesh` fw4 zone for the `fips0` device, using
[OpenWrt's device-bound zone configuration](https://openwrt.org/docs/guide-user/firewall/firewall_configuration).
Its input and forwarding policies reject by default; explicit IPv6 rules allow
only the configured mesh TCP/UDP ports and essential ICMPv6. The earlier FIPS
nft chain applies the same ingress policy, so losing either layer leaves the
other restrictive. The guarded transaction backs up
`/etc/config/firewall`, and health checks require both layers. Verify the
actual generated fw4 rules and mesh service access on this firmware before
confirmation.
Deployment refuses pending UCI edits in `network`, `dhcp`, or `firewall` before
the first router write. If a guarded deployment fails between a UCI `set` and
`commit`, rollback clears those uncommitted deltas before restoring the saved
files. Commit or revert your own pending changes before deployment.
When gateway mode is enabled, an IPv6-only `lan` → `fips_mesh` forwarding rule
allows LAN clients to initiate traffic toward the mesh; no reverse forwarding
is added. Disabling gateway mode removes that rule while keeping the node's
mesh zone. The health check requires the rule only when gateway mode is active.

## Deployment transaction

After explicit hardware deployment authorization and successful dry-run review:

```sh
ansible-playbook ansible/deploy.yml --ask-pass -e @ansible/vars/local.yml -e recovery_transaction=unique_reviewed_id
```

The playbook installs the guard outside the three replaceable packages, enables
its early boot service, stages known-good IPKs, backs up live identity and network
configuration in mode-0700 router storage, then arms a 60–900 second deadline.
Before those router writes, it captures all current UCI files, FIPS identity and
configuration when present, and dashboard settings into a verified encrypted
backup on the controller. The age identity stays outside Git and the offline
kit. Keep this off-router backup after confirmation: the router-local guard
automatically rolls back only while its transaction remains pending.
Only then does it install packages. If selected, it switches the touchscreen
to the community dashboard while the guard is armed. It checks SSH, `ubus`,
route, ping, DNS, selected package files, and that the dashboard owns the
display and its button watcher is running. It also checks web gzip integrity,
the CGI's rejected-request response, dashboard Python syntax, and in-memory
Pillow rendering, but **leaves the transaction pending**. Check the
admin page and physically check the selected touchscreen UI while the guard is
armed. After those independent checks, confirm from the same local controller:

```sh
ansible-playbook ansible/confirm.yml --ask-pass -e @ansible/vars/local.yml -e recovery_transaction=unique_reviewed_id -e interface_health_verified=true
```

The confirmation playbook rechecks the exact pending transaction, management,
ordinary networking, an enabled FIPS node with live links when selected, and
selected package and touchscreen runtime state.
It also compares the controller's selected component set with the set saved on
the router when the guard was installed; a narrowed confirmation profile cannot
skip FIPS or interface checks.
The guard rejects confirmation at or after its wall-clock or uptime deadline,
or after a reboot, even if the watchdog has not run yet. The pending transaction
then remains available for local rollback.
Guard operations take an exclusive lock in root-owned `/tmp/fips-recovery`.
A concurrent confirmation
or manual rollback fails rather than racing an active rollback; retry after the
current operation finishes. The boot watchdog clears a lock whose process has
died, then retries pending rollback. Reboot also clears the temporary lock.
The `interface_health_verified` flag is an operator attestation, not an automated
visual test. Without confirmation, controller loss, reboot, or deadline expiry
triggers router-local rollback. A failed deployment task requests immediate
rollback. Review `/etc/fips-recovery/<ID>/result` and actual network/UI state
after any failure; don't equate an Ansible exit code with full recovery. Guard
fault tests cover timeout, reboot, interrupted install, bad checksum, and
confirmation using fake opkg; actual OpenWrt rollback remains a hardware
acceptance test.
The local interrupted-install test includes an opkg `unpacked` state. If
removing that partial package fails, the guard keeps the transaction pending
and retries on its next watchdog check; an operator must inspect the recorded
result and package state if the retry cannot complete.
The guard records whether `gl_screen`, `citydash`, and `homebutton` were enabled
and running before arming. After package restoration it restores those states,
the dashboard settings file, and the original ownership/mode of the network,
DHCP, and firewall files. A first-install rollback returns to the stock screen;
an upgrade rollback returns to the previously active dashboard. If either
screen cannot be restarted and observed in its prior state, the guard keeps
the pending marker for retry. These paths have isolated failure/retry tests,
but still need an on-device display check.
The dashboard's removal script also stops its button watcher and dashboard,
then starts the stock screen directly. It does not require `toggle.sh` to be
present after an interrupted install.

The web extension also uses the guard for later configuration changes. Validate
and stage, apply, then confirm in the still-connected web page within 3 minutes;
the backend checks daemon reachability, the private persistent key file and
the read-only route, ping and DNS probes saved from the reviewed deployment
profile before confirmation. If FIPS is being disabled, network probes still
must pass. The touchscreen stages on the first tap and applies on the second;
use the web page to confirm. Its button can roll back a pending change. A lost
browser or failed daemon lets the local timer restore the prior FIPS config
without changing the touchscreen owner. Package rollback restores the prior
display owner. These flows have local fake-service tests, but no on-device acceptance
yet. The optional LAN gateway is not approved for hardware use until routing,
firewall and client behavior are tested on this model.

The manual GitHub deployment workflow is restricted to `main`, a self-hosted LAN
runner, and the `hardware` environment. Configure environment reviewers and a
trusted local `/etc/gl-e5800/deploy.yml`; no router credentials or LAN runner are
available to pull requests. It rebuilds packages and checks the private profile's
candidate hashes before invoking the same Ansible transaction. Its success means
the transaction is pending, not confirmed; run the separate confirmation playbook
from the local controller after checking both interfaces. This repository
has an origin remote but no hosted runner configured, so CI/CD is authored but
not yet observed running on GitHub.

## Recovery ladder

| Recovery path | Current evidence |
| --- | --- |
| Router-local deadline, reboot and interrupted-install rollback | Passed isolated fake-opkg/filesystem tests; not run on the GL-E5800. |
| Post-firmware identity restore followed by controller loss | Passed isolated filesystem test; not run on OpenWrt hardware. |
| Offline kit integrity and tamper detection | Passed synthetic two-UI kit smoke and local age encrypt/decrypt tests; a real stock-router backup was decrypted and validated, but not restored. |
| Four-second soft reset and ten-second factory reset | Vendor documentation only; neither reset was performed. |
| No-SSH debrick/support procedure | Vendor documentation only; no debrick action was performed. |


- If SSH works, inspect the guard with
  `/bin/sh /etc/fips-recovery/guard.sh status`. For a pending transaction, use
  `/bin/sh /etc/fips-recovery/guard.sh rollback`; confirm only after independent
  network, daemon, web and screen checks. The guard restores prior IPKs and the
  saved identity/config and predeployment screen state. For a first installation,
  this is the stock screen.
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
`python3 tools/recovery_kit.py --profile ansible/vars/local.yml --encrypted-backup private/identity-config-backup.age --identity /secure/path/gl-e5800-age-key.txt --kit-id <unique-id>`.
It copies the reviewed candidate/prior IPKs, their checksums, backup/rollback scripts,
Ansible playbook/roles, this runbook, and an age-formatted identity/configuration
backup under `private/recovery-kits/<ID>` with a manifest. It also writes
`private/deploy.yml` with package paths relative to the kit root. Controller
Ansible tasks resolve those paths from the kit root after the kit is moved.
From the kit directory, run:

```sh
python3 tools/verify_recovery_kit.py . --identity /secure/path/gl-e5800-age-key.txt
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook ansible/deploy.yml --ask-pass --check -e @private/deploy.yml -e recovery_transaction=review1
```

The verifier checks the kit's files, profile, candidate provenance and IPK
payloads, then decrypts the backup in memory and checks required configuration
and existing FIPS identity files. Rehearse local restoration into a new private
directory and compare the staged key/configuration with the intended snapshot:

```sh
mkdir -m 0700 -p private/restore-rehearsal
python3 tools/stage_backup.py private/identity-config-backup.age --identity /secure/path/gl-e5800-age-key.txt --destination private/restore-rehearsal/files --require-fips-identity
```

The staging tool validates the entire archive before writing plaintext files;
all staged files are mode 0600. Remove the rehearsal files after review and keep
the decryption identity separately secured. Archive inspection and an offline
file comparison still cannot prove that recovered router services will start.
The kit does not
include a vendor firmware image or credentials. Keep it off the router and
offline. The kit assumes Python, Ansible, SSH and the age CLI are already
available on the local controller; retain their installers or a tested offline
controller image separately. Run a real deployment from this kit only after
separate authorization. Set `predeploy_backup.directory` outside the sealed
kit so a new deployment backup does not invalidate its manifest.
After a real guarded deployment and independent interface review, run
`ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook ansible/confirm.yml --ask-pass -e @private/deploy.yml -e recovery_transaction=<same-id> -e interface_health_verified=true`
from the kit directory before the rollback deadline.
