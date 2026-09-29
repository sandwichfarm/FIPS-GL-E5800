# Restore packages after firmware updates

This is controller-driven Ansible recovery, not a router-resident update hook.
Run it after a firmware update and reboot. Firmware upgrades may remove custom
packages even when settings are retained. Never overlay an old `/www` directory
or `gl_screen` executable onto a new firmware.

## Inspect and review

1. Run `python3 tools/capture.py --label <unique-firmware-label>` from the repo root.
   It reads stock assets only; SSH prompts for a password if needed. Captures are
   local and ignored by Git. Use a new label for each capture.
2. From `ansible/`, run `ansible-playbook inspect.yml --ask-pass`.
3. Review the observed firmware, architecture, web-bundle hash and screen hash
   against the package's supported runtime. Observed fingerprints are not proof of
   runtime compatibility. Web toolkit compatibility captures and a live extension
   cycle are still required to establish support for this model/release.
4. Create `ansible/vars/local.yml` (ignored) from the example below. Only put a tuple
   in `approved_profiles` after reviewing that exact firmware for the components
   you intend to restore. Never use a wildcard version or approve from version
   number alone.

```yaml
restore_components: [fips]
approved_profiles:
  - firmware: '4.10.0'
    architecture: aarch64_cortex-a53
    app_sha256: '<observed and reviewed SHA-256>'
    screen_sha256: '<observed and reviewed SHA-256>'
package_artifacts:
  fips:
    path: /absolute/path/to/artifacts/fips_v0.5.2_aarch64_cortex-a53.ipk
    sha256: '<published artifact SHA-256>'
  # web_ui requires a built gl-sdk4-ui-fips IPK, not the toolkit itself.
  # device_ui requires a built gl-e5800-dashboard IPK and a working PIL/numpy runtime.
```

The controller needs Python 3, Ansible, and SSH. Password authentication uses
Ansible's `--ask-pass`; never store the password in inventory. For SSH keys omit
that flag. Host key checking remains enabled. Transfer uses SSH pipes, so the
router does not need Python, SFTP, or rsync for FIPS/web recovery.

## Review without installing

```sh
cd ansible
ansible-playbook restore.yml --ask-pass --check -e @vars/local.yml
```

Check mode reads the router and validates local artifact metadata/checksums and
prerequisites. It does not upload or install anything. It describes intended
actions, not an exact opkg transaction simulation. Missing dependencies remain an
error to resolve; the playbook does not update feeds or bypass dependency checks.

This workspace also includes ignored `private/artifacts.json` with the downloaded
FIPS and locally built dashboard paths/hashes, and `private/check-only.json` used
to verify the FIPS dry run on 4.10.0. The latter is explicitly rejected outside
check mode and is not deployment approval. To repeat that read-only test:

```sh
ansible-playbook restore.yml --ask-pass --check -e @../private/check-only.json
```

## Apply on a subsequent deployment pass

```sh
ansible-playbook restore.yml --ask-pass -e @vars/local.yml
```

The playbook rejects unknown firmware tuples, verifies every selected artifact
before installation, and restricts package names to `fips`, `gl-sdk4-ui-fips`, and
`gl-e5800-dashboard`. It verifies the package hash again on the router. Matching
installed versions with matching non-config payloads are unchanged; missing or
different versions go through normal `opkg install`. Same-version file drift
fails for inspection rather than using `--force-reinstall`. Failed dependency or
downgrade checks are not bypassed. Multiple-package installation is not atomic:
if a later package fails, an earlier successful install remains installed.

Configuration files and first-boot scripts are excluded from payload hash checks:
configs belong to the operator, while uci-defaults scripts can self-delete. Other
packaged regular files must match. SHA-256 validates against your pinned local
manifest; this is not independent publisher-signature verification.

## Component behavior and known work

**FIPS:** Upstream v0.5.2 postinst starts/enables the daemon and commits DNS/firewall
changes, including adding fips0 to the LAN zone. Installing is therefore activation,
not just staging. It uses ephemeral identity by default. Before a deployment pass,
prepare the intended persistent identity/configuration and isolated firewall policy.
The imported package has not been modified to implement that policy. Gateway/LAN
IPv6 changes are not applied by our role. Upstream keeps `/etc/fips/` across a
settings-preserving sysupgrade; keep a separate encrypted backup of the identity.
Do not put keys in Git. A factory reset or upgrade without keeping settings is a
separate identity/configuration recovery operation.

**Web UI:** Restore only a separately named FIPS extension package. No stock
bundles are overwritten. A FIPS page/backend still needs to be implemented, built,
and verified against 4.10.0. The toolkit's E5800 support is not established.

**Device UI:** The built upstream dashboard has no FIPS page yet. Its install starts
a power-button watcher; the stock display initially stays active. Switching to the
dashboard is a separate action. Pillow is not a normal dependency because of the
vendor FreeType ownership conflict; our preflight requires `PIL.Image` and `numpy`
to import successfully, and does not execute upstream's `--nodeps` suggestion.
The conflict must be resolved with a compatible package/runtime before deployment.
Preserve dashboard preferences separately; the upstream package does not declare
them as conffiles or provide a firmware-upgrade keep rule.

## Recovery if a component misbehaves

There is no automatic downgrade or broad vendor-file restore. FIPS can be stopped
using its init service, but uninstalling does not imply every firewall/DNS change
is reverted; compare against a pre-deployment private configuration backup. The
community dashboard provides `/root/dashboard/toggle.sh off` to return to the
installed stock screen. Removing a FIPS web extension should remove only its own
package-owned menu/view/backend. Test these flows before approving production use.
