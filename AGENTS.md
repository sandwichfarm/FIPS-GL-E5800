# GL-E5800 workspace

Prefer codebase-memory-mcp for code discovery; index this repository before searching.

The components directories are pinned, vendored source snapshots. Preserve their
licenses and record source updates in upstream/sources.json. They are ordinary
monorepo files, not submodules. No upstream remote is configured for this repo.

private/ contains proprietary firmware reference captures. Never add it, credentials,
router configuration, or identity keys to Git. Never replay a stock firmware capture
over another firmware release. Router inspection is read-only unless deployment is
explicitly requested. Local preparation does not authorize deploying to hardware.

The stock web and touchscreen applications are not available as full source.
components/web-ui is the community extension toolkit; components/device-ui is the
community replacement dashboard. Neither is the extracted GL.iNet application.
