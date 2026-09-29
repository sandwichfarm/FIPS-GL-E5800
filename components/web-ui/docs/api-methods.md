# Complete GL.iNet RPC API Reference

> 302 methods extracted from GL-MT3000 firmware 4.8.1 (all views).
> Of ~129 safe read methods, 122 confirmed working via live RPC.
> Methods marked [tested] have been confirmed working.
> Methods marked [write] modify router configuration.
>
> **Feature-gated methods** (return Method not found without specific hardware/packages):
> - `logread.get_config` — Method not found
> - `modem.get_apn_poll_enabled` — requires cellular modem
> - `bark.get_config` / `bark.get_status` — requires Bark parental control package
> - `mvas.get_connect_info` — requires multi-SIM hardware
> - `plugins.get_package_info` — requires `{name: "package-name"}` parameter
> - `mptun.get_token` — hangs/timeout (requires AstroWarp setup)

## system (9 methods)

| Method | Type | Description |
|--------|------|-------------|
| `system.get_status` | [tested] | Network, Wi-Fi, services, uptime, memory, CPU temp |
| `system.get_info` | [tested] | Board info, firmware, hardware/software features |
| `system.get_load` | [tested] | CPU load average |
| `system.get_timezone_config` | [tested] | Timezone settings |
| `system.get_usb3_disable` | [tested] | USB3 status |
| `system.set_timezone_config` | [write] | Set timezone |
| `system.set_usb3_disable` | [write] | Enable/disable USB3 |
| `system.set_password` | [write] | Change admin password |
| `system.reboot` | [write] | Reboot router |
| `system.reset_firmware` | [write] | Factory reset |

## vpn-client (17 methods)

| Method | Type | Description |
|--------|------|-------------|
| `vpn-client.get_status` | [tested] | Active VPN connections, TX/RX bytes |
| `vpn-client.get_all_config_list` | [tested] | All VPN configs (WireGuard + OpenVPN) |
| `vpn-client.get_tunnel` | [tested] | Get tunnel config |
| `vpn-client.get_connection_methods` | [tested] | Available connection methods |
| `vpn-client.get_vpn_using_status` | [tested] | Per-client VPN usage |
| `vpn-client.add_tunnel` | [write] | Add VPN tunnel |
| `vpn-client.set_tunnel` | [write] | Modify tunnel |
| `vpn-client.remove_tunnel` | [write] | Remove tunnel |
| `vpn-client.order_tunnel` | [write] | Reorder tunnels |
| `vpn-client.set_default_tunnel` | [write] | Set default tunnel |
| `vpn-client.set_global_mode` | [write] | Set VPN policy mode |
| `vpn-client.set_options` | [write] | Set VPN options |
| `vpn-client.set_tap_s2s` | [write] | Configure site-to-site |
| `vpn-client.set_single_mac` | [write] | VPN policy per MAC |
| `vpn-client.start_random_client` | [write] | Start random VPN client |
| `vpn-client.stop` | [write] | Stop VPN |
| `vpn-client.check_domain_online` | read | Check VPN domain reachability |

## wg-client (13 methods)

| Method | Type | Description |
|--------|------|-------------|
| `wg-client.get_group_list` | [tested] | WireGuard provider groups |
| `wg-client.get_config_list` | read | Configs in a group (needs group_id param) |
| `wg-client.add_group` | [write] | Add provider group |
| `wg-client.remove_group` | [write] | Remove group |
| `wg-client.set_group` | [write] | Edit group |
| `wg-client.add_config` | [write] | Add WireGuard config |
| `wg-client.remove_config` | [write] | Remove config |
| `wg-client.set_config` | [write] | Edit config |
| `wg-client.check_config` | read | Validate config |
| `wg-client.confirm_config` | [write] | Confirm config after check |
| `wg-client.clear_config_list` | [write] | Clear all configs in group |
| `wg-client.clear_user_pass` | [write] | Clear saved credentials |
| `wg_client.gen_key` | read | Generate WireGuard keypair |
| `wg_client.get_max_client` | read | Max client count |
| `wg_client.create_provider_account` | [write] | Create VPN provider account |
| `wg_client.get_provider_user_info` | read | Provider account info |
| `wg_client.update_provider_config` | [write] | Update provider configs |

