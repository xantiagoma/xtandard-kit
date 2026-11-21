# PLAN — `@xtandard/kit`

The shared building blocks of the xtandard control-plane products, written once. Every fix lands in
one place and reaches all five products.

- Inputs: [`docs/research/inventory.md`](docs/research/inventory.md) (what exists, which copy is best,
  which fixes are missing where) and [`MISSION.md`](MISSION.md).
- Decisions are recorded as ADRs in [`docs/ADR/`](docs/ADR/).

## 1. Goals and non-goals

**Goals**
1. One implementation of each shared piece, assembled from the best copy and carrying every bug fix
   from every copy (inventory §3).
2. Each product stays installable on its own. The kit is a regular `dependency` of each product, and
   users never install or configure it.
3. The products' public API keeps working: subpaths, exported names, config shapes, CLI, HTTP API and
   stored data. Anything that cannot stay compatible goes in the product CHANGELOG with a Migration
   section.
4. "Add a fix once": a kit patch release reaches every product's users without a product release
   (ADR 0007).

**Non-goals**
- Product logic stays in the products:
  - webhooks' delivery queue;
  - audit's event log;
  - entitlements' counters, for now (a later kit capability, see §9);
  - route tables, views and seed data.
- No forced rewrite of the products' routers onto the kit's declarative route table. The kit offers
  it; adopting it is optional per product.
- No change to stored data formats or HTTP status codes as a side effect of moving code (ADR 0005,
  ADR 0010).

## 2. What goes in the kit

Rule (ADR 0002): the kit gets **mechanism**; the product keeps **policy and data**. If something only
differs between products by name, enum lists or defaults, it goes to the kit with those as parameters.
If it encodes a product's domain, it stays.

| Kit module | Built from (inventory) | Product supplies |
|---|---|---|
| storage contract `KvStorage` + capabilities (`watch`, `compareAndSwap`), guards, `withWatch`, `pgListenNotify`, `requirePeer` | any (≡) | type aliases (`WebhooksStorage = KvStorage`…), channel name |
| storage util: `escapeLike/Glob/RedisGlob/Regex`, `canonical`, `canonicalJson`, `deepEqual` (own-props), `assertIdentifier`, key-segment helpers (`encodeSegment`, `lastSegment`, `sortableLeaf`) | en `util.ts`, au keys, wh `dueKey` | key layouts (`keys.ts`) |
| drivers: memory, file, sqlite, libsql (shared `sqlite-kv`), postgres, mongodb, redis + RedisJSON, cloudflare-kv, unstorage, drizzle | en + li SCAN de-dup + escaped PSUBSCRIBE + wh `migrateFileStorage` + fl legacy read-through | default table/db/collection names, product capability layers |
| drizzle KV table factories + column helpers (`textC`, `binVarchar`) | en | default table name, product tables |
| conformance suite `@xtandard/kit/storage/testing` | union of li + en + wh sortable case + new cases (SCAN dupes, PSUBSCRIBE globs, empty segments, legacy-value CAS) | extra product suites |
| auth `contract/none/basic/delegated` | any (≡) | default realm |
| authorization `contract` (`defineActions`), `none`, `delegated`, `roles` | en layout | action/resource unions, `DEFAULT_ROLE_POLICY` |
| hooks runner (`HookDeniedError`, `runBefore/After`, `normalizeHooks`, reporter) + `hooks/log` | any + en `json` | event unions, log `source`/`describe` |
| HTTP plumbing: `base-path`, `cors`, `static-assets`, `renderIndexHtml`, `json/error/match/isNamed/mapError`, auth + scoped-token short-circuit, `authorize`, panel `createPanelHandler` (healthcheck, no-cache SPA, `close()`, background tasks) | li render + en skeleton + au/li/en `match` | `globalName`, bootstrap, API handler, error map, readonly status |
| declarative router + OpenAPI generator (optional) | en | route table, schemas |
| scoped tokens `createScopedTokens` | en (empty-secret check, `now`) | prefix, claims validator, TTL |
| adapters: bun, hono (`waitUntilOf`), express + Node bridge (shared with the CLI), elysia/elysia2 `createPass`, next `toNextHandler` | li + au + en merge | panel factory names, typed Elysia chain |
| CLI plumbing `createCli`: `env`, `parseArgs`, storage-from-env, `buildAuthFromEnv` (rejects unknown `AUTH_MODE`), `startServer`, `serve`, self-run guard | au/en loader, li+en parser, en auth, au guard | env prefix/roles, commands |
| utils: `duration` (+`w`, `parseDurationList`), `canonicalStringify`, `createIdGenerator` (ULID + legacy formats), validation core, `JsonValue`/`Duration`/`Actor` | en/au/li | id format, prefixes |
| testing helpers: `createTestClock`, `collectingSink` | en, au/li | — |
| UI kit `@xtandard/kit/ui`: primitives, Toast, ThemeToggle, theme (fl API + wh guard), `createApiClient`, `takeTokenFromUrl`, `bootSpa`, `ShellFrame` + `useShellConfig`, bits, format, BrandMark, base `styles.css` | see inventory §2.3 | views, tabs, scope switcher, brand tokens, scope class, config global |
| embed `@xtandard/kit/ui/embed`: `createEmbed` | li routing + invalidation, fl theme, en portal flag | component names, initial-scope props |
| build tools `@xtandard/kit/build` + `xtandard-kit` bin: `scope-embed-css` (fl), `fix-elysia2-types`, vite/vite-plus/playwright config factories, tsconfig bases, example runner (en shape), API-surface snapshot | inventory §2.4 | entries, thresholds, ports |
| docs site `@xtandard/kit/site`: `typedoc-plugin`, `api-overviews` (fl), `sync` (fl+au, one pending design), `defineXtandardSite` | inventory §2.4 | sidebar, `apiOwners`, copy, palette |
| reusable workflows `.github/workflows/{ci,pages,docker,release-prepare}.yml` (`workflow_call`) | ≡ + drift fixed | inputs (services, bun version, smoke paths) |

