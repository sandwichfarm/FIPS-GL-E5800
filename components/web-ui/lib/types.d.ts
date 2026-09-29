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
/**
 * Parameters for system.set_password
 * @typedef {object} SetPasswordParams
 * @property {string} old_password - Current password
 * @property {string} new_password - New password
 * @property {string} [username="root"] - Username
 */
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
/**
 * Parameters for qos.set_speed_limit_rule
 * @typedef {object} SetSpeedLimitRuleParams
 * @property {string} mac - Client MAC address
 * @property {number} [upload=0] - Upload speed limit in bytes/sec (0 = unlimited)
 * @property {number} [download=0] - Download speed limit in bytes/sec (0 = unlimited)
 */
/**
 * Parameters for tailscale.set_config
 * @typedef {object} TailscaleSetConfigParams
 * @property {boolean} enabled - Enable or disable Tailscale
 * @property {boolean} [lan_enabled=false] - Allow LAN access to Tailscale network
 * @property {boolean} [wan_enabled=false] - Allow WAN access via Tailscale
 * @property {string} [exit_node_ip=""] - Exit node IP address (empty = no exit node)
 */
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
/**
 * Parameters for plugins.install_package
 * @typedef {object} PluginsInstallParams
 * @property {string[]} name - Array of package names to install
 */
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
declare const _exports: {};
export = _exports;
export type SystemGetInfo = {
    board_info: BoardInfo;
    /**
     * - e.g. "4.8.1"
     */
    firmware_version: string;
    /**
     * - e.g. "release8"
     */
    firmware_type: string;
    /**
     * - e.g. "94:83:C4:xx:xx:xx"
     */
    mac: string;
    /**
     * - Serial number
     */
    sn: string;
    /**
     * - Number of CPU cores
     */
    cpu_num: number;
    /**
     * - e.g. "DE", "US"
     */
    country_code: string;
    /**
     * - e.g. "GL.iNet"
     */
    vendor: string;
    hardware_version: string;
    hardware_feature: HardwareFeature;
    software_feature: SoftwareFeature;
    hidden_features: string[];
    ddns: boolean;
};
export type BoardInfo = {
    /**
     * - e.g. "GL-MT3000"
     */
    hostname: string;
    /**
     * - e.g. "GL-MT3000"
     */
    model: string;
    /**
     * - e.g. "ARMv8 Processor rev 4"
     */
    architecture: string;
    /**
     * - e.g. "5.4.211"
     */
    kernel_version: string;
    /**
     * - e.g. "OpenWrt 21.02-SNAPSHOT"
     */
    openwrt_version: string;
};
export type HardwareFeature = {
    /**
     * - Has fan control
     */
    fan: boolean;
    /**
     * - Has MCU
     */
    mcu: boolean;
    /**
     * - Has Bluetooth
     */
    bluetooth: boolean;
    /**
     * - LED disabled
     */
    noled: boolean;
    /**
     * - NAND flash
     */
    nand: boolean;
    /**
     * - Has GPS
     */
    gps: boolean;
    /**
     * - Has screen
     */
    screen: boolean;
    /**
     * - Hardware NAT support
     */
    hwnat: boolean;
    /**
     * - WDS disabled
     */
    nowds: boolean;
    /**
     * - SIM only
     */
    simo: boolean;
    /**
     * - Has RS485
     */
    rs485: boolean;
    /**
     * - WAN interface (e.g. "eth0")
     */
    wan: string;
    /**
     * - LAN interface (e.g. "eth1")
     */
    lan: string;
    /**
     * - USB ports (e.g. "1-1,2-1")
     */
    usb: string;
    /**
     * - USB3 port (e.g. "2-1")
     */
    usb3: string;
    /**
     * - Radio modules
     */
    radio: string;
    /**
     * - Built-in modem
     */
    build_in_modem: string;
    /**
     * - SIM slot type (e.g. "single")
     */
    slot: string;
    /**
     * - GPIO for reset
     */
    reset_button: string;
    /**
     * - GPIO for switch
     */
    switch_button: string;
    /**
     * - MicroSD slot
     */
    microsd: string;
    /**
     * - USB power control
     */
    usb_power: string;
    /**
     * - USB reset
     */
    usb_reset: string;
    submodel: string;
    modem_reset: number;
};
export type SoftwareFeature = {
    vpn: boolean;
    tor: boolean;
    nas: boolean;
    /**
     * - AdGuard Home
     */
    adguard: boolean;
    ipv6: boolean;
    passthrough: boolean;
    /**
     * - WPA Enterprise repeater
     */
    repeater_eap: boolean;
    /**
     * - IDS/IPS
     */
    ids_ips: boolean;
    sms_forward: boolean;
    cellular_upgrade: boolean;
    secondwan: boolean;
    mlo: boolean;
    ksmbd: boolean;
    bark: boolean;
};
export type SystemGetStatus = {
    system: SystemStatus;
    network: NetworkInterface[];
    wifi: WifiInterface[];
    service: Service[];
    client: ClientCount[];
};
export type SystemStatus = {
    /**
     * - Seconds since boot (float)
     */
    uptime: number;
    /**
     * - Unix timestamp
     */
    timestamp: number;
    /**
     * - Timezone offset (e.g. "+0200")
     */
    tzoffset: string;
    /**
     * - 0=router, 1=wds, 2=relay, 3=mesh, 4=ap, 6=passthrough
     */
    mode: number;
    /**
     * - LAN IP address (e.g. "192.168.14.1")
     */
    lan_ip: string;
    /**
     * - (e.g. "255.255.255.0")
     */
    lan_netmask: string;
    /**
     * - Guest network IP (e.g. "192.168.9.1")
     */
    guest_ip: string;
    guest_netmask: string;
    cpu: CpuStatus;
    /**
     * - Flash total in bytes
     */
    flash_total: number;
    /**
     * - Flash free in bytes
     */
    flash_free: number;
    /**
     * - Flash used by apps in bytes
     */
    flash_app: number;
    /**
     * - RAM total in bytes
     */
    memory_total: number;
    /**
     * - RAM free in bytes
     */
    memory_free: number;
    /**
     * - RAM buffered/cached in bytes
     */
    memory_buff_cache: number;
    /**
     * - System load [1min, 5min, 15min] as floats
     */
    load_average: number[];
    /**
     * - Hardware NAT enabled
     */
    netnat_enabled: boolean;
    ipv6_enabled: boolean;
    ddns_enabled: boolean;
};
export type CpuStatus = {
    /**
     * - CPU temperature in Celsius
     */
    temperature: number;
};
export type ClientCount = {
    wireless_total: number;
    cable_total: number;
};
export type NetworkInterface = {
    /**
     * - Interface name (e.g. "wan", "wwan")
     */
    interface: string;
    /**
     * - Interface is up
     */
    up: boolean;
    /**
     * - Has internet connectivity
     */
    online: boolean;
};
export type WifiInterface = {
    /**
     * - Network name
     */
    ssid: string;
    /**
     * - "2G" or "5G"
     */
    band: string;
    /**
     * - Wi-Fi channel
     */
    channel: number;
    /**
     * - e.g. "sae-mixed"
     */
    encryption: string;
    /**
     * - Wi-Fi password
     */
    passwd: string;
    /**
     * - SSID hidden
     */
    hidden: boolean;
    /**
     * - Is guest network
     */
    guest: boolean;
    /**
     * - Radio is up
     */
    up: boolean;
    /**
     * - Internal name (e.g. "wifi2g")
     */
    name: string;
    /**
     * - Multi-Link Device
     */
    mld: boolean;
};
export type Service = {
    /**
     * - Service name (e.g. "wireguard", "openvpn", "adguardhome")
     */
    name: string;
    /**
     * - 0=stopped, 1=running
     */
    status: number;
};
export type ClientsGetStatus = {
    /**
     * - Number of wireless clients
     */
    wireless_total: number;
    /**
     * - Number of wired clients
     */
    cable_total: number;
};
export type WifiGetStatus = {
    res: WifiRadio[];
};
export type WifiRadio = {
    /**
     * - e.g. "ready"
     */
    state: string;
    /**
     * - Radio name (e.g. "mt798111")
     */
    name: string;
    /**
     * - Current channel
     */
    channel?: number;
};
export type TailscaleGetStatus = {
    /**
     * - DNS servers (e.g. ["192.168.1.67", "1.1.1.1"])
     */
    dns: string[];
};
export type TailscaleGetConfig = {
    enabled: boolean;
    /**
     * - Allow Tailscale over WAN
     */
    wan_enabled: boolean;
    /**
     * - Allow LAN access via Tailscale
     */
    lan_enabled: boolean;
    /**
     * - LAN subnet (e.g. "192.168.14.0/24")
     */
    lan_ip: string;
};
export type DnsGetConfig = {
    /**
     * - DNS mode
     */
    mode: string;
    rebind_protection: boolean;
    dns_over_tls: boolean;
    custom_dns_1?: string;
    custom_dns_2?: string;
    override_client_dns: boolean;
    fallback_dns: boolean;
    /**
     * - Available DNS servers
     */
    dns_server_list: DnsServer[];
    dnscrypt_version: number;
};
export type DnsServer = {
    /**
     * - Server name (e.g. "quad9-dnscrypt-ip6-filter-pri")
     */
    name: string;
    /**
     * - "DNSCrypt" or "DoH"
     */
    proto: string;
    /**
     * - No logging policy
     */
    nolog: boolean;
    /**
     * - No filtering
     */
    nofilter: boolean;
    /**
     * - IPv6 support
     */
    ipv6: boolean;
    /**
     * - DNSSEC support
     */
    dnssec: boolean;
};
export type DdnsGetStatus = {
    /**
     * - 0=disabled, 1=updating, 2=active
     */
    status: number;
    /**
     * - IP addresses per interface
     */
    ips: DdnsIp[];
};
export type DdnsIp = {
    /**
     * - e.g. "wan", "wan6"
     */
    interface: string;
    /**
     * - IP addresses
     */
    ip: string[];
};
export type DdnsGetConfig = {
    enable_ddns: boolean;
    /**
     * - GL.iNet device ID (e.g. "ik69035")
     */
    device_id: string;
};
export type AdGuardHomeGetConfig = {
    enabled: boolean;
    dns_enabled: boolean;
};
export type RepeaterGetStatus = {
    /**
     * - 0=idle, 1=connecting, 2=connected
     */
    state: number;
    /**
     * - "idle", "connecting", "connected"
     */
    state_s: string;
    /**
     * - Repeater process running
     */
    running: boolean;
    /**
     * - Connected SSID (when state=2)
     */
    ssid?: string;
    /**
     * - Connected BSSID
     */
    bssid?: string;
    /**
     * - Signal strength in dBm
     */
    signal?: number;
    /**
     * - Connected channel
     */
    channel?: number;
    /**
     * - DFS channel
     */
    dfs?: boolean;
    /**
     * - Channel width (e.g. "HE80")
     */
    htmode?: string;
    /**
     * - Radio device name
     */
    device?: string;
    /**
     * - Network interface (e.g. "wwan")
     */
    network?: string;
    /**
     * - Repeater MAC address
     */
    macaddr?: string;
    /**
     * - Connection duration (e.g. "52m,41s")
     */
    connected?: string;
    /**
     * - Bare mode active
     */
    bare_mode?: boolean;
    /**
     * - Captive portal detected
     */
    portal?: boolean;
    /**
     * - Failure reason if disconnected
     */
    fail_type?: string;
    /**
     * - IP info when connected
     */
    ipv4?: {
        gateway: string;
        dns: string[];
        ip: string;
    };
    /**
     * - Active connection config (ssid, key, protocol, macaddr)
     */
    config?: object;
};
export type RepeaterGetConfig = {
    /**
     * - Repeater MAC address
     */
    macaddr: string;
    /**
     * - Auto-connect (1=enabled)
     */
    auto: number;
    /**
     * - DFS channel support
     */
    dfs_support: boolean;
};
export type TorGetConfig = {
    enable: boolean;
    /**
     * - Manual exit node selection
     */
    manual: boolean;
    /**
     * - Selected exit node countries
     */
    countries: string[];
};
export type UpgradeGetConfig = {
    /**
     * - Allow release candidate upgrades
     */
    rc_upgrade: boolean;
    /**
     * - Show upgrade prompt
     */
    prompt: boolean;
};
export type CloudGetConfig = {
    cloud_enable: boolean;
    /**
     * - Remote web terminal
     */
    rtty_web: boolean;
    /**
     * - Remote SSH terminal
     */
    rtty_ssh: boolean;
    token_invalid: boolean;
    /**
     * - AstroWarp URL
     */
    aw_url: string;
    /**
     * - AstroWarp API URL
     */
    aw_api_url: string;
    /**
     * - Available regions (e.g. ["Europe", "America", "Asia Pacific"])
     */
    serverzones: string[];
};
export type FanGetStatus = {
    /**
     * - Fan speed in RPM
     */
    speed: number;
    /**
     * - Current temperature
     */
    temperature?: number;
};
export type FanGetConfig = {
    /**
     * - Temperature threshold for fan activation
     */
    temperature: number;
    /**
     * - Warning temperature
     */
    warn_temperature: number;
};
export type LedGetConfig = {
    /**
     * - LED enabled
     */
    enabled: boolean;
};
export type AddPortForwardParams = {
    /**
     * - Rule name / label
     */
    name: string;
    /**
     * - Protocol: "tcp udp", "tcp", or "udp"
     */
    proto?: string;
    /**
     * - Destination zone (internal zone name)
     */
    dest: string;
    /**
     * - Destination IP address (LAN device)
     */
    dest_ip: string;
    /**
     * - Destination port(s)
     */
    dest_port: string;
    /**
     * - Source zone (external zone name)
     */
    src: string;
    /**
     * - Source (external) port(s)
     */
    src_dport: string;
    /**
     * - Whether the rule is enabled
     */
    enabled?: boolean;
};
export type SetDmzParams = {
    /**
     * - Enable or disable DMZ
     */
    enabled: boolean;
    /**
     * - DMZ host IP (only when enabled is true)
     */
    dest_ip?: string;
    /**
     * - DMZ priority over port forwards (only when enabled)
     */
    priority?: boolean;
};
export type SetWanAccessParams = {
    /**
     * - Enable remote HTTPS access
     */
    enable_https?: boolean;
    /**
     * - Enable remote ping (ICMP)
     */
    enable_ping?: boolean;
    /**
     * - Enable remote SSH access
     */
    enable_ssh?: boolean;
    /**
     * - Enable IP whitelist restriction
     */
    enable_whitelist?: boolean;
    /**
     * - Array of whitelist entries
     */
    whitelist?: WanAccessWhitelistEntry[];
};
export type WanAccessWhitelistEntry = {
    /**
     * - Label for the entry
     */
    name: string;
    /**
     * - IP address or CIDR
     */
    ipaddr: string;
};
export type SetWifiConfigParams = {
    /**
     * - Interface name (e.g. "wlan0", "wlan1", "guest0")
     */
    iface_name: string;
    /**
     * - Network name (SSID)
     */
    ssid?: string;
    /**
     * - Encryption mode: "none", "psk2", "psk-mixed", "sae", "sae-mixed"
     */
    encryption?: string;
    /**
     * - Whether the SSID is hidden
     */
    hidden?: boolean;
    /**
     * - Wi-Fi password (omitted when encryption is "none")
     */
    key?: string;
    /**
     * - Radio device name (omitted for guest interfaces)
     */
    device?: string;
    /**
     * - Hardware mode / band (omitted for guest interfaces)
     */
    hwmode?: string;
    /**
     * - Channel number; 0 = auto
     */
    channel?: number;
    /**
     * - Channel width: "HT20", "HT40", "VHT80", "VHT160", "HE80", "HE160", "EHT320"
     */
    htmode?: string;
    /**
     * - Transmit power level
     */
    txpower?: string;
    /**
     * - Enable random BSSID
     */
    random_bssid?: boolean;
    /**
     * - Enable/disable interface (used for quick toggle)
     */
    enabled?: boolean;
};
export type AddTunnelParams = {
    /**
     * - Tunnel display name
     */
    name?: string;
    /**
     * - Traffic source filter
     */
    from?: TunnelFrom;
    /**
     * - Traffic destination filter
     */
    to?: TunnelTo;
    /**
     * - VPN client configuration to route through
     */
    via: TunnelVia;
    /**
     * - Enable VPN kill switch
     */
    killswitch?: boolean;
};
export type TunnelFrom = {
    /**
     * - Source type: "default", "interface", "mac", "exclude_mac"
     */
    type?: string;
    /**
     * - List of MAC addresses (when type is "mac" or "exclude_mac")
     */
    mac_list?: string[];
    /**
     * - List of interfaces (when type is "interface")
     */
    interface_list?: string[];
};
export type TunnelTo = {
    /**
     * - Destination type: "default", "domain", "exclude_domain"
     */
    type?: string;
    /**
     * - Whether domain list is entered manually (vs URL)
     */
    manual?: boolean;
    /**
     * - Newline-separated domain list (when manual is true)
     */
    domain_list?: string;
    /**
     * - URL to fetch domain list from (when manual is false)
     */
    url?: string;
};
export type TunnelVia = {
    /**
     * - VPN type: "wireguard" or "openvpn"
     */
    type: string;
    /**
     * - Group ID of the VPN provider/config group
     */
    group_id: number;
    /**
     * - WireGuard peer ID (for WireGuard type)
     */
    peer_id?: number;
    /**
     * - OpenVPN client ID (for OpenVPN type)
     */
    client_id?: number;
};
export type SetTunnelParams = {
    /**
     * - ID of the tunnel to modify
     */
    tunnel_id: string | number;
    /**
     * - Updated tunnel name
     */
    name?: string;
    /**
     * - Traffic source filter
     */
    from?: TunnelFrom;
    /**
     * - Traffic destination filter
     */
    to?: TunnelTo;
    /**
     * - VPN client to route through
     */
    via?: TunnelVia;
    /**
     * - Enable/disable the tunnel
     */
    enabled?: boolean;
};
export type WgClientAddConfigParams = {
    /**
     * - Group to add the config to
     */
    group_id: number;
    /**
     * - Configuration display name
     */
    name?: string;
    /**
     * - IPv4 address with CIDR (e.g. "10.0.0.2/32")
     */
    address_v4?: string;
    /**
     * - IPv6 address with CIDR
     */
    address_v6?: string;
    /**
     * - WireGuard private key (Base64, 44 chars)
     */
    private_key?: string;
    /**
     * - Server's public key
     */
    public_key?: string;
    /**
     * - Server endpoint (host:port)
     */
    end_point?: string;
    /**
     * - Comma-separated DNS servers
     */
    dns?: string;
    /**
     * - Comma-separated allowed IPs (CIDR notation)
     */
    allowed_ips?: string;
    /**
     * - Pre-shared key (optional)
     */
    preshared_key?: string;
    /**
     * - Local listen port (1-65535, null = auto)
     */
    listen_port?: number | null;
    /**
     * - Keepalive interval in seconds
     */
    persistent_keepalive?: number | null;
    /**
     * - Custom MTU value
     */
    mtu?: number | null;
};
export type WgServerSetConfigParams = {
    /**
     * - Server IPv4 address with CIDR (e.g. "10.0.0.1/24")
     */
    address_v4?: string;
    /**
     * - Server IPv6 address with CIDR (e.g. "fd00::1/64")
     */
    address_v6?: string;
    /**
     * - Listen port (1-65535)
     */
    port?: number | null;
    /**
     * - Server private key
     */
    private_key?: string;
};
export type WgServerAddPeerParams = {
    /**
     * - Peer display name
     */
    name?: string;
    /**
     * - Comma-separated allowed IPs in CIDR notation
     */
    allowed_ips?: string;
    /**
     * - Comma-separated DNS servers
     */
    dns?: string;
    /**
     * - Pre-shared key
     */
    presharedkey?: string;
    /**
     * - Keepalive interval
     */
    persistent_keepalive?: string;
    /**
     * - Custom MTU
     */
    mtu?: string;
};
export type SetDnsConfigParams = {
    /**
     * - DNS mode: "auto", "manual", "proxy", "secure"
     */
    mode?: string;
    /**
     * - Force all DNS traffic through router
     */
    force_dns?: boolean;
    /**
     * - Enable DNS rebind protection
     */
    rebind_protection?: boolean;
    /**
     * - Override VPN DNS settings
     */
    override_vpn?: boolean;
    /**
     * - Array of DNS server IPs (mode-dependent: 1-4 for manual, 1 for proxy)
     */
    server?: string[];
    /**
     * - Secure DNS protocol: "DoT", "DoH", "DNSCrypt", "oDoH" (mode=secure)
     */
    proto?: string;
    /**
     * - DoT provider ID (mode=secure, proto=DoT)
     */
    dot_provider?: string;
    /**
     * - NextDNS configuration ID
     */
    nextdns_id?: string;
};
export type LanSetConfigParams = {
    /**
     * - Network interface: "lan" or "guest"
     */
    interface?: string;
    /**
     * - LAN/Guest IP address
     */
    ip?: string;
    /**
     * - Subnet mask
     */
    netmask?: string;
    /**
     * - AP isolation: 0 (off) or 1 (on)
     */
    ap_isolate?: number;
    /**
     * - WAN isolation (guest only): 0 (off) or 1 (on)
     */
    wan_isolate?: number;
    /**
     * - DHCP enable: 1 (on) or 0 (off)
     */
    enable?: number;
    /**
     * - DHCP lease time (e.g. "120m", "24h")
     */
    leasetime?: string;
    /**
     * - DHCP gateway IP
     */
    gateway?: string;
    /**
     * - DHCP range start IP
     */
    start?: string;
    /**
     * - DHCP range end IP
     */
    end?: string;
    /**
     * - DNS servers (1-2 entries)
     */
    dns?: string[];
};
export type AddStaticBindParams = {
    /**
     * - Client display name
     */
    name: string;
    /**
     * - MAC address
     */
    mac: string;
    /**
     * - Reserved IP address
     */
    ip: string;
};
export type SetPasswordParams = {
    /**
     * - Current password
     */
    old_password: string;
    /**
     * - New password
     */
    new_password: string;
    /**
     * - Username
     */
    username?: string;
};
export type LocalAccessSetConfigParams = {
    /**
     * - Enable SSH access
     */
    ssh_enabled?: boolean;
    /**
     * - SSH port
     */
    ssh_port?: number;
    /**
     * - HTTP port for admin panel
     */
    http_port?: number;
    /**
     * - HTTPS port for admin panel
     */
    https_port?: number;
    /**
     * - Redirect HTTP to HTTPS for admin panel
     */
    redirect_https?: boolean;
    /**
     * - Session timeout in seconds
     */
    session_timeout?: number;
    /**
     * - HTTP port for LuCI
     */
    luci_http_port?: number;
    /**
     * - HTTPS port for LuCI
     */
    luci_https_port?: number;
    /**
     * - Redirect HTTP to HTTPS for LuCI
     */
    luci_redirect_https?: boolean;
};
export type TimerSetParams = {
    /**
     * - Enable or disable the timer
     */
    enable: boolean;
    /**
     * - Hour to turn on (24h format, zero-padded)
     */
    turnon_hour?: string;
    /**
     * - Minute to turn on (zero-padded)
     */
    turnon_min?: string;
    /**
     * - Hour to turn off (24h format, zero-padded)
     */
    turnoff_hour?: string;
    /**
     * - Minute to turn off (zero-padded)
     */
    turnoff_min?: string;
    /**
     * - Days of week (0=Sunday, 6=Saturday)
     */
    week?: number[];
};
export type SetSpeedLimitRuleParams = {
    /**
     * - Client MAC address
     */
    mac: string;
    /**
     * - Upload speed limit in bytes/sec (0 = unlimited)
     */
    upload?: number;
    /**
     * - Download speed limit in bytes/sec (0 = unlimited)
     */
    download?: number;
};
export type TailscaleSetConfigParams = {
    /**
     * - Enable or disable Tailscale
     */
    enabled: boolean;
    /**
     * - Allow LAN access to Tailscale network
     */
    lan_enabled?: boolean;
    /**
     * - Allow WAN access via Tailscale
     */
    wan_enabled?: boolean;
    /**
     * - Exit node IP address (empty = no exit node)
     */
    exit_node_ip?: string;
};
export type RepeaterConnectParams = {
    /**
     * - WiFi network name
     */
    ssid: string;
    /**
     * - WiFi password (omitted if open network)
     */
    key?: string;
    /**
     * - 802.1X identity (enterprise auth)
     */
    identity?: string;
    /**
     * - Encryption type from scan result
     */
    encryption?: string;
    /**
     * - WiFi band (e.g. "2g", "5g")
     */
    band: string;
    /**
     * - WiFi channel from scan result
     */
    channel: number;
    /**
     * - BSSID from scan result
     */
    bssid: string;
    /**
     * - Save the AP for auto-reconnect
     */
    remember?: boolean;
    /**
     * - MAC address configuration
     */
    macaddr?: object;
};
export type PluginsInstallParams = {
    /**
     * - Array of package names to install
     */
    name: string[];
};
export type OvpnServerSetConfigParams = {
    /**
     * - Tunnel mode: "tun" or "tap-s2s"
     */
    mode?: string;
    /**
     * - Protocol: "tcp" or "udp"
     */
    proto?: string;
    /**
     * - Server listen port
     */
    port?: number | null;
    /**
     * - Client authentication mode
     */
    client_auth?: number;
    /**
     * - HMAC authentication algorithm
     */
    auth?: string;
    /**
     * - Encryption cipher
     */
    cipher?: string;
    /**
     * - Enable LZO compression
     */
    lzo?: boolean;
    /**
     * - Enable HMAC firewall
     */
    hmac?: boolean;
    /**
     * - Allow client-to-client communication
     */
    client_to_client?: boolean;
    /**
     * - IPv4 subnet (mode=tun)
     */
    subnetv4?: string;
    /**
     * - IPv4 subnet mask (mode=tun)
     */
    mask?: string;
    /**
     * - IPv6 subnet with CIDR (mode=tun)
     */
    subnetv6?: string;
};
export type VpnOptionsParams = {
    /**
     * - Tunnel ID (vpn-client only)
     */
    tunnel_id?: string | number;
    /**
     * - Enable kill switch
     */
    killswitch?: boolean;
    /**
     * - Custom MTU (null = auto)
     */
    mtu?: number | null;
    /**
     * - Allow local network access
     */
    local_access?: boolean;
    /**
     * - Enable IP masquerading
     */
    masq?: boolean;
    /**
     * - Allow client-to-client communication
     */
    client_to_client?: boolean;
    /**
     * - Enable service policy
     */
    service_policy?: boolean;
};
