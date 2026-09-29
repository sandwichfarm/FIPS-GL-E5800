# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.9.x | Yes |
| 0.8.x | No |
| 0.7.x | No |
| 0.6.x | No |
| 0.5.x | No |
| 0.4.x | No |
| 0.3.x | No |
| 0.2.x | No |
| Earlier development snapshots | No |

## Vue 2 build-tool advisory

The official GL.iNet SDK4 admin runtime uses Vue 2, so generated projects use
`vue-template-compiler@2.7.16` at build time. GitHub advisory
`GHSA-g3ch-rx76-35fx` affects every Vue 2 compiler release and has no patched Vue 2
version. The package is a development dependency, is not installed for CLI runtime,
and is not copied into router packages. Compile only trusted local `.vue` source;
untrusted runtime templates are outside the supported build model.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting form:

https://github.com/go-wombat/gl-sdk4-plugin-kit/security/advisories/new

Do not open a public issue for a suspected vulnerability. Include the affected
version, impact, reproduction steps, and any proposed mitigation. Remove router
passwords, session IDs, private keys, Wi-Fi credentials, serial numbers, and MAC
addresses from reports and attachments.

The maintainers will acknowledge a report through the private advisory, validate
the issue, coordinate a fix, and publish disclosure details after a patched version
is available.
