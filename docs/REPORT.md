# Report: extracting @xtandard/kit and migrating the five products

The five xtandard products copied their infrastructure from each other. That code now lives once,
in `@xtandard/kit`, and each product builds on it.

- **Kit:** [`@xtandard/kit`](https://www.npmjs.com/package/@xtandard/kit) 0.1.1 (0.1.0 was the
  owner's manual first publish; 0.1.1 is from `kit-release.yml`, with provenance).
- **Docs site:** <https://me.xantiagoma.com/xtandard-kit/>.
- **Design:** [`PLAN.md`](../PLAN.md) and the ADRs in [`docs/ADR/`](ADR/).
- **Inventory:** [`docs/research/inventory.md`](research/inventory.md).

## What moved where

Each product keeps every subpath and exported name. A thin wrapper passes the product's own names
and defaults to the kit (ADR 0002, 0010).

| Area                         | Kit subpath                                                          | What the products kept                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Storage contract, 10 drivers | `storage`, `storage/<driver>`, `storage/<driver>/internals`          | Wrappers that pass table, Mongo and channel names. Capability layers stay in the product: webhooks' due queue (`onWrite`, Lua), audit's events tables. |
| Drizzle tables               | `drizzle/{pg,mysql,sqlite}`                                          | `pg<P>Table` / `mysql<P>Table` with the collation each product shipped.                                                                                |
| Conformance suite            | `storage/testing`                                                    | Each product runs it over its wrapped drivers, plus its own cases.                                                                                     |
| Auth, authorization          | `auth/*`, `authorization`                                            | Realm, roles and action lists.                                                                                                                         |
| Hooks                        | `hooks`, `hooks/log`                                                 | Hook names and event types.                                                                                                                            |
| Scoped tokens                | `tokens`                                                             | Prefix, TTL and claims validators.                                                                                                                     |
| Util                         | `util`, `util/core`                                                  | Id formats, key roots, `maxLength`.                                                                                                                    |
| Panel, router, OpenAPI       | `server`, `server/router`                                            | Routes and the readonly status. Entitlements uses `createRouter`; the others keep hand-written routers on the kit's plumbing.                          |
| Adapters                     | `server/{express,elysia,hono,next,node}`                             | Product-named helpers.                                                                                                                                 |
| CLI plumbing                 | `cli`                                                                | Env roles, defaults, help text (`storageRegistryFrom` in wh, au, fl, en).                                                                              |
| Admin UI shell and embed     | `ui`, `ui/embed`, `ui/styles.css`                                    | Views. Some products keep their own layout pieces (see Known gaps).                                                                                    |
| Build tooling                | `build`, the `xtandard-kit` bin, `tsconfig/*`                        | `scripts/` that are product-specific.                                                                                                                  |
| Docs-site tooling            | `site`                                                               | Content.                                                                                                                                               |
| Workflows                    | `ci.yml`, `pages.yml`, `docker.yml`, `release-prepare.yml` (`@v0.1`) | A small `release.yml` per repo, because trusted publishing validates the caller.                                                                       |

## LOC per repo

The figures are for each migration's squash merge, excluding lockfiles.

| Product      | PR                                                                 | Merge     | Files | Added | Removed | `src/` added / removed | API surface |
| ------------ | ------------------------------------------------------------------ | --------- | ----- | ----- | ------- | ---------------------- | ----------- |
| webhooks     | [#16](https://github.com/xantiagoma/xtandard-webhooks/pull/16)     | `4937cf8` | 122   | 1,932 | 7,141   | 996 / 4,702            | +5 / −0     |
| flags        | [#24](https://github.com/xantiagoma/xtandard-flags/pull/24)        | `7095c25` | 126   | 1,750 | 7,526   | 876 / 4,278            | +9 / −0     |
| audit        | [#26](https://github.com/xantiagoma/xtandard-audit/pull/26)        | `0c8c685` | 129   | 2,007 | 7,710   | 1,142 / 4,666          | +8 / −0     |
| links        | [#20](https://github.com/xantiagoma/xtandard-links/pull/20)        | `524bbc4` | 125   | 1,683 | 7,541   | 885 / 4,481            | +6 / −0     |
| entitlements | [#26](https://github.com/xantiagoma/xtandard-entitlements/pull/26) | `095b4d6` | 134   | 1,901 | 8,158   | 1,100 / 5,232          | +1 / −0     |
| **Total**    |                                                                    |           | 636   | 9,273 | 38,076  | 4,999 / 23,359         | 0 removed   |

The products net 28,803 fewer lines, 18,360 of them in `src/`. The kit adds one copy of the code,
with tests.

## How to verify

- **Kit:** `bun run check && bun run test && bun run test:bun`. `kit-ci.yml` runs the same with the
  live backends (Postgres, MySQL, Redis/RedisJSON, Mongo).
- **The kit on npm:** `npm view @xtandard/kit@0.1.1 dist.attestations` shows the provenance.
- **Each product:** CI on `main` is green, including live MySQL with `padSpaceKeys`, Docker and
  Pages. Locally: `bun install && bun run check && bun run test && bun run test:bun && bun run build`.
- **No API removals:**
  `xtandard-kit api-surface --diff <before.json> <after.json>` on the product, comparing the last
  release (or `origin/main` before the merge) with the current `main`.
- **Stored data:** `test/fixtures/stored-data/` in the kit holds every product's legacy on-disk and
  on-wire forms. `storage-stored-data.test.ts` reads, lists and swaps them.
- **Ecosystem:** the kit's row is in the README ecosystem table of all five products, xtandard,
  xyte and xtandard-image, and on each product's docs-site home page (`site/content/index.mdx`).

## Known gaps

- **Kit papercuts** (entitlements' feedback, 0.1.2 candidates):
  - `describeStorage` has no `driver` override (en keeps a `withDriver` env-spread helper);
  - `storageRegistryFrom` is not generic, so wh and en cast its result;
  - `StorageConfig` fields stay `string | undefined` even when the role gives a default.
- **Optional adoptions not done** (behaviour or layout would change):
  - the declarative router and OpenAPI generator (wh, fl, au, li keep theirs on the kit's plumbing);
  - `ShellFrame` in links, and `SectionCard` in webhooks (the kit's version adds named regions);
  - the kit's `relativeTime` and `formatDateTime` in webhooks (different rounding);
  - `runEmbedThemeE2e` in webhooks;
  - `createExampleRunner` and `storageRegistryFrom` in links (links keeps one memory store per
    process).
- **Preserved quirks:**
  - links' CLI uses the Mongo collection `links`, while its library default is `links_kv`, as before;
  - links' CI pins Bun 1.4.4 (the others use 1.3.14).
- **Docker images** bundle the kit at build time. A kit patch reaches them only through a rebuild:
  `docker.yml` with `refresh-kit: true`, or a lockfile bump (ADR 0007).
- **MySQL PAD SPACE:** existing `utf8mb4_bin` tables now reject keys that differ only by trailing
  spaces (`KeyCollisionError`, with the migration SQL), where they used to merge them silently.
  NO PAD collations are opt-in for new tables (ADR 0005).

## How to add a fix once

The full steps are in [`CLAUDE.md`](../CLAUDE.md#how-to-add-a-fix-once).

1. Reproduce the bug in the kit: a conformance case for storage, otherwise a unit test.
2. Fix it in the kit only.
3. Release a kit PATCH; the CHANGELOG names the affected products.
4. The products get it without a release, because they depend on `^0.1.x`. Refresh their lockfiles
   so their CI tests the fix.
5. Rebuild their Docker images (`docker.yml`, `refresh-kit: true`).
6. A product release is needed only when the fix touches product code, or the product moves to a
   new kit MINOR.
