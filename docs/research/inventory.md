# Inventory: shared infrastructure across the xtandard products

Phase 1 of the `@xtandard/kit` mission. It diffs the infrastructure that `@xtandard/webhooks` (origin),
`flags`, `audit`, `links` and `entitlements` copied from each other. For each area it records:

- whether the copies are identical, identical modulo names, or diverged;
- which copy is best;
- LOC per copy;
- which bug fixes each copy has or lacks.

Snapshot: 2026-11-21, at the products' `main` heads: webhooks `a76c95e` (v0.2.0), flags `ad19639` (v0.2.0),
audit `2e0c65a` (v0.1.1), links `0cb0ccc` (v0.1.1), entitlements `b09be30` (0.1.1+).

Repos are abbreviated **wh** webhooks · **fl** flags · **au** audit · **li** links · **en** entitlements.
"≡names" means the copies are identical once the product name is normalised.

| Detail | File |
|---|---|
| Storage: contract, 10 drivers, watch, drizzle tables, keys, conformance suite, CI services | [`inventory/storage.md`](inventory/storage.md) |
| Server: auth, authorization, hooks, adapters, `server/*`, portal tokens, CLI, utils, standalone image | [`inventory/server.md`](inventory/server.md) |
| UI + tooling: React admin shell, embeds, docs-site tooling, build/test config, scripts, workflows | [`inventory/ui-tooling.md`](inventory/ui-tooling.md) |
| Method, per-file diff matrix, area LOC, fix-commit list | [`inventory/data/`](inventory/data/) |

**Method.**
1. `inventory/data/matrix.ts` takes every file present in at least 2 repos, normalises the product
   name (`webhook(s)`/`flag(s)`/… → `xprod`, all casings) and counts the differing lines against
   webhooks. The result is `matrix.tsv`.
2. Every `fix…` commit in each repo is listed in `fixes.txt`.
3. Each area was then read file by file. Every fix was verified in the current code of all five repos,
   not taken from commit messages. Many fixes were ported, or written in from the start, without a
   `fix` commit.

## 1. Verdict

- **The copying is real and large.** About 175 files exist under the same path in all five repos.
- **Byte-identical code is rare.** Only these files are byte-identical in all five:
  - UI primitives: `Toast`, `ThemeToggle`, `ui-bits`, `utils`, `nav-guard`;
  - `static-assets.ts`, `vendor.d.ts`, the tsconfigs and the husky hooks.
- **Identical modulo names:** auth, `cors`, `base-path`, `watch`, `cloudflare-kv`, `typedoc-plugin`,
  `fix-elysia2-types` and the `bin/` shims.
- **Everything else diverged, for two reasons.** Part of it is product extension: delivery queue,
  event log, counters, scope switchers. The rest is **drift**: hardening done in one copy and never
  propagated back.
- **The five named storage bugs were propagated by hand.** MySQL collation + `LIKE … ESCAPE`, file
  case collisions, unstorage key normalisation, Redis SCAN MATCH escaping, and SQL getKeys prefix
  filtering are fixed in **all five** copies today (storage.md §4, F1–F10). That cost five fix
  rounds.
- **The drift left at least 30 fixes stranded in one or two copies.** These are listed in §3. Some
  examples:
  - wh/fl miss two Redis watch/SCAN fixes;
  - wh/fl/au render the panel title unescaped into HTML;
  - every copy except li collapses multiple `Set-Cookie` headers in the Express bridge;
  - wh, fl and li fall back to the open `file` driver on a typo in `STORAGE_DRIVER`. Every copy except
    en treats a typo in `AUTH_MODE` as `none`, which leaves the panel **open**;
  - wh's portal SPA fires admin requests before `/config` returns.
- **The newest copy is usually, but not always, the best.**
  - en is the best base for storage (shared `util.ts`, canonical JSON, single-statement CAS on every
    dialect, `COLLATE "C"`, DDL retry) and for the router/OpenAPI: a declarative route table that
    generates the docs.
  - li has the best HTTP plumbing (Express bridge, index.html escaping, Elysia multi-mount, embed
    routing and token invalidation).
  - au has the best ids (monotonic ULID), `canonical`, streaming responses and the CLI self-run guard.
  - fl has the best theme API and `scope-embed-css`.
  - The kit therefore takes the **best piece of each copy**, not one repo wholesale.
