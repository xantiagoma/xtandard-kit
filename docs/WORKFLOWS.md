# Reusable workflows

The products' CI, docs, image and release workflows live here once, as `workflow_call` workflows
(ADR 0009). A product's own workflow files keep their triggers, `paths` filters and permissions, and
are about 20 lines each.

Reference them at the moving `v0.MINOR` tag (ADR 0007), so a workflow fix released as a kit patch
reaches every product:

```yaml
uses: xantiagoma/xtandard-kit/.github/workflows/ci.yml@v0.1
```

| Workflow              | What it runs                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ci.yml`              | typecheck, lint, fmt, coverage, `test:bun`, build, publint, pack dry-run; optional examples typecheck and e2e |
| `pages.yml`           | builds the Starlight site (fails on broken links) and deploys it to GitHub Pages                              |
| `docker.yml`          | builds the image, smoke-tests it, then pushes it to GHCR                                                      |
| `release-prepare.yml` | checks out the tag, runs the gate, builds, runs publint, packs the tarball, extracts the notes                |

No secrets are needed: `GITHUB_TOKEN` and OIDC cover everything. Callers declare the permissions.

Every workflow takes a `bun-version` input (default `1.3.14`, the pin in the kit's `mise.toml`). A
product pinned to another Bun (links: `1.4.4`) passes its own, so CI runs the same Bun as local
development. With `clickhouse-image` set, `ci.yml` starts ClickHouse with a CI-only password and a
health check, and exports `CLICKHOUSE_URL`, `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD`.

## `ci.yml`

```yaml
jobs:
  ci:
    uses: xantiagoma/xtandard-kit/.github/workflows/ci.yml@v0.1
    with:
      db-name: webhooks
      typecheck-examples: true
      e2e: true
