# VPN Write Methods - Parameter Reference

Extracted from GL.iNet SDK4 UI source files. Documents all VPN-related write/create/delete/action RPC method parameter structures.

---

## Table of Contents

- [vpn-client Methods](#vpn-client-methods)
- [wg-client Methods](#wg-client-methods)
- [wg-server Methods](#wg-server-methods)
- [ovpn-client Methods](#ovpn-client-methods)
- [ovpn-server Methods](#ovpn-server-methods)

---

## vpn-client Methods

### vpn-client.add_tunnel

Creates a new VPN tunnel with from/via/to routing configuration.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | string | `""` | Tunnel display name |
| `from` | object | `{type: "default"}` | Traffic source filter (which clients use this tunnel) |
| `from.type` | string | `"default"` | Source type: `"default"` (all clients), `"interface"`, `"mac"`, `"exclude_mac"` |
| `from.mac_list` | array | `[]` | List of MAC addresses (when type is `"mac"` or `"exclude_mac"`) |
| `from.interface_list` | array | `[]` | List of interfaces (when type is `"interface"`) |
| `to` | object | `{type: "default"}` | Traffic destination filter (which domains use this tunnel) |
| `to.type` | string | `"default"` | Destination type: `"default"`, `"domain"`, `"exclude_domain"` |
| `to.manual` | boolean | `true` | Whether domain list is entered manually (vs URL) |
| `to.domain_list` | string | `""` | Newline-separated domain list (when manual is true) |
| `to.url` | string | `""` | URL to fetch domain list from (when manual is false) |
| `via` | object | `{}` | VPN client configuration to route through |
| `via.type` | string | | VPN type: `"wireguard"` or `"openvpn"` |
| `via.group_id` | number | | Group ID of the VPN provider/config group |
| `via.peer_id` | number | | WireGuard peer ID (for WireGuard type) |
| `via.client_id` | number | | OpenVPN client ID (for OpenVPN type) |

**RPC call:** `s("call", ["sid", "vpn-client", "add_tunnel", params], {timeout: 30000})`

Default params are spread: `{from: {type: "default"}, to: {type: "default"}, via: {}, ...userParams}`

---

### vpn-client.set_tunnel

Updates an existing VPN tunnel configuration.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tunnel_id` | string/number | *required* | ID of the tunnel to modify |
| `name` | string | | Updated tunnel name |
| `from` | object | | Traffic source filter (same structure as add_tunnel) |
| `to` | object | | Traffic destination filter (same structure as add_tunnel) |
| `via` | object | | VPN client to route through (same structure as add_tunnel) |
| `enabled` | boolean | | Enable/disable the tunnel |

**RPC call:** `s("call", ["sid", "vpn-client", "set_tunnel", params], {timeout: 30000})`

---

### vpn-client.remove_tunnel

Removes an existing VPN tunnel.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tunnel_id` | string/number | *required* | ID of the tunnel to remove |

**RPC call:** `s("call", ["sid", "vpn-client", "remove_tunnel", {tunnel_id}])`

---

### vpn-client.set_default_tunnel

Enables or disables the default tunnel feature.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | boolean | *required* | Whether the default tunnel is enabled |

**RPC call:** `s("call", ["sid", "vpn-client", "set_default_tunnel", {enabled}])`

---

### vpn-client.set_global_mode

Switches between global proxy mode and policy-based routing mode.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | number | *required* | Proxy mode: `0` = GLOBAL, `1` = POLICY |

**RPC call:** `s("call", ["sid", "vpn-client", "set_global_mode", {mode}])`

**Constants:** `PROXY_MODE = {GLOBAL: 0, POLICY: 1}`

---

### vpn-client.set_options

Sets tunnel-specific options (killswitch, MTU, local access, etc.).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tunnel_id` | string/number | *required* | ID of the tunnel to configure |
| `killswitch` | boolean | `true` | Enable VPN kill switch (block internet if VPN drops) |
| `mtu` | number/null | `null` | Custom MTU value (null = auto) |
| `local_access` | boolean | `false` | Allow access to local network while VPN is active |
| `masq` | boolean | `false` | Enable IP masquerading |
| `client_to_client` | boolean | `false` | Allow VPN clients to communicate with each other |
| `service_policy` | boolean | `false` | Enable service policy |

**Form definition:**
```js
settingForm: {
  killswitch: true,
  mtu: null,
  local_access: false,
  masq: false,
  client_to_client: false,
  service_policy: false
}
```

**RPC call:** `s("call", ["sid", "vpn-client", "set_options", params])`

**Note:** The `tunnel_using_options` and `options_in_used` fields from the get response are stripped before sending.

---

### vpn-client.set_tap_s2s

Enables or disables TAP Site-to-Site mode for a tunnel.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | boolean | *required* | Enable/disable TAP S2S mode |
| `group_id` | number | *required* | VPN group ID |
| `client_id` | number | *required* | OpenVPN client ID |

**RPC call:** `s("call", ["sid", "vpn-client", "set_tap_s2s", params], {timeout: 30000})`

---

### vpn-client.set_single_mac

**Note:** This method is referenced in the API reference but no UI form was found for it in the analyzed source files. It likely sets a single MAC address for VPN client routing. Expected parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mac` | string | *required* | MAC address to route through VPN |
| `tunnel_id` | string/number | | Tunnel ID (if applicable) |

---

### vpn-client.start_random_client

Starts a VPN connection using a random/recommended configuration from a provider group.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `peer_count` | number | | Number of peers available |
| `group_id` | number | *required* | Group ID of the VPN provider to start |

**RPC call:** `s("call", ["sid", "vpn-client", "start_random_client", params], {timeout: 0})`

**Note:** timeout=0 means no timeout (long-running connection).

---

### vpn-client.stop

Stops an active VPN client connection.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tunnel_id` | string/number | | Tunnel ID to stop (passed as object) |

**RPC call:** `s("call", ["sid", "vpn-client", "stop", params])`

---

### vpn-client.order_tunnel

Reorders VPN tunnel priority.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `id_list` | array | *required* | Ordered array of tunnel IDs representing priority (first = highest) |

**RPC call:** `s("call", ["sid", "vpn-client", "order_tunnel", {id_list}])`

---

## wg-client Methods

### wg-client.add_config

Adds a new WireGuard client configuration to a group.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_id` | number | *required* | Group to add the config to |
| `name` | string | `""` | Configuration display name |
| `address_v4` | string | `""` | IPv4 address with CIDR (e.g., `"10.0.0.2/32"`) |
| `address_v6` | string | `""` | IPv6 address with CIDR |
| `private_key` | string | `""` | WireGuard private key (Base64, 44 chars) |
| `public_key` | string | `""` | Server's public key |
| `end_point` | string | `""` | Server endpoint (`host:port`) |
| `dns` | string | `""` | Comma-separated DNS servers |
| `allowed_ips` | string | | Comma-separated allowed IPs (CIDR notation) |
| `preshared_key` | string | `""` | Pre-shared key (optional, included only if `presharedkey_enable` is true) |
| `listen_port` | number/null | `null` | Local listen port (1-65535, null = auto) |
| `persistent_keepalive` | number/null | `null` | Keepalive interval in seconds |
| `mtu` | number/null | `null` | Custom MTU value |

**Form definition:**
```js
config: {
  name: "",
  address_v4: "",
  address_v6: "",
  private_key: "",
  allowed_ips: [{ip: ""}],  // UI array, joined to comma-separated string for RPC
  end_point: "",
  public_key: "",
  dns: "",
  presharedkey_enable: false,  // UI-only toggle, not sent to RPC
  preshared_key: "",
  listen_port: null,
  persistent_keepalive: null,
  mtu: null
}
```

**Note:** `null` values and the `dns`/`preshared_key` fields are handled specially:
- Fields with `null` values are excluded from the submission
- `dns` is trimmed and comma-joined
- `preshared_key` is only included when `presharedkey_enable` is true

**RPC call:** `s("call", ["sid", "wg-client", "add_config", params])`

---

### wg-client.set_config

Updates an existing WireGuard client configuration.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_id` | number | *required* | Group the config belongs to |
| `peer_id` | number | *required* | Peer/config ID to update |
| *(all fields from add_config)* | | | Same fields as `add_config` |

**RPC call:** `s("call", ["sid", "wg-client", "set_config", params])`

---

### wg-client.remove_config

Removes a specific WireGuard client configuration.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_id` | number | *required* | Group the config belongs to |
| `peer_id` | number | *required* | Peer/config ID to remove |

**RPC call:** `s("call", ["sid", "wg-client", "remove_config", {group_id, peer_id}])`

---

### wg-client.add_group

Creates a new WireGuard client configuration group.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_name` | string | `"New Provider"` | Display name for the new group (localized default) |

**RPC call:** `s("call", ["sid", "wg-client", "add_group", {group_name}])`

---

### wg-client.set_group

Updates a WireGuard client group's properties.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_id` | number | *required* | Group ID to update |
| `group_name` | string | | New group name |

**RPC call:** `s("call", ["sid", "wg-client", "set_group", params])`

---

### wg-client.remove_group

Removes a WireGuard client configuration group and all its configs.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_id` | number | *required* | Group ID to remove (uses `currentGroupId`) |

**RPC call:** `s("call", ["sid", "wg-client", "remove_group", {group_id}])`

---

### wg-client.clear_config_list

Removes all configurations from a WireGuard client group.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_id` | number | *required* | Group to clear |
| `delete_key` | boolean | `false` | Also delete encryption keys (only for `group_type === 1` / provider groups) |

**RPC call:** `s("call", ["sid", "wg-client", "clear_config_list", {group_id, delete_key}])`

---

## wg-server Methods

### wg-server.set_config

Updates the WireGuard server configuration.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `address_v4` | string | `""` | Server IPv4 address with CIDR (e.g., `"10.0.0.1/24"`) |
| `address_v6` | string | `""` | Server IPv6 address with CIDR (e.g., `"fd00::1/64"`) |
| `port` | number/null | `null` | Listen port (1-65535) |
| `private_key` | string | `""` | Server private key |

**Form definition:**
```js
serverConfigForm: {
  address_v4: "",
  address_v6: "",
  port: null,
  private_key: "",
  public_key: ""   // excluded from submission (read-only, derived)
}
```

**Note:** `public_key` is stripped before submission. The UI auto-appends `/24` to IPv4 and `/64` to IPv6 if missing.

**RPC call:** `s("call", ["sid", "wg-server", "set_config", params])`

---

### wg-server.set_setting

Updates WireGuard server operational settings (options).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `killswitch` | boolean | `true` | Enable kill switch |
| `mtu` | number/null | `null` | Custom MTU |
| `local_access` | boolean | `false` | Allow local network access |
| `masq` | boolean | `false` | Enable IP masquerading |
| `client_to_client` | boolean | `false` | Allow client-to-client communication |
| `service_policy` | boolean | `false` | Enable service policy |

**Form definition:**
```js
settingForm: {
  killswitch: true,
  mtu: null,
  local_access: false,
  masq: false,
  client_to_client: false,
  service_policy: false
}
```

**RPC call:** `s("call", ["sid", "wg-server", "set_setting", params], {timeout: 30000})`

---

### wg-server.add_peer

Adds a new peer to the WireGuard server.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | string | `""` | Peer display name |
| `allowed_ips` | string | | Comma-separated allowed IPs in CIDR notation |
| `dns` | string | `""` | Comma-separated DNS servers |
| `presharedkey` | string | `""` | Pre-shared key (included only if `presharedkey_enable` is true) |
| `persistent_keepalive` | string | `""` | Keepalive interval |
| `mtu` | string | `""` | Custom MTU |

**Form definition:**
```js
peerForm: {
  name: "",
  allowed_ips: [{ip: ""}],  // UI array, joined to comma-separated string
  dns: "",
  presharedkey: "",
  presharedkey_enable: false,  // UI-only toggle
  persistent_keepalive: "",
  mtu: ""
}
```

**Note:** The `dns` and `allowed_ips` fields are processed the same way as wg-client. After successful add, the server auto-calls `generate_peer` with the returned `peer_id`.

**RPC call:** `s("call", ["sid", "wg-server", "add_peer", params])`

---

### wg-server.set_peer

Updates an existing peer on the WireGuard server.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `peer_id` | string/number | *required* | Peer ID to update |
| *(all fields from add_peer)* | | | Same fields as `add_peer` |

**RPC call:** `s("call", ["sid", "wg-server", "set_peer", params])`

---

### wg-server.remove_peer

Removes a peer from the WireGuard server.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `peer_id` | string/number | | Peer ID to remove (omit if using `all`) |
| `all` | boolean | | Set to `true` to remove all peers |

**RPC call:** `s("call", ["sid", "wg-server", "remove_peer", params])`

**Note:** Either `peer_id` or `all: true` must be provided, not both.

---

### wg-server.start

Starts the WireGuard server. Takes no parameters.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| *(none)* | | | Empty object `{}` |

**RPC call:** `s("call", ["sid", "wg-server", "start", {}])`

---

### wg-server.stop

Stops the WireGuard server. Takes no parameters.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| *(none)* | | | Empty object `{}` |

**RPC call:** `s("call", ["sid", "wg-server", "stop", {}])`

---

### wg-server.generate_peer

Generates a complete peer configuration file (used after add_peer or set_peer).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `peer_id` | string/number | *required* | Peer ID to generate config for |

**Response fields:**
```js
peerData: {
  address: "",
  allowed_ips: "",
  dns: "",
  end_point: "",
  listen_port: "",
  persistent_keepalive: "",
  private_key: "",
  public_key: "",
  mtu: 1420,
  presharedkey: ""
}
```

**RPC call:** `s("call", ["sid", "wg-server", "generate_peer", {peer_id}])`

---

### wg-server.generate_publickey

Generates a public key from a given private key.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `private_key` | string | *required* | WireGuard private key to derive public key from |

**RPC call:** `s("call", ["sid", "wg-server", "generate_publickey", {private_key}])`

---

## ovpn-client Methods

### ovpn-client.add_config

Adds a new OpenVPN client configuration to a group. Config is typically uploaded as a file and processed via `check_config` / `confirm_config` flow, but can also be added directly.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_id` | number | *required* | Group to add the config to |
| `name` | string | | Configuration display name |

**RPC call:** `r("call", ["sid", "ovpn-client", "add_config", params])`

---

### ovpn-client.set_config

Updates an existing OpenVPN client configuration.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_id` | number | *required* | Group the config belongs to |
| `client_id` | number | *required* | Client config ID to update |
| `name` | string | `""` | Updated display name |

**Form definition:**
```js
configForm: {
  group_id: null,
  client_id: null,
  name: ""
}
```

**RPC call:** `r("call", ["sid", "ovpn-client", "set_config", params])`

---

### ovpn-client.remove_config

Removes a specific OpenVPN client configuration.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_id` | number | *required* | Group the config belongs to |
| `client_id` | number | *required* | Client config ID to remove |

**RPC call:** `r("call", ["sid", "ovpn-client", "remove_config", params])`

---

### ovpn-client.add_group

Creates a new OpenVPN client configuration group.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_name` | string | `"New Provider"` | Display name for the new group (localized default) |

**RPC call:** `r("call", ["sid", "ovpn-client", "add_group", {group_name}])`

---

### ovpn-client.set_group

Updates an OpenVPN client group's properties.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_id` | number/string | *required* | Group ID to update |
| `group_name` | string | `""` | New group name |

**Form definition:**
```js
editGroupData: {
  group_name: "",
  group_id: ""
}
```

**RPC call:** `r("call", ["sid", "ovpn-client", "set_group", params])`

---

### ovpn-client.remove_group

Removes an OpenVPN client configuration group.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_id` | number | *required* | Group ID to remove |

**RPC call:** `r("call", ["sid", "ovpn-client", "remove_group", {group_id}])`

---

## ovpn-server Methods

### ovpn-server.set_config

Updates the OpenVPN server configuration. This is the main server configuration method.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | string | `"tun"` | Tunnel mode: `"tun"` or `"tap-s2s"` |
| `proto` | string | `"tcp"` | Protocol: `"tcp"` or `"udp"` |
| `port` | number/null | `null` | Server listen port |
| `client_auth` | number | `1` | Client authentication mode (1 = username/password) |
| `auth` | string | `"SHA256"` | HMAC authentication algorithm |
| `cipher` | string | `"AES-256-GCM"` | Encryption cipher |
| `lzo` | boolean | `false` | Enable LZO compression |
| `hmac` | boolean | `false` | Enable HMAC firewall |
| `client_to_client` | boolean | `false` | Allow client-to-client communication |
| `verb` | string | `"0"` | Verbosity level (0-11) |
| `cert` | string | `""` | Server certificate (PEM content) |
| `key` | string | `""` | Server private key (PEM content) |
| `ca` | string | `""` | CA certificate (PEM content) |
| `dh` | string | `""` | Diffie-Hellman parameters |
| `ta` | string | `""` | TLS auth key |
| `subnetv4` | string | `""` | IPv4 subnet (mode=tun; sent without CIDR, mask sent separately) |
| `mask` | string | `""` | IPv4 subnet mask (mode=tun; converted from CIDR in UI) |
| `subnetv6` | string | `""` | IPv6 subnet with CIDR (mode=tun) |
| `tap_address` | string | `""` | TAP interface address (mode=tap-s2s) |
| `tap_mask` | string | `""` | TAP interface netmask (mode=tap-s2s) |
| `start` | string | `""` | DHCP range start (mode=tap-s2s) |
| `end` | string | `""` | DHCP range end (mode=tap-s2s) |

**Form definition:**
```js
ovpnServerForm: {
  mode: "tun",
  subnetv4: "",
  mask: "",
  subnetv6: "",
  start: "",
  end: "",
  proto: "tcp",
  port: null,
  client_auth: 1,
  cert: "",
  key: "",
  auth: "SHA256",
  cipher: "AES-256-GCM",
  lzo: false,
  dh: "",
  ca: "",
  hmac: false,
  ta: "",
  client_to_client: false,
  verb: "0",
  tap_address: "",
  tap_mask: ""
}
```

**Note:** On submission, the form is processed:
- `subnetv4` CIDR is split into `subnetv4` (IP only) and `mask` (converted from CIDR)
- TUN mode sends `subnetv4`, `mask`, `subnetv6`
- TAP-S2S mode sends `tap_address`, `tap_mask`, `start`, `end`
- Empty string fields are excluded

**RPC call:** `i("call", ["sid", "ovpn-server", "set_config", params], {timeout: 300000})`

---

### ovpn-server.set_setting

Updates OpenVPN server operational settings (options).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `killswitch` | boolean | `true` | Enable kill switch |
| `mtu` | number/null | `null` | Custom MTU |
| `local_access` | boolean | `false` | Allow local network access |
| `masq` | boolean | `false` | Enable IP masquerading |
| `client_to_client` | boolean | `false` | Allow client-to-client communication |
| `service_policy` | boolean | `false` | Enable service policy |

**Form definition:**
```js
settingForm: {
  killswitch: true,
  mtu: null,
  local_access: false,
  masq: false,
  client_to_client: false,
  service_policy: false
}
```

**RPC call:** `i("call", ["sid", "ovpn-server", "set_setting", params], {timeout: 30000})`

---

### ovpn-server.add_user

Adds a new user to the OpenVPN server.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `username` | string | *required* | Username (max 64 bytes, trimmed) |
| `password` | string | *required* | Password (max 64 chars, trimmed) |

**Form definition:**
```js
userForm: {
  username: "",
  password: ""
}
```

**RPC call:** `i("call", ["sid", "ovpn-server", "add_user", {username, password}])`

---

### ovpn-server.remove_user

Removes a user from the OpenVPN server.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `username` | string | | Username to remove (omit if using `all`) |
| `password` | string | | Password of user to remove |
| `all` | boolean | | Set to `true` to remove all users |

**RPC call:** `i("call", ["sid", "ovpn-server", "remove_user", params])`

**Note:** Either `username`+`password` or `all: true` must be provided.

---

### ovpn-server.generate_certificate

Generates/regenerates the OpenVPN server's TLS certificates. Used during initial server setup.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ca` | string | | CA certificate content (optional, for custom CA) |
| `dh` | string | | DH parameters content (optional, for custom DH) |

**Form definition:**
```js
initServerForm: {
  ca: "",
  dh: ""
}
```

**Note:** Empty fields are excluded from the request. If both are empty, the server generates all certificates from scratch.

**RPC call:** `i("call", ["sid", "ovpn-server", "generate_certificate", params], {timeout: 180000})`

---

### ovpn-server.export_config

Exports an OpenVPN client configuration file (.ovpn) for connecting to this server.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `address` | array | *required* | Array of server addresses/hostnames for the client to connect to |

**RPC call:** `i("call", ["sid", "ovpn-server", "export_config", {address: [exportAddress]}])`

**Note:** After the RPC call succeeds, the UI downloads the file from `/etc/openvpn/ovpn/client.ovpn`.

---

## Shared Structures

### Options/Settings Form (shared by wg-server, ovpn-server, vpn-client)

The options dialog is reused across VPN types with the same form structure:

```js
settingForm: {
  killswitch: true,         // Kill internet if VPN drops
  mtu: null,                // Custom MTU (null = auto)
  local_access: false,      // Allow LAN access while VPN active
  masq: false,              // IP masquerading
  client_to_client: false,  // Client-to-client routing
  service_policy: false     // Service policy mode
}
```

The `OptionsSettingDialog` component accepts a `type` prop with valid values: `"vpnclient"`, `"wgserver"`, `"ovpnserver"`.

### Group Types (shared by wg-client, ovpn-client)

```js
GROUPTYPE = {
  PROVIDE: 1,   // Third-party VPN provider (e.g., NordVPN, Mullvad)
  CUSTOM: 2,    // User-uploaded custom configs
  APP: 3        // App-based provider
}
```

### VPN Protocol Types

```js
{wireguard: "WireGuard", openvpn: "OpenVPN"}
```

### Tunnel Status Constants

```js
STATUS = {
  DISCONNECTED: 0,
  CONNECTED: 1,
  CONNECTING: 2
}
```
