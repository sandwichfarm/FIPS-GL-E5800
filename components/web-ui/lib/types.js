/**
 * @fileoverview JSDoc type definitions for GL.iNet RPC API responses.
 * Based on live testing against GL-MT3000 firmware 4.8.1.
 *
 * This file exports nothing at runtime (module.exports = {}).
 * The typedefs below are for JSDoc/IDE autocompletion only.
 *
 * Usage in your code (JSDoc annotation, not a runtime import):
 *   @type {import('./types').SystemGetInfo}
 */

/**
 * Response from system.get_info
 * @typedef {object} SystemGetInfo
 * @property {BoardInfo} board_info
 * @property {string} firmware_version - e.g. "4.8.1"
 * @property {string} firmware_type - e.g. "release8"
 * @property {string} mac - e.g. "94:83:C4:xx:xx:xx"
 * @property {string} sn - Serial number
 * @property {number} cpu_num - Number of CPU cores
 * @property {string} country_code - e.g. "DE", "US"
 * @property {string} vendor - e.g. "GL.iNet"
 * @property {string} hardware_version
 * @property {HardwareFeature} hardware_feature
 * @property {SoftwareFeature} software_feature
 * @property {string[]} hidden_features
 * @property {boolean} ddns
 */

/**
 * @typedef {object} BoardInfo
 * @property {string} hostname - e.g. "GL-MT3000"
 * @property {string} model - e.g. "GL-MT3000"
 * @property {string} architecture - e.g. "ARMv8 Processor rev 4"
 * @property {string} kernel_version - e.g. "5.4.211"
 * @property {string} openwrt_version - e.g. "OpenWrt 21.02-SNAPSHOT"
 */

/**
 * @typedef {object} HardwareFeature
 * @property {boolean} fan - Has fan control
 * @property {boolean} mcu - Has MCU
 * @property {boolean} bluetooth - Has Bluetooth
 * @property {boolean} noled - LED disabled
 * @property {boolean} nand - NAND flash
 * @property {boolean} gps - Has GPS
 * @property {boolean} screen - Has screen
 * @property {boolean} hwnat - Hardware NAT support
 * @property {boolean} nowds - WDS disabled
 * @property {boolean} simo - SIM only
 * @property {boolean} rs485 - Has RS485
 * @property {string} wan - WAN interface (e.g. "eth0")
 * @property {string} lan - LAN interface (e.g. "eth1")
 * @property {string} usb - USB ports (e.g. "1-1,2-1")
 * @property {string} usb3 - USB3 port (e.g. "2-1")
 * @property {string} radio - Radio modules
 * @property {string} build_in_modem - Built-in modem
 * @property {string} slot - SIM slot type (e.g. "single")
 * @property {string} reset_button - GPIO for reset
 * @property {string} switch_button - GPIO for switch
 * @property {string} microsd - MicroSD slot
 * @property {string} usb_power - USB power control
 * @property {string} usb_reset - USB reset
 * @property {string} submodel
 * @property {number} modem_reset
 */

/**
 * @typedef {object} SoftwareFeature
 * @property {boolean} vpn
 * @property {boolean} tor
 * @property {boolean} nas
 * @property {boolean} adguard - AdGuard Home
 * @property {boolean} ipv6
 * @property {boolean} passthrough
 * @property {boolean} repeater_eap - WPA Enterprise repeater
 * @property {boolean} ids_ips - IDS/IPS
 * @property {boolean} sms_forward
 * @property {boolean} cellular_upgrade
 * @property {boolean} secondwan
 * @property {boolean} mlo
 * @property {boolean} ksmbd
 * @property {boolean} bark
 */

/**
 * Response from system.get_status
 * @typedef {object} SystemGetStatus
 * @property {SystemStatus} system
 * @property {NetworkInterface[]} network
 * @property {WifiInterface[]} wifi
 * @property {Service[]} service
 * @property {ClientCount[]} client
 */

