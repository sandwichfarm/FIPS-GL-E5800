# Release Process

## Prepare

1. Start from a clean `main` branch synchronized with `origin/main`.
2. Update `package.json`, `package-lock.json`, and `CHANGELOG.md` to the same version.
3. Run `npm ci`, `npm test`, and `npm pack --dry-run`.
4. Inspect the tarball file list and confirm `bin/glplugin` has executable mode.
5. Commit and push the release changes.

## First npm release

The package must exist before its npm trusted publisher can be configured. For the
first release only:

1. Authenticate interactively with `npm login` and publish from the reviewed release
   commit with `npm publish --access public`.
2. Configure the npm trusted publisher for repository
   `go-wombat/gl-sdk4-plugin-kit`, workflow `publish.yml`, and the `npm publish`
   action.
3. Tag the exact commit and publish the matching GitHub release.

## Subsequent releases

Create and publish a GitHub release whose tag is exactly `v<package-version>`. The
`publish.yml` workflow verifies the tag, installs from the lockfile, runs the
`prepack` test suite, and publishes through npm trusted publishing. OIDC removes the
need for a long-lived npm token and generates npm provenance automatically.

The workflow exits successfully without republishing when the exact version already
exists. This makes the first manually published release safe to mirror as a GitHub
release.

After publication, verify the npm version and GitHub Actions result, then move the
released changelog entries under a new empty `Unreleased` section.
