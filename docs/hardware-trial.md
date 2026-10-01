# Proposed GL-E5800 hardware trial

**Status:** Stage A completed on 2026-10-01 with manual rollback and no timer.
Stage B, firmware flashing, reset, and deliberate loss of router connectivity
are not approved. Use [the recovery runbook](recovery.md) for the exact backup,
rollback, comparison, and rescue commands. If SSH is lost during Stage A,
there is no automatic recovery; physical intervention may be required.
The first fully installed Stage A attempt was manually rolled back after FIPS
failed to start its mesh interface and link on this IPv4-only router. Final
inventory and encrypted configuration contents matched stock. Its revised
FIPS candidate passed local checks before the second trial.
The second Stage A attempt linked to the public peer and preserved LAN internet,
DNS, Mullvad, Tailscale and SSH. The owner saw the FIPS touchscreen panel and
used its return control, but the web admin FIPS page was blank. It was manually
rolled back; final stock inventory and encrypted configuration contents matched
the fresh baseline. A third trial installed the corrected web bundle; the
owner confirmed live status, identity, peers, transport settings and diagnostics
in the browser. Automated health found one FIPS link, and LAN internet, DNS,
Mullvad, Tailscale and SSH passed. This trial was also manually rolled back;
final stock inventory and encrypted configuration contents matched its fresh
baseline. See [validation evidence](validation.md) for transaction IDs, tested
scope and remaining hardware gates.

The last successful read-only inventory (2026-10-01) matched GL.iNet 4.10.0,
OpenWrt 23.05.4, `aarch64_cortex-a53`, all installed packages and service
states, and the stock web and touchscreen fingerprints against the 2026-09-30
baseline. Reinspect immediately
before a trial; refuse any changed target until it is reviewed. The candidate
stack is `fips` 0.5.2-1, `gl-sdk4-ui-fips` 0.1.0-1, and
`gl-e5800-dashboard` 3.2.1-2. Verify all IPKs, provenance, offline runtime,
and [the compatibility manifest](../artifacts/compatibility.json) again before
use. The ignored private Stage A profile selects `deployment_recovery_mode:
manual`; the checked-in fixture remains check-only.

The current check-only fixture selects UDP peer
`npub1qmc3cvfz0yu2hx96nq3gp55zdan2qclealn7xshgr448d3nh6lks7zel98` at
`217.77.8.91:2121`. Recheck its reachability and the owner's choice of peer
immediately before requesting approval; the profile can be changed locally
without changing router state.

## Stage A: prove manual stock rollback

1. Verify controller access to SSH and Docker; run the local checks and the
   read-only Ansible check with the reviewed target. Capture a fresh encrypted
   configuration backup and full inventory under a unique trial ID. Verify the
   backup decrypts. Keep the private age and SSH identities off Git and outside
   the offline kit. Confirm the stock screen, router admin, ordinary internet,
   DNS, and the existing VPN work. On one LAN client, record its default
   gateway, DNS resolver, a working ordinary HTTPS destination, and a resource
   reached through the VPN.
2. Prepare a separate, ignored deployment profile from the reviewed fixture.
   Pin the three verified IPKs and exact firmware profile, use the selected
   reachable FIPS peer, set `gateway_enabled: false`, and select manual-only
   rollback with no deadline. Review the generated offline recovery kit and
   confirm a person can access the physical router throughout the trial.
3. Install the candidate stack with Ansible. The router-local guard must be
   armed before any package or network change. Do **not** confirm this first
   transaction. While pending, check the FIPS peer link, authenticated web UI,
   physical touchscreen and return button. From the same LAN client, check
   unchanged gateway and DNS, ordinary HTTPS, VPN resource, and router admin.
   If a check fails, run `/bin/sh /etc/fips-recovery/guard.sh rollback`
   manually as soon as SSH is available. After recording successful checks,
   run the same manual rollback command and verify the stock state. Neither a
   timer nor a reboot rolls back Stage A. No controller-loss or WAN interruption
   is induced on this in-use router.
4. Capture another encrypted backup and inventory. Require the stock screen,
   original packages/services, router administration, LAN internet, DNS, and
   VPN to work. Use the read-only stock rollback preflight, archive guard
   evidence, remove only the newly installed recovery guard, and repeat both
   comparisons. Do not call rollback successful if package, configuration,
   service, stock-UI, or unexplained metadata drift remains. Keep the encrypted
   before/after/evidence archives off Git.

Stage A stops if the guard does not arm, a health check fails, SSH or client
internet/VPN disappears, rollback retries without reaching stock, or the final
state differs from the pretrial baseline. Use the model-specific recovery
ladder in [the runbook](recovery.md); GL-E5800 U-Boot flashing is not a
supported fallback. Report the observed state before any new install.

## Stage B: keep FIPS installed, only after Stage A review and fresh approval

The ignored `private/deploy-profiles/stage-b-20261001.yml` pins the three
Stage-A-verified IPKs, public test peer, `gateway_enabled: false`, and a
manual-only package guard. The private `stageb_persistent_ready_20261001v3`
offline kit includes the stock backup and exact recovery tools. Recheck both
against the current working tree and router immediately before use.

1. Capture a fresh stock inventory and encrypted backup, verify them, run the
   Ansible check mode, and record the same LAN-client HTTPS, DNS, SSH, Mullvad
   and Tailscale probes. Refuse changed firmware, vendor UI fingerprints,
   installed packages, pending UCI edits, or an existing recovery guard.
2. With the owner present, deploy all three IPKs under a unique manual package
   transaction. Leave it pending. Check router and LAN-client networking, FIPS
   peer link, authenticated web status/settings/diagnostics, touchscreen FIPS
   page and physical return control. After testing the return control, restore
   the FIPS display with `/root/dashboard/toggle.sh on` before confirmation.
   If any check fails, explicitly run
   `guard.sh rollback`, archive the guard evidence, remove it, and compare the
   final encrypted backup and inventory with the fresh stock baseline.
3. Only if every check passes, run `ansible/confirm.yml` with the exact
   transaction and `interface_health_verified=true`. Capture an encrypted
   FIPS identity/configuration backup and confirmed package inventory. Keep
   these and the matching IPKs in the private offline kit before any future
   upgrade. The package confirmation has no timer and intentionally leaves
   FIPS installed.
4. Use `tools/switch_mode.py` to prepare and confirm stock mode, then prepare
   and confirm FIPS mode. Repeat ordinary network/VPN/admin checks in both;
   require the same public identity, peer link, web view, and screen ownership
   after returning to FIPS. These configuration switches each use a separate
   180-second router-local rollback. The initial package guard remains manual
   only. Leave the router in the owner's chosen operating mode.

The owner accepted that stock operating mode keeps FIPS packages, identity and
peer settings installed for easy switching. An exact uninstall after package
confirmation is outside Stage B. If SSH is lost during the manual package
transaction, there is no timed recovery; use the model-specific physical
recovery ladder. No fault injection, firmware flash or reset is part of this
in-use-router plan.

Hardware evidence is required for these claims. Local tests and a matching
firmware fingerprint alone do not prove that the GL-E5800 preserves client
internet, VPN, administration, or the display after installation.