- **Some code is dead or wrong everywhere:**
  - `TransactionalXStorage` / `isTransactional`: no driver implements it and nothing calls it, in any
    repo;
  - unstorage empty segments (`a//b`) are lossy in every copy;
  - no portal token supports `kid` (key id) or secret rotation.

### Size of the prize

Per copy, the kit-able part is about 8–9k lines:

| Area | Kit-able lines per copy |
|---|---|
| storage | ~1.9k |
| auth + authorization + hooks machinery | ~0.7k |
| adapters + panel/server plumbing | ~1.4k |
| portal tokens + CLI plumbing + utilities | ~0.8k |
| UI shell + embed | ~1.6k |
| docs-site tooling | ~1.2k |
| build scripts + workflows | ~0.5k |
| shared tests (conformance, auth, bridges) | ~0.7k |

That is **about 40k lines duplicated across the five repos**. Area totals are in
`inventory/data/areas-loc.txt`. Of `src/` alone (wh 15.5k, fl 18.8k, au 21.0k, li 24.2k, en 26.3k LOC),
roughly 30–45% per product is shared infrastructure.

## 2. Area by area

Status: **≡** identical (modulo names/docs) · **D** diverged. LOC = lines per copy, in the order
wh / fl / au / li / en; `–` = absent.

### 2.1 Storage (detail: [storage.md](inventory/storage.md))

| Piece | Status | LOC wh/fl/au/li/en | Best | Kit? |
|---|---|---|---|---|
| contract `XStorage` (4 methods) + `watch`/`compareAndSwap` capabilities + `is*` guards + `requirePeer` | ≡, plus product capabilities (wh `claimDue`, au `EventLogStorage`) | 94/70/127/71/76 | any | ✓ neutral `KvStorage` + product aliases; `requirePeer` takes the package name |
| memory | D (capabilities; fl has no CAS) | 154/70/177/99/100 | en/li + `util.deepEqual` | ✓ |
| file | D (largest drift) | 252/232/197/187/242 | en (atomic+locked writes, empty segments, CAS) + wh `migrateFileStorage` | ✓ |
| sqlite / libsql | D | 90/90/117/108/74 · 153/153/187/201/150 | en's shared `sqlite-kv.ts` (GLOB, canonical-JSON CAS, connect retry) | ✓ |
| postgres | D | 192/192/359/217/222 | en (`COLLATE "C"`, `ESCAPE '!'`, single-statement CAS, DDL retry, `postgresStorageSchema`) | ✓ |
| mongodb | D | 182/182/407/224/233 | en (`$expr`/`$literal` CAS, `startsWith` post-filter) | ✓ |
| redis + RedisJSON | D | 403/292/373/360/382 | en structure + li SCAN de-dup + escaped `PSUBSCRIBE` (au/li/en) | ✓ with a write hook for wh's due-zset |
| cloudflare-kv | ≡ | 106/100/109/107/103 | any | ✓ |
| unstorage | ≡ except en (`$` escaping) | 87/87/90/86/90 | en | ✓ |
| drizzle storage | D | 147/146/489/220/220 | en (dialect detection, per-dialect prefix, CAS on pg/mysql/sqlite) | ✓ |
| drizzle KV table factories | ≡ (default names differ) | 231/214/562/223/356 (dir) | en (`COLLATE "C"` on pg) | ✓ factories + column helpers; product tables stay |
| `withWatch` / `pgListenNotify` | ≡ | 106 ×4, 110 | any | ✓ (channel name as a parameter) |
| `keys.ts` | product layout | 145/85/123/99/75 | – | only helpers: `encodeSegment` (au), `lastSegment`, sortable padded leaf |
| conformance suite `test/storage-contract.ts` | D (different case sets) | 328/140/473/250/204 | union of li + en + wh's sortable case | ✓ as `@xtandard/kit/storage/testing`, with capability options and product-registered extra suites |

**Stays in the products:**
- wh `DeliveryQueueStorage.claimDue` (memory scan, Redis due zset + Lua);
- au `EventLogStorage` (sql.ts, sqlite-event-log, drizzle event tables);
- en `CounterStore` (`src/counters/*`, 9 drivers). This is a later candidate for a generic kit
  capability, because li's approximate click counter would use it.

**CI:**
- No repo has a compose file.
- The service images are the same everywhere, except that **redis:7 in wh/fl/au/li means live
  RedisJSON conformance never runs in CI.** en uses redis:8.
- Test gating differs: some tests check whether an env var is set, others probe a connection.

