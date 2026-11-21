# Changelog

All notable changes to `@xtandard/kit` are documented here. The project uses ZeroVer (`0.x`): a
MINOR bump is breaking, a PATCH bump is a fix or a backwards-compatible addition (ADR 0007). Each
entry names the products it affects: wh = webhooks, fl = flags, au = audit, li = links,
en = entitlements.

## v0.1.0

The first release: one implementation of the infrastructure the five xtandard products copied from
each other. It takes the best piece of each copy and every bug fix from every copy. See
[`docs/research/inventory.md`](docs/research/inventory.md) for what it replaces, and
[`PLAN.md`](PLAN.md) and [`docs/ADR/`](docs/ADR/) for the design. All five products are affected.

### Storage

- **`@xtandard/kit/storage`.** The neutral `KvStorage` contract with the `watch` and
  `compareAndSwap` capabilities and their guards. `TransactionalKvStorage` is kept as a deprecated
  type only. Also:
  - `withWatch` (spread-safe) and `pgListenNotify` (the channel is a parameter);
  - escaping, canonical-JSON and key-segment helpers.
- **Ten drivers,** with compare-and-swap on every one except Cloudflare KV and unstorage:
  - memory (`onWrite` hook);
  - file: atomic writes, empty-segment encoding, legacy `ignore`/`warn`/`read-through` modes,
    `migrateFileStorage`;
  - `bun:sqlite` and libSQL: one shared core, `GLOB` prefixes;
  - Postgres: `COLLATE "C"` on new tables, `postgresStorageSchema`;
  - MongoDB: `$expr`/`$literal` CAS;
  - Redis and RedisJSON: SCAN results de-duplicated, glob-escaped `PSUBSCRIBE`, an `onWrite` hook,
    sorted-set commands on `RedisLike`;
  - Cloudflare KV;
  - unstorage: trailing-`$` and empty-segment encoding, with legacy read-through;
  - Drizzle on Postgres, MySQL and SQLite: dialect detection, `KeyCollisionError`.

  Peers load lazily, and `…/internals` subpaths expose connections, executors and codecs for product
  capabilities (ADR 0004).
- **Drizzle table factories** `drizzle/{pg,mysql,sqlite}`: `pgKvTable`, `mysqlKvTable`,
  `sqliteKvTable` with a required `name`, `textC`, `binVarchar`, and `keyCollation` options. These
  keep existing schemas stable.
- **Stored data stays compatible (ADR 0005):**
  - writes are canonical JSON;
  - compare-and-swap still works on legacy non-canonical rows, documents and values;
  - new-table DDL only;
  - permanent stored-data fixtures for every product's legacy representations.
- **`@xtandard/kit/storage/testing`:**
  - the runner-injected conformance suite (vitest or `bun:test`): the union of every copy's cases
    plus new regression cases;
  - declared capabilities are checked against the storage, so cases are never skipped silently;
  - `fakeRedis()` with an `eval` hook for a product's own Lua scripts.
- **Fixed in every copy:**
  - MySQL: `getKeys` skipped keys with supplementary characters such as emoji, because an indexed
    `LIKE` on `utf8mb4_bin` misses them. It now uses a range scan plus `startsWith`.
  - MySQL: keys that differ only by trailing spaces collided on a `utf8mb4_bin` key, which is
    PAD SPACE. Reads, removes and swaps are now byte-exact, and a colliding write throws
    `KeyCollisionError` with migration SQL. NO PAD collations are opt-in.
  - unstorage, Postgres and Drizzle: stored strings that look like JSON (`"123"`) came back parsed
    (`123`).
  - Redis CAS treated `{}` and `[]` as equal.
  - A failed connection or DDL is retried instead of being cached forever.
- **Fixed in some copies** (inventory §3.2), now everywhere:
  - file-watch removals and atomic file writes;
  - escaped Redis `PSUBSCRIBE` and SCAN de-duplication;
  - empty key segments;
  - unstorage `$`;
  - Postgres `COLLATE "C"`, SQLite `GLOB`, the Mongo `startsWith` post-filter;
  - canonical JSON;
  - Mongo CAS with `$`-prefixed keys, MySQL Drizzle CAS;
  - `deepEqual` own-properties check.