/**
 * @typedef {object} SystemStatus
 * @property {number} uptime - Seconds since boot (float)
 * @property {number} timestamp - Unix timestamp
 * @property {string} tzoffset - Timezone offset (e.g. "+0200")
 * @property {number} mode - 0=router, 1=wds, 2=relay, 3=mesh, 4=ap, 6=passthrough
 * @property {string} lan_ip - LAN IP address (e.g. "192.168.14.1")
 * @property {string} lan_netmask - (e.g. "255.255.255.0")
 * @property {string} guest_ip - Guest network IP (e.g. "192.168.9.1")
 * @property {string} guest_netmask
 * @property {CpuStatus} cpu
 * @property {number} flash_total - Flash total in bytes
 * @property {number} flash_free - Flash free in bytes
 * @property {number} flash_app - Flash used by apps in bytes
 * @property {number} memory_total - RAM total in bytes
 * @property {number} memory_free - RAM free in bytes
 * @property {number} memory_buff_cache - RAM buffered/cached in bytes
 * @property {number[]} load_average - System load [1min, 5min, 15min] as floats
 * @property {boolean} netnat_enabled - Hardware NAT enabled
 * @property {boolean} ipv6_enabled
 * @property {boolean} ddns_enabled
 */

/**
 * @typedef {object} CpuStatus
 * @property {number} temperature - CPU temperature in Celsius
 */

/**
 * @typedef {object} ClientCount
 * @property {number} wireless_total
 * @property {number} cable_total
 */

/**
 * @typedef {object} NetworkInterface
 * @property {string} interface - Interface name (e.g. "wan", "wwan")
 * @property {boolean} up - Interface is up
 * @property {boolean} online - Has internet connectivity
 */

/**
 * @typedef {object} WifiInterface
 * @property {string} ssid - Network name
 * @property {string} band - "2G" or "5G"
 * @property {number} channel - Wi-Fi channel
 * @property {string} encryption - e.g. "sae-mixed"
 * @property {string} passwd - Wi-Fi password
 * @property {boolean} hidden - SSID hidden
 * @property {boolean} guest - Is guest network
 * @property {boolean} up - Radio is up
 * @property {string} name - Internal name (e.g. "wifi2g")
 * @property {boolean} mld - Multi-Link Device
 */

/**
 * @typedef {object} Service
 * @property {string} name - Service name (e.g. "wireguard", "openvpn", "adguardhome")
 * @property {number} status - 0=stopped, 1=running
 */

/**
 * Response from clients.get_status
 * @typedef {object} ClientsGetStatus
 * @property {number} wireless_total - Number of wireless clients
 * @property {number} cable_total - Number of wired clients
 */

/**
 * Response from wifi.get_status
 * @typedef {object} WifiGetStatus
 * @property {WifiRadio[]} res
 */

/**
 * @typedef {object} WifiRadio
 * @property {string} state - e.g. "ready"
 * @property {string} name - Radio name (e.g. "mt798111")
 * @property {number} [channel] - Current channel
 */

/**
 * Response from tailscale.get_status
 * @typedef {object} TailscaleGetStatus
 * @property {string[]} dns - DNS servers (e.g. ["192.168.1.67", "1.1.1.1"])
 */

/**
 * Response from tailscale.get_config
 * @typedef {object} TailscaleGetConfig
 * @property {boolean} enabled
 * @property {boolean} wan_enabled - Allow Tailscale over WAN
 * @property {boolean} lan_enabled - Allow LAN access via Tailscale
 * @property {string} lan_ip - LAN subnet (e.g. "192.168.14.0/24")
 */

/**
 * Response from dns.get_config
 * @typedef {object} DnsGetConfig
 * @property {string} mode - DNS mode
 * @property {boolean} rebind_protection
 * @property {boolean} dns_over_tls
 * @property {string} [custom_dns_1]
 * @property {string} [custom_dns_2]
 * @property {boolean} override_client_dns
 * @property {boolean} fallback_dns
 * @property {DnsServer[]} dns_server_list - Available DNS servers
 * @property {number} dnscrypt_version
 */

/**
 * @typedef {object} DnsServer
 * @property {string} name - Server name (e.g. "quad9-dnscrypt-ip6-filter-pri")
 * @property {string} proto - "DNSCrypt" or "DoH"
 * @property {boolean} nolog - No logging policy
 * @property {boolean} nofilter - No filtering
 * @property {boolean} ipv6 - IPv6 support
 * @property {boolean} dnssec - DNSSEC support
 */

/**
 * Response from ddns.get_status
 * @typedef {object} DdnsGetStatus
 * @property {number} status - 0=disabled, 1=updating, 2=active
 * @property {DdnsIp[]} ips - IP addresses per interface
 */

/**
 * @typedef {object} DdnsIp
 * @property {string} interface - e.g. "wan", "wan6"
 * @property {string[]} ip - IP addresses
 */

/**
 * Response from ddns.get_config
 * @typedef {object} DdnsGetConfig
 * @property {boolean} enable_ddns
 * @property {string} device_id - GL.iNet device ID (e.g. "ik69035")
 */