## 3. Subpath layout (ADR 0001)

Each optional peer belongs to one subpath, and nothing imports a peer at module top level.

```
@xtandard/kit                         ← root index re-exports nothing heavy (types + tiny utils)
@xtandard/kit/storage                 ← contract, guards, withWatch, pgListenNotify, util, key helpers
@xtandard/kit/storage/{memory,file,sqlite,libsql,postgres,mongodb,redis,cloudflare-kv,unstorage,drizzle}
@xtandard/kit/storage/<driver>/internals ← semi-public connection/codec/executor helpers (ADR 0004)
@xtandard/kit/storage/testing         ← conformance suite (runner injected)
@xtandard/kit/drizzle/{pg,mysql,sqlite}
@xtandard/kit/auth                    ← contract;  /auth/{none,basic,delegated}
@xtandard/kit/authorization           ← contract + defineActions;  /authorization/{none,roles,delegated}
@xtandard/kit/hooks                   ← runner;  /hooks/log
@xtandard/kit/server                  ← panel handler, plumbing, cors, base-path, static, index.html
@xtandard/kit/server/router           ← declarative router + OpenAPI generator
@xtandard/kit/tokens                  ← scoped HMAC tokens (WebCrypto)
@xtandard/kit/adapters/{bun,hono,express,node,elysia,next}
@xtandard/kit/cli
@xtandard/kit/util                    ← duration, canonical, ids, validation core, json types
@xtandard/kit/testing                 ← test clock, collecting sink
@xtandard/kit/ui   /ui/embed   /ui/styles.css
@xtandard/kit/build                   ← config factories + scope-embed-css + api-surface (bin: xtandard-kit)
@xtandard/kit/site
@xtandard/kit/tsconfig/*.json
```

- **Peers.** `redis`, `mongodb`, `pg`, `@libsql/client`, `drizzle-orm`, `unstorage`, `elysia`, `hono`,
  `express`, `react`, `react-dom`, `@base-ui-components/react`, `lucide-react`, `wouter`,
  `@tanstack/react-query`, `postcss`, `astro`, `@astrojs/starlight`, `typedoc` and the vite-plus
  toolchain are all **optional peers**.