### Server

- **`auth`:** `none`, `basic` and `delegated`, with a parameterised realm.
- **`authorization`:**
  - `defineActions` (typed action lists → sets and predicates);
  - the role engine with readonly `RolePolicy` arrays, `none` and `delegated`.
- **`hooks`:** the generic before/after runner, `isNamed` for cross-bundle errors, and `hooks/log`
  with `json`, `source` and `describe`.
- **`tokens`:** `createScopedTokens`. It verifies every product's existing portal and viewer tokens,
  rejects an empty secret, supports secret rotation and takes an injectable clock.
- **`util`:**
  - durations, including weeks, and `parseDurationList`;
  - id generators in the three persisted formats (monotonic, integer milliseconds);
  - the validation core: finite JSON values, no trailing `.` in root issue paths,
    `validateKeySegment`, `validateUrl`, `parseInput`.
- **`testing`:** `createTestClock` and `collectingSink`.
- **`server`:**
  - `createPanelHandler`: in-panel `/healthcheck`, `no-cache` SPA HTML, `close()` for background
    tasks;
  - `renderIndexHtml` escapes the title, base href and U+2028;
  - `match()` treats a malformed `%` escape as no match (404), not a 500;
  - name-based `mapError`, including `*TokenError` → 401 across bundles;
  - a throwing auth provider is a 500, not a 401;
  - scoped tokens never fall back to host auth;
  - `node:fs` loads lazily, for Workers.
- **`server/router`:** a declarative router with `405` + `Allow` and a parameterised readonly status,
  plus OpenAPI generated from the route table with an explicit version.
- **Adapters:**
  - one Fetch↔Node bridge for Express and the CLI: it keeps every `Set-Cookie`, streams with
    backpressure, appends multi-value headers and re-serialises parsed bodies;
  - Elysia `createPass` (PATCH/DELETE, stale `content-length`, multi-mount, a `raw` route) on
    Elysia 1 and 2;
  - Hono `mountPanel`/`waitUntilOf`;
  - Next `toNextHandler`.
- **`cli`:**
  - `AUTH_MODE` and `STORAGE_DRIVER` fail closed on unknown values, and empty variables count as
    unset;
  - `storageFromEnv` is generic over product roles, with per-role table names;
  - connection strings stay out of the startup banner;
  - `isMainModule` is the self-run guard.

### UI

- **`@xtandard/kit/ui`, `/ui/embed`, `/ui/styles.css`:** the shared admin shell:
  - primitives, a theme store keyed per product, `createApiClient`, `takeTokenFromUrl`, `bootSpa`;
  - `ShellFrame` + `useShellConfig`, bits, format helpers, `BrandMark`;
  - `createEmbed`;
  - a base stylesheet with `@source` for Tailwind.
- **UI fixes carried over:**
  - the portal waits for `/config`, and a token means portal (wh lacked this);
  - the token is stripped from the URL (wh, au, li lacked this);
  - memory routing keeps the query string, and swapping the token refetches (wh, au, en lacked
    this);
  - the host-theme watcher guards a missing `MutationObserver` (fl lacked this).

### Tooling

- **`@xtandard/kit/build` and the `xtandard-kit` bin:**
  - `scope-embed-css`, `fix-elysia2-types`;
  - `api-surface [--diff]`, the no-removals gate for migrations and kit patches;
  - config factories for vite-plus, the UI, the embed and Playwright;
  - the example runner, reusable embed-CSS and theme test suites, `tsconfig/{base,react}.json`.
- **`@xtandard/kit/site`:** the docs-site tooling (manifest, sync with one pending-guide design, the
  TypeDoc plugin naming each entry after its subpath, API overviews, `defineXtandardSite`).
- **Reusable GitHub workflows:**
  - `ci.yml`: optional services, and redis:8 so RedisJSON runs;
  - `pages.yml`;
  - `docker.yml`: smoke-tested before push, `refresh-kit` for kit patches;
  - `release-prepare.yml`: `npm publish` stays in each repo's own workflow, for trusted publishing.

  The kit's own site is live at https://me.xantiagoma.com/xtandard-kit/.
