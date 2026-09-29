# FIPS v0.5.2

**Released**: 2026-09-28

v0.5.2 is a maintenance release on the v0.5.x line. It closes several security gaps, changes three defaults, and fixes defects that reach every node as well as the gateway, the Windows service and the Linux, OpenWrt and FreeBSD packages. There is no wire format change, so a mixed mesh works and nodes can be upgraded one at a time.

Read "Before you upgrade", below, if you run an ephemeral node (which is what every package's shipped config runs), the gateway, or FIPS on Windows or OpenWrt.

## At a glance

### Who should upgrade

- **Every node: upgrade.** The TLS library the Nostr relay connections use moves to a release that fixes RUSTSEC-2026-0285, and every default build reaches it. Four fixes also apply on every platform: a link rekey whose reply is lost no longer splits the link when the node answering the rekey runs v0.5.2; a session whose last handshake message is lost no longer stays one-sided; a session rekey whose setup or acknowledgement is lost no longer stops key rotation for the rest of the session; and a node that uses Nostr NAT traversal no longer signs deletion requests with its routing key, which linked its identity to its traversal messages on every relay it reached.
- **Windows: upgrade, and run `install-service.ps1` again.** On v0.5.1 any local user could read the node's key, or create a config, key, hosts file or peer list that the service then used, and a `peers.deny` placed beside the hosts file was never read, so the peer ACL failed open. The service log was also lost.
- **Gateway operators: upgrade.** Session pinning never worked, so a mapping carrying traffic could be reclaimed about two minutes after its last DNS reference. Any host that could reach the LAN resolver could exhaust the address pool. NAT rebuilds were reported as failed past about 105 mappings and did fail past about 313. On an OpenWrt access point with the gateway enabled, `.fips` names stopped resolving and nothing reported it.
- **Debian and Ubuntu, from the `.deb`: upgrade.** An upgrade whose new daemon could not start hung apt; an upgrade left `fips-gateway` stopped until the next reboot; a changed firewall ruleset was not reapplied; and purging the package could leave `.fips` lookups timing out.
- **OpenWrt: upgrade, and read the first-upgrade note below.** An `apk` upgrade left the old processes running until a reboot, and a fresh install enabled `fips-gateway`, which is meant to ship disabled.
- **FreeBSD: upgrade at your convenience.** The daemon's log now rotates; it grew without bound.
- **macOS: upgrade for the fixes every node gets.** Nothing in this release is specific to macOS.

### Before you upgrade

Three defaults changed.

- **An ephemeral node no longer writes `fips.key`.** It used to write the private key of an identity it discards at every restart to that file, overwriting any key already there, including an operator's key when `persistent: true` had been forgotten. It now writes only `fips.pub` and holds the private key in memory. A `fips.key` found at an ephemeral start is renamed to `fips.key.unused`, with a warning, on the first start after the upgrade. **If you started a node once in ephemeral mode and then pinned the key it wrote, that no longer works**: set `node.identity.persistent: true` before upgrading, since most packages restart the daemon as they upgrade and an ephemeral start renames the key. The first persistent start uses the `fips.key` it finds. If an ephemeral start on v0.5.2 has already renamed it to `fips.key.unused`, rename it back to `fips.key` before restarting, as the daemon's warning says. With no key file, the first persistent start generates and saves one, so the npub changes once, at that restart, and stays stable from then on.
- **The gateway's default DNS listen address is `[::1]:5365`.** It was `[::1]:5353`, the mDNS port, which the daemon's own LAN rendezvous, Avahi and systemd-resolved can hold. On OpenWrt the upgrade rewrites the previously shipped `listen: "[::1]:5353"` line and the init script points dnsmasq at whatever port `gateway.dns.listen` sets, so there is nothing to do. On other hosts the upgrade leaves your `fips.yaml` as it is, so first check whether it sets `gateway.dns.listen`; the v0.5.1 example config and deployment guide set it to `"[::1]:5353"`. If it sets it, the gateway stays on that port and warns at startup when it is 5353: leave the resolver as it is, or move off the mDNS port by setting `listen: "[::1]:5365"` and forwarding `.fips` there, changing both together. If it does not set it, the gateway moves to `[::1]:5365`: a resolver you configured by hand to forward `.fips` to `[::1]:5353` must forward to `[::1]:5365` instead, or set `gateway.dns.listen: "[::1]:5353"` to keep the old port. A gateway on 5353 now exits if Avahi, systemd-resolved's MulticastDNS or the daemon's LAN rendezvous already holds that port, so that is the case to move.
- **Windows keeps its config, key, hosts and peer ACL files in `C:\ProgramData\fips`.** That is the directory the service installer already wrote to; the config search, `fipsctl keygen` and the peer ACL defaults each looked somewhere else. Upgrade by running the new `install-service.ps1` from an elevated prompt, with the service stopped. It restricts the directory to SYSTEM and Administrators and creates empty `peers.allow` and `peers.deny` files there. **It stops if it finds a `peers.allow` or `peers.deny` under `\etc\fips` on the system drive with no copy in `C:\ProgramData\fips`**: review that file, move it into `C:\ProgramData\fips` or delete it, and run the installer again. A key left in `%APPDATA%\fips` is still used by a persistent node when the new directory has none, with a note asking you to move it; stop the service and run the installer again after moving any file into the directory, since a moved file keeps its old permissions. If your v0.5.1 service read its config from `\etc\fips`, move its files before upgrading, as described in the Windows upgrade notes below.

Also worth knowing before you start:

- **`fips-gateway` now exits when its DNS listener cannot bind, or stops while the gateway runs**, where it used to stay up with `.fips` resolution dead. systemd and procd restart it or report it failed, and an "address in use" error names the service likely to hold the port. See [Port conflict on the DNS listen port](https://github.com/jmcorgan/fips/blob/v0.5.2/docs/how-to/troubleshoot-gateway.md#port-conflict-on-the-dns-listen-port).
- **The first opkg upgrade to this release re-enables and starts `fips-gateway` on any router that has the `.ipk` installed**, including one where you disabled the gateway by hand. If you had disabled it, run `service fips-gateway stop` and then `service fips-gateway disable` once after upgrading. Stopping it hands dnsmasq's `.fips` forwarding back to the daemon and removes the LAN prefix and route the gateway added; disabling it alone leaves it running, and after a reboot dnsmasq would still forward `.fips` to the gateway's port. Later upgrades keep whatever state the service is in, and an `apk` upgrade on OpenWrt 25 keeps it from the first upgrade on.
- **A `.deb` upgrade now fails if the daemon does not come up within 60 seconds**, and apt exits non-zero naming the unit, where it used to hang with no message.
- **The `.deb` now recommends `nftables`**, so `apt install` pulls it in by default. `dpkg -i` and `--no-install-recommends` do not.
- No configuration key was added or removed. Apart from `gateway.dns.listen`, no configuration key's default changed.

### What changed

- Windows: files in `C:\ProgramData\fips`, the directory restricted to SYSTEM and Administrators, empty peer lists created by the installer, and a service log.
- Gateway: session pinning works, the pool has a mapping ceiling and a rate limit, the NAT rebuild is one transaction and scales past a few hundred mappings, the DNS listener moved off the mDNS port and a dead listener is fatal.
- Sessions and links: lost rekey replies, lost final handshake messages and lost rekey setups no longer leave a link or session stuck, and unauthenticated datagrams can no longer abort a rekey.
- Discovery: bloom filter and spanning-tree announces lost on a link are resent, and a node re-announces its filter when a child joins or leaves.
- Packages: the `.deb` upgrade, remove and purge paths manage every service and the DNS routing; OpenWrt `apk` upgrades restart the services; FreeBSD rotates the log.
- Dependencies: `rustls` 0.23.45 for RUSTSEC-2026-0285.

## Security fixes

### Windows files readable and plantable by any local user

The service installer wrote to `C:\ProgramData\fips`, which inherited `C:\ProgramData`'s default access: any local user could read the files in it and create new ones. Any local account could therefore read the node's key, or create a missing `fips.key`, `fips.yaml` or `hosts` that the service then used. Separately, the service read its peer ACL files from `\etc\fips` on the system drive, where any local user can create files, so a planted list was enforced, while a `peers.deny` placed beside the hosts file was never read.

The installer now creates the directory with an ACL that admits only SYSTEM and Administrators, or replaces the ACL of an existing one, resets the files already in it to inherit that ACL, and refuses to continue if the directory or anything in it is a link or a folder, or if another account owns the directory. It creates empty `peers.allow` and `peers.deny` files, which allow every peer, so the service never falls back to the old location. To clear a list, empty its file rather than deleting it. **For this release only**, a `peers.allow` or `peers.deny` missing from `C:\ProgramData\fips` is still read from `\etc\fips`, with a warning naming both paths; the installer's stop, described above, is what keeps an unreviewed file there from being enforced. The [security reference](https://github.com/jmcorgan/fips/blob/v0.5.2/docs/reference/security.md) describes the fallback.

A foreground `fips.exe` run from an unelevated prompt can no longer read the files in that directory. Reading or editing them, `fipsctl keygen`, and `fipsctl address` with no argument need an elevated prompt.

### Gateway address pool exhausted from the LAN

Every `.fips` query was given a pool address before the gateway looked at what the client had asked for, and an A or HTTPS query was then answered with NODATA. Any host that could reach the LAN resolver could consume the pool one name at a time with a query type it is never given an address for, and could ask for one new name after another until the 65,535 addresses ran out, while every mapping made each NAT rebuild, each pool tick and shutdown slower.

Only AAAA and ANY queries allocate now. The pool refuses a new name once it holds 1000 live mappings, and admits new names at 10 per second after a burst of 50; a refused query gets SERVFAIL, and the "Pool allocation failed" warning says which limit refused it. A name that already has a mapping is answered before either limit is consulted, so names in use keep resolving when the pool is full. The limits are compiled in, not configured.

### Rekey aborted by an unauthenticated datagram

Two handlers gave up a rekey handshake before reading a message that nothing authenticates ahead of that read.

- **A forged link rekey msg2 took the link down.** Anyone on the path who saw the rekey msg1 go out could answer first with a msg2 of the right size, and the two ends were left on different keys until each removed the other on the link-dead timeout, about 30 seconds later. A msg2 that fails to read now leaves the handshake as it was, so the genuine msg2 still completes the rekey.
- **A SessionAck that failed to read ended a session rekey.** The only tie between the ack and the rekey is the datagram's source address. The handshake is now rolled back to its state before the read, so the peer's genuine ack still completes the rekey, and the refusal is counted as `ack_handshake_failed`.

### Routing key published next to traversal messages

After a NAT traversal attempt, a node published NIP-09 deletion requests signed with its routing key. Each one put the node's public identity next to the ids of its offer and answer gift wraps on every relay it reached, which the one-time signing keys on those wraps exist to prevent, and most of them deleted nothing, since a relay deletes a gift wrap only at its recipient's request. The node no longer sends them. A relay that stores the wraps now keeps them until their NIP-40 expiration. Withdrawing an advertisement still sends its deletion request, since that names an event the routing key signed itself.

### Inbound TCP limit held by a connection collision

The inbound TCP pool was keyed by the peer's address alone. A listener on a wildcard address, which is what the shipped configuration binds, can accept two connections from the same peer `ip:port` on two different local addresses, and that collision left the inbound connection counter one above the connections it counts. A host repeating it could hold the counter at the limit and lock out further inbound TCP connections until the daemon restarted. Inbound entries are now keyed by the connection's local address as well as the remote one.

### rustls advisory

The lockfile moves `rustls` from 0.23.43 to 0.23.45 for RUSTSEC-2026-0285: 0.23.43 accepted TLS 1.3 handshake messages across encryption-level boundaries. It is the TLS client the Nostr relay connections use, so every default build reached it. The update is within the version range the dependencies already allowed.

## Gateway

- **Session pinning works.** The session count searched each `/proc/net/nf_conntrack` line for the virtual IP in its compressed form, while the kernel prints it uncompressed, so every mapping counted zero sessions on every kernel. A mapping whose client did not query DNS again was reclaimed about two minutes after its last DNS reference while its traffic was still flowing. Addresses are now compared as addresses. On a kernel without `/proc/net/nf_conntrack`, such as Ubuntu's, the gateway now reads conntrack over netlink, as `conntrack -L` does, where session pinning used to be off. The gateway says at startup which source it can read, or that none is readable and pinning is off, and reports an unreadable source when it happens. The table is read once per tick, off the thread that serves DNS, instead of once per mapping.
- **The NAT table is rebuilt in one netlink transaction.** A rebuild deleted the table in one batch and recreated it in another; between the two the gateway had no NAT at all, and a recreate the kernel refused left the table gone for good. A refused rebuild now leaves the previous table in place.
- **The NAT rebuild scales past a few hundred mappings.** From about 105 mappings rebuilds were logged as failed although they had taken effect; past about 313, new names got a virtual IP with no translation, and a rebuild could delete the whole table. The rebuild now sizes its buffer to the batch and asks for one acknowledgement, and NAT errors name the kernel errno.
- **A DNS query that renews a draining mapping cancels its old grace period**, so the address is no longer reclaimed while the client's renewed answer is still valid.
- **The DNS listener moved to `[::1]:5365`, and a listener that cannot bind or stops is fatal**, as described under "Before you upgrade" above. This applies to a gateway used only for port forwards too. A `gateway.dns.upstream` written as a hostname now works; before, the startup check resolved it and the resolver then stopped on the unparsed name.

The [gateway deployment guide](https://github.com/jmcorgan/fips/blob/v0.5.2/docs/how-to/deploy-gateway.md) and the [troubleshooting guide](https://github.com/jmcorgan/fips/blob/v0.5.2/docs/how-to/troubleshoot-gateway.md) describe the new limits, the listener's failure modes and the session-pinning check.

## Windows

Besides the directory move and the access restriction above, the Windows service now writes its log to `C:\ProgramData\fips\fips.log`, rolled at 10 MiB with four old files kept. A service has no standard output, so everything the daemon logged in service mode was lost, including config-load failures and panic messages. A foreground run still logs to the console.

## Linux packages

- **A `.deb` upgrade whose new daemon cannot start no longer hangs apt.** Each service start is waited on for at most 60 seconds, 90 for `fips-gateway`. A unit that does not come up has its status printed and fails the configure step; a masked unit, or one whose condition is not met, is reported and skipped.
- **The `.deb` scripts manage `fips-gateway`.** An upgrade stopped the daemon, which the gateway requires, and never brought the gateway back. It is now stopped before the daemon on upgrade and restarted afterwards when it is enabled and the daemon came up, and it is stopped and disabled on remove and purge, where its enablement link used to be left behind.
- **A `.deb` upgrade reapplies the firewall ruleset in place.** A changed `/etc/fips/fips.nft` used to take effect only at the next reboot or manual restart. `fips-firewall.service` gains a reload that replaces the ruleset in one transaction, and the `.deb` upgrade reloads it only when it is already active, so an upgrade never turns the firewall on for a host that has not opted in. A tarball or AUR upgrade does not reload it; run `systemctl reload fips-firewall` afterwards if the firewall is active.
- **Purging the `.deb`, or running `uninstall.sh` from the tarball, removes the `.fips` DNS routing** when `fips-dns` was not running at the time, and restarts or reloads the resolver that used it. The host used to keep sending `.fips` queries to a port where nothing listened.
- The `.deb` declares `libgcc-s1 (>= 4.2)`, which its binaries always needed, and every package build now checks the declared dependencies against the libraries the binaries link. It recommends `nftables`, which the opt-in firewall unit runs. The release AUR package lists `dbus` as a dependency and `nftables` as an optional one.
- `-V` on the packaged Linux binaries prints the source revision again.
- **The AUR package is published only after every package workflow for the release tag has succeeded**, so it can appear up to an hour after the release. At v0.5.1 the AUR was updated while the release had 15 of its 17 assets.

## OpenWrt

- **A fresh install no longer enables and starts `fips-gateway`.** The documented `service fips-gateway enable` and `service fips-gateway start` steps are unchanged, and the shipped `fips.yaml` still has `gateway.enabled: true`, so enabling the service is all that is needed.
- **An `apk` upgrade on OpenWrt 25 restarts `fips`**, and `fips-gateway` if it was enabled, so the new binaries run without a reboot.
- The first opkg upgrade re-enables the gateway, as described under "Before you upgrade" above. Later upgrades keep the service's state.
- Starting `fips-gateway` when the config disables the gateway no longer points dnsmasq's `.fips` forwarding at a port nothing listens on.
- The packages no longer ship `/etc/dnsmasq.d/fips.conf`, which OpenWrt's dnsmasq never read; `.fips` forwarding has always come from the UCI server entry.
- The [package README](https://github.com/jmcorgan/fips/blob/v0.5.2/packaging/openwrt-ipk/README.md) gives the `apk add` upgrade command for OpenWrt 25 and a plain `opkg install` for 24.10 and earlier, in place of `--force-reinstall`, which left the gateway disabled.

## FreeBSD

The daemon's log, `/var/log/fips.log`, is rotated by newsyslog, which keeps five compressed generations of 1000 KB, and the rc script starts `daemon(8)` with `-H` so it reopens the log after a rotation.

## Sessions, rekey and discovery

These apply on every platform.

- **A link rekey whose reply is lost no longer splits the link.** The answering side used to switch to the new keys on its own next tick, before the other side had them; when the reply was lost, frames from the answering side were dropped until the link was torn down. It now switches only when a frame on the new keys arrives from the side that started the rekey, and drops keys that were never adopted after a hold, 120 seconds by default. While it holds such keys, that node neither accepts nor starts a rekey on the link, so rekeying on that link waits for up to the hold. The fix is on the answering side: a link where a v0.5.0 or v0.5.1 node answers can still drop, as described under Compatibility below.
- **A session whose last handshake message is lost no longer stays one-sided.** The initiator sent msg3 once; when it was lost, the responder dropped every frame the initiator sent until the next session rekey, or indefinitely with periodic rekey off. The initiator now resends msg3 with backoff until the responder is heard from or the handshake resend limit is reached.
- **A session rekey whose setup or ack is lost now expires** on the handshake timeout, and the next tick starts a fresh one. It used to stay pending and block every later rekey, so the session stopped rotating its keys. Expiries are counted as `rekey_unanswered`.
- A node with no coordinates cached for a session's destination no longer sends its own coordinates in their place, which made the destination cache its own address under the sender's coordinates.
- **Lost bloom filter and spanning-tree announces are resent.** An announce counted as delivered once the transport accepted it, so a dropped datagram or a short link outage left the peer with the old filter or tree position until something else changed, and destinations could stay missing from discovery. The node now confirms each announce from the link's existing receiver reports and resends on loss, within a budget.
- A node re-announces its bloom filter when a peer starts or stops using it as parent, so destinations under a new child become discoverable and a departed child's stop being advertised.

## Links, node health and the control socket

- A heartbeat whose send failed is no longer counted as delivered, and the peer is retried sooner instead of after a whole `heartbeat_interval_secs`.
- A peer that moves to a new address loses the connected UDP socket pinned to the address it left, and a peer reached by NAT traversal now gets its connected socket.
- A configured `ble:` transport that this build cannot construct is reported at startup instead of being dropped silently.
- A DNS responder or TUN thread that dies, including by a panic, now degrades the node's published health, and a dead responder's address is retracted.
- `fipsctl show links` reports the traffic a link has carried; every link used to report zero.
- `fipsctl show peers` reports a peer that has been silent longer than `heartbeat_interval_secs` as `stale`; every peer used to read `connected` until it was removed.
- Replacing the peer list at runtime with `Node::update_peers` now updates `.fips` names and peer ACL entries written as an alias.
- A persistent node whose identity key path cannot be examined, such as a key symlinked onto a volume that did not mount, now refuses to start and names the path, instead of coming up under a new identity.
- On Linux, an empty datagram sent through the native datagram API just before a close may read as the close; the [native API reference](https://github.com/jmcorgan/fips/blob/v0.5.2/docs/reference/native-api.md) now says so.

## Compatibility

v0.5.2 is wire-compatible with v0.5.1. No file that defines a frame, message, TLV or encoding changed between the two releases, so a mixed mesh works and nodes can be upgraded one at a time with no coordinated restart. The msg3 resend sends the same msg3, and the rekey and announce changes alter when a node sends or switches keys, not what it sends. Mixed-version behavior is measured by the interop run described below. Until the older nodes are upgraded, a link to a v0.5.0 or v0.5.1 node can still drop and be re-established when that node answers a link rekey and its reply is lost: the fix is on the answering side.

No configuration key was added or removed; the gateway's DNS listen default is the only configuration-key default that changed.

## Upgrade notes

**Debian and Ubuntu.** `apt install ./fips_0.5.2_<arch>.deb`, with `amd64` or `arm64` in place of `<arch>`. Once the new files are in place the package reloads the firewall if it is running, starts the daemon, then enables and starts `fips-dns` (every upgrade re-enables it; `systemctl mask fips-dns` keeps it off), and restarts `fips-gateway` if it is enabled. If the daemon does not come up, apt exits non-zero and prints its status; check `fipsctl show status` afterwards either way.

**Windows.** Open an elevated PowerShell in the folder where you unzipped the new ZIP, and in it: stop the service (`Stop-Service fips`); if your v0.5.1 service read its config from `\etc\fips`, move its files as described in the next paragraph; run the installer (`powershell -ExecutionPolicy Bypass -File .\install-service.ps1`, since the execution policy can refuse an unsigned script from a downloaded ZIP); then start the service (`Start-Service fips`). In Windows PowerShell 5.1, `sc` is an alias for `Set-Content`, so use `sc.exe` if you prefer the service control tool. The installer cannot replace `fips.exe` while the service is running and stops with a file-in-use error, so stop the service before every run of it. Resolve any legacy peer list the installer reports, as described under "Before you upgrade" above. The service log is at `C:\ProgramData\fips\fips.log`.

If your v0.5.1 service was set up by hand to read its config from `\etc\fips`, rather than by v0.5.1's `install-service.ps1` (which already used `C:\ProgramData\fips` and set `FIPS_CONFIG`), move `fips.yaml` and `fips.key` from `\etc\fips` into `C:\ProgramData\fips` after stopping the service and before running the new installer. The v0.5.2 installer sets `FIPS_CONFIG` to `C:\ProgramData\fips\fips.yaml`, and the service then reads only that file and the key beside it. Without the move, the service starts from whatever `C:\ProgramData\fips` holds. With the default config the installer places there, which does not enable a persistent identity, the node comes up under a new identity, and nothing warns about the files left in `\etc\fips`.

**OpenWrt.** Copy the package to `/tmp` on the router. On OpenWrt 25 and later run `apk add --allow-untrusted /tmp/fips_<new-version>_<arch>.apk`; on 24.10 and earlier run `opkg install /tmp/fips_<new-version>_<arch>.ipk`, with the file name you downloaded in place of the placeholders. After a first opkg upgrade, if you had disabled `fips-gateway`, run `service fips-gateway stop` and then `service fips-gateway disable`.

**FreeBSD.** Install the new package with `pkg install ./fips-0.5.2-freebsd-amd64.pkg`, then run `service fips restart` and, if you use it, `service fips_dns restart`, and check `fipsctl show status`. The package restarts the services itself only when pkg takes its upgrade path, which `pkg add` over an installed package does not, and the log rotation fix takes effect only once the daemon restarts. Do not remove the package before adding the new one: removal stops both services and removes the `.fips` resolver drop-in.

**Arch Linux and the systemd tarball.** pacman does not restart services: after the AUR package updates, run `systemctl restart fips.service`, and `systemctl restart fips-gateway.service` if you run the gateway. The tarball's `install.sh` restarts `fips` if it was running, but stopping `fips` also stops `fips-dns` and `fips-gateway`, and it starts neither again: run `systemctl start fips-dns.service`, and `systemctl start fips-gateway.service` if you run the gateway. After either, run `systemctl reload fips-firewall` if the firewall is active.

**Gateway on other hosts.** If `fips.yaml` does not set `gateway.dns.listen` and a local resolver forwards `.fips` to `[::1]:5353`, point it at `[::1]:5365` right after the upgrade, or set `listen` to the old port. If `fips.yaml` sets it, the gateway stays on that port and nothing needs to change; see "Before you upgrade" above.

**Rolling upgrade.** No coordination is needed. Upgrade nodes in any order.

## What was measured and what was not

**Measured, at the release's source content** (the same source as the tag, with the version string at `0.5.2-dev`):

- The full local test suite: 36 suites passed, including the chaos scenarios, the NAT traversal, gateway, firewall and DNS resolver suites, and the `.deb` install suite on five distributions.
- `cargo audit`: no vulnerabilities, with the same four allowed warnings as v0.5.1.
- The 100-node discovery test.
- The Debian package built through the release's container script, with all four binaries at a glibc floor of 2.34 against the 2.35 the package declares.
- The systemd tarball rebuilt twice on the same machine and compared byte for byte: identical.
- The OpenWrt `.ipk` cross-compiled for aarch64. The `.apk` cannot be built on the build host used here and is built by the release workflow.
- The wire format, by a diff showing that no file defining a frame, message, TLV or encoding changed since v0.5.1.
- A mixed-version mesh of v0.5.2, v0.5.1 and v0.5.0 nodes passed the interop suite, once without impairment and in eight runs with added delay and 2% packet loss: every pair passed the suite's connectivity checks, including after two rekey cycles; every pair of a v0.5.2 node and an older one completed link rekeys with each side starting them; and the logs showed no panic, error, decryption failure or handshake failure. Under loss, a link whose answering node ran v0.5.0 or v0.5.1 dropped after that node's rekey reply was lost and was re-established, three times in the eight runs. That is the defect this release fixes on the answering side: no link dropped where a v0.5.2 node answered or between two v0.5.2 nodes, and a v0.5.2-only mesh under the same loss dropped no link in four runs.
- The Windows installer and service on Windows Server 2025 (GitHub-hosted runners), under Windows PowerShell 5.1 and PowerShell 7, from a build that differs from the release's source content only in the version string, the changelog and the rustls update: the directory and peer-file permissions on a fresh install and on reruns; the installer's stop on a peer list left under `\etc\fips`; a peer list planted there by a standard user, which the service ignores once the current file exists and otherwise enforces with a warning; the upgrade from a service set up by v0.5.1's installer, which kept its node address; and the upgrade from a v0.5.1 service that read its config from `\etc\fips`, which came up under a new identity with no warning, as described in the Windows upgrade notes above.
- The gateway DNS port change on an OpenWrt 24 router running this release's source content (tested by Arjen): the gateway listened on `[::1]:5365` and dnsmasq forwarded `.fips` to it, and a gateway that cannot bind its DNS listener now exits instead of running with DNS dead. The same test found that if `fips-gateway` fails to start, dnsmasq is left forwarding `.fips` to the gateway's port until the gateway runs; this predates v0.5.2. If `.fips` stops resolving on a router, check `logread | grep fips-gateway`, and run `service fips-gateway stop` to hand `.fips` back to the daemon until the cause is fixed.

**Not measured when this was written:**

- No published v0.5.2 artifact existed. The checks above ran against artifacts built by the same scripts the release workflow uses.
- A `.deb` upgrade from an installed v0.5.1 package, which is the only case in which v0.5.1's removal scripts meet v0.5.2's install scripts. The install suite repacks one package against itself.
- The OpenWrt maintainer scripts are tested in CI in a BusyBox container against stubs, not under a real opkg or apk upgrade on a router.
- On OpenWrt router hardware, the upgrade rewriting the shipped gateway DNS listen line: the router test above ran the new port and did not report the rewrite separately.
- The Windows checks on a desktop edition of Windows, which can differ from the server runners in the owner given to new files and in when the service sees the `FIPS_CONFIG` the installer sets. The runner checks did not exercise `uninstall-service.ps1` or the TUN adapter.
- The changed rekey behavior under real mixed-version traffic on live nodes. No field soak was run for this release; the interop run described above stands in for it.
- Upgrading a running node in place, forwarding across more than one hop, loss patterns other than random 2% packet loss, and runs longer than a few minutes: the interop run started each mesh fresh, used full meshes only, and ran each repetition for about six minutes.
- Reproducibility across machines, which has never been tested.
- The FreeBSD upgrade command, and the statement that `pkg add` over an installed package does not take pkg's upgrade path: both are taken from pkg's source and were not run on a FreeBSD host.

## Getting v0.5.2

- **Linux x86_64 / aarch64**: `.deb` and tarball at the [v0.5.2 release page](https://github.com/jmcorgan/fips/releases/tag/v0.5.2).
- **Arch Linux**: `fips` from the AUR, once every package workflow for the release has finished.
- **macOS**: `.pkg` at the v0.5.2 release page.
- **Windows**: ZIP at the v0.5.2 release page.
- **FreeBSD (x86_64)**: `.pkg` at the v0.5.2 release page.
- **OpenWrt**: `.ipk` (OpenWrt 24.x and earlier) or `.apk` (OpenWrt 25+) at the v0.5.2 release page, for `aarch64_cortex-a53` and `x86_64`.
- **From source**: `cargo build --release` from a checkout of the v0.5.2 tag (Rust 1.94.1 per `rust-toolchain.toml`; `libclang-dev` is a required Linux build prerequisite, and on glibc Linux so are `libdbus-1-dev` and `pkg-config`).
- **Nix / NixOS**: `nix build .#fips` from a checkout of the v0.5.2 tag builds the binaries from source with the pinned toolchain and no manual prerequisites (see the Nix section of [`packaging/README.md`](https://github.com/jmcorgan/fips/blob/v0.5.2/packaging/README.md)). The NixOS module's documented flake input, `github:jmcorgan/fips`, follows the default branch; to run v0.5.2, set `inputs.fips.url = "github:jmcorgan/fips/v0.5.2"`, then run `nix flake update fips` and `nixos-rebuild switch`.

There is no Android daemon artifact. Android is supported as an embedded crate.

The full per-commit changelog lives in [`CHANGELOG.md`](https://github.com/jmcorgan/fips/blob/v0.5.2/CHANGELOG.md). Issues and discussion at [github.com/jmcorgan/fips](https://github.com/jmcorgan/fips). Security reports have a private channel; see [`SECURITY.md`](https://github.com/jmcorgan/fips/blob/v0.5.2/SECURITY.md).

## Contributors

Thanks to everyone who contributed code, packaging work, bug reports, or reviews to this release.

- [@jmcorgan](https://github.com/jmcorgan) (Johnathan Corgan): release shepherd; the gateway, Windows, packaging, session and discovery fixes.
- [@mmalmi](https://github.com/mmalmi) (Martti Malmi): the gateway fix that keeps a renewed DNS answer valid while its mapping is draining ([#169](https://github.com/jmcorgan/fips/pull/169)).
- [@Origami74](https://github.com/Origami74) (Arjen): found on router hardware that the gateway's DNS port collided with the daemon's mDNS responder on an OpenWrt access point, and reviewed the OpenWrt packaging fixes on OpenWrt 25.
- [@fr34aky](https://github.com/fr34aky): version placeholders in the FreeBSD packaging examples ([#152](https://github.com/jmcorgan/fips/pull/152), landed as `93d45191`), and a hostname test that no longer depends on the host's DNS search domain ([#154](https://github.com/jmcorgan/fips/pull/154), landed as `a1c0cd42`).
- [@shaibearary](https://github.com/shaibearary) (Sherry): a fix to the mesh test loop, which aborted its rekey setup under the bash that ships with macOS ([#155](https://github.com/jmcorgan/fips/pull/155), landed as `31ebec62`).
- [@Ghost-glitch-hub](https://github.com/Ghost-glitch-hub): reported that `fipsctl show links` showed zero traffic for active peers ([#158](https://github.com/jmcorgan/fips/issues/158)).

<!-- markdownlint-disable-file MD013 -->