/**
 * Response from adguardhome.get_config
 * @typedef {object} AdGuardHomeGetConfig
 * @property {boolean} enabled
 * @property {boolean} dns_enabled
 */

/**
 * Response from repeater.get_status
 * @typedef {object} RepeaterGetStatus
 * @property {number} state - 0=idle, 1=connecting, 2=connected
 * @property {string} state_s - "idle", "connecting", "connected"
 * @property {boolean} running - Repeater process running
 * @property {string} [ssid] - Connected SSID (when state=2)
 * @property {string} [bssid] - Connected BSSID
 * @property {number} [signal] - Signal strength in dBm
 * @property {number} [channel] - Connected channel
 * @property {boolean} [dfs] - DFS channel
 * @property {string} [htmode] - Channel width (e.g. "HE80")
 * @property {string} [device] - Radio device name
 * @property {string} [network] - Network interface (e.g. "wwan")
 * @property {string} [macaddr] - Repeater MAC address
 * @property {string} [connected] - Connection duration (e.g. "52m,41s")
 * @property {boolean} [bare_mode] - Bare mode active
 * @property {boolean} [portal] - Captive portal detected
 * @property {string} [fail_type] - Failure reason if disconnected
 * @property {{gateway: string, dns: string[], ip: string}} [ipv4] - IP info when connected
 * @property {object} [config] - Active connection config (ssid, key, protocol, macaddr)
 */

/**
 * Response from repeater.get_config
 * @typedef {object} RepeaterGetConfig
 * @property {string} macaddr - Repeater MAC address
 * @property {number} auto - Auto-connect (1=enabled)
 * @property {boolean} dfs_support - DFS channel support
 */

/**
 * Response from tor.get_config
 * @typedef {object} TorGetConfig
 * @property {boolean} enable
 * @property {boolean} manual - Manual exit node selection
 * @property {string[]} countries - Selected exit node countries
 */

/**
 * Response from upgrade.get_config
 * @typedef {object} UpgradeGetConfig
 * @property {boolean} rc_upgrade - Allow release candidate upgrades
 * @property {boolean} prompt - Show upgrade prompt
 */

/**
 * Response from cloud.get_config
 * @typedef {object} CloudGetConfig
 * @property {boolean} cloud_enable
 * @property {boolean} rtty_web - Remote web terminal
 * @property {boolean} rtty_ssh - Remote SSH terminal
 * @property {boolean} token_invalid
 * @property {string} aw_url - AstroWarp URL
 * @property {string} aw_api_url - AstroWarp API URL
 * @property {string[]} serverzones - Available regions (e.g. ["Europe", "America", "Asia Pacific"])
 */

/**
 * Response from fan.get_status
 * @typedef {object} FanGetStatus
 * @property {number} speed - Fan speed in RPM
 * @property {number} [temperature] - Current temperature
 */

/**
 * Response from fan.get_config
 * @typedef {object} FanGetConfig
 * @property {number} temperature - Temperature threshold for fan activation
 * @property {number} warn_temperature - Warning temperature
 */

/**
 * Response from led.get_config
 * @typedef {object} LedGetConfig
 * @property {boolean} enabled - LED enabled
 */

// ═══════════════════════════════════════════════════════════════════════
// Write method parameter types
// ═══════════════════════════════════════════════════════════════════════

// ── Firewall ──────────────────────────────────────────────────────────

/**
 * Parameters for firewall.add_port_forward
 * @typedef {object} AddPortForwardParams
 * @property {string} name - Rule name / label
 * @property {string} [proto="tcp udp"] - Protocol: "tcp udp", "tcp", or "udp"
 * @property {string} dest - Destination zone (internal zone name)
 * @property {string} dest_ip - Destination IP address (LAN device)
 * @property {string} dest_port - Destination port(s)
 * @property {string} src - Source zone (external zone name)
 * @property {string} src_dport - Source (external) port(s)
 * @property {boolean} [enabled=true] - Whether the rule is enabled
 */

/**
 * Parameters for firewall.set_dmz
 * @typedef {object} SetDmzParams
 * @property {boolean} enabled - Enable or disable DMZ
 * @property {string} [dest_ip] - DMZ host IP (only when enabled is true)
 * @property {boolean} [priority=true] - DMZ priority over port forwards (only when enabled)
 */