## wg-server (13 methods)

| Method | Type | Description |
|--------|------|-------------|
| `wg-server.get_config` | [tested] | Server config |
| `wg-server.get_setting` | [tested] | Server settings |
| `wg-server.get_peer_list` | [tested] | Connected peers |
| `wg-server.set_config` | [write] | Set server config |
| `wg-server.set_setting` | [write] | Set server settings |
| `wg-server.set_peer` | [write] | Edit peer |
| `wg-server.add_peer` | [write] | Add peer |
| `wg-server.remove_peer` | [write] | Remove peer |
| `wg-server.generate_key` | read | Generate server key |
| `wg-server.generate_peer` | read | Generate peer config |
| `wg-server.generate_publickey` | read | Generate public key |
| `wg-server.start` | [write] | Start WG server |
| `wg-server.stop` | [write] | Stop WG server |

## ovpn-client (15 methods)

| Method | Type | Description |
|--------|------|-------------|
| `ovpn-client.get_group_list` | [tested] | OpenVPN provider groups |
| `ovpn-client.get_config_list` | read | Configs in group |
| `ovpn-client.get_recommend_config` | read | Recommended config |
| `ovpn-client.get_third_config` | read | Third-party configs |
| `ovpn-client.add_group` | [write] | Add group |
| `ovpn-client.remove_group` | [write] | Remove group |
| `ovpn-client.set_group` | [write] | Edit group |
| `ovpn-client.add_config` | [write] | Add config |
| `ovpn-client.remove_config` | [write] | Remove config |
| `ovpn-client.set_config` | [write] | Edit config |
| `ovpn-client.check_config` | read | Validate config |
| `ovpn-client.confirm_config` | [write] | Confirm after check |
| `ovpn-client.clear_config_list` | [write] | Clear configs |
| `ovpn-client.clear_user_pass` | [write] | Clear credentials |
| `ovpn_client.set_config_name` | [write] | Rename config |

## ovpn-server (9 methods)

| Method | Type | Description |
|--------|------|-------------|
| `ovpn-server.get_config` | [tested] | Server config |
| `ovpn-server.get_setting` | [tested] | Server settings |
| `ovpn-server.get_user_list` | [tested] | Connected users |
| `ovpn-server.set_config` | [write] | Set config |
| `ovpn-server.set_setting` | [write] | Set settings |
| `ovpn-server.add_user` | [write] | Add user |
| `ovpn-server.remove_user` | [write] | Remove user |
| `ovpn-server.export_config` | read | Export client config |
| `ovpn-server.generate_certificate` | [write] | Generate SSL cert |

## clients (5 methods)

| Method | Type | Description |
|--------|------|-------------|
| `clients.get_status` | [tested] | Wireless/wired client counts |
| `clients.get_list` | [tested] | Full client list with IP, MAC, name, traffic |
| `clients.set_info` | [write] | Set client name/info |
| `clients.remove_offline` | [write] | Remove offline clients |
| `clients.clean_traffic` | [write] | Reset traffic counters |

## wifi (6 methods)

| Method | Type | Description |
|--------|------|-------------|
| `wifi.get_status` | [tested] | Radio status |
| `wifi.get_config` | [tested] | Full Wi-Fi config (SSID, password, channel, etc.) |
| `wifi.set_config` | [write] | Set Wi-Fi config |
| `wifi.get_mlo_config` | read | Multi-Link Operation config |
| `wifi.set_mlo_config` | [write] | Set MLO config |
| `wifi.set_txpower` | [write] | Set transmit power |

## firewall (10 methods)

