# Captured firmware and source availability

Read-only device inspection on 2026-09-29, before and after the user's firmware
update. Both snapshots came from `/rom` (stock firmware), not mutable user data.

| Property | Before | After |
| --- | --- | --- |
| GL.iNet version | 4.8.3 | 4.10.0 |
| OpenWrt | 23.05.4 | 23.05.4 |
| Kernel | 5.15.170-perf | 5.15.170-perf |
| Package architecture | aarch64_cortex-a53 | aarch64_cortex-a53 |
| Local capture | private/device/4.8.3 | private/device/4.10.0 |

The new capture contains 149 added paths, 41 removed paths, and 376 changed regular
files compared with the previous capture. These counts cover the captured UI trees,
not the entire firmware. No JavaScript source maps were found in either capture.

## Web UI

- `/www/js/app.*.js.gz`: compiled application bundle.
- `/www/views/`: compiled feature bundles.
- `/www/i18n/`, `/www/theme/`, `/www/fonts/`: translations/styles/assets.
- `/usr/share/oui/menu.d/`: readable JSON menu registration.
- `/www/cgi-bin/`, `/usr/lib/oui-httpd/`, `/usr/share/gl-validator.d/`: shipped
  backend/validation components, including compiled/bytecode files.
- `inspection/www/` in each local capture contains decompressed JS/CSS for reading.
  It is not the original Vue source and has no upstream source license inferred.

## Touchscreen UI

- `/usr/bin/gl_screen`: compiled ARM64 ELF executable; no section headers in the
  observed 4.8.3 binary. Original C/C++ application source is unavailable.
- `/usr/lib/oui-httpd/rpc/screen`: Lua 5.1 bytecode in the 4.8.3 capture.
- `/etc/gl_screen/config/`: readable layouts and screen parameters.
- `/etc/gl_screen/image/`, `/etc/gl_screen/language/`: stock images/fonts/text.
- `/etc/gl_screen/platform.sh`, `/etc/gl_screen/scripts/`: available shell/Lua
  helper source. The 4.10.0 snapshot also includes `layout_config_tool.lua` and
  `test_layout_config_tool.sh`.
- `/etc/init.d/gl_screen` and `/lib/preinit/02_screen_boot`: startup integration.

The captured helpers are available locally for study. We have not established a
supported plugin API for adding a new FIPS page to the proprietary touchscreen app.
The community dashboard is separately available as editable, MIT-licensed source.

## Exact observed fingerprints

These are identification evidence, **not runtime compatibility approval**.

| Version | File | SHA-256 |
| --- | --- | --- |
| 4.8.3 | compressed app bundle | `43cce848d96f21e49dc9c17045da80b3aac7315cb8c6c15d8cff496c96b16392` |
| 4.8.3 | gl_screen | `269dc2443d39a88d6247733155b917555e3ec08482ea1bb3e2c6856421b4d200` |
| 4.10.0 | compressed app bundle | `2194dc7d2be581d79903a3a2555627977bce40ebe8ba7f7f694ec291fce907a7` |
| 4.10.0 | gl_screen | `c1aed1444ab8e516a2471b513fa93f8fe3413eec48e3b569047d655f1fba30fc` |

Ansible's live read-only inspection on 4.10.0 matched the two captured hashes.
The firmware has OpenSSL but no standalone base64 applet. opkg can report
`Status: install user installed`, so recovery checks the installation-state field.

## Public sources

- [FIPS v0.5.2](https://github.com/jmcorgan/fips/tree/v0.5.2)
- [GL SDK4 plugin toolkit](https://github.com/go-wombat/gl-sdk4-plugin-kit)
- [Community E5800 dashboard](https://github.com/robavionix/gl-e5800-dashboard)
- [Official LVGL demo for BE3600](https://github.com/gl-inet/gl-lvgl) — not E5800 app source.
- [GL.iNet statement about UI/API source](https://forum.gl-inet.com/t/changes-planned-for-json-rpc-router-4-x-api/49488)
- [GL.iNet firmware upgrade behavior](https://docs.gl-inet.com/router/en/4/interface_guide/upgrade/)