/**
 * Parameters for firewall.set_wan_access
 * @typedef {object} SetWanAccessParams
 * @property {boolean} [enable_https=false] - Enable remote HTTPS access
 * @property {boolean} [enable_ping=false] - Enable remote ping (ICMP)
 * @property {boolean} [enable_ssh=false] - Enable remote SSH access
 * @property {boolean} [enable_whitelist=false] - Enable IP whitelist restriction
 * @property {WanAccessWhitelistEntry[]} [whitelist] - Array of whitelist entries
 */

/**
 * @typedef {object} WanAccessWhitelistEntry
 * @property {string} name - Label for the entry
 * @property {string} ipaddr - IP address or CIDR
 */

// ── Wi-Fi ─────────────────────────────────────────────────────────────

/**
 * Parameters for wifi.set_config (per-band/interface configuration)
 * @typedef {object} SetWifiConfigParams
 * @property {string} iface_name - Interface name (e.g. "wlan0", "wlan1", "guest0")
 * @property {string} [ssid] - Network name (SSID)
 * @property {string} [encryption] - Encryption mode: "none", "psk2", "psk-mixed", "sae", "sae-mixed"
 * @property {boolean} [hidden=false] - Whether the SSID is hidden
 * @property {string} [key] - Wi-Fi password (omitted when encryption is "none")
 * @property {string} [device] - Radio device name (omitted for guest interfaces)
 * @property {string} [hwmode] - Hardware mode / band (omitted for guest interfaces)
 * @property {number} [channel=0] - Channel number; 0 = auto
 * @property {string} [htmode] - Channel width: "HT20", "HT40", "VHT80", "VHT160", "HE80", "HE160", "EHT320"
 * @property {string} [txpower] - Transmit power level
 * @property {boolean} [random_bssid] - Enable random BSSID
 * @property {boolean} [enabled] - Enable/disable interface (used for quick toggle)
 */

// ── VPN Client (tunnels) ──────────────────────────────────────────────

/**
 * Parameters for vpn-client.add_tunnel
 * @typedef {object} AddTunnelParams
 * @property {string} [name=""] - Tunnel display name
 * @property {TunnelFrom} [from] - Traffic source filter
 * @property {TunnelTo} [to] - Traffic destination filter
 * @property {TunnelVia} via - VPN client configuration to route through
 * @property {boolean} [killswitch] - Enable VPN kill switch
 */

/**
 * @typedef {object} TunnelFrom
 * @property {string} [type="default"] - Source type: "default", "interface", "mac", "exclude_mac"
 * @property {string[]} [mac_list] - List of MAC addresses (when type is "mac" or "exclude_mac")
 * @property {string[]} [interface_list] - List of interfaces (when type is "interface")
 */

/**
 * @typedef {object} TunnelTo
 * @property {string} [type="default"] - Destination type: "default", "domain", "exclude_domain"
 * @property {boolean} [manual=true] - Whether domain list is entered manually (vs URL)
 * @property {string} [domain_list] - Newline-separated domain list (when manual is true)
 * @property {string} [url] - URL to fetch domain list from (when manual is false)
 */

/**
 * @typedef {object} TunnelVia
 * @property {string} type - VPN type: "wireguard" or "openvpn"
 * @property {number} group_id - Group ID of the VPN provider/config group
 * @property {number} [peer_id] - WireGuard peer ID (for WireGuard type)
 * @property {number} [client_id] - OpenVPN client ID (for OpenVPN type)
 */

/**
 * Parameters for vpn-client.set_tunnel
 * @typedef {object} SetTunnelParams
 * @property {string|number} tunnel_id - ID of the tunnel to modify
 * @property {string} [name] - Updated tunnel name
 * @property {TunnelFrom} [from] - Traffic source filter
 * @property {TunnelTo} [to] - Traffic destination filter
 * @property {TunnelVia} [via] - VPN client to route through
 * @property {boolean} [enabled] - Enable/disable the tunnel
 */

// ── WireGuard Client ──────────────────────────────────────────────────

/**
 * Parameters for wg-client.add_config
 * @typedef {object} WgClientAddConfigParams
 * @property {number} group_id - Group to add the config to
 * @property {string} [name=""] - Configuration display name
 * @property {string} [address_v4=""] - IPv4 address with CIDR (e.g. "10.0.0.2/32")
 * @property {string} [address_v6=""] - IPv6 address with CIDR
 * @property {string} [private_key=""] - WireGuard private key (Base64, 44 chars)
 * @property {string} [public_key=""] - Server's public key
 * @property {string} [end_point=""] - Server endpoint (host:port)
 * @property {string} [dns=""] - Comma-separated DNS servers
 * @property {string} [allowed_ips] - Comma-separated allowed IPs (CIDR notation)
 * @property {string} [preshared_key=""] - Pre-shared key (optional)
 * @property {number|null} [listen_port] - Local listen port (1-65535, null = auto)
 * @property {number|null} [persistent_keepalive] - Keepalive interval in seconds
 * @property {number|null} [mtu] - Custom MTU value
 */

