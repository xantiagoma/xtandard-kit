# Releases

How `@xtandard/kit` is versioned and published. The policy is ADR 0007; the workflows are
described in [Reusable workflows](WORKFLOWS.md).

## Versioning (ZeroVer)

- `0.MINOR.PATCH`. A breaking change bumps MINOR. Fixes and backwards-compatible additions bump
  PATCH. That includes the semi-public driver internals (ADR 0004) and the reusable workflows'
  inputs.
- Products depend on `^0.MINOR.0`, which means the same minor and any patch, so a kit patch reaches
  every product's users on their next install, with no product release.
- `xtandard-kit api-surface --diff` against the last release must show no removals in a patch (see
  [Build tooling](BUILD.md)).
- Each CHANGELOG entry names the products it affects, and says "rebuild images" when a fix must reach
  the GHCR images (see "Kit patches and images" in [Reusable workflows](WORKFLOWS.md)).

## Cutting a release

1. On `main`, with a green CI:

   ```sh
   bun run release   # changelogen: bump from conventional commits, write CHANGELOG.md, commit, tag vX.Y.Z, push
   ```

   For a planned minor, pass the version explicitly (`bunx changelogen --release -r 0.2.0 --push`):
   changelogen may otherwise bump `0.1.2` to `0.1.3`.

2. The tag push runs `kit-release.yml`:
   - `release-prepare.yml` checks out the tag, checks that it matches `package.json`, runs `check`,
     `test` and `test:bun`, builds, runs publint, packs the tarball and extracts the notes;
   - the `publish` job runs `npm publish <tarball> --provenance --access public`. It skips a
     version that is already on npm, so re-running is safe;
   - it creates (or un-drafts) the GitHub release from the CHANGELOG section;
   - it moves the `v0.MINOR` tag to the release, so products' `@v0.MINOR` workflow references pick
     up the new workflows. The workflow triggers only on full `v*.*.*` tags, so moving `v0.MINOR`
     never starts another release.

3. Re-publish an existing tag after a failed run:

   ```sh
   gh workflow run kit-release.yml -f tag=v0.1.2
   ```

## npm trusted publishing (one-time setup)

Publishing uses OIDC; there is no `NPM_TOKEN`. On npmjs.com, the package's trusted publisher is this
repo and this workflow file:

```sh
npm trust github @xtandard/kit --repo xantiagoma/xtandard-kit --file kit-release.yml
```

(or npmjs.com → package Settings → Trusted Publisher). It needs npm 11.5.1 or newer; the publish job
uses Node 24. Because npm validates the **calling** workflow, the publish step stays in
`kit-release.yml` and is never moved into the reusable `release-prepare.yml`.

## After a kit release

- **Patch:** nothing to release in the products. Refresh each product's lockfile so its CI tests
  the new kit. If the CHANGELOG says "rebuild images", run each product's `docker.yml` with
  `refresh-kit: true`.
- **Minor:** each product moves to it in its own release: a product MINOR if its own surface
  changes, a product PATCH otherwise.
