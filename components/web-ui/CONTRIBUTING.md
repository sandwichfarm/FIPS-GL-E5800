# Contributing

## Development setup

Requirements:

- Node.js 18.17 or newer
- npm with lockfile support
- `tar`, `gzip`, and POSIX `sh`
- OpenSSL for router authentication tests and live RPC commands
- OpenSSH for live deploy and extraction commands

```bash
git clone https://github.com/go-wombat/gl-sdk4-plugin-kit.git
cd gl-sdk4-plugin-kit
npm ci
npm test
```

Use a feature branch and keep changes focused. Run `npm test` and
`npm pack --dry-run` before opening a pull request. New behavior must include tests;
bug fixes should include a regression case.

## Firmware evidence

Do not infer public APIs or global Vue components from string matches alone. New
firmware catalogs must include:

- router model, exact firmware version, and release channel;
- SHA-256 of the inspected decompressed admin bundle;
- runtime evidence from `Vue.options.components` for component claims;
- manually reviewed and redacted RPC output for method claims.

Never commit firmware images, passwords, session IDs, nonces, salts, serial numbers,
MAC addresses, Wi-Fi keys, VPN keys, or unreviewed extraction output.

## Pull requests

Describe the behavior change, compatibility assumptions, and verification commands.
Call out live-router testing separately from fixture-only testing. Do not weaken
host-key verification, archive validation, redaction, or feature gating to make a
test pass.

Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not a public issue.