// ── WireGuard Server ──────────────────────────────────────────────────

/**
 * Parameters for wg-server.set_config
 * @typedef {object} WgServerSetConfigParams
 * @property {string} [address_v4=""] - Server IPv4 address with CIDR (e.g. "10.0.0.1/24")
 * @property {string} [address_v6=""] - Server IPv6 address with CIDR (e.g. "fd00::1/64")
 * @property {number|null} [port] - Listen port (1-65535)
 * @property {string} [private_key=""] - Server private key
 */

/**
 * Parameters for wg-server.add_peer
 * @typedef {object} WgServerAddPeerParams
 * @property {string} [name=""] - Peer display name
 * @property {string} [allowed_ips] - Comma-separated allowed IPs in CIDR notation
 * @property {string} [dns=""] - Comma-separated DNS servers
 * @property {string} [presharedkey=""] - Pre-shared key
 * @property {string} [persistent_keepalive=""] - Keepalive interval
 * @property {string} [mtu=""] - Custom MTU
 */

// ── DNS ───────────────────────────────────────────────────────────────

/**
 * Parameters for dns.set_config
 * @typedef {object} SetDnsConfigParams
 * @property {string} [mode="auto"] - DNS mode: "auto", "manual", "proxy", "secure"
 * @property {boolean} [force_dns=false] - Force all DNS traffic through router
 * @property {boolean} [rebind_protection=false] - Enable DNS rebind protection
 * @property {boolean} [override_vpn=true] - Override VPN DNS settings
 * @property {string[]} [server] - Array of DNS server IPs (mode-dependent: 1-4 for manual, 1 for proxy)
 * @property {string} [proto] - Secure DNS protocol: "DoT", "DoH", "DNSCrypt", "oDoH" (mode=secure)
 * @property {string} [dot_provider] - DoT provider ID (mode=secure, proto=DoT)
 * @property {string} [nextdns_id] - NextDNS configuration ID
 */

// ── LAN / DHCP ────────────────────────────────────────────────────────

/**
 * Parameters for lan.set_config (LAN/Guest IP settings)
 * @typedef {object} LanSetConfigParams
 * @property {string} [interface] - Network interface: "lan" or "guest"
 * @property {string} [ip] - LAN/Guest IP address
 * @property {string} [netmask] - Subnet mask
 * @property {number} [ap_isolate] - AP isolation: 0 (off) or 1 (on)
 * @property {number} [wan_isolate] - WAN isolation (guest only): 0 (off) or 1 (on)
 * @property {number} [enable] - DHCP enable: 1 (on) or 0 (off)
 * @property {string} [leasetime] - DHCP lease time (e.g. "120m", "24h")
 * @property {string} [gateway] - DHCP gateway IP
 * @property {string} [start] - DHCP range start IP
 * @property {string} [end] - DHCP range end IP
 * @property {string[]} [dns] - DNS servers (1-2 entries)
 */

/**
 * Parameters for lan.add_static_bind
 * @typedef {object} AddStaticBindParams
 * @property {string} name - Client display name
 * @property {string} mac - MAC address
 * @property {string} ip - Reserved IP address
 */

// ── System ────────────────────────────────────────────────────────────

/**
 * Parameters for system.set_password
 * @typedef {object} SetPasswordParams
 * @property {string} old_password - Current password
 * @property {string} new_password - New password
 * @property {string} [username="root"] - Username
 */

// ── Local Access ──────────────────────────────────────────────────────

/**
 * Parameters for local-access.set_config
 * @typedef {object} LocalAccessSetConfigParams
 * @property {boolean} [ssh_enabled=false] - Enable SSH access
 * @property {number} [ssh_port=22] - SSH port
 * @property {number} [http_port=80] - HTTP port for admin panel
 * @property {number} [https_port=443] - HTTPS port for admin panel
 * @property {boolean} [redirect_https=false] - Redirect HTTP to HTTPS for admin panel
 * @property {number} [session_timeout=300] - Session timeout in seconds
 * @property {number} [luci_http_port=8080] - HTTP port for LuCI
 * @property {number} [luci_https_port=8443] - HTTPS port for LuCI
 * @property {boolean} [luci_redirect_https=false] - Redirect HTTP to HTTPS for LuCI
 */

