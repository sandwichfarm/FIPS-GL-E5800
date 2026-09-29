# GL.iNet RPC/API Reference

## Overview

The GL.iNet admin panel communicates with the router backend via JSON-RPC over HTTP.
The frontend exposes a global Vue instance method for making API calls:

```js
this.$rpcRequest('call', ['sid', namespace, method, params])
```

The `"sid"` string is a placeholder that gets automatically replaced with the
current session token by the request interceptor.

---

## Call Format

```js
// Signature
this.$rpcRequest('call', ['sid', '<namespace>', '<method>', { ...params }])

// Returns a Promise that resolves with the result object.

// Examples
const info = await this.$rpcRequest('call', ['sid', 'system', 'get_info', {}]);
const status = await this.$rpcRequest('call', ['sid', 'system', 'get_status', {}]);
```

### What happens under the hood

`$rpcRequest` sends a POST to `/rpc` with this JSON-RPC 2.0 body:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "call",
  "params": ["<session_token>", "system", "get_info", {}]
}
```

The response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "board_info": { "hostname": "GL-MT3000", "model": "GL-MT3000" }, ... }
}
```

`$rpcRequest` unwraps the result automatically — you get the inner object directly.

---

## Using $axios

For non-RPC HTTP requests (e.g. file uploads, external APIs):

```js
const response = await this.$axios.post('/rpc', {
  jsonrpc: '2.0',
  id: 1,
  method: 'call',
  params: [this.$store.state.sid, 'system', 'get_info', {}]
});
const result = response.data.result;
```

Use `$rpcRequest` for standard RPC calls — it handles session tokens and error
handling automatically. Use `$axios` only when you need full control.

---

## Authentication

- On login, the backend returns a session ID (SID).
- The SID is stored as a cookie (`Admin-Token`) and is available through the
  admin runtime's `window.$getCookie` helper.
- `$rpcRequest` reads that cookie and replaces the `"sid"` placeholder with the
  real token automatically.
- Sessions expire after inactivity; the admin panel handles re-authentication.
- This protects `/rpc`, not an arbitrary plugin-owned CGI endpoint. See
  [Authentication for Custom Backends](backend-auth.md).

### Login Algorithm (for CLI tools)

```bash
# 1. Get challenge
curl -s http://ROUTER/rpc -d '{"jsonrpc":"2.0","id":1,"method":"challenge","params":{"username":"root"}}'
# => { result: { alg: 1|5|6, salt: "XXXX", nonce: "YYYY" } }

# 2. Compute hash: sha256(username + ":" + crypt(password, "$alg$salt$") + ":" + nonce)
# Parse ALG, SALT, and NONCE from the challenge JSON first.
case "$ALG" in 1|5|6) ;; *) echo "Unsupported challenge.alg: $ALG" >&2; exit 1;; esac
read -r -s -p 'Router password: ' PASSWORD; printf '\n'
CRYPTED=$(printf '%s' "$PASSWORD" | openssl passwd "-$ALG" -salt "$SALT" -stdin)
unset PASSWORD
HASH=$(printf '%s' "root:${CRYPTED}:${NONCE}" | shasum -a 256 | cut -d' ' -f1)

# 3. Login
curl -s http://ROUTER/rpc -d '{"jsonrpc":"2.0","id":2,"method":"login","params":{"username":"root","hash":"'$HASH'"}}'
# => { result: { sid: "SESSION_TOKEN" } }
```

---

## Important: Not All ubus Methods Are Proxied

GL.iNet's RPC layer does **not** expose standard OpenWrt ubus methods. It only
proxies GL.iNet's own methods (typically `get_status`, `get_config`, `get_info`).

Standard ubus calls that **do NOT work** via RPC:

- `system.board` -- "Method not found"
- `system.info` -- "Method not found"
- `network.status` -- "Method not found"

GL.iNet equivalents that **do work**:

- `system.get_info` -- returns board info, firmware, hardware features
- `system.get_status` -- returns uptime, network, wifi, services

If you call a non-proxied method, the admin panel shows a global error:
"Unknown error occurred. Please check the network environment or reboot the device."

Always wrap RPC calls in try/catch to prevent error popups from crashing your plugin.

---

## Vuex Store (Global State)

The admin panel pre-fetches system data into Vuex on page load. Access it directly
without making RPC calls — this is how GL.iNet's own pages get system data.

### this.$store.state.systemStatus

