# Menu Configuration Reference

## Overview

Each plugin registers a sidebar menu entry by placing a JSON file in
`/usr/share/oui/menu.d/` on the router. The filename is typically
`gl-sdk4-ui-{name}.json` and contains a single JSON object describing
the menu item.

For manifest projects, prefer `glplugin view add`, `glplugin view list`, and
`glplugin view remove` over editing the `views` array and menu files manually.

---

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `index` | Number | Yes | Sort order in the sidebar. Lower numbers appear higher. Core menu items use values below 80. |
| `view` | String | Yes | View identifier. Must match the JS bundle filename: `gl-sdk4-ui-{view}.common.js`. No spaces or special characters. |
| `title` | String or Object | Yes | Display name in the sidebar. Can be a plain string or an object `{"translate": "key"}` for i18n support. |
| `icon` | String | Yes | Icon name from the GL.iNet icon font (e.g., `"setting"`, `"network"`, `"wifi"`). |
| `level` | Number | Yes | Menu depth: `1` for top-level sidebar item, `2` for a sub-menu item nested under a parent. |
| `parent` | String | Level 2 only | The `view` value of the parent menu item this entry nests under. |
| `parent_icon` | String | Level 2 only | Icon for the parent group heading (used if the parent is not already visible). |
| `parent_index` | Number | Level 2 only | Sort order for the parent group heading. |
| `show_mode` | Array of Strings | No | Router operating modes in which this menu entry is visible. Values include `"router"`, `"ap"`, `"bridge"`, `"repeater"`, `"wisp"`. If omitted, the entry is shown in all modes. |
| `disables` | Array of Strings | No | Operating modes in which the menu entry appears but is disabled/greyed out. |
| `lang_hide` | Array of Strings | No | Locale codes for which this menu entry is hidden entirely (e.g., `["zh-cn"]`). |

---

## Level 1 Example (Top-Level Sidebar Item)

```json
{
  "index": 85,
  "view": "helloworld",
  "title": "Hello World",
  "icon": "setting",
  "level": 1
}
```

This creates a top-level sidebar entry labeled "Hello World" with the settings
icon. The view bundle must exist at `/www/views/gl-sdk4-ui-helloworld.common.js.gz`.

---

## Level 2 Example (Sub-Menu Item)

```json
{
  "index": 10,
  "view": "vpn-dashboard",
  "title": { "translate": "VPN Dashboard" },
  "icon": "vpn",
  "level": 2,
  "parent": "vpn",
  "parent_icon": "vpn",
  "parent_index": 40
}
```

This creates a sub-menu item under the "vpn" parent group. If the parent group
does not already exist in the sidebar, it is created automatically using
`parent_icon` and `parent_index`.

---

## Level 2 Example with Mode Restrictions

```json
{
  "index": 20,
  "view": "repeater-settings",
  "title": "Repeater Settings",
  "icon": "wifi",
  "level": 2,
  "parent": "wireless",
  "parent_icon": "wifi",
  "parent_index": 30,
  "show_mode": ["repeater", "wisp"],
  "disables": ["ap"],
  "lang_hide": ["zh-cn"]
}
```

This entry is only visible when the router is in repeater or WISP mode. It
appears disabled in AP mode and is hidden entirely for the zh-cn locale.

---

## Internationalized Titles

To support multiple languages, use an object with a `translate` key instead
of a plain string:

```json
"title": { "translate": "menu.my_plugin" }
```

The value `"menu.my_plugin"` should correspond to a key in the admin panel
locale files. If the key is not found, the raw string is displayed as a
fallback.

---

## File Placement

- Menu JSON files go in: `/usr/share/oui/menu.d/`
- View JS bundles go in: `/www/views/`
- Bundle filename must match the `view` field: `gl-sdk4-ui-{view}.common.js.gz`

---

## Notes

- The admin panel reads all JSON files from the menu directory on load and
  merges them into the sidebar.
- Index values should avoid conflicting with built-in firmware menu entries.
  Values of 80 and above are generally safe for custom plugins.
- The `view` field is used both for routing and for locating the JS bundle,
  so it must be consistent across the menu file and the build output.
