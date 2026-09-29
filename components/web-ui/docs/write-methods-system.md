# System / Service / Control Write Methods

RPC write method parameter structures extracted from GL.iNet SDK4 UI source code.

All methods are called via: `call(["sid", "<module>", "<method>", <params>])`

---

## Table of Contents

- [wifi](#wifi)
- [system](#system)
- [led](#led)
- [fan](#fan)
- [timer](#timer)
- [plugins](#plugins)
- [parental-control](#parental-control)
- [clients](#clients)
- [qos](#qos)
- [black_white_list](#black_white_list)
- [switch-button](#switch-button)
- [tailscale](#tailscale)
- [zerotier](#zerotier)
- [tor](#tor)
- [adguardhome](#adguardhome)
- [ddns](#ddns)
- [cloud](#cloud)
- [rtty](#rtty)
- [upgrade](#upgrade)
- [ui](#ui)

---

## wifi

### `wifi.set_config`

Applies wireless radio and SSID configuration. The parameter object is constructed in the `applyConfig` method from form data.

| Parameter          | Type    | Default   | Description                                                    |
|--------------------|---------|-----------|----------------------------------------------------------------|
| `iface_name`       | string  | --        | Interface name (e.g., `"wlan0"`, `"wlan1"`, `"guest0"`)       |
| `ssid`             | string  | --        | Network name (SSID)                                            |
| `encryption`       | string  | --        | Encryption mode: `"none"`, `"psk2"`, `"psk-mixed"`, `"sae"`, `"sae-mixed"` |
| `hidden`           | boolean | `false`   | Whether the SSID is hidden                                     |
| `key`              | string  | --        | Wi-Fi password (omitted when `encryption` is `"none"`)         |
| `device`           | string  | --        | Radio device name (omitted for guest interfaces)               |
| `hwmode`           | string  | --        | Hardware mode / band (omitted for guest interfaces)            |
| `channel`          | number  | `0`       | Channel number; `0` = auto (omitted if repeater is using band) |
| `htmode`           | string  | --        | Channel width: `"HT20"`, `"HT40"`, `"VHT80"`, `"VHT160"`, `"HE80"`, `"HE160"`, `"EHT320"` (omitted if repeater is using band) |
| `txpower`          | string  | --        | Transmit power level (omitted for guest interfaces)            |
| `random_bssid`     | boolean | --        | Enable random BSSID (omitted for guest interfaces)             |
| `chan_6g_only_psc` | boolean | --        | 6 GHz PSC-only channels (only included for 6 GHz radios)      |
| `enabled`          | boolean | --        | Enable/disable a specific interface (used for quick toggle)    |

When toggling an interface on/off, only `iface_name` and `enabled` are sent.

### `wifi.set_txpower`

Sets the transmit power for a radio. The parameter is passed through from the txpowerChange handler.

| Parameter  | Type   | Default | Description                                   |
|------------|--------|---------|-----------------------------------------------|
| `txpower`  | string | --      | Transmit power level (from txpower list)      |
| `device`   | string | --      | Radio device name (e.g., `"radio0"`)          |

### `wifi.set_mlo_config`

Configures Multi-Link Operation (MLO) settings for Wi-Fi 7 devices. Two usage patterns:

**Toggle MLO on/off:**

| Parameter    | Type    | Default | Description                               |
|--------------|---------|---------|-------------------------------------------|
| `name`       | string  | --      | MLO interface name                        |
| `mlo_enable` | boolean | --      | Enable or disable MLO for this interface  |

**Full MLO configuration:** sends the full MLO interface config object with the same fields as `wifi.set_config` (ssid, encryption, key, hidden, etc.) plus MLO-specific fields.

---

## system

### `system.set_password`

Changes the admin password.

| Parameter      | Type   | Default | Description                          |
|----------------|--------|---------|--------------------------------------|
| `old_password` | string | --      | Current password                     |
| `new_password` | string | --      | New password                         |
| `username`     | string | --      | Username (typically `"root"`)        |

Error tips: error code `-1` maps to "old password error".

### `system.set_timezone_config`

Sets the router timezone.

| Parameter   | Type   | Default | Description                                              |
|-------------|--------|---------|----------------------------------------------------------|
| `zonename`  | string | --      | IANA timezone name (e.g., `"UTC"`, `"America/New_York"`, `"Europe/London"`) |
| `timezone`  | string | --      | POSIX timezone string (e.g., `"EST5EDT,M3.2.0,M11.1.0"`) |
| `localtime` | number | --      | Current local UNIX timestamp in seconds (optional, sent on auto-detect) |

The `zonename` and `timezone` values come from the internal timezone list mapping IANA names to POSIX strings.

### `system.set_usb3_disable`

Toggles USB 3.0 mode (disabling USB 3.0 can reduce radio interference on 2.4 GHz).

| Parameter      | Type    | Default | Description                                     |
|----------------|---------|---------|--------------------------------------------------|
| `usb3_disable` | boolean | --      | `true` to disable USB 3.0, `false` to enable    |

### `system.reboot`

Reboots the router.

| Parameter | Type   | Default | Description                         |
|-----------|--------|---------|-------------------------------------|
| `delay`   | number | `1`     | Delay in seconds before rebooting   |

### `system.reset_firmware`

Resets the router to factory defaults. No parameters required (empty object `{}`).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| (none)    | --   | --      | No parameters; sends `{}` |

---

## led

### `led.set_config`

Toggles the router LED on or off.

| Parameter    | Type    | Default | Description                   |
|--------------|---------|---------|-------------------------------|
| `led_enable` | boolean | --      | `true` to turn LED on, `false` to turn off |

---

## fan

### `fan.set_config`

Sets the fan temperature threshold (fan activates when CPU temperature exceeds this value).

| Parameter     | Type   | Default | Description                                        |
|---------------|--------|---------|----------------------------------------------------|
| `temperature` | number | `80`    | Temperature threshold in Celsius (range: 70 -- 90) |

---

## timer

### `timer.set_led`

Configures the scheduled LED on/off timer.

| Parameter      | Type     | Default                 | Description                                    |
|----------------|----------|-------------------------|------------------------------------------------|
| `enable`       | boolean  | `false`                 | Enable or disable the LED timer                |
| `turnon_hour`  | string   | `"07"`                  | Hour to turn LED on (24h format, zero-padded)  |
| `turnon_min`   | string   | `"00"`                  | Minute to turn LED on (zero-padded)            |
| `turnoff_hour` | string   | `"22"`                  | Hour to turn LED off (24h format, zero-padded) |
| `turnoff_min`  | string   | `"00"`                  | Minute to turn LED off (zero-padded)           |
| `week`         | number[] | `[0,1,2,3,4,5,6]`      | Days of week (0=Sunday, 6=Saturday)            |

### `timer.set_reboot`

Configures the scheduled auto-reboot timer.

| Parameter | Type     | Default            | Description                                       |
|-----------|----------|--------------------|---------------------------------------------------|
| `enable`  | boolean  | `false`            | Enable or disable the reboot timer                |
| `hour`    | string   | `"07"`             | Reboot hour (24h format, zero-padded; only when enabled) |
| `min`     | string   | `"00"`             | Reboot minute (zero-padded; only when enabled)    |
| `week`    | number[] | `[0,1,2,3,4,5,6]` | Days of week, sorted ascending (only when enabled) |

When `enable` is `false`, only `enable` is sent.

### `timer.set_wifi`

Configures scheduled Wi-Fi on/off timers. Sends an array of timer config objects (one per band/function).

Each element in the array:

| Parameter       | Type     | Default            | Description                                                  |
|-----------------|----------|--------------------|--------------------------------------------------------------|
| `band`          | string   | --                 | Radio band: `"2G"`, `"5G"`, `"6G"` (uppercase)              |
| `enable`        | boolean  | `false`            | Enable or disable this Wi-Fi timer                           |
| `guest`         | number   | `0`                | `0` for main SSID, `1` for guest SSID                       |
| `func`          | string   | `""`               | Timer function: `""` (on/off toggle) or `"power_switch"` (power level switch) |
| `on_hour`       | string   | --                 | Hour to turn Wi-Fi on (only when func is on/off and enabled) |
| `on_min`        | string   | --                 | Minute to turn Wi-Fi on                                      |
| `off_hour`      | string   | --                 | Hour to turn Wi-Fi off                                       |
| `off_min`       | string   | --                 | Minute to turn Wi-Fi off                                     |
| `switch_hour`   | string   | --                 | Hour to switch power (only when func is `"power_switch"`)    |
| `switch_min`    | string   | --                 | Minute to switch power                                       |
| `restore_hour`  | string   | --                 | Hour to restore power                                        |
| `restore_min`   | string   | --                 | Minute to restore power                                      |
| `switch_power`  | string   | `"Max"`            | Power level to switch to                                     |
| `restore_power` | string   | `"Max"`            | Power level to restore to                                    |
| `week`          | number[] | `[0,1,2,3,4,5,6]` | Days of week                                                 |

### `timer.set_screen`

Configures the scheduled LCD screen on/off timer (for models with a screen).

| Parameter      | Type     | Default            | Description                                     |
|----------------|----------|--------------------|-------------------------------------------------|
| `enable`       | boolean  | `false`            | Enable or disable the screen timer              |
| `turnon_hour`  | string   | --                 | Hour to turn screen on (only when enabled)      |
| `turnon_min`   | string   | --                 | Minute to turn screen on                        |
| `turnoff_hour` | string   | --                 | Hour to turn screen off                         |
| `turnoff_min`  | string   | --                 | Minute to turn screen off                       |
| `week`         | number[] | `[0,1,2,3,4,5,6]` | Days of week                                    |

When `enable` is `false`, only `enable` and `week` are sent.

---

## plugins

### `plugins.install_package`

Installs one or more packages from the repository. Timeout: 180 seconds.

| Parameter | Type     | Default | Description                              |
|-----------|----------|---------|------------------------------------------|
| `name`    | string[] | --      | Array of package names to install        |

### `plugins.remove_package`

Removes (uninstalls) a package. Timeout: 180 seconds.

| Parameter | Type   | Default | Description                    |
|-----------|--------|---------|--------------------------------|
| `name`    | string | --      | Package name to remove         |

### `plugins.set_config`

Updates the package repository source list. Timeout: 180 seconds.

| Parameter | Type     | Default | Description                                             |
|-----------|----------|---------|---------------------------------------------------------|
| `source`  | object[] | --      | Array of source objects (user-defined sources only, excludes system sources) |

Each source object:

| Field  | Type   | Description                                              |
|--------|--------|----------------------------------------------------------|
| `name` | string | Source name (alphanumeric + `!@#$%&*()+=,._-/\[]^|<>?{}:;"'` + backtick, max 100 chars) |
| `url`  | string | Source URL (max 1024 chars)                              |

### `plugins.update_repository`

Forces a refresh of the package repository index. No parameters (sends `{}`). Timeout: 180 seconds.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| (none)    | --   | --      | No parameters; sends `{}` |

---

## parental-control

### `parental-control.set_config`

Sets the main parental control configuration.

| Parameter        | Type    | Default | Description                                         |
|------------------|---------|---------|-----------------------------------------------------|
| `enable`         | boolean | `false` | Enable or disable parental control                  |
| `drop_anonymous` | boolean | `false` | Block traffic from unrecognized (anonymous) devices |
| `auto_update`    | boolean | `false` | Auto-update block lists                             |

### `parental-control.set_mode`

Switches the parental control operating mode.

| Parameter | Type   | Default | Description                                                  |
|-----------|--------|---------|--------------------------------------------------------------|
| `mode`    | number | --      | Mode: `1` (bark/third-party), `2` (disable bark and use default mode) |

### `parental-control.add_group`

Creates a new device group for parental control.

| Parameter      | Type     | Default | Description                                   |
|----------------|----------|---------|-----------------------------------------------|
| `name`         | string   | `""`    | Group name                                    |
| `default_rule` | string   | `""`    | Default rule ID to apply to this group        |
| `macs`         | string[] | `[]`    | Array of MAC addresses to include in the group |

Returns `{ id: "<new_group_id>" }` on success.

### `parental-control.set_group`

Updates an existing device group. Sends partial or full group config.

| Parameter      | Type     | Default | Description                                       |
|----------------|----------|---------|---------------------------------------------------|
| `id`           | string   | --      | Group ID (from `add_group` response or `get_config`) |
| `name`         | string   | --      | Group name                                        |
| `default_rule` | string   | --      | Default rule ID                                   |
| `macs`         | string[] | --      | Array of device MAC addresses                     |
| `schedules`    | object[] | --      | Array of schedule objects (when updating schedules) |

Each schedule object:

| Field   | Type   | Description                                     |
|---------|--------|-------------------------------------------------|
| `week`  | number | Day of week (0=Sunday, 6=Saturday)              |
| `begin` | string | Start time `"HH:MM:SS"` (or `"HH:MM"`)         |
| `end`   | string | End time `"HH:MM:SS"` (or `"HH:MM"`)           |
| `rule`  | string | Rule ID to apply during this schedule           |

### `parental-control.remove_group`

Removes a device group.

| Parameter | Type   | Description            |
|-----------|--------|------------------------|
| `id`      | string | Group ID to remove     |

### `parental-control.add_rule`

Creates a new filtering rule. Timeout: 30 seconds.

| Parameter   | Type     | Default | Description                                                 |
|-------------|----------|---------|-------------------------------------------------------------|
| `name`      | string   | `""`    | Rule name                                                   |
| `color`     | string   | `""`    | Color hex code for the rule badge (e.g., `"#a1b2c3"`)      |
| `apps`      | string[] | `[]`    | Array of app category IDs to block                          |
| `manual`    | boolean  | `true`  | `true` for manual blacklist mode, `false` for URL-based mode |
| `blacklist` | string[] | --      | Array of domain strings to block (when `manual` is `true`)  |
| `url`       | string   | --      | URL of an external blocklist (when `manual` is `false`)     |

Returns `{ id: "<new_rule_id>" }` on success.

### `parental-control.set_rule`

Updates an existing filtering rule. Same parameters as `add_rule` plus rule ID. Timeout: 30 seconds.

| Parameter   | Type     | Default | Description                                                 |
|-------------|----------|---------|-------------------------------------------------------------|
| `id`        | string   | --      | Rule ID to update                                           |
| `name`      | string   | --      | Rule name                                                   |
| `color`     | string   | --      | Color hex code                                              |
| `apps`      | string[] | --      | Array of app category IDs to block                          |
| `manual`    | boolean  | --      | `true` for manual blacklist, `false` for URL-based          |
| `blacklist` | string[] | --      | Array of domain strings (when `manual` is `true`)           |
| `url`       | string   | --      | External blocklist URL (when `manual` is `false`)           |

### `parental-control.remove_rule`

Removes a filtering rule.

| Parameter | Type   | Description                              |
|-----------|--------|------------------------------------------|
| `id`      | string | Rule ID to remove                        |

Error code `-2` means the rule is a default rule and cannot be removed. Error code `-3` means the rule is currently in use by a group.

### `parental-control.set_brief`

Sets a temporary "brief" override for a device group (e.g., grant temporary internet access).

| Parameter     | Type    | Default | Description                                          |
|---------------|---------|---------|------------------------------------------------------|
| `enable`      | boolean | --      | Enable or disable the brief override                 |
| `group_id`    | string  | --      | Target group ID                                      |
| `manual_stop` | boolean | `false` | If `true`, override lasts until manually stopped     |
| `time`        | string  | --      | End time `"HH:MM"` (when `manual_stop` is `false`)  |
| `rule_id`     | string  | --      | Rule ID to apply during the brief period             |

---

## clients

### `clients.set_info`

Updates client device display info (alias and device type).

| Parameter | Type   | Default | Description                                              |
|-----------|--------|---------|----------------------------------------------------------|
| `mac`     | string | `""`    | Client MAC address                                       |
| `alias`   | string | `""`    | Display name / alias (must not contain `,` or `"`)       |
| `class`   | string | `""`    | Device type class (icon category, e.g., `"phone"`, `"laptop"`, `"desktop"`) |

### `clients.remove_offline`

Removes an offline client from the client list. The parameter is the stored offline client data object.

| Parameter | Type   | Description                                |
|-----------|--------|--------------------------------------------|
| `mac`     | string | MAC address of the offline client to remove |

### `clients.clean_traffic`

Clears all client traffic statistics. No parameters (sends `{}`).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| (none)    | --   | --      | No parameters; sends `{}` |

---

## qos

### `qos.set_speed_limit_rule`

Sets a per-client speed limit. Timeout: 30 seconds.

| Parameter  | Type   | Default | Description                                                |
|------------|--------|---------|------------------------------------------------------------|
| `mac`      | string | --      | Client MAC address                                         |
| `download` | number | `0`     | Download speed limit in bytes/sec (`0` = unlimited)        |
| `upload`   | number | `0`     | Upload speed limit in bytes/sec (`0` = unlimited)          |

The UI converts from bits/sec to bytes/sec by dividing by 8 when the display unit is bits.

### `qos.remove_speed_limit_rule`

Removes a per-client speed limit. Timeout: 30 seconds.

| Parameter | Type   | Description                    |
|-----------|--------|--------------------------------|
| `mac`     | string | Client MAC address to unlimit  |

---

## black_white_list

### `black_white_list.set_config`

Sets the MAC access control configuration (blacklist or whitelist mode).

| Parameter | Type   | Default | Description                                              |
|-----------|--------|---------|----------------------------------------------------------|
| `mode`    | string | --      | Access control mode: `"black"` (blacklist) or `"white"` (whitelist) |
| `mac`     | string | --      | Newline-separated list of MAC addresses (one per line)   |

When called from the access control dialog, `mode` and `mac` list are sent together.

### `black_white_list.set_single_mac`

Toggles a single device's block/allow status. Called from the client list inline toggle.

| Parameter | Type   | Description                                 |
|-----------|--------|---------------------------------------------|
| `mac`     | string | Client MAC address to block or unblock      |

The exact parameters depend on the access control mode context. Additional fields may be included based on the current blacklist/whitelist state.

---

## switch-button

### `switch-button.set_config`

Configures the physical toggle switch function assignment.

| Parameter  | Type    | Default | Description                                                   |
|------------|---------|---------|---------------------------------------------------------------|
| `func`     | string  | --      | Primary function: `"vpn"`, `"tor"`, `"adguardhome"`, `"none"`, etc. |
| `sub_func` | string  | --      | Sub-function (e.g., specific VPN protocol or tunnel)          |
| `sync`     | boolean | `false` | Whether to force sync (set `true` to sync immediately)       |

The `func` and `sub_func` values come from the available functions list returned by `switch-button.get_funcs`.

---

## tailscale

### `tailscale.set_config`

Configures Tailscale VPN settings.

| Parameter      | Type    | Default | Description                                           |
|----------------|---------|---------|-------------------------------------------------------|
| `enabled`      | boolean | `false` | Enable or disable Tailscale                           |
| `lan_enabled`  | boolean | `false` | Allow LAN access to Tailscale network (only when enabled) |
| `wan_enabled`  | boolean | `false` | Allow WAN access via Tailscale (only when enabled)    |
| `exit_node_ip` | string  | `""`    | Exit node IP address (empty string = no exit node; only when enabled) |

When disabling (`enabled: false`), only `enabled` is sent. When using an exit node, `lan_enabled` and `wan_enabled` retain their previous values.

---

## zerotier

### `zerotier.set_config`

Configures ZeroTier VPN settings. Timeout: 30 seconds.

| Parameter     | Type    | Default | Description                                              |
|---------------|---------|---------|----------------------------------------------------------|
| `id`          | string  | `""`    | ZeroTier Network ID (16-character hex string)            |
| `enabled`     | boolean | `false` | Enable or disable ZeroTier                               |
| `lan_enabled` | boolean | `false` | Allow LAN access to ZeroTier network                     |
| `wan_enabled` | boolean | `false` | Allow WAN access via ZeroTier                            |

Network ID validation: must match `/^[a-fA-F0-9]{16}$/` when enabled.

---

## tor

### `tor.set_config`

Configures Tor anonymization settings. Timeout: 30 seconds.

| Parameter   | Type     | Default | Description                                             |
|-------------|----------|---------|---------------------------------------------------------|
| `enable`    | boolean  | `false` | Enable or disable Tor                                   |
| `manual`    | boolean  | `false` | Enable manual country selection for exit nodes          |
| `countries` | string[] | `[]`    | Array of country codes for exit nodes (only when `manual` is `true`) |

The country code list is sorted alphabetically by code.

---

## adguardhome

### `adguardhome.set_config`

Configures AdGuard Home DNS filtering.

| Parameter     | Type    | Default | Description                                             |
|---------------|---------|---------|----------------------------------------------------------|
| `enabled`     | boolean | --      | Enable or disable AdGuard Home                           |
| `dns_enabled` | boolean | --      | Enable DNS filtering within AdGuard Home (only sent when `enabled` is `true`) |

Error code `1` when disabling indicates that DNS cannot be disabled.

---

## ddns

### `ddns.set_config`

Configures Dynamic DNS settings. The parameter object is passed through from form data. DDNS configuration is typically managed through the cloud settings view.

| Parameter | Type    | Default | Description                                |
|-----------|---------|---------|--------------------------------------------|
| `enabled` | boolean | --      | Enable or disable DDNS                     |

Additional parameters depend on the DDNS provider configuration. The method is referenced in the API but the detailed form is managed at the cloud/system level.

---

## cloud

### `cloud.set_config`

Configures GoodCloud remote management features.

| Parameter  | Type    | Default | Description                                         |
|------------|---------|---------|-----------------------------------------------------|
| `rtty_ssh` | boolean | `true`  | Enable remote SSH access via GoodCloud              |
| `rtty_web` | boolean | `true`  | Enable remote web terminal access via GoodCloud     |

Only `rtty_ssh` and `rtty_web` fields are sent from the cloud configuration form.

---

## rtty

### `rtty.set_config`

Configures the rtty remote terminal service. This method is referenced in the API and typically managed through the cloud configuration. Parameters align with the cloud remote access settings.

| Parameter | Type    | Default | Description                              |
|-----------|---------|---------|------------------------------------------|
| `enabled` | boolean | --      | Enable or disable rtty service           |

Additional rtty-specific parameters may be available depending on firmware version.

---

## upgrade

### `upgrade.set_config`

Sets firmware upgrade preferences.

| Parameter    | Type    | Default | Description                                              |
|--------------|---------|---------|----------------------------------------------------------|
| `rc_upgrade` | boolean | `false` | Enable release candidate (beta) firmware upgrades        |

### `upgrade.upgrade_online`

Triggers an online firmware upgrade. The method is dispatched from the root application component via `$downloadFirware`.

| Parameter      | Type    | Default | Description                                              |
|----------------|---------|---------|----------------------------------------------------------|
| `keep_config`  | boolean | `true`  | Preserve current configuration after upgrade             |
| `keep_package` | boolean | `true`  | Preserve installed packages after upgrade                |

### `upgrade.upgrade_local`

Triggers a local firmware upgrade (from uploaded firmware file at `/tmp/firmware.img`).

| Parameter      | Type    | Default | Description                                              |
|----------------|---------|---------|----------------------------------------------------------|
| `keep_config`  | boolean | `false` | Preserve current configuration after upgrade             |
| `keep_package` | boolean | `false` | Preserve installed packages (set to same value as `keep_config`) |

The `keep_config` default depends on firmware verification status: set to `true` when verification status is `0` (valid), `false` otherwise.

---

## ui

### `ui.set_lang`

Sets the web interface language.

| Parameter | Type   | Default | Description                                            |
|-----------|--------|---------|--------------------------------------------------------|
| `lang`    | string | --      | Language code (e.g., `"en"`, `"zh"`, `"de"`, `"fr"`)  |

The language is set via the UI language selector and persisted in both the router config and browser local storage.