```js
{
  system: {
    mode: 0,              // 0=router, 1=wds, 2=relay, 3=mesh, 4=ap, 6=passthrough
    lan_ip: "192.168.14.1",
    lan_netmask: "255.255.255.0",
    guest_ip: "192.168.9.1",
    guest_netmask: "255.255.255.0",
    uptime: 77851.23,     // seconds since boot (float)
    timestamp: 1775935379,
    tzoffset: "+0200",
    cpu: { temperature: 59 },
    flash_total: 268435456,     // bytes (256 MB)
    flash_free: 160931840,      // bytes
    flash_app: 1699840,         // bytes
    memory_total: 503181312,    // bytes (480 MB)
    memory_free: 172847104,     // bytes
    memory_buff_cache: 120700928, // bytes
    load_average: [0.18, 0.32, 0.27],  // 1/5/15 min
    netnat_enabled: true,
    ipv6_enabled: false,
    ddns_enabled: false
  },
  network: [
    { interface: "wan", up: true, online: true },
    { interface: "wwan", up: false, online: false },
    { interface: "tethering", up: false, online: false }
  ],
  wifi: [
    { ssid: "MyNetwork", band: "2G", channel: 1, encryption: "sae-mixed",
      passwd: "secret", hidden: false, guest: false, name: "wifi2g", up: true, mld: false },
    { ssid: "MyNetwork", band: "5G", channel: 48, encryption: "sae-mixed",
      passwd: "secret", hidden: false, guest: false, name: "wifi5g", up: true, mld: false }
  ],
  service: [
    { name: "wgserver", status: 0 },
    { name: "ovpnserver", status: 0 },
    { name: "adguard", status: 0 },
    { name: "tor", status: 0 },
    { name: "tailscale", status: 0 },
    { name: "zerotier", status: 0 }
  ],
  client: [
    { wireless_total: 5, cable_total: 0 }
  ]
}

// NOTE: Wi-Fi passwords are returned in plain text in the passwd field!
```

### this.$store.state.systemInfo

```js
{
  board_info: {
    hostname: "GL-MT3000",
    model: "GL-MT3000",
    architecture: "ARMv8 Processor rev 4",
    kernel_version: "5.4.211",
    openwrt_version: "21.02-SNAPSHOT"
  },
  firmware_version: "4.8.1",
  firmware_type: "release",
  country_code: "us",
  mac: "94:83:C4:xx:xx:xx",
  sn: "...",
  cpu_num: 2,
  ddns: false,
  hardware_feature: {
    fan: false,            // has fan control
    mcu: false,            // has MCU
    noled: false,          // LED disabled
    build_in_modem: false  // has cellular modem
  },
  software_feature: {
    repeater_eap: false    // supports WPA Enterprise repeater
  },
  hidden_features: []      // features hidden in UI
}
```

### Other store state

```js
this.$store.state.lang            // "en", "zh-cn", "de", etc.
this.$store.state.theme           // "dark" or "light"
this.$store.state.model           // "GL-MT3000"
this.$store.state.is2c            // boolean, 2.4GHz only model
this.$store.state.screenWidth     // viewport width in pixels
this.$store.state.clientList      // connected device list
this.$store.state.initInfo        // initialization data
```

### Getting Uptime (the correct way)

Do NOT call `system.info` via RPC — it is not proxied and triggers an error popup.
Use the Vuex store:

```js
computed: {
  uptime() {
    const status = this.$store.state.systemStatus;
    if (!status || !status.system) return '--';
    const s = status.system.uptime;
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d + 'd ' + h + 'h ' + m + 'm';
  },
  cpuTemp() {
    const sys = (this.$store.state.systemStatus || {}).system || {};
    return sys.cpu ? sys.cpu.temperature + ' C' : '--';
  },
  lanIp() {
    const sys = (this.$store.state.systemStatus || {}).system || {};
    return sys.lan_ip || '--';
  }
}
```

---

## Known API Namespaces

The following RPC methods have been **confirmed working** by live testing
on GL-MT3000 firmware 4.8.1:

