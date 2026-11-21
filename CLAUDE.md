# @xtandard/kit

The shared building blocks of the xtandard products (webhooks, flags, audit, links, entitlements).
It is one npm package with subpath exports. Bun is used for tooling, and `vp` (vite-plus) for build,
test, lint and format.

Before committing, run `bun run format`, then `bun run check` (subpath sync, lint, format check and
typecheck). `bun run test` and `bun run test:bun` are the gate.

- **Project files:**
  - `PLAN.md`: plan and phases.
  - `docs/ADR/`: decisions.
  - `WORKLOG.md`: progress.
  - `docs/research/inventory.md`: the five copies this kit replaces.
  - `MISSION.md`: the brief. Never edit it.
- **Subpaths have one source of truth: `scripts/subpaths.ts`.** To add a subpath:
  1. Add it to `SUBPATHS`.
  2. Run `bun scripts/subpaths.ts --write`. This regenerates `package.json#exports` and creates the
     `src/entry-*.ts` stub. `vite.config.ts` reads the pack entries from the same file.
  3. Make sure each entry starts with a `@module` doc comment.
- **Boundary (ADR 0002):** the kit holds mechanism. Product names, enums and defaults are parameters,
  never constants. There is no global product config; each factory takes its own options.
- **Optional peers** are imported dynamically behind `requirePeer`, never at module top level.
  `valibot` is the only runtime dependency.
- **Stored data (ADR 0005):** never change an on-disk or on-wire representation without a read path
  for the old one. The stored-data fixtures in `test/fixtures/stored-data/` must keep passing.
- **Public behaviour (ADR 0010):** behaviour a product documents (status codes, token prefixes, id
  formats) is a parameter. Bug fixes apply everywhere.
- **Tests:**
  - `test/*.test.ts` run under vitest; `test/*.bun.test.ts` run under `bun test` (`bun:sqlite`);
    `test/*.elysia2.test.ts` run against Elysia 2.
  - Live backends run only when `REDIS_URL`, `MONGO_URL`, `POSTGRES_URL`, `MYSQL_URL` or
    `REDIS_JSON_URL` is set.
  - On the shared machine, run heavy jobs through `/Users/santi/Projects/xtandard-missions/heavy.sh`.

## How to add a fix once

1. **Reproduce in the kit.**
   - For storage, add a case to the conformance suite (`src/storage/testing/`). It then runs against
     every driver here and in every product's CI.
   - Otherwise, add a unit test next to the module.
2. **Fix it in the kit.** Do not patch a product's copy. Products only wrap kit code.
3. **Release a kit PATCH** (`0.MINOR.PATCH`, ADR 0007). The CHANGELOG entry names the affected
   products.
4. **Products pick it up without a release,** because they depend on `^0.MINOR.0` and users get the
   patch on their next install. Refresh each product's lockfile so its CI tests the fix.
5. **Docker images are the exception.** The GHCR images (`apps/standalone`) bundle their dependencies
   at build time. For a security fix, re-run each product's `docker.yml` with `refresh-kit: true`, or
   merge a lockfile bump. Say "rebuild images" in the kit CHANGELOG.
6. **A product release is needed only when** the fix touches product code, or the product moves to a
   new kit MINOR.

## Docs Site

`site/` is an Astro Starlight site, deployed to https://me.xantiagoma.com/xtandard-kit/. It has its own
`package.json` and lockfile and is not published. `README.md` and `docs/*.md` are the source of truth.
The API reference has one module per `exports` entry.
