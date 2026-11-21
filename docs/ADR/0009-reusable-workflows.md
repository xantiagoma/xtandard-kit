# ADR 0009 — Reusable GitHub workflows; `npm publish` stays in each repo

**Status:** Accepted

---

## Context

The five repos carry near-identical `ci.yml`, `pages.yml`, `docker.yml` and `release.yml`. They drift
in the Bun version, the redis image and the smoke paths, and en has no `docker.yml`.

npm trusted publishing (OIDC) validates claims against the **calling** workflow. npm's documentation
lists `workflow_call` as a source of claim mismatches, and users report that publishing from inside a
reusable workflow fails or needs workarounds.

## Decision

The kit hosts these reusable workflows (`on: workflow_call`):

| Workflow | Inputs | What it runs |
|---|---|---|
| `ci.yml` | `bun-version`, the service set (redis image, mongo, postgres, mysql, clickhouse), `db-name`, `typecheck-examples`, `e2e`, `extra-env` | typecheck, lint, fmt, coverage, `test:bun`, build, publint, pack dry-run, and the optional browser e2e |
| `pages.yml` | `bun-version`, `site-dir` | builds and deploys the Starlight site |
| `docker.yml` | `dockerfile`, `image-name`, `smoke-paths`, `smoke-env` | builds, smoke-tests and pushes to GHCR |
| `release-prepare.yml` | — | checks out the tag, runs the gate, builds, runs publint, uploads the tarball as an artifact, and extracts release notes from the CHANGELOG |

- Each repo keeps a small `release.yml` that calls `release-prepare` and then runs **`npm publish
  --provenance` itself**, from the downloaded tarball, and creates the GitHub release. The trusted
  publisher stays registered against that repo's own `release.yml`.
- Each product's `docker.yml` caller has `workflow_dispatch` (plus its usual triggers), so an image can
  be rebuilt on demand to pick up a kit patch (ADR 0007). The reusable workflow installs without a
  stale lockfile pin on the kit: it runs `bun update @xtandard/kit` inside the image build when the
  `refresh-kit` input is true.
- Callers pin `@v0.MINOR` (ADR 0007) and declare permissions: `id-token: write`, `pages: write`,
  `packages: write`.

## Consequences

- One place to bump Bun or service images, and the products' workflows become about 20 lines each.
- The publish step remains duplicated (about 15 lines per repo). That is deliberate, to stay within
  what npm's trusted publishing reliably supports.