### 2.2 Server side (detail: [server.md](inventory/server.md))

| Piece | Status | LOC wh/fl/au/li/en | Best | Kit? |
|---|---|---|---|---|
| auth `contract/basic/none/delegated` | ≡ | 381 ×5 | any | ✓ verbatim (realm default is a parameter; `basic` uses `node:crypto`) |
| authorization `none/delegated` | ≡ | 35 ×5, 46–51 | any | ✓ |
| authorization `roles` | engine byte-identical, data product | 139/131/122/135/152 | en layout (actions in the contract, readonly arrays) | ✓ `defineActions` + `rolesAuthorization(policy)` |
| authorization `contract` | same shape, product enums | 75/72/85/79/108 | en | ✓ generic over `Action`/`Resource` |
| hooks runner (`HookDeniedError`, `runBefore/After`, `normalizeHooks`) | ≡ code; event unions product | 247/256/195/123/156 | any | ✓ generic over `<Before, After>` |
| `hooks/log` | D (en adds `json`) | 56 ×4, 68 | en | ✓ with `source` + `describe(event)` |
| `server/base-path`, `cors`, `static-assets` | ≡ | 32, 91, 67 ×5 | any | ✓ |
| `server/render-index-html` | D: **title XSS fix only in li/en** | 58/60/58/65/61 | li | ✓ (`globalName`, bootstrap object) |
| `server/create-fetch-handler` (panel) | D | 271/229/297/221/256 | en skeleton (`close()`, healthcheck) + li no-cache + storage/core guard | ✓ `createPanelHandler` |
| router plumbing in `routes.ts` (json/error/match/auth/portal short-circuit/authorize/mapError) | D | 689/752/694/1154/1278 (incl. product routes) | en declarative route table + `isNamed` + safe `match` | ✓ `createRouter`; routes stay in the product |
| `server/openapi` envelope + generator | D | 589/856/653/768/708 | en (generated from the route table) | ✓ generator; schemas stay in the product |
| adapters bun/hono | panel part ≡; extras product | 27/26/76/76/64 · 38/28/59/68/79 | any + li `waitUntilOf` | ✓ |
| adapters elysia/elysia2 + `elysia-shared` | D (4 `createPass` variants) | 149/156/153/162/240 · 163/194/150/186/241 · 71/62/71/69/123 | au + li methods + en `raw` + li `seed` | ✓ `createPass` + helpers; the Eden-typed chain stays in the product |
| adapter express | D | 103/95/149/166/149 | li (headers, `Set-Cookie`, bodies) + au streaming + en `Uint8Array` | ✓ one Fetch↔Node bridge, shared with the CLI |
| adapter next | li/en only | –/–/–/104/112 | en `toNextHandler` | ✓ |
| `portal.ts` scoped tokens | same mechanics, product claims | 176/–/320/198/221 | en (rejects empty secret, `now`) | ✓ `createScopedTokens({prefix, ttl, validateClaims})` |
| CLI plumbing (`env`, `parseArgs`, driver loader, `buildAuth`, `startServer`, `serve`) | D | cli.ts 847/592/986/800/803 (mostly product commands) | au/en loader + li/en parser + en `buildAuth` + au self-run guard | ✓ `createCli`; commands stay in the product |
| "CLI scaffolding" (`init`) | wh/fl only, seeds product data | – | – | ✗ product |
| `duration` | ≡ (en adds `w`) | 63/–/63/42/43 | en + `parseDurationList` | ✓ |
| `canonical` | au = wh + non-finite guard | 38/–/42/–/– | au | ✓ |
| `id` | D: 4 incompatible schemes | 50/–/97/88/24 | au (monotonic ULID) | ✓ generator; **persisted formats must stay per product** |
| validation primitives | D | 250/525/180/359/239 (mostly product) | li issues + au `jsonValueSchema` + en `parseInput` | ✓ small core |
| `testing.ts` | product | 170/150/285/185/104 | – | only `createTestClock`, `collectingSink` |
| `bin/*.mjs`, `apps/standalone` | ≡ (fl re-implements serve) | 3 ×5; index 24/172/24/25/31 | wh pattern | template only |

### 2.3 UI and embeds (detail: [ui-tooling.md](inventory/ui-tooling.md) §A)