| Namespace | Confirmed Methods |
|-----------|-------------------|
| `system` | `get_status`, `get_info`, `get_load`, `get_timezone_config`, `get_usb3_disable` |
| `vpn-client` | `get_status`, `get_all_config_list`, `get_tunnel`, `get_connection_methods`, `get_vpn_using_status` |
| `wg-client` | `get_group_list` |
| `wg-server` | `get_config`, `get_setting`, `get_peer_list` |
| `ovpn-client` | `get_group_list` |
| `ovpn-server` | `get_config`, `get_setting`, `get_user_list` |
| `clients` | `get_status`, `get_list` |
| `wifi` | `get_status`, `get_config` |
| `firewall` | `get_port_forward_list`, `get_rule_list`, `get_zone_list`, `get_dmz`, `get_wan_access` |
| `network` | `get_advance_config`, `get_netnat_config`, `get_arp_list`, `check_wan_cable` |
| `lan` | `get_config_list`, `get_static_bind_list`, `get_wan_info` |
| `cable` | `get_config`, `get_ports_config`, `get_ports_status`, `get_status` |
| `dns` | `get_config`, `get_info`, `get_host` |
| `led` | `get_config` |
| `fan` | `get_status`, `get_config` |
| `ddns` | `get_status`, `get_config` |
| `tailscale` | `get_status`, `get_config` |
| `adguardhome` | `get_config` |
| `repeater` | `get_status`, `get_config`, `get_saved_ap_list` |
| `tor` | `get_status`, `get_config` |
| `upgrade` | `get_config` |
| `cloud` | `get_config` |
| `timer` | `get_led`, `get_reboot`, `get_wifi`, `get_screen` |
| `parental-control` | `get_config`, `get_status`, `get_mode` |
| `kmwan` | `get_config`, `get_status` |
| `plugins` | `get_config`, `get_repository_status` |
| `local-access` | `get_config` |
| `switch-button` | `get_config`, `get_funcs` |
| `edgerouter` | `get_config`, `get_status` |
| `tethering` | `get_config`, `get_status` |
| `ipv6` | `get_ipv6` |
| `igmp` | `get_config` |
| `ui` | `get_menu_list` |
| `logread` | `get_module_name` |
| `luci` | `get_status` |
| `netmode` | `get_mode` |
| `black_white_list` | `get_config` |
| `rtty` | `get_config` *(hidden module)* |
| `qos` | `get_config` *(hidden module)* |

**85 read methods confirmed** across 37 modules. See [api-methods.md](api-methods.md) for the full reference (302 methods discovered, ~295 working; 7 are feature-gated or require specific hardware/packages).

**Not available via RPC** (standard ubus methods are not proxied):

- `system.board`, `system.info` — use `system.get_info` instead
- `network.status` — use `system.get_status` (contains network array)
- `wireguard.*`, `openvpn.*` — use `vpn-client.*`, `wg-client.*`, `ovpn-client.*`

> Available namespaces vary by firmware version and installed packages.
> Use `glplugin extract --rpc` to discover methods from your firmware version.

### Commonly Used Calls

```js
// Get system status — network, wifi, services (CONFIRMED)
this.$rpcRequest('call', ['sid', 'system', 'get_status', {}])
// => { network: [{interface, up, online}], wifi: [{ssid, band, channel, encryption, passwd, guest}],
//      system: {uptime, lan_ip, cpu, flash_total, flash_free, ...}, service: [{name, status}] }

// Get device info — hardware, firmware, board (CONFIRMED)
this.$rpcRequest('call', ['sid', 'system', 'get_info', {}])
// => { board_info: {hostname, model, architecture, kernel_version, openwrt_version},
//      firmware_version, mac, sn, cpu_num, country_code,
//      hardware_feature: {fan, mcu, bluetooth, usb3, ...},
//      software_feature: {vpn, tor, nas, adguard, ipv6, ...} }

// Get connected client counts (CONFIRMED)
this.$rpcRequest('call', ['sid', 'clients', 'get_status', {}])
// => { wireless_total: 5, cable_total: 0 }

// Get Wi-Fi radio status (CONFIRMED)
this.$rpcRequest('call', ['sid', 'wifi', 'get_status', {}])
// => { res: [{state, name, channel}] }

// Get Wi-Fi config (CONFIRMED)
this.$rpcRequest('call', ['sid', 'wifi', 'get_config', {}])

// Get DNS config (CONFIRMED)
this.$rpcRequest('call', ['sid', 'dns', 'get_config', {}])

// Get Tailscale status (CONFIRMED)
this.$rpcRequest('call', ['sid', 'tailscale', 'get_status', {}])

// Get VPN connection status (CONFIRMED)
this.$rpcRequest('call', ['sid', 'vpn-client', 'get_status', {}])
// => { status_list: [{type, peer_name, domain, status, tx_bytes, rx_bytes, ipv4}], mode }

// Get all VPN configs (CONFIRMED)
this.$rpcRequest('call', ['sid', 'vpn-client', 'get_all_config_list', {}])
// => { configs: { wireguard: [...], openvpn: [...] } }

// Get full client list with traffic data (CONFIRMED)
this.$rpcRequest('call', ['sid', 'clients', 'get_list', {}])
// => { clients: [{ip, mac, name, iface, online, total_rx, total_tx, ...}] }

// Get ARP table (CONFIRMED)
this.$rpcRequest('call', ['sid', 'network', 'get_arp_list', {}])
// => { entries: [{ip, mac, device}] }

// Scan nearby Wi-Fi networks (CONFIRMED)
this.$rpcRequest('call', ['sid', 'repeater', 'scan', {}])
// => { res: [{ssid, signal, channel, band, encryption, bssid}] }

// Get firewall port forwards (CONFIRMED)
this.$rpcRequest('call', ['sid', 'firewall', 'get_port_forward_list', {}])

// Get WAN connection info (CONFIRMED)
this.$rpcRequest('call', ['sid', 'cable', 'get_status', {}])
// => { protocol, status, ipv4: {ip, gateway, dns} }
```

