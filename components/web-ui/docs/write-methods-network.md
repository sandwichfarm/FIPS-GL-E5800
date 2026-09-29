# Network / Firewall / LAN / DNS Write Methods

RPC write method parameter structures extracted from GL.iNet SDK4 UI source code.

All methods are called via: `call(["sid", "<module>", "<method>", <params>])`

---

## Table of Contents

- [firewall](#firewall)
- [dns](#dns)
- [lan](#lan)
- [network](#network)
- [cable](#cable)
- [netmode](#netmode)
- [local-access](#local-access)
- [repeater](#repeater)
- [tethering](#tethering)
- [ipv6](#ipv6)
- [igmp](#igmp)
- [kmwan (Multi-WAN)](#kmwan-multi-wan)

---

## firewall

### `firewall.add_port_forward`

Adds a new port forwarding rule. Sends the `portForWardForm` object directly.

| Parameter   | Type    | Default     | Description                                     |
|-------------|---------|-------------|-------------------------------------------------|
| `name`      | string  | `""`        | Rule name / label                               |
| `proto`     | string  | `"tcp udp"` | Protocol: `"tcp udp"`, `"tcp"`, or `"udp"`      |
| `dest`      | string  | `""`        | Destination zone (internal zone name)            |
| `dest_ip`   | string  | `""`        | Destination IP address (LAN device)              |
| `dest_port` | string  | `""`        | Destination port(s)                              |
| `src`       | string  | `""`        | Source zone (external zone name)                 |
| `src_dport` | string  | `""`        | Source (external) port(s)                        |
| `enabled`   | boolean | `true`      | Whether the rule is enabled                      |

### `firewall.set_port_forward`

Updates an existing port forwarding rule. Same parameters as `add_port_forward` plus the rule `id` (set on the form object when editing).

| Parameter   | Type    | Default     | Description                                     |
|-------------|---------|-------------|-------------------------------------------------|
| `id`        | string  | --          | Rule ID (from `get_port_forward_list`)           |
| `name`      | string  | `""`        | Rule name / label                                |
| `proto`     | string  | `"tcp udp"` | Protocol: `"tcp udp"`, `"tcp"`, or `"udp"`      |
| `dest`      | string  | `""`        | Destination zone                                 |
| `dest_ip`   | string  | `""`        | Destination IP address                           |
| `dest_port` | string  | `""`        | Destination port(s)                              |
| `src`       | string  | `""`        | Source zone                                      |
| `src_dport` | string  | `""`        | Source port(s)                                   |
| `enabled`   | boolean | `true`      | Whether the rule is enabled                      |

### `firewall.remove_port_forward`

Removes one or all port forwarding rules.

| Parameter | Type    | Description                                  |
|-----------|---------|----------------------------------------------|
| `id`      | string  | Rule ID to remove (omit if removing all)     |
| `all`     | boolean | Set `true` to remove all rules               |

One of `id` or `all` must be provided.

### `firewall.order_port_forward`

Reorders port forwarding rules by priority.

| Parameter | Type     | Description                                    |
|-----------|----------|------------------------------------------------|
| `id_list` | string[] | Ordered array of rule IDs (highest priority first) |

### `firewall.add_rule`

Adds a new open-ports-on-router firewall rule. Sends `portRuleForm` directly.

| Parameter   | Type    | Default     | Description                                      |
|-------------|---------|-------------|--------------------------------------------------|
| `name`      | string  | `""`        | Rule name / label                                |
| `src`       | string  | `"wan"`     | Source zone (e.g. `"wan"`)                       |
| `proto`     | string  | `"tcp udp"` | Protocol: `"tcp udp"`, `"tcp"`, or `"udp"`      |
| `dest_port` | string  | `""`        | Port or port range                               |
| `target`    | string  | `"ACCEPT"`  | Firewall target: `"ACCEPT"`                      |
| `enabled`   | boolean | `true`      | Whether the rule is enabled                      |

### `firewall.set_rule`

Updates an existing firewall rule. Same structure as `add_rule` with the rule `id`.

| Parameter   | Type    | Default     | Description                                      |
|-------------|---------|-------------|--------------------------------------------------|
| `id`        | string  | --          | Rule ID (from `get_rule_list`)                   |
| `name`      | string  | `""`        | Rule name / label                                |
| `src`       | string  | `"wan"`     | Source zone                                      |
| `proto`     | string  | `"tcp udp"` | Protocol                                         |
| `dest_port` | string  | `""`        | Port or port range                               |
| `target`    | string  | `"ACCEPT"`  | Firewall target                                  |
| `enabled`   | boolean | `true`      | Whether the rule is enabled                      |

### `firewall.remove_rule`

Removes one or all open-port rules.

| Parameter | Type    | Description                                  |
|-----------|---------|----------------------------------------------|
| `id`      | string  | Rule ID to remove (omit if removing all)     |
| `all`     | boolean | Set `true` to remove all rules               |

### `firewall.set_dmz`

Configures DMZ (exposed host) settings.

| Parameter  | Type    | Default | Description                                        |
|------------|---------|---------|------------------------------------------------------|
| `enabled`  | boolean | `false` | Enable or disable DMZ                              |
| `dest_ip`  | string  | `""`    | DMZ host IP (only sent when `enabled` is `true`)   |
| `priority` | boolean | `true`  | DMZ priority over port forwards (only when enabled)|

### `firewall.set_wan_access`

Configures remote WAN access (remote management) settings. Sends `remoteAccessFrom` object.

| Parameter         | Type     | Default | Description                                        |
|-------------------|----------|---------|------------------------------------------------------|
| `enable_https`    | boolean  | `false` | Enable remote HTTPS access                         |
| `enable_ping`     | boolean  | `false` | Enable remote ping (ICMP)                          |
| `enable_ssh`      | boolean  | `false` | Enable remote SSH access                           |
| `enable_whitelist`| boolean  | `false` | Enable IP whitelist restriction                    |
| `whitelist`       | object[] | `[]`    | Array of whitelist entries (see below)             |

Each **whitelist entry**:

| Field    | Type   | Description        |
|----------|--------|--------------------|
| `name`   | string | Label for the entry|
| `ipaddr` | string | IP address or CIDR |

---

## dns

### `dns.set_config`

Configures DNS resolver settings. Parameters vary by mode.

**Common parameters (always sent):**

| Parameter            | Type    | Default | Description                                  |
|----------------------|---------|---------|----------------------------------------------|
| `force_dns`          | boolean | `false` | Force all DNS traffic through router         |
| `rebind_protection`  | boolean | `false` | Enable DNS rebind protection                 |
| `override_vpn`       | boolean | `true`  | Override VPN DNS settings                    |
| `mode`               | string  | `"auto"`| DNS mode (see below)                         |

**Mode-specific parameters:**

When `mode` = `"manual"`:

| Parameter | Type     | Description                              |
|-----------|----------|------------------------------------------|
| `server`  | string[] | Array of DNS server IPs (1-4 addresses)  |

When `mode` = `"proxy"`:

| Parameter | Type     | Description                     |
|-----------|----------|---------------------------------|
| `server`  | string[] | Single-element array with proxy address |

When `mode` = `"secure"`:

| Parameter          | Type     | Description                                      |
|--------------------|----------|--------------------------------------------------|
| `proto`            | string   | Protocol: `"DoT"`, `"DoH"`, `"DNSCrypt"`, `"oDoH"` |
| `server`           | string[] | Server list (for DoH/DNSCrypt/oDoH)              |
| `dot_provider`     | string   | DoT provider ID (for DoT mode)                   |
| `nextdns_id`       | string   | NextDNS configuration ID (when `dot_provider` = `"1"`) |
| `controld_id`      | string   | Control D resolver ID (when `dot_provider` = `"D"`, plan `"2"`) |
| `free_controld_id` | string   | Free Control D ID (when `dot_provider` = `"D"`, plan other) |
| `controld_plan`    | string   | Control D plan: `"2"` or `"3"` (when `dot_provider` = `"D"`) |

### `dns.set_host`

Sets custom DNS host entries (local DNS records).

| Parameter | Type   | Description                                              |
|-----------|--------|----------------------------------------------------------|
| `content` | string | Raw hosts file content as a string (newline-separated entries) |

---

## lan

### `lan.set_config`

Configures LAN or Guest network IP and DHCP settings. Parameters depend on whether setting IP or DHCP.

**LAN/Guest IP settings:**

| Parameter     | Type   | Description                                      |
|---------------|--------|--------------------------------------------------|
| `interface`   | string | Network interface: `"lan"` or `"guest"`          |
| `ip`          | string | LAN/Guest IP address                             |
| `netmask`     | string | Subnet mask                                      |
| `ap_isolate`  | number | AP isolation: `0` (off) or `1` (on)              |
| `wan_isolate`  | number | WAN isolation (guest only): `0` (off) or `1` (on)|

**DHCP settings:**

| Parameter   | Type     | Description                                       |
|-------------|----------|----------------------------------------------------|
| `interface` | string   | Network interface: `"lan"` or `"guest"`           |
| `enable`    | number   | DHCP enable: `1` (on) or `0` (off)               |
| `leasetime` | string   | DHCP lease time (e.g. `"120m"`, `"24h"`)          |
| `gateway`   | string   | DHCP gateway IP                                    |
| `start`     | string   | DHCP range start IP                                |
| `end`       | string   | DHCP range end IP                                  |
| `dns`       | string[] | DNS servers (1-2 entries)                          |
| `lpr`       | string[] | LPR / static routes (filtered non-empty entries)   |

### `lan.add_static_bind`

Adds a static DHCP binding (IP reservation). Sends `staticBindForm`.

| Parameter | Type   | Default | Description                |
|-----------|--------|---------|----------------------------|
| `name`    | string | `""`    | Client display name        |
| `mac`     | string | `""`    | MAC address                |
| `ip`      | string | `""`    | Reserved IP address        |

### `lan.set_static_bind`

Updates an existing static DHCP binding. Same parameters as `add_static_bind`.

| Parameter | Type   | Description                |
|-----------|--------|----------------------------|
| `name`    | string | Client display name        |
| `mac`     | string | MAC address                |
| `ip`      | string | Reserved IP address        |

### `lan.remove_static_bind`

Removes a static DHCP binding.

| Parameter | Type   | Description                          |
|-----------|--------|--------------------------------------|
| `mac`     | string | MAC address of the binding to remove |
| `mode`    | number | Always `0`                           |

---

## network

### `network.set_advance_config`

Sets advanced network configuration (NAT / SIP ALG).

| Parameter    | Type   | Default | Description                     |
|--------------|--------|---------|---------------------------------|
| `nat_enable` | number | `0`     | NAT mode: `0` (off) or `1` (on) |
| `sip_enable` | number | `0`     | SIP ALG: `0` (off) or `1` (on) |

### `network.set_netnat_config`

Configures hardware NAT acceleration.

| Parameter     | Type    | Default | Description                                  |
|---------------|---------|---------|----------------------------------------------|
| `enable`      | boolean | `false` | Enable hardware NAT acceleration             |
| `actype`      | number  | `0`     | Acceleration type (from available `actypes`)  |
| `wifi_reload`  | boolean | `false` | Whether WiFi reload is needed                |

---

## cable

### `cable.set_config`

Configures the WAN Ethernet connection. Parameters vary by protocol.

**Common parameters:**

| Parameter  | Type   | Description                                     |
|------------|--------|-------------------------------------------------|
| `protocol` | string | Connection protocol: `"dhcp"`, `"static"`, `"pppoe"` |
| `vlanid`   | number | VLAN ID (optional, omitted if null)             |
| `ttl`      | number | TTL value (optional, omitted if null)           |
| `ttl_ipv6` | number | IPv6 TTL/hop limit (optional, omitted if null)  |
| `mtu`      | number | MTU value (optional, omitted if null)           |

**When `protocol` = `"pppoe"`:**

| Parameter  | Type   | Description     |
|------------|--------|-----------------|
| `username` | string | PPPoE username  |
| `password` | string | PPPoE password  |

**When `protocol` = `"static"`:**

| Parameter | Type   | Description               |
|-----------|--------|---------------------------|
| `ipv4`    | object | IPv4 static configuration |
| `ipv6`    | object | IPv6 static configuration (if IPv6 enabled) |

**`ipv4` object:**

| Field     | Type     | Description        |
|-----------|----------|--------------------|
| `ip`      | string   | IP address         |
| `netmask` | string   | Subnet mask        |
| `gateway` | string   | Gateway IP         |
| `dns`     | string[] | DNS servers (1-2)  |

**`ipv6` object:**

| Field     | Type     | Description        |
|-----------|----------|--------------------|
| `ip`      | string   | IPv6 address       |
| `gateway` | string   | IPv6 gateway       |
| `dns`     | string[] | DNS servers (1-2)  |

### `cable.set_port_config`

Configures a physical Ethernet port (WAN/LAN role, MAC clone).

| Parameter | Type   | Description                                          |
|-----------|--------|------------------------------------------------------|
| `name`    | string | Port identifier (e.g. port silk name)                |
| `mode`    | string | Port mode: `"wan"` or `"lan"`                        |
| `macaddr` | object | MAC address configuration (optional, only for WAN)   |

**`macaddr` object (when `mode` = `"wan"`):**

| Field     | Type   | Description                                          |
|-----------|--------|------------------------------------------------------|
| `mode`    | string | MAC mode: `"clone"`, `"random"`, or default          |
| `macaddr` | string | MAC address (cloned, random, or factory default)     |
| `update`  | string | Auto-update: `"time"` or `"none"` (for random mode) |
| `period`  | number | Update period in hours (e.g. `168` for 7 days)       |

---

## netmode

### `netmode.set_mode`

Switches the router operating mode (router, AP, bridge/repeater, WDS).

**For router/AP mode:**

| Parameter | Type   | Description                                    |
|-----------|--------|------------------------------------------------|
| `mode`    | string | Operating mode: `"router"` or `"ap"`           |

**For relay (repeater) / WDS mode (includes WiFi connection params):**

| Parameter | Type    | Description                                    |
|-----------|---------|------------------------------------------------|
| `mode`    | string  | `"relay"` or `"wds"`                           |
| `ssid`    | string  | WiFi network name to connect to                |
| `key`     | string  | WiFi password (if encrypted)                   |
| `identity`| string  | 802.1X identity (if enterprise auth)           |
| `band`    | string  | WiFi band                                      |
| `channel` | number  | WiFi channel                                   |
| `bssid`   | string  | BSSID of the target AP                         |
| `macaddr` | object  | MAC address config (same structure as cable)   |

**For AP passthrough mode:**

| Parameter | Type   | Description                                    |
|-----------|--------|------------------------------------------------|
| `mode`    | string | `"ap"`                                         |
| `mask`    | string | Subnet mode: `"auto"` or manual mask           |
| `mac`     | string | MAC address (optional)                         |

---

## local-access

### `local-access.set_config`

Configures local admin panel access settings. Sends `localAccessForm` (with `session_timeout` converted to seconds).

| Parameter             | Type    | Default  | Description                                  |
|-----------------------|---------|----------|----------------------------------------------|
| `redirect_https`      | boolean | `false`  | Redirect HTTP to HTTPS for admin panel       |
| `http_port`           | number  | `80`     | HTTP port for admin panel                    |
| `https_port`          | number  | `443`    | HTTPS port for admin panel                   |
| `luci_redirect_https` | boolean | `false`  | Redirect HTTP to HTTPS for LuCI              |
| `luci_http_port`      | number  | `8080`   | HTTP port for LuCI                           |
| `luci_https_port`     | number  | `8443`   | HTTPS port for LuCI                          |
| `ssh_port`            | number  | `22`     | SSH port                                     |
| `session_timeout`     | number  | `300`    | Session timeout in seconds (UI shows minutes, sends `minutes * 60`) |
| `ssh_enabled`         | boolean | `false`  | Enable SSH access                            |

---

## repeater

### `repeater.connect`

Connects to a WiFi network as a repeater. Parameters built from wifi scan item + user input.

| Parameter  | Type    | Description                                         |
|------------|---------|-----------------------------------------------------|
| `ssid`     | string  | WiFi network name                                   |
| `key`      | string  | WiFi password (omitted if open network)             |
| `identity` | string  | 802.1X identity (omitted if not enterprise)         |
| `remember` | boolean | Always `true` (save the AP for auto-reconnect)      |
| `band`     | string  | WiFi band from scan result (e.g. `"2g"`, `"5g"`)   |
| `channel`  | number  | WiFi channel from scan result                       |
| `bssid`    | string  | BSSID from scan result                              |
| `macaddr`  | object  | MAC address configuration (optional)                |

**`macaddr` object:**

| Field     | Type   | Description                                      |
|-----------|--------|--------------------------------------------------|
| `macaddr` | string | MAC address (generated random or user-set)       |
| `mode`    | string | `"random"` or other mode                         |
| `update`  | string | `"none"` (no auto-update)                        |

### `repeater.disconnect`

Disconnects the repeater. No parameters required.

```
{}
```

### `repeater.set_config`

Configures repeater behavior settings.

| Parameter  | Type    | Default | Description                                    |
|------------|---------|---------|------------------------------------------------|
| `auto`     | number  | `0`     | Auto-reconnect: `0` (off) or `1` (on)         |
| `lock_band`| string  | `""`    | Lock to specific band (empty = no lock)        |
| `ttl`      | number  | `null`  | TTL override (optional)                        |
| `ttl_ipv6` | number  | `null`  | IPv6 TTL/hop limit override (optional)         |
| `mtu`      | number  | `null`  | MTU override (optional)                        |

Note: Only `auto` and `lock_band` (if set) are sent in the RPC call. `ttl`, `ttl_ipv6`, and `mtu` are stored in config but sent only when non-null.

### `repeater.remove_saved_ap`

Removes a saved (remembered) WiFi AP from the list.

| Parameter | Type   | Description             |
|-----------|--------|-------------------------|
| `ssid`    | string | SSID of the AP to forget|

---

## tethering

### `tethering.set_connect`

Connects via USB tethering to a phone/device.

| Parameter  | Type   | Description                                     |
|------------|--------|-------------------------------------------------|
| `device`   | string | USB device identifier                           |
| `ttl`      | number | TTL value (optional, omitted if null)           |
| `ttl_ipv6` | number | IPv6 TTL/hop limit (optional, omitted if null)  |
| `mtu`      | number | MTU value (optional, omitted if null)           |

### `tethering.disconnect`

Disconnects tethering. No parameters required.

```
{}
```

---

## ipv6

### `ipv6.set_ipv6`

Configures IPv6 settings. Parameters vary based on `enable` and `lan_mode`.

| Parameter     | Type    | Default  | Description                                   |
|---------------|---------|----------|-----------------------------------------------|
| `enable`      | boolean | `false`  | Enable IPv6                                   |
| `lan_mode`    | string  | `"nat6"` | LAN IPv6 mode (only when enabled)             |
| `lan_dns_mode`| boolean | `true`   | Use automatic DNS (only when enabled)         |
| `lan_dns1`    | string  | `null`   | Primary DNS (only when `lan_dns_mode` = `false`) |
| `lan_dns2`    | string  | `null`   | Secondary DNS (optional, when `lan_dns_mode` = `false`) |
| `lan_ip`      | string  | `null`   | Static IPv6 address (only when `lan_mode` = `"static"`) |

**`lan_mode` values:**

| Value        | Label         | Description                 |
|--------------|---------------|-----------------------------|
| `"native"`   | Native        | Native IPv6                 |
| `"relay"`    | Passthrough   | IPv6 passthrough/relay      |
| `"nat6"`     | NAT6          | NAT6 translation            |
| `"static"`   | Static IPv6   | Static IPv6 address         |

---

## igmp

### `igmp.set_config`

Configures IGMP snooping.

| Parameter | Type    | Default | Description                           |
|-----------|---------|---------|---------------------------------------|
| `enable`  | boolean | `false` | Enable IGMP snooping                  |
| `version` | number  | `3`     | IGMP version: `1`, `2`, or `3`       |

---

## kmwan (Multi-WAN)

### `kmwan.set_config`

Sets the Multi-WAN failover/load-balance mode and interface priority or weights.

| Parameter    | Type     | Description                                       |
|--------------|----------|---------------------------------------------------|
| `mode`       | number   | Multi-WAN mode: `0` (failover) or `1` (load balance) |
| `interfaces` | object[] | Interface configuration list (see below)          |

**For failover mode (`mode` = `0`):**

Each `interfaces` entry:

| Field       | Type   | Description                              |
|-------------|--------|------------------------------------------|
| `interface` | string | Interface name (e.g. `"wan"`, `"wwan"`)  |
| `metric`    | number | Priority metric (lower = higher priority)|

**For load balance mode (`mode` = `1`):**

Each `interfaces` entry:

| Field       | Type   | Description                              |
|-------------|--------|------------------------------------------|
| `interface` | string | Interface name                           |
| `weight`    | number | Traffic weight                           |

### `kmwan.set_interface`

Configures health check settings for a specific WAN interface.

| Parameter     | Type     | Default | Description                                  |
|---------------|----------|---------|----------------------------------------------|
| `interface`   | string   | `""`    | Interface name                               |
| `enable_check`| boolean  | `true`  | Enable connectivity checking                 |
| `track_proto` | number   | `0`     | Track protocol: `0` (IPv4), `1` (IPv6), `2` (both) |
| `track_method`| number   | `0`     | Tracking method: `0` (ping), `1` (HTTP)      |
| `track_mode`  | number   | `0`     | Track mode                                   |
| `track_ipv4`  | string[] | `[]`    | IPv4 tracking IPs (up to 4, filtered non-empty) |
| `track_ipv6`  | string[] | `[]`    | IPv6 tracking IPs (up to 4, filtered non-empty) |
| `enable_ssl`  | boolean  | `false` | Enable SSL for HTTP tracking (when `track_method` = `1`) |

Note: `track_ipv4`, `track_ipv6`, and `enable_ssl` are only sent when `enable_check` is `true`, and filtered based on `track_proto` and `track_method`.

### `kmwan.set_sensitivity`

Sets the Multi-WAN failover sensitivity level.

| Parameter     | Type   | Description                              |
|---------------|--------|------------------------------------------|
| `sensitivity` | object | Sensitivity configuration object         |

**`sensitivity` object:**

| Field   | Type   | Default    | Description                                 |
|---------|--------|------------|---------------------------------------------|
| `level` | string | `"medium"` | Preset level: `"low"`, `"medium"`, `"high"`, `"custom"` |
| `val`   | number | `5`        | Custom sensitivity value (used when `level` = `"custom"`) |