| Piece | Status | LOC wh/fl/au/li/en | Best | Kit? |
|---|---|---|---|---|
| `primitives`, `ui-bits`, `Toast`, `ThemeToggle`, `lib/{utils,nav-guard,portal-container}` | byte-identical or ≡ | 354, 126, 130, 51, 8, 32, 34 ×5 | any | ✓ verbatim |
| `theme.ts` | D: fl rewrote it | 126/140(+62)/126/126/126 | fl API + wh's `MutationObserver` guard | ✓ (storage key as a parameter) |
| `api.ts` client core (~40 lines shared) | D | 316/340/221/293/265 (mostly endpoints) | au/li `send`/`req` split + en `getApiToken` + li `toQuery` | ✓ `createApiClient` |
| `main.tsx` bootstrap | D | 48/41/48/40/52 | en `takeTokenFromUrl` (strips the token from the URL) | ✓ `bootSpa` |
| `App.tsx` shell | skeleton ≡; switcher/tabs/views product | 355/590/370/339/247 | au "wait for /config" + en "token means portal" | ✓ `ShellFrame` + `useShellConfig` |
| `*-bits`, `format.ts`, `JsonCodeEditor`, `TagInput`, `BrandMark` | partly shared | see detail | see detail | ✓ the common subset |
| `styles.css` | same skeleton, brand tokens differ | 188/218/189/191/207 | base + per-product token overlay | ✓ |
| `react.tsx` embed (~120 shared lines) | D | 242/169/245/256/220+27 | li (memory `searchHook`, invalidate on token change) + fl theme + en portal flag | ✓ `createEmbed` |
| `scripts/scope-embed-css.ts` | D (fl better) | 88/89/88/88/88 | fl | ✓ |
| vite UI/embed configs, `tsconfig.react.json`, playwright config | ≡ modulo entries, ports and timeouts | 18 ×5, 26–35, 13 ×5, 31–32 | – | ✓ factories |

**Public API seams that must keep working:**
- the `.xtandard-<p>` wrapper class;
- `window.__<P>_CONFIG__`;
- the `xtandard-<p>:theme` localStorage key;
- the token prefixes `whpt_`, `audpt_`, `lvt_`, `entpt_`;
- the `./react` exports (in en, `./react` is a different, customer-facing package and the admin
  embed lives at `./react/embed`).

### 2.4 Docs site, repo tooling and workflows (detail: [ui-tooling.md](inventory/ui-tooling.md) §B–C)

| Piece | Status | LOC wh/fl/au/li/en | Best | Kit? |
|---|---|---|---|---|
| `site/scripts/typedoc-plugin.ts` | ≡ | 87 ×5 | any | ✓ |
| `site/scripts/api-overviews.ts` | ≡ except fl | 249/250/250/249/249 | fl (exports order, `{@link}` handling) | ✓ |
| `site/scripts/sync.ts` | D (fl/au/en extended; two incompatible "pending page" designs) | 436/454/462/436/438 | union of fl + au, with one pending design | ✓ |
| `site/astro.config.ts`, `manifest.ts`, typedoc tsconfigs, `content.config.ts`, `site/package.json` | template + product strings | 154–164, 242–406, … | fl/au (validate `apiOwners`, favicon sizes) | ✓ `defineXtandardSite` |
| `vite.config.ts` (vite-plus test/lint/fmt/staged/pack) | same skeleton; thresholds and entries differ | 108/117/115/114/126 | – | ✓ `defineXtandardConfig` |
| `tsconfig*.json`, husky hooks, `fix-elysia2-types.ts`, `vendor.d.ts` | byte-identical / ≡ | 36, 14, 14, 30, 19 ×5 | any | ✓ |
| `scripts/example.ts` runner | ≡ except en (refactored) | 139/159/155/142/213 | en shape | ✓ |
| brand generator | D (TS in wh/fl/en, Python in au/li) | 289/270/–/–/283 (TS) | TS | ✓ later |
| `demo.ts`, `seed-demo.ts`, `screenshots.ts` | product | – | – | ✗ (screenshot helper maybe) |
| `.github/workflows/ci.yml` | same 2 jobs; services and bun version drift | 114/114/114/128/112 | – | ✓ reusable `workflow_call` |
| `pages.yml`, `release.yml`, `docker.yml` | ≡ (fl release notes differ; en has no docker.yml) | 79–80, 80–85, 68 ×4 | wh (notes from the CHANGELOG) | ✓ reusable |
| `mise.toml`, Bun pin | li on bun 1.4.4, others on 1.3.14 | – | one pin | ✓ as a workflow input |