---

## Global Vue Instance Methods

| Method | Description |
|--------|-------------|
| `this.$rpcRequest(method, params)` | Make an RPC call (see above) |
| `this.$axios` | Axios HTTP client instance |
| `this.$t(key)` | i18n — returns translated string |
| `this.$locale()` | Get or set current locale |
| `this.$setTheme(name)` | Switch UI theme |
| `this.$message({ type, message })` | Show toast notification |
| `this.$store` | Vuex router state (available keys vary by firmware) |
| `this.$router` | Vue Router instance |
| `this.$route` | Current route object |

---

## Error Handling

```js
try {
  const data = await this.$rpcRequest('call', ['sid', 'system', 'get_info', {}]);
  this.systemInfo = data;
} catch (err) {
  this.$message({ type: 'error', message: 'Failed to load system info.' });
  console.error(err);
}
```

---

## VPN Control

**Important:** `vpn-client.stop` does NOT work (returns "parameter missing").
Use `vpn-client.set_tunnel` with `enabled: false/true` to control VPN:

```js
// Get current tunnels
const tunnels = await this.rpc('vpn-client', 'get_tunnel');
const tunnel = tunnels.tunnels[0];

// Disable VPN
tunnel.enabled = false;
await this.rpc('vpn-client', 'set_tunnel', tunnel);

// Re-enable VPN
tunnel.enabled = true;
await this.rpc('vpn-client', 'set_tunnel', tunnel);

// Check status
const status = await this.rpc('vpn-client', 'get_status');
// status.status_list[0].status: 1 = connected, 0 = disconnected
// status.status_list[0].enabled: true/false
```

---

## Node.js API Client

For scripts and CLI tools, use the stable root API:

```js
const { api } = require('gl-sdk4-plugin-kit');

const client = await api.createClient('192.168.8.1', 'password');

try {
  // ~300 methods available via namespaced API (some are feature-gated)
  const info = await client.system.getInfo();
  const clients = await client.clients.getList();
  const vpn = await client.vpnClient.getStatus();
  await client.firewall.addPortForward({ name: 'SSH', ... });

  // Raw RPC for edge cases
  const result = await client.rpc('custom-module', 'custom_method', { key: 'value' });
} finally {
  await client.close();
}
```

Authentication uses GL.iNet's challenge-response protocol
(Unix crypt selected by `challenge.alg`, followed by SHA-256). `close()` logs out
the router session and is safe to call more than once.

---

## Notes

- API namespaces and methods were discovered by reverse engineering firmware 4.8.1.
- Use `glplugin extract --rpc <router-ip>` to discover API calls on any firmware.
- Some methods require specific packages to be installed on the router.
- VPN modules use hyphenated names: `vpn-client`, `wg-client`, `wg-server`, `ovpn-client`, `ovpn-server`
- Standard OpenWrt ubus methods (`system.board`, `system.info`) are NOT available via GL.iNet RPC.
- Wi-Fi passwords are returned in plain text by `system.get_status` and `wifi.get_config`.