| Method | Type | Description |
|--------|------|-------------|
| `firewall.get_port_forward_list` | [tested] | Port forwarding rules |
| `firewall.get_rule_list` | [tested] | Firewall rules |
| `firewall.get_zone_list` | [tested] | Firewall zones |
| `firewall.get_dmz` | [tested] | DMZ config |
| `firewall.get_wan_access` | [tested] | WAN access settings |
| `firewall.add_port_forward` | [write] | Add port forward |
| `firewall.remove_port_forward` | [write] | Remove port forward |
| `firewall.set_port_forward` | [write] | Edit port forward |
| `firewall.order_port_forward` | [write] | Reorder port forwards |
| `firewall.add_rule` | [write] | Add firewall rule |
| `firewall.remove_rule` | [write] | Remove rule |
| `firewall.set_rule` | [write] | Edit rule |
| `firewall.set_dmz` | [write] | Set DMZ |
| `firewall.set_wan_access` | [write] | Set WAN access |

## dns (5 methods)

| Method | Type | Description |
|--------|------|-------------|
| `dns.get_config` | [tested] | DNS config + server list (DNSCrypt/DoH) |
| `dns.get_info` | [tested] | DNS resolver info |
| `dns.get_host` | [tested] | Custom DNS hosts |
| `dns.set_config` | [write] | Set DNS config |
| `dns.set_host` | [write] | Set custom host |

## network (7 methods)

| Method | Type | Description |
|--------|------|-------------|
| `network.get_advance_config` | [tested] | Advanced network settings |
| `network.get_netnat_config` | [tested] | Hardware NAT config |
| `network.get_arp_list` | [tested] | ARP table |
| `network.get_available_address_list` | read | Available address pools |
| `network.check_wan_cable` | [tested] | WAN cable detection |
| `network.set_advance_config` | [write] | Set advanced config |
| `network.set_netnat_config` | [write] | Set NAT config |

## lan (7 methods)

| Method | Type | Description |
|--------|------|-------------|
| `lan.get_config_list` | [tested] | LAN config |
| `lan.get_static_bind_list` | [tested] | Static DHCP bindings |
| `lan.get_wan_info` | [tested] | WAN info from LAN perspective |
| `lan.set_config` | [write] | Set LAN config |
| `lan.add_static_bind` | [write] | Add static DHCP binding |
| `lan.remove_static_bind` | [write] | Remove binding |
| `lan.set_static_bind` | [write] | Edit binding |

## repeater (10 methods)

| Method | Type | Description |
|--------|------|-------------|
| `repeater.get_status` | [tested] | Repeater state (idle/connecting/connected) |
| `repeater.get_config` | [tested] | Repeater config |
| `repeater.get_saved_ap_list` | [tested] | Saved Wi-Fi networks |
| `repeater.get_channel_prompt` | read | Channel prompt settings |
| `repeater.scan` | read | Scan for Wi-Fi networks |
| `repeater.connect` | [write] | Connect to network |
| `repeater.disconnect` | [write] | Disconnect |
| `repeater.remove_saved_ap` | [write] | Remove saved network |
| `repeater.set_config` | [write] | Set repeater config |
| `repeater.set_channel_prompt` | [write] | Set channel prompt |
| `repeater.enter_bare_mode` | [write] | Enter bare mode |
| `repeater.exit_bare_mode` | [write] | Exit bare mode |

## logread (9 methods)

| Method | Type | Description |
|--------|------|-------------|
| `logread.get_system_log` | read | System log (syslog) |
| `logread.get_kernel_log` | read | Kernel log (dmesg) |
| `logread.get_crash_log` | read | Crash log |
| `logread.get_nginx_log` | read | Nginx error log |
| `logread.get_esim_log` | read | eSIM log |
| `logread.get_module_name` | [tested] | Log module names |
| `logread.get_config` | read | Log config |
| `logread.set_config` | [write] | Set log config |
| `logread.export_logs` | read | Export all logs |
| `logread.remove_crash_log` | [write] | Clear crash log |

## Other modules