## 3. Bug-fix matrix (consolidated)

✓ = has it · ✗ = lacks it · n/a = not applicable.

### 3.1 Fixes with `fix` commits (the five-times-over ones)

All of these are now present in every copy that needs them:

| Fix | Origin commits | wh | fl | au | li | en |
|---|---|---|---|---|---|---|
| MySQL key column `utf8mb4_bin` (case-exact keys) | wh e4b0dc1, fl c9d27ae, li 8a577b5 | ✓ | ✓ | ✓ | ✓ | ✓ |
| drizzle `LIKE … ESCAPE '!'` (MySQL rejects `'\'`) | same | ✓ | ✓ | ✓ | ✓ | ✓ |
| SQL getKeys literal prefix (`%`/`_` escaped + `startsWith`) | wh e4b0dc1, fl c9d27ae, au 55ab3d9, li 8a577b5 | ✓ | ✓ | ✓ | ✓ | ✓ |
| file driver case-safe reversible segment encoding | same + au 55ab3d9 | ✓ | ✓ | ✓ | ✓ | ✓ |
| unstorage lossless escaping of `% ? \ :` + plain-prefix getKeys | wh e4b0dc1, fl c9d27ae, au 6d4114c, li 0502400 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Redis SCAN MATCH escaping + exact `startsWith` post-filter | wh e4b0dc1, fl c9d27ae, au ed8bc48 | ✓ | ✓ | ✓ | ✓ | ✓ |
| drizzle-orm 1.0-beta `DrizzleKvTable` typing | fl 8397b69 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `HookDeniedError` mapped by name across bundles | fl 723121c | ✓ | ✓ | ✓ | ✓ | ✓ |
| resolve `dist/ui` when running from source | fl 7475369 | ✓ | ✓ | ✓ | ✓ | ✓ |
| embed CSS + portals scoped; one theme per embed | wh c1f27b3/986ad99, fl cc2141e/de6600e | ✓ | ✓ | ✓ | ✓ | ✓ |
| https `og:url` / `og:image` / sitemap | wh bc53bad, fl 2ada92e, au c8a72c7, en ed237f2 | ✓ | ✓ | ✓ | ✓ | ✓ |
| throwing auth provider → 500, not 401 | wh 543e1fa | ✓ | **✗** | ✓ | ✓ | ✓ |
| panel requires `storage` or a prebuilt `core` | wh 5b151c1 | ✓ | **✗** | ✓ | ✓ | ✓ |
| integer ms in ids | au 6761a34 | n/a | n/a | ✓ | ✓ | ✓ |
| monotonic ids within one ms | li 2acc19a | n/a | n/a | ✓ | ✓ | **✗** |
| CLI self-run guard (`import.meta.main`) | au 6761a34 | **✗** | **✗** | ✓ | **✗** | **✗** |
| portal SPA waits for `/config` before the default route | au 6761a34 | **✗** | n/a | ✓ | ✓ | ✓ (different approach) |

### 3.2 Fixes that exist in some copies only (no `fix` commit), i.e. drift to recover