- **Runtime dependencies:** `valibot` only. The products already depend on it.

## 4. How products consume the kit (ADR 0003)

Products depend on `@xtandard/kit` at `^0.MINOR.0`, which ZeroVer reads as "same minor". Their
bundler leaves the kit external, so a kit patch reaches users with no product release.

A product keeps its own files and subpaths. They become thin:

```ts
// xtandard-webhooks/src/entry-storage-postgres.ts — subpath unchanged
export { type PostgresStorageOptions, type SqlClient } from "@xtandard/kit/storage/postgres";
export { createPostgresStorage, type PostgresWebhooksStorage } from "./storage/postgres.ts";

// xtandard-webhooks/src/storage/postgres.ts — product defaults only
import * as kit from "@xtandard/kit/storage/postgres";
export type PostgresWebhooksStorage = kit.PostgresKvStorage;
export const createPostgresStorage = (o: kit.PostgresStorageOptions = {}) =>
  kit.createPostgresStorage({ table: "xtandard_webhooks", ...o }); // stored-data default stays
```

**Rules for product wrappers:**
- Product-prefixed names stay (`webhooksPanel`, `WebhooksStorage`, `ElysiaWebhooksHandler`…), as
  aliases or thin wrappers.
- Product defaults stay. Every default that affects stored data or the HTTP API is passed explicitly
  by the product: table names, key roots, id format, readonly status, token prefix, realm, config
  global, theme key and scope class.
- Product capabilities attach through kit extension points:
  - wh `claimDue` attaches to the memory/redis drivers through the `onWrite` hook plus the exported
    connection and codec;
  - au's event log attaches through the exported SQL executors and `ready`;
  - en's counters attach through the exported connection helpers.
- **API-surface gate.** Before and after each migration, `xtandard-kit api-surface` records, for every
  subpath, the runtime export names (by importing `dist/`) and the exported type names (from the
  `.d.mts`). The PR must show no removals. Additions are fine.

## 5. Shared conformance suite (ADR 0006)

```ts
import { describe, expect, test } from "vitest"; // or bun:test
import { runStorageConformance } from "@xtandard/kit/storage/testing";
runStorageConformance("postgres", () => createPostgresStorage(...), {
  t: { describe, test, expect },
  capabilities: { compareAndSwap: true, watch: false },
  keyRoot: "whk",
});
```

- **Cases:** the union of the current suites. Added on top:
  - empty segments;
  - `$`, `#`, unicode;
  - many keys (pagination);
  - SCAN duplicates;
  - `PSUBSCRIBE` with glob characters in the prefix;
  - legacy, non-canonical values for CAS.
- **Products** call the kit suite for their wrapped drivers and keep their own extra suites (claimDue,
  event log, counters).
- **Live backends** are gated by environment variables only (`REDIS_URL`, `MONGO_URL`, `POSTGRES_URL`,
  `MYSQL_URL`). CI uses `redis:8`, so RedisJSON runs too. The kit repo runs the whole matrix
  (Docker-backed locally through `heavy.sh`).

## 6. Versioning policy (ADR 0007)

**Kit releases (ZeroVer):**
- `0.MINOR.PATCH`. A breaking change bumps MINOR; fixes and additions bump PATCH.
- The reusable workflows follow the same tags. Products reference `@v0.MINOR` (a moving tag per minor),
  so workflow fixes reach them as well.

**Products:**
- A product moves to a new kit MINOR in its own release. The kit's types appear in the product's
  `.d.mts`, so the product bumps too (a MINOR in ZeroVer if its own surface changes, a patch
  otherwise).

**"Fix once" flow:**
1. Fix the bug in the kit and add a conformance or unit case.
2. Release a kit patch.
3. Products' users pick it up on install. Products only refresh their lockfile and CI.

## 7. Migration order and per-product checklist (phase 4)

