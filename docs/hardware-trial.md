# Proposed GL-E5800 hardware trial

**Status:** preparation only. The owner has not approved router writes. This
plan does not authorize deployment, firmware flashing, a reset, or deliberate
loss of router connectivity. Use [the recovery runbook](recovery.md) for the
exact backup, rollback, comparison, and rescue commands.

The last successful read-only inventory (2026-10-01) matched GL.iNet 4.10.0,
OpenWrt 23.05.4, `aarch64_cortex-a53`, all installed packages and service
states, and the stock web and touchscreen fingerprints against the 2026-09-30
baseline. Reinspect immediately
before a trial; refuse any changed target until it is reviewed. The candidate
stack is `fips` 0.5.2-1, `gl-sdk4-ui-fips` 0.1.0-1, and
`gl-e5800-dashboard` 3.2.1-2. Verify all IPKs, provenance, offline runtime,
and [the compatibility manifest](../artifacts/compatibility.json) again before
use. The current private profile is a check-only fixture, not deployment
authorization.

The current check-only fixture selects UDP peer
`npub1qmc3cvfz0yu2hx96nq3gp55zdan2qclealn7xshgr448d3nh6lks7zel98` at
`217.77.8.91:2121`. Recheck its reachability and the owner's choice of peer
immediately before requesting approval; the profile can be changed locally
without changing router state.

## Stage A: prove stock rollback, after explicit owner approval

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
   reachable FIPS peer, set `gateway_enabled: false`, and keep the local guard
   deadline at 600 seconds. Review the generated offline recovery kit and
   confirm a person can access the physical router throughout the trial.
3. Install the candidate stack with Ansible. The router-local guard must be
   armed before any package or network change. Do **not** confirm this first
   transaction. While pending, check the FIPS peer link, authenticated web UI,
   physical touchscreen and return button. From the same LAN client, check
   unchanged gateway and DNS, ordinary HTTPS, VPN resource, and router admin.
   Any failed check triggers immediate rollback; otherwise allow the deadline
   to restore stock. No controller-loss or WAN interruption is induced on this
   in-use router.
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

Take a new encrypted backup and inventory, verify the same firmware and IPKs,
then run a new guarded deployment with `gateway_enabled: false`. Confirm only
while the 600-second deadline remains and the same LAN client still has
ordinary HTTPS, DNS, VPN access, and router administration; the router has a
live FIPS peer link; and the web UI and physical display work. After
confirmation, exercise the guarded FIPS/stock operating-mode switch in both
directions, checking the same ordinary network paths in each mode. Retain the
verified backup, prior artifacts, and offline kit for later upgrades.

Hardware evidence is required for these claims. Local tests and a matching
firmware fingerprint alone do not prove that the GL-E5800 preserves client
internet, VPN, administration, or the display after installation.