| Fix | wh | fl | au | li | en |
|---|---|---|---|---|---|
| file watch: `rename` → `remove` only if the file is gone | ✗ | ✗ | ✓ | ✓ | ✓ |
| Redis watch `PSUBSCRIBE` pattern glob-escaped | ✗ | ✗ | ✓ | ✓ | ✓ |
| Redis getKeys de-duplicates SCAN results | ✗ | ✗ | ✗ | ✓ | ✗ |
| file: empty key segments preserved (`a//b` ≠ `a/b`) | ✗ | ✗ | ✗ | ✗ | ✓ |
| file: atomic write (tmp + rename) | ✗ | ✗ | ✓ | ✗ | ✓ |
| unstorage: `$` escaped (otherwise hidden as a meta key) | ✗ | ✗ | ✗ | ✗ | ✓ |
| postgres/libsql: failed connect/DDL is retried, not cached | ✗ | ✗ | pg only | ✗ | ✓ |
| postgres key `COLLATE "C"`; SQLite `GLOB`; Mongo `startsWith` post-filter | ✗ | ✗ | ✗ | ✗ | ✓ |
| canonical JSON on write (key-order-insensitive CAS) | ✗ | ✗ | ✗ | ✗ | ✓ |
| Mongo CAS safe for `$`-prefixed value keys; CAS on MySQL drizzle | n/a | n/a | n/a | ✗ | ✓ |
| `deepEqual` checks own properties | ✗ | n/a | ✗ | ✗ | partial |
| index.html escapes title (+ base, U+2028) | ✗ | ✗ | ✗ | ✓ | title only |
| `match()` survives malformed `%` escapes (else 500) | ✗ | ✗ | ✓ | ✓ | ✓ |
| all domain errors mapped by name (`isNamed`) | ✓ | ✗ | ✓ | ✓ | ✓ |
| unknown `STORAGE_DRIVER` is an error (not a silent `file`) | ✗ | ✗ | ✓ | ✗ | ✓ |
| unknown `AUTH_MODE` is an error (not an open panel) | ✗ | ✗ | ✗ | ✗ | ✓ |
| Express/Node bridge keeps multiple `Set-Cookie` | ✗ | ✗ | ✗ | ✓ | ✗ |
| Express/Node bridge streams response bodies | ✗ | SSE only | ✓ | ✗ | ✗ |
| Elysia body rebuild drops stale `content-length` / covers PATCH+DELETE / multi-mount `seed` | ✗/✗/✗ | ✗/✗/✗ | ✓/✗/✗ | ✗/✓/✓ | ✓/PATCH/✗ |
| valibot root-issue path without a trailing `.` | ✗ | own | ✓ | ✓ | ✓ |
| JSON values must be finite | ✗ | ✗ | ✓ | ✗ | ✗ |
| portal token rejects an empty secret | ✗ | n/a | ✗ | ✓ | ✓ |
| OpenAPI `info.version` not hard-coded `0.1.0` | ✗ | ✗ | ✗ | ✓ | API version |
| SPA HTML `cache-control: no-cache`; `/healthcheck` inside the panel | ✗ | ✗ | ✗ | ✓ | healthcheck only |
| embed: memory router keeps the query string; invalidate queries on token change | ✗ | ✗/n/a | ✗ | ✓ | ✗ |
| SPA strips `?token=` from the address bar | ✗ | n/a | ✗ | ✗ | ✓ |
| theme host watcher guards a missing `MutationObserver` | ✓ | ✗ | ✓ | ✓ | ✓ |
| embed-css unit test; Elysia 2 typedoc program; `docker.yml`; CI `typecheck:examples` | ✓ | ✓ | ✓ | ✓ | ✗ |

### 3.3 Bugs in every copy (fix once in the kit)

- unstorage collapses empty segments.
- Lua `cjson` CAS treats `{}` and `[]` as equal (au/en).
- No `kid` or rotation for scoped tokens.
- RedisJSON conformance never runs in CI (wh/fl/au/li).
- `TransactionalXStorage` is declared and exported but implemented and used nowhere.

## 4. Decisions this inventory hands to the design (phase 2)

1. **Readonly status code.** wh/fl/li return 403, au/en return 423. Each product's HTTP API is public.
   The kit takes a parameter, and each product keeps its current code.
2. **Id formats are persisted data.** The kit ships au's generator, but each product keeps its current
   format: wh random base62, en lowercase 22-char, au/li ULID.
3. **Default storage names** (`xtandard_X`, `xtandard_X_kv`, Mongo db/collection, pg channel) are
   stored-data compatibility, so they are a product-supplied seam.
4. **Product capabilities on drivers.** wh `claimDue` needs a write hook on the redis/memory drivers.
   au's event log needs the SQL executors and the `ready` plumbing. en already exports connection
   helpers, which shows that shape works.
5. **`TransactionalXStorage`.** Keep it as an exported type for API compatibility, and implement it
   nowhere (or deprecate it).
6. **Two "pending docs page" designs** (au, en) and **two brand generators** (TS, Python): pick one
   of each.
7. **Elysia Eden typing** needs literal route chains, so products keep their typed Elysia chain; the
   kit provides `createPass` and helpers. en's declarative route table drives dispatch and OpenAPI,
   and the products move onto it at their own pace.
8. **Candidates from the mission, confirmed or refuted:**
   - KV contract + drivers + conformance ✓;
   - key encoding ✓ (helpers only; layouts stay in the products);
   - auth ✓;
   - authorization ✓;
   - adapters ✓ (panel part + bridges);
   - panel/SPA serving + scoped tokens ✓;
   - CLI scaffolding: plumbing only (the `init` commands are product data);
   - React admin shell ✓ (shell + primitives; views stay in the products);
   - docs-site tooling ✓;
   - CI/release workflows ✓.