Order: **webhooks → flags → audit → links → entitlements.**
- webhooks first: it is the origin, it has the fewest extensions, and it carries stranded fixes.
- flags next: the closest copy, and it has the most gaps (no CAS, auth-throw, guard).
- audit next: its event-log layer exercises the extension points.
- links next.
- entitlements last: most of the kit comes from it, so its PR is mostly deletions.

One PR per repo, developed against `file:../xtandard-kit`. It merges only after the kit is on npm.
Each PR:
1. Takes an API-surface snapshot (before).
2. Replaces the copied modules with kit imports and product wrappers. Product capability layers move
   onto the extension points.
3. Deletes dead copies: code, duplicated tests (now in the kit) and `scripts/*` replaced by
   `xtandard-kit` bin commands.
4. Keeps product tests, and runs the kit conformance suite against the product's wrapped drivers.
   Persisted-data fixtures (legacy file stores, unstorage keys, SQL rows written by the previous
   release) must still read back.
5. Moves its workflows onto the kit's reusable ones. The `npm publish` step stays in the product's own
   `release.yml` (ADR 0009).
6. Takes an API-surface snapshot (after) and diffs it: no removals. Then `bun run check`, the full
   tests, `test:bun`, e2e and a docs build.
7. Updates the CHANGELOG entry: behaviour changes that come from inheriting fixes (inventory §3.2),
   plus a Migration section if anything is not compatible.
8. Adds the kit to the "The xtandard ecosystem" section in the README, `site/` and `docs` (phase 5).

**Behaviour changes inherited from the kit** are deliberate bug fixes, and each is listed in the
product CHANGELOG. Examples:
- unknown `STORAGE_DRIVER` fails;
- multiple `Set-Cookie` headers are kept;
- index.html escapes the title;
- malformed `%` in a path gives 404/400, not 500.

## 8. Phase 3 build plan (kit repo)

| Step | Scope | Worker |
|---|---|---|
| 0 | Repo skeleton, mirroring flags: package.json, vite-plus config, tsconfigs, husky, CI, README with the ecosystem section, CLAUDE.md, CHANGELOG, `docs/`, `site/` stub. Create the GitHub repo. | lead |
| 1 | storage contract + util + all drivers + drizzle tables + conformance suite + driver tests | worker A (largest) |
| 2 | auth, authorization, hooks, util, tokens, server plumbing + router/OpenAPI, adapters, CLI + tests | worker B |
| 3 | UI kit + embed + build tools (scope-embed-css, config factories, api-surface) + site tooling + reusable workflows | worker C |
| 4 | Docs site live, `npm pack --dry-run` + publint clean, release workflow → **READY TO PUBLISH** | lead |

- At most 3 workers at once, each in its own worktree with disjoint directories.
- Heavy jobs (full suites, builds, Docker) go through `heavy.sh`.

## 9. Risks and open questions

- **Canonical-JSON CAS on legacy rows.** SQLite text and Mongo BSON field order would make CAS fail
  forever on rows written before canonicalisation. The kit CAS does a canonical fast path, then a
  structural fallback that reads, runs `deepEqual` and swaps on the raw value (ADR 0005). A dedicated
  conformance case covers it.
- **unstorage `$` escaping.** Encoding every `$` (en) would orphan existing keys that contain `$` in
  wh/fl/au/li. The kit encodes only a trailing `$` and reads through to the legacy key (ADR 0005).
- **Tailwind scanning of kit UI classes.** The kit ships `@source` in its stylesheet, and products
  import it. This needs verification in the first product (webhooks).
- **Elysia Eden types** need literal chains. Products keep their typed chain on top of the kit's
  `createPass`.
- **Trusted publishing via a reusable workflow** is fragile: npm validates the calling workflow. So
  `npm publish` stays in each repo's `release.yml`; only preparation is shared (ADR 0009).
- **Later kit capabilities, not in this mission:**
  - en's `CounterStore` as a generic counter port;
  - wh's due-queue as a generic lease queue.