| Module | Methods | Description |
|--------|---------|-------------|
| `tailscale` | get_status, get_config, set_config, get_auth_url, get_exit_node_list, logout | Tailscale VPN |
| `zerotier` | get_config, get_status, set_config | ZeroTier VPN |
| `tor` | get_config, get_status, set_config | Tor proxy |
| `adguardhome` | get_config, set_config | AdGuard Home |
| `ddns` | get_status, get_config, set_config | Dynamic DNS |
| `upgrade` | get_config, set_config, check_firmware_online, check_firmware_local, check_cellular_online, check_cellular_local, get_online_upgrade_status, get_cellular_upgrade_status, reset_cellular_upgrade_status, upgrade_online, upgrade_local | Firmware upgrade |
| `cloud` | get_config, set_config, unbind | GL.iNet cloud / AstroWarp |
| `plugins` | get_list, get_config, get_package_info, get_repository_status, install_package, remove_package, set_config, update_repository | Package manager |
| `timer` | get_led, get_reboot, get_wifi, get_screen, set_led, set_reboot, set_wifi, set_screen | Scheduled tasks |
| `led` | get_config, set_config | LED control |
| `fan` | get_status, get_config, set_config | Fan control |
| `igmp` | get_config, set_config | IGMP proxy |
| `ipv6` | get_ipv6, set_ipv6 | IPv6 settings |
| `cable` | get_config, get_ports_config, get_ports_status, get_status, init_status, set_config, set_port_config, wan_proto_detect | Ethernet port config |
| `netmode` | get_mode, set_mode | Network mode (router/AP/bridge) |
| `parental-control` | 14 methods | Parental control rules and groups |
| `qos` | set_speed_limit_rule, remove_speed_limit_rule | QoS speed limits |
| `black_white_list` | get_config, set_config, set_single_mac | MAC filter lists |
| `switch-button` | get_config, get_funcs, set_config, check_sync_status | Physical button config |
| `local-access` | get_config, set_config | Local access settings |
| `luci` | get_status, install_luci, uninstall_luci | LuCI management |
| `modem` | 20+ methods | Cellular modem management |
| `sms-forward` | get_config, set_email, set_phone_number | SMS forwarding |
| `tethering` | get_config, get_status, set_connect, disconnect | USB tethering |
| `kmwan` | get_config, get_status, get_sensitivity, set_config, set_interface, set_sensitivity | Multi-WAN failover |
| `mptun` | get_config, get_token, set_config | AstroWarp tunnel |
| `edgerouter` | get_config, get_status, set_config | Edge router |
| `ui` | get_menu_list, get_remote_langs, set_lang, set_inited_internet, update_langs | UI settings |
| `rtty` | get_config, set_config | Remote terminal (web + SSH) — hidden module |
| `qos` | get_config, set_config | Quality of Service — hidden module |
| `black_white_list` | get_config, set_config, set_single_mac | MAC filter lists |

## Hidden Modules (not in any view, discovered by brute force)

| Method | Response |
|--------|----------|
| `rtty.get_config` | `{ web_enabled: false, ssh_enabled: false }` |
| `qos.get_config` | `{ enable: false, mode: "0" }` |

## Security Notes

The following sensitive data is returned in plain text by the RPC API:

- **Wi-Fi passwords** — `system.get_status` and `wifi.get_config` return `passwd`/`key` fields
- **Saved Wi-Fi passwords** — `repeater.get_saved_ap_list` returns `key` for all saved networks
- **OpenVPN DH parameters** — `ovpn-server.get_config` returns full DH key
- **WireGuard configs** — `vpn-client.get_all_config_list` returns endpoint, allowed IPs, DNS
- **DNS hosts file** — `dns.get_host` returns `/etc/hosts` content
- **WAN IP** — `cable.get_status` and `ddns.get_status` expose public IP
- **ARP table** — `network.get_arp_list` lists all devices on all interfaces
- **Client traffic history** — `clients.get_list` returns total TX/RX per device since first connection

Any plugin with a valid session token has **full read access** to all this data.
There is no per-module ACL — authentication grants access to everything.