```

| Input                                                         | Default                                        |
| ------------------------------------------------------------- | ---------------------------------------------- |
| `bun-version`                                                 | `1.3.14`                                       |
| `redis-image`, `mongo-image`, `postgres-image`, `mysql-image` | `redis:8`, `mongo:7`, `postgres:16`, `mysql:8` |
| `clickhouse-image`                                            | `""` (skipped)                                 |
| `db-name`                                                     | `xtandard` (the Postgres/MySQL database)       |
| `coverage`, `test-bun`, `build`                               | `true`                                         |
| `typecheck-examples`, `e2e`                                   | `false`                                        |
| `extra-env`                                                   | `{}` (a JSON object)                           |

A service whose image input is empty doesn't run, and only the running services' URLs are exported
(`REDIS_URL`, `MONGO_URL`, `POSTGRES_URL`, `MYSQL_URL`, `CLICKHOUSE_URL`). `redis:8` has RedisJSON
built in, so `REDIS_JSON_URL` is set too and the RedisJSON conformance cases run. They never ran in
CI for four of the five products.

## `pages.yml`

```yaml
on:
  push: { branches: [main], paths: [docs/**, README.md, src/**, site/**] }
  pull_request: { paths: [docs/**, README.md, src/**, site/**] }
  workflow_dispatch:
jobs:
  pages:
    uses: xantiagoma/xtandard-kit/.github/workflows/pages.yml@v0.1
    permissions: { contents: read, pages: write, id-token: write }
```

| Input         | Default  | Notes                                                                            |
| ------------- | -------- | -------------------------------------------------------------------------------- |
| `bun-version` | `1.3.14` |                                                                                  |
| `site-dir`    | `site`   | the site's directory, with its own lockfile                                      |
| `prebuild`    | `""`     | a root command run before the site install (the kit's site uses `bun run build`) |
| `deploy`      | `true`   | pull requests never deploy                                                       |

It installs the root (the API reference needs the library's types), installs and builds the site
with the `SITE_ORIGIN`/`SITE_BASE` that `actions/configure-pages` reports, uploads `site/dist`, and
deploys it. Prerequisite (owner, once): Settings → Pages → Source: "GitHub Actions".

## `docker.yml`

```yaml
on:
  push: { branches: [main], tags: ["v*"] }
  workflow_dispatch:
    inputs:
      refresh-kit: { type: boolean, default: false }
jobs:
  docker:
    uses: xantiagoma/xtandard-kit/.github/workflows/docker.yml@v0.1
    permissions: { contents: read, packages: write }
    with:
      refresh-kit: ${{ inputs.refresh-kit || false }}
      smoke-paths: /links/ /links/api/openapi.json # links; default "/healthcheck /"
```

| Input         | Default                       |
| ------------- | ----------------------------- |
| `dockerfile`  | `apps/standalone/Dockerfile`  |
| `context`     | `.`                           |
| `image-name`  | `ghcr.io/<owner>/<repo>`      |
| `smoke-paths` | `/healthcheck /`              |
| `smoke-env`   | `AUTH_MODE=none`              |
| `port`        | `3000` (inside the container) |
| `refresh-kit` | `false`                       |
| `push`        | `true`                        |
| `bun-version` | `1.3.14`                      |

The image is built locally and smoke-tested first. Every smoke path must answer 2xx, and the
container logs are printed on failure. Only then is it pushed (`latest` on the default branch,
`sha-…`, and `vX.Y.Z` on tags).

**Kit patches and images.** An image bundles its dependencies at build time, and the lockfile pins
the kit, so a kit patch doesn't reach a running image on its own (ADR 0007). For a kit security fix,
run each product's `docker.yml` by hand with `refresh-kit: true`: it runs `bun update @xtandard/kit`
before the build. The kit CHANGELOG says "rebuild images" for such fixes. en had no `docker.yml`;
it gets one by calling this workflow.

## `release-prepare.yml` and the publish step

npm trusted publishing (OIDC) validates the **calling** workflow, and publishing from inside a
`workflow_call` is a known source of claim mismatches. So the shared workflow only prepares; each
repo's own `release.yml` publishes:

```yaml
# .github/workflows/release.yml (product)
on:
  push: { tags: ["v*.*.*"] }
  workflow_dispatch:
    inputs:
      tag: { description: "Existing tag to publish", required: true }
permissions: { contents: read }
jobs:
  prepare:
    uses: xantiagoma/xtandard-kit/.github/workflows/release-prepare.yml@v0.1
    with: { tag: "${{ inputs.tag || github.ref_name }}" }
  publish:
    needs: prepare
    runs-on: ubuntu-latest
    permissions: { contents: write, id-token: write }
    env:
      TAG: ${{ inputs.tag || github.ref_name }}
      TARBALL: ${{ needs.prepare.outputs.tarball }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24", registry-url: "https://registry.npmjs.org" }
      - uses: actions/download-artifact@v4
        with: { name: package, path: pack }
      - uses: actions/download-artifact@v4
        with: { name: release-notes, path: . }
      # `./` is required: npm reads a bare `pack/x.tgz` as the GitHub repo `pack/x.tgz`.
      - run: npm publish "./pack/${TARBALL}" --provenance --access public
      - env: { GH_TOKEN: "${{ github.token }}" }
        run: gh release create "$TAG" --title "$TAG" --notes-file notes.md --verify-tag --latest
```

`release-prepare.yml`:

- checks out the tag and fails if it doesn't match `package.json`'s version;
- runs `check`, `test` and `test:bun` (each can be turned off);
- builds, runs publint, and packs the tarball with `npm pack`;
- extracts the tag's `## vX.Y.Z` section from `CHANGELOG.md`, plus a compare link to the previous
  release.

It uploads the `package` and `release-notes` artifacts and outputs `version` and `tarball`.

The trusted publisher on npmjs.com is registered against the repo's own `release.yml`
(`npm trust github <package> --repo xantiagoma/<repo> --file release.yml`). It needs npm 11.5.1 or
newer, which Node 24 ships. No `NPM_TOKEN` is involved.

The kit's own callers are `kit-ci.yml`, `kit-pages.yml` and `kit-release.yml` (see
[Releases](RELEASES.md)).