// ── Timers ────────────────────────────────────────────────────────────

/**
 * Parameters for timer.set_led
 * @typedef {object} TimerSetParams
 * @property {boolean} enable - Enable or disable the timer
 * @property {string} [turnon_hour="07"] - Hour to turn on (24h format, zero-padded)
 * @property {string} [turnon_min="00"] - Minute to turn on (zero-padded)
 * @property {string} [turnoff_hour="22"] - Hour to turn off (24h format, zero-padded)
 * @property {string} [turnoff_min="00"] - Minute to turn off (zero-padded)
 * @property {number[]} [week] - Days of week (0=Sunday, 6=Saturday)
 */

// ── QoS ───────────────────────────────────────────────────────────────

/**
 * Parameters for qos.set_speed_limit_rule
 * @typedef {object} SetSpeedLimitRuleParams
 * @property {string} mac - Client MAC address
 * @property {number} [upload=0] - Upload speed limit in bytes/sec (0 = unlimited)
 * @property {number} [download=0] - Download speed limit in bytes/sec (0 = unlimited)
 */

// ── Tailscale ─────────────────────────────────────────────────────────

/**
 * Parameters for tailscale.set_config
 * @typedef {object} TailscaleSetConfigParams
 * @property {boolean} enabled - Enable or disable Tailscale
 * @property {boolean} [lan_enabled=false] - Allow LAN access to Tailscale network
 * @property {boolean} [wan_enabled=false] - Allow WAN access via Tailscale
 * @property {string} [exit_node_ip=""] - Exit node IP address (empty = no exit node)
 */

// ── Repeater ──────────────────────────────────────────────────────────

/**
 * Parameters for repeater.connect
 * @typedef {object} RepeaterConnectParams
 * @property {string} ssid - WiFi network name
 * @property {string} [key] - WiFi password (omitted if open network)
 * @property {string} [identity] - 802.1X identity (enterprise auth)
 * @property {string} [encryption] - Encryption type from scan result
 * @property {string} band - WiFi band (e.g. "2g", "5g")
 * @property {number} channel - WiFi channel from scan result
 * @property {string} bssid - BSSID from scan result
 * @property {boolean} [remember=true] - Save the AP for auto-reconnect
 * @property {object} [macaddr] - MAC address configuration
 */

// ── Plugins ───────────────────────────────────────────────────────────

/**
 * Parameters for plugins.install_package
 * @typedef {object} PluginsInstallParams
 * @property {string[]} name - Array of package names to install
 */

// ── OpenVPN Server ────────────────────────────────────────────────────

/**
 * Parameters for ovpn-server.set_config
 * @typedef {object} OvpnServerSetConfigParams
 * @property {string} [mode="tun"] - Tunnel mode: "tun" or "tap-s2s"
 * @property {string} [proto="tcp"] - Protocol: "tcp" or "udp"
 * @property {number|null} [port] - Server listen port
 * @property {number} [client_auth=1] - Client authentication mode
 * @property {string} [auth="SHA256"] - HMAC authentication algorithm
 * @property {string} [cipher="AES-256-GCM"] - Encryption cipher
 * @property {boolean} [lzo=false] - Enable LZO compression
 * @property {boolean} [hmac=false] - Enable HMAC firewall
 * @property {boolean} [client_to_client=false] - Allow client-to-client communication
 * @property {string} [subnetv4] - IPv4 subnet (mode=tun)
 * @property {string} [mask] - IPv4 subnet mask (mode=tun)
 * @property {string} [subnetv6] - IPv6 subnet with CIDR (mode=tun)
 */

// ── VPN Options (shared by vpn-client, wg-server, ovpn-server) ───────

/**
 * Parameters for vpn-client.set_options / wg-server.set_setting / ovpn-server.set_setting
 * @typedef {object} VpnOptionsParams
 * @property {string|number} [tunnel_id] - Tunnel ID (vpn-client only)
 * @property {boolean} [killswitch=true] - Enable kill switch
 * @property {number|null} [mtu] - Custom MTU (null = auto)
 * @property {boolean} [local_access=false] - Allow local network access
 * @property {boolean} [masq=false] - Enable IP masquerading
 * @property {boolean} [client_to_client=false] - Allow client-to-client communication
 * @property {boolean} [service_policy=false] - Enable service policy
 */

module.exports = {};
