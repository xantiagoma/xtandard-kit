# Storage inventory

Scope: `src/storage/*` (contract, memory, file, sqlite, libsql, postgres, mongodb, redis + RedisJSON,
cloudflare-kv, unstorage, drizzle, watch), `src/keys.ts`, `src/drizzle/*`, `src/entry-storage-*.ts`,
`src/entry-drizzle-*.ts`, `test/storage-*.ts`, CI services. Repos are abbreviated wh / fl / au / li / en.
Product names are normalised to `X` (e.g. `XStorage` = `WebhooksStorage` / `FlagsStorage` / …).

## 0. Verdict

- The **KV contract** (`getItem/setItem/removeItem/getKeys`) and the optional `watch` / `compareAndSwap`
  capabilities are the same in all five copies modulo names. The kit should own them.
- Copies diverge in three ways:
  1. **Product capabilities layered onto the drivers.** wh adds `claimDue` (delivery queue), au adds
     `EventLogStorage` (native event tables), en adds `CounterStore` drivers (`src/counters/*`) that
     reuse storage internals.
  2. **Adding CAS.** fl has none. wh has it on memory only. au has it on memory and redis. li and en
     have it on every driver except cloudflare-kv and unstorage. li's drizzle has no CAS on MySQL.
  3. **Hardening.** en (the newest copy) has the most: shared `util.ts` escapes, canonical JSON,
     single-statement CAS on every SQL dialect including MySQL, `COLLATE "C"`, SQLite `GLOB`, atomic
     and locked file writes, empty-segment encoding, unstorage `$` escaping, and DDL retry. au and li
     each carry fixes that wh and fl lack: file-watch remove detection, escaped Redis `PSUBSCRIBE`, and
     Redis SCAN de-duplication (li).
- **Best base: en's driver set, plus a few pieces from the others:**
  - li: the Redis SCAN de-dup.
  - au/en: the escaped watch pattern.
  - wh: `migrateFileStorage` + legacy warning (wh's published API).
  - fl: transparent legacy-file read-through.
  - li: the richer conformance cases (arrays, unicode, many keys, case-distinct tenants, watch).
  - wh: the due-ordering case, so the kit can host the generic part.
- **`TransactionalXStorage` / `isTransactional` is dead in every repo.** It is declared in each
  `contract.ts` and exported from every root index, but no driver implements `transaction` and no
  core code calls `isTransactional` (grep over `src/` finds only `contract.ts`). Keep it for API
  compatibility or drop it, but don't build drivers for it.

## 1. LOC per copy (`matrix.tsv` loc columns; `d:` = lines differing from wh after name normalisation)

| file | wh | fl | au | li | en | d:fl | d:au | d:li | d:en |
|---|---|---|---|---|---|---|---|---|---|
| storage/contract.ts | 94 | 70 | 127 | 71 | 76 | 34 | 71 | 43 | 38 |
| storage/memory.ts | 154 | 70 | 177 | 99 | 100 | 110 | 133 | 73 | 104 |
| storage/file.ts | 252 | 232 | 197 | 187 | 242 | 182 | 127 | 123 | 212 |
| storage/sqlite.ts | 90 | 90 | 117 | 108 | 74 | 2 | 51 | 32 | 50 |
| storage/libsql.ts | 153 | 153 | 187 | 201 | 150 | 6 | 64 | 66 | 169 |
| storage/postgres.ts | 192 | 192 | 359 | 217 | 222 | 8 | 247 | 41 | 194 |
| storage/mongodb.ts | 182 | 182 | 407 | 224 | 233 | 8 | 279 | 60 | 167 |
| storage/redis.ts | 403 | 292 | 373 | 360 | 382 | 151 | 200 | 191 | 315 |
| storage/cloudflare-kv.ts | 106 | 100 | 109 | 107 | 103 | 20 | 21 | 21 | 23 |
| storage/unstorage.ts | 87 | 87 | 90 | 86 | 90 | 12 | 11 | 27 | 57 |
| storage/drizzle.ts | 147 | 146 | 489 | 220 | 220 | 17 | 408 | 111 | 209 |
| storage/watch.ts | 106 | 106 | 106 | 106 | 110 | 22 | 0 | 12 | 26 |
| storage/ extra | – | – | sql.ts 282, sqlite-event-log.ts 191 | – | util.ts 100, sqlite-kv.ts 83 | | | | |
| drizzle/table.ts | 19 | 19 | 59 | 19 | 33 | 0 | 46 | 0 | 30 |
| drizzle/pg.ts | 70 | 64 | 182 | 70 | 113 | 24 | 148 | 8 | 101 |
| drizzle/mysql.ts | 77 | 74 | 173 | 73 | 112 | 41 | 124 | 30 | 107 |
| drizzle/sqlite.ts | 65 | 57 | 148 | 61 | 98 | 22 | 111 | 14 | 93 |
| keys.ts | 145 | 85 | 123 | 99 | 75 | (product layout; diff meaningless) |
| test/storage-contract.ts | 328 | 140 | 473 | 250 | 204 | 326 | 649 | 392 | 394 |
| **all src/storage + src/drizzle** | 2181 | 1918 | 3757 | 2193 | 2525 | | | | |

The `entry-storage-*.ts` / `entry-drizzle-*.ts` files are 8–18 lines each, and all are re-export
shims (§7). en also has `src/counters/*` (11 files, ~1.6k LOC) built on storage internals. That is out
of this area's scope, but it is noted in §5.

## 2. Per-file status

### contract.ts — identical modulo names, plus product capabilities

- **Common to all five:**
  - `XStorage` (4 methods), `StorageChangeEvent`, `WatchableXStorage`, `TransactionalXStorage`,
    `CompareAndSwapXStorage`.
  - `isWatchable`, `isTransactional`, `isCompareAndSwap`.
  - `requirePeer(name, subpath)`. This hard-codes `` `@xtandard/X/${subpath}` `` (`wh:src/storage/contract.ts:89`).
- **wh adds** `DeliveryQueueStorage.claimDue({now,limit,leaseMs}): Promise<Delivery[]>` and
  `hasDeliveryQueue` (`wh:src/storage/contract.ts:59-83`). Product-specific: it imports `Delivery`.
- **au adds** `ChainConflictError`, `EventLogStorage` (`appendEvents`, `getEvent`, `lastEvent`,
  `eventsBySeq`, `queryEvents`, `replaceEvent`, `deleteEventsThrough`, `countEvents`,
  `listEventTenants`) and `hasEventLog` (`au:src/storage/contract.ts:55-116`). Product-specific:
  it imports `AuditEvent` and `NormalizedQuery`.
- **li** only adds a doc comment on CAS ("slug claims").
- **Best:** any copy. The kit ships the base contract with a neutral name (e.g. `KvStorage`), and
  products keep `type XStorage = KvStorage` aliases. `requirePeer` needs a package-name parameter.

### memory.ts — diverged by capability

| | watch | CAS | product capability |
|---|---|---|---|
| wh | ✓ | ✓ | `claimDue` (`wh:src/storage/memory.ts:110-152`, uses `DUE_KEY_RE`, `parseDueKey`, `deliveryKey`) |
| fl | ✓ | **✗** (`fl:src/storage/memory.ts:32` returns `WatchableFlagsStorage`) | – |
| au | ✓ | ✓ | native event log (per-tenant arrays) |
| li | ✓ | ✓ | – (also *exports* `deepEqual`, `li:src/storage/memory.ts:28`, used by li's drizzle/mongodb/libsql/redis) |
| en | ✓ | ✓ | – |

- **Equality:** every `memory.ts` `deepEqual` omits a `hasOwnProperty` check, so `{a: undefined}`
  equals `{b: undefined}`. Stored values are `structuredClone`d, so `undefined` members survive. en's
  `util.ts:72` `deepEqual` *does* check, but en's `memory.ts` still uses its own local copy.
- **Best:** en/li, with `util.deepEqual`.

### file.ts — diverged (the largest real drift)

Common to all five (from the case-collision fix):
- `encodeSegment`/`decodeSegment`: uppercase → `^x`, `^` → `^^`, other bytes → `%XX`, leading `.` → `%2E`.
- The allowed set is `[a-z0-9._~!@,=+-]`. wh lists `_` twice; the behaviour is the same.
- Recursive `walk`, and `fs.watch` for watch.

Differences:

| behaviour | wh | fl | au | li | en |
|---|---|---|---|---|---|
| legacy (pre-encoding) files | ignored + one-time `console.warn`; `migrateFileStorage({dir})` exported (`wh:src/storage/file.ts:213`) | read-through, removed on next write; case-exact `existsExactly` (`fl:src/storage/file.ts:78-103`); Set-dedup in getKeys | none | none | none |
| watch `rename` → type | **always `remove`** (`wh:…/file.ts:191`) | **always `remove`** (`fl:…/file.ts:217`) | `existsSync` check (`au:…/file.ts:182`) | async `access` check | `existsSync(keyToPath)` (`en:…/file.ts:227`) |
| atomic write (tmp + `rename`) | ✗ | ✗ | ✓ (`au:…/file.ts:143-147`) | ✗ | ✓ (`en:…/file.ts:171-175`) |
| empty segment (`a//b`, trailing `/`) | collapses (`path.join`) | collapses | collapses | collapses | `""` → `%` (`en:…/file.ts:56,70`); tested with `ent//empty` (`en:test/storage-file.test.ts:96`) |
| CAS | ✗ | ✗ | ✗ | ✗ | ✓, in-process per-key promise lock `withLock` (`en:…/file.ts:148`) |

- **Best:** en, plus wh's `migrateFileStorage` and legacy warning (wh's public API), or fl's
  read-through.
- The legacy message hard-codes a product version (`"v0.1.4 and earlier"`) and the log prefix
  `[@xtandard/webhooks]`. That is a product seam.

### sqlite.ts (bun:sqlite) — diverged

- **wh = fl** (d = 2).
  - `LIKE ? ESCAPE '\'` + `startsWith` post-filter.
  - Inline table-name regex check.
  - No CAS.
- **au:** the same KV, plus the event log via `createSqliteEventLog` (`au:src/storage/sqlite.ts:111`).
  Uses `assertSafeIdentifier` from `sql.ts`.
- **li:** adds CAS as read + `deepEqual` + upsert inside `db.transaction(...).immediate`
  (`BEGIN IMMEDIATE`) (`li:src/storage/sqlite.ts:76-102`).
- **en:** rewritten over a shared `sqlite-kv.ts` used by both sqlite and libsql
  (`en:src/storage/sqlite-kv.ts`):
  - `getKeys` uses `GLOB` with `escapeGlob`. It is case-sensitive and index-usable, plus a
    `startsWith` filter.
  - Values are canonical JSON, so CAS is one `UPDATE … WHERE key=? AND value=? RETURNING key` or
    `INSERT … ON CONFLICT DO NOTHING RETURNING key`.
- **Best:** en's `sqlite-kv.ts`. It removes the sqlite/libsql duplication.

### libsql.ts — diverged

- **wh = fl** (d = 6). `ESCAPE '\'` + `startsWith`.
- **au:** adds the event log through `sqlite-event-log.ts`, with batch transactions in one round-trip.
- **li:** CAS by SELECT + `deepEqual` + conditional `UPDATE … AND value = <raw read>` with
  `CAS_RETRIES = 16` (`li:src/storage/libsql.ts:169-194`).
- **en:** `sqliteKvStorage` + exported `libsqlConnection`/`libsqlExecutor`, which are reused by
  `counters/libsql`.
- **Init failure:** the `ready ??=` promise stays rejected forever after a failed connect or DDL in
  wh, fl, au and li. en resets it (`en:src/storage/libsql.ts:104-105`).
- **Best:** en.

### postgres.ts — diverged

- **wh = fl** (d = 8). `LIKE $1 ESCAPE '\'` + `startsWith`; `jsonb` values; lazy `Pool`; no CAS.
- **au:** the same KV, plus the native event log tables. `ensured` is reset on failure
  (`au:src/storage/postgres.ts:165`).
- **li:** CAS as single-statement `INSERT … ON CONFLICT DO NOTHING RETURNING` /
  `UPDATE … WHERE value = $3::jsonb RETURNING` (`li:src/storage/postgres.ts:194-210`).
- **en:** li's CAS, plus:
  - `ESCAPE '!'` via `util.escapeLike`.
  - `key text COLLATE "C"`, which gives bytewise keys and index-usable prefix `LIKE`
    (`en:src/storage/postgres.ts:119`).
  - Exported `postgresStorageSchema()` DDL for migrations.
  - Exported `pgConnection()`, shared with counters.
  - DDL retry (`en:…/postgres.ts:163`).
- **wh/fl/li:** `ensured` stays rejected after a transient DDL failure.
- **Best:** en.

### mongodb.ts — diverged

- **wh = fl** (d = 8).
  - `_id` = key, `{value}` doc.
  - `getKeys` uses an anchored `$regex` over `escapeRegex`.
  - Connect failures retry.
  - No watch (change streams need a replica set). No CAS.
- **au:** the same KV, plus a native events collection (no transactions; unique `(tenant, seq)`
  index plus compensating delete).
- **li:** CAS.
  - Expecting null: `insertOne`, with duplicate-key → false.
  - Otherwise: read + `deepEqual` + `updateOne({_id, value: doc.value})` with 16 retries
    (`li:src/storage/mongodb.ts:179-200`).
  - Using the raw `value` as a filter breaks if the value has `$`-prefixed keys.
- **en:**
  - Canonical values on write.
  - CAS with one `updateOne({_id, $expr: {$eq: ["$value", {$literal: canonical(expected)}]}})`
    (`en:src/storage/mongodb.ts:197-219`).
  - `startsWith` post-filter on getKeys (`:193`), which guards against a case-insensitive
    collection collation.
  - Exported `mongoConnection`/`isDuplicateKey`.
- **Best:** en.

### redis.ts (+ `createRedisJSONStorage`) — diverged

All five share the same skeleton:
- node-redis `RedisLike`.
- Lazy connect with `disableOfflineQueue` and a capped reconnect, and an always-attached `error`
  handler plus `onError`.
- `prefix:` namespace.
- A value codec (string vs RedisJSON).
- SCAN `getKeys`, keyspace-notification `watch`, and `close()` (only for clients it owns).

| | SCAN MATCH escaped | `startsWith` post-filter | SCAN de-dup | watch `PSUBSCRIBE` pattern escaped | CAS | product |
|---|---|---|---|---|---|---|
| wh | ✓ (`wh:…/redis.ts:300`) | ✓ | ✗ | **✗** (`wh:…/redis.ts:382`) | ✗ | `claimDue`: `<prefix>whk:due` zset mirrored on set/remove of due keys + Lua `ZRANGEBYSCORE`/reposition (`:28-37, 284-366`) |
| fl | ✓ (`fl:…/redis.ts:248`) | ✓ | ✗ | **✗** (`fl:…/redis.ts:271`) | ✗ | – |
| au | ✓ | ✓ (ed8bc48) | ✗ | ✓ (`au:…/redis.ts:344`) | Lua, server-side structural `cjson` compare, one round-trip (`au:…/redis.ts:114-163`) | – |
| li | ✓ | ✓ | **✓** `new Set` (`li:…/redis.ts:309`) | ✓ (`li:…/redis.ts:339`) | read raw + JS `deepEqual` + Lua raw-equality write, 16 retries (`li:…/redis.ts:312-327`) | – |
| en | ✓ (`util.escapeRedisGlob`) | ✓ | ✗ | ✓ (`en:…/redis.ts:364`) | Lua structural compare, codec-aware `ARGV[4]` (`en:…/redis.ts:151-173`) | exported `redisConnection`, `scanKeys`, `RedisLike` (used by `counters/redis`) |

- **SCAN duplicates:** Redis SCAN may return a key more than once, so every copy except li can return
  duplicate keys.
- **Unescaped `PSUBSCRIBE`:** in wh/fl, a prefix containing `[`, `*`, `?` or `\` can silently miss
  events. The `startsWith` re-check only removes over-matches, not misses.
- **Lua `cjson` CAS (au, en):** `{}` and `[]` decode to the same empty table, so they compare equal.
  This is low-impact.
- **Best:** en's structure, plus li's de-dup.
  - The kit's redis builder must expose a write hook, or the connection/codec/key helpers (en already
    exports these), so wh can layer `claimDue` with its due-zset mirroring on top.

### cloudflare-kv.ts — identical modulo names/docs

- fl writes `list({prefix, cursor})` (undefined cursor) where the others spread it conditionally.
- Cursor pagination; no `startsWith` needed (KV prefixes are byte-exact).
- **Best:** any.

### unstorage.ts — near-identical; en has one extra fix

- **All five:**
  - Escape `% ? \ :` as `%25 %3F %5C %3A` and reverse.
  - `getKeys` lists from the last `/` and filters `startsWith`, so it is a plain string prefix.
- **en** also escapes `$`, as `%24` (`en:src/storage/unstorage.ts:33-45`). unstorage treats keys
  ending in `$` as meta keys and drops them from `getKeys`. en tests this with `"ent/end$"`
  (`en:test/storage-unstorage.test.ts:20`).
- **Gap in every copy:** unstorage also collapses repeated separators and strips leading/trailing
  `:`, so empty segments (`a//b`) are lossy. Not handled anywhere.
- **Best:** en.

### storage/drizzle.ts — diverged

- **wh = fl** (d = 17).
  - Consumer-owned table and db; no DDL.
  - Upsert dialect detected from the insert builder (`onConflictDoUpdate` vs
    `onDuplicateKeyUpdate`).
  - `LIKE … ESCAPE '!'` + `startsWith`. No CAS.
- **au:**
  - The same KV via `sql.ts` `escapeLike`.
  - Plus `createDrizzleEventLog` over `events`/`eventTargets` tables: `db.transaction`, with a
    sync-SQLite `immediate` path. Overloads return `DrizzleEventLogAuditStorage` when the event
    tables are passed (`au:src/storage/drizzle.ts:198-205, 267-489`).
- **li:**
  - Adds CAS on pg/sqlite tables.
  - Detects MySQL via `table.constructor[entityKind]` and returns *no* CAS there
    (`li:src/storage/drizzle.ts:106-109, 180`).
  - The swap is read + `deepEqual` + `UPDATE … WHERE value = <observed>` with 16 retries.
- **en:**
  - `detectDrizzleDialect(db)` from `db.dialect`'s `entityKind`, with a `dialect` override.
  - The prefix predicate is per dialect: `GLOB` on sqlite, `LIKE … ESCAPE '!'` elsewhere.
  - Canonical values.
  - Single-statement CAS on **all three dialects** (`en:src/storage/drizzle.ts:199-219`):
    - pg: `value = $::jsonb`.
    - MySQL: `value = cast(? as json)` + `INSERT IGNORE`, with `affectedRows()`.
    - sqlite: canonical-text equality.
  - Caveat: the MySQL UPDATE path counts *changed* rows unless the driver sets `CLIENT_FOUND_ROWS`
    (mysql2 does by default). A swap whose `next` equals `expected` would report false on a driver
    that doesn't.
- **Best:** en.

### watch.ts — identical modulo names

- `withWatch(storage, subscribe)` wraps via `Object.create`, so a spread of the result loses the
  methods.
- `pgListenNotify(client, channel = "xtandard_X")`.
- d:au = 0. The other diffs are docs and import order.
- **Seam:** the default channel name. au has no `test/storage-watch.test.ts`; the other four do.

### drizzle/table.ts, pg.ts, mysql.ts, sqlite.ts — identical KV factories modulo names, plus product tables

- **All five:**
  - `DrizzleKvTable = Table & {key: Column; value: Column}` (the drizzle-orm 1.0-beta typing fix,
    fl 8397b69).
  - `{pg,mysql,sqlite}XTable(name, opts)` with `extraColumns`/`extraIndexes`; pg also has `schema`;
    mysql has `keyLength` (default 512).
  - The MySQL key column is `varchar(n) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`.
- **Default table names differ** (a seam):

  | repo | default table name |
  |---|---|
  | wh, au | `xtandard_X` |
  | li, en | `xtandard_X_kv` |
  | fl | none: `name` is **required** (`fl:src/drizzle/pg.ts:54`) |

- **au** adds `{dialect}AuditEventsTable`, `…EventTargetsTable`, `…AuditTables()`, plus the
  `DrizzleEventsTable`/`DrizzleEventTargetsTable`/`DrizzleAuditTables` types, and `text COLLATE "C"`
  on event key columns (`au:src/drizzle/pg.ts:87`). Its KV `key` stays plain `text`.
- **en** adds `{dialect}CountersTable` and the `DrizzleCounterTable` type, plus `text COLLATE "C"` for
  the pg KV and counters keys (`en:src/drizzle/pg.ts:43`). A shared `build()` helper.
- **Best:** en's KV factory (`COLLATE "C"`). Product tables stay in the products, and the kit exports
  the `textC`/`binVarchar` column helpers.

### keys.ts — product layout; small generic core

- Every copy is a product key layout (`ROOT` = `whk`, `flags`, `aud`, `lnk`, `ent`). It stays in the
  product.
- Generic pieces, and how they differ:

| helper | wh | fl | au | li | en |
|---|---|---|---|---|---|
| segment encoding of variable parts | none (validated instead; wh 543e1fa validates idempotency keys) | none | `encodeURIComponent` + `~`→`%7E` | `encodeURIComponent` | `encodeURIComponent` |
| `lastSegment` | raw | raw | raw + separate `decodeSegment` | decoded | decoded |
| zero-padded sortable leaf | `dueKey` 13-digit ms + `~id`, `parseDueKey` | – | `padSeq` (12), `padMs` (13), `indexLeaf`/`parseIndexLeaf` (same `ms~id` shape as wh) | – | – |

- **Kit candidates:**
  - `encodeSegment` (au's variant; `~` matters because both wh and au use `~` as a leaf separator).
  - `lastSegment` with decode.
  - `padMillis` and `sortableLeaf`/`parseSortableLeaf`. wh's `dueKey` and au's `indexLeaf` are the
    same pattern.
- **Stays in the product:** the layouts themselves, wh's `DueEntry`, and `RESERVED_APPLICATION_KEYS`.

## 3. Capability matrix (who implements what today)

| driver | wh | fl | au | li | en |
|---|---|---|---|---|---|
| memory | watch, CAS, claimDue | watch | watch, CAS, eventlog | watch, CAS | watch, CAS |
| file | watch | watch | watch | watch | watch, CAS (in-process) |
| sqlite | – | – | eventlog | CAS | CAS |
| libsql | – | – | eventlog | CAS | CAS |
| postgres | – | – | eventlog | CAS | CAS |
| mongodb | – | – | eventlog | CAS | CAS |
| redis / redisJSON | watch, claimDue | watch | watch, CAS | watch, CAS | watch, CAS |
| drizzle | – | – | eventlog (pg/mysql/sqlite) | CAS (pg/sqlite only) | CAS (pg/mysql/sqlite) |
| cloudflare-kv | – | – | – | – | – |
| unstorage | – | – | – | – | – |

- `transaction`: no driver, anywhere.
- watch for the other drivers comes from `withWatch` in all repos.

## 4. Bug-fix matrix

Verified in code, not from commit messages.

**Legend.** ✓ = has it. ✗ = lacks it. n/a = not applicable.
- (born) = the copy was written after the fix with the fix already in place (no `fix` commit).
- (au/li only) etc. = the fix exists only in those copies; there is no fix commit.

### Known storage fixes

| # | fix (origin commits) | wh | fl | au | li | en |
|---|---|---|---|---|---|---|
| F1 | MySQL key column `utf8mb4_bin` (wh e4b0dc1, fl c9d27ae, li 8a577b5) | ✓ | ✓ | ✓ (born) | ✓ | ✓ (born) |
| F2 | drizzle `LIKE … ESCAPE '!'`, not `'\'` (MySQL syntax error) (same commits) | ✓ | ✓ | ✓ (`sql.ts:60`) | ✓ | ✓ (`util.ts:30`) |
| F3 | SQL getKeys literal prefix: `%`/`_` escaped + exact `startsWith` filter (sqlite/libsql/postgres/drizzle) (wh e4b0dc1, fl c9d27ae, au 55ab3d9, li 8a577b5) | ✓ | ✓ | ✓ | ✓ | ✓ |
| F4 | file driver case-safe reversible segment encoding (same + au 55ab3d9) | ✓ | ✓ | ✓ | ✓ | ✓ |
| F4b | migration path for pre-F4 file stores | ✓ `migrateFileStorage` + warn | ✓ read-through | n/a | n/a | n/a |
| F5 | unstorage lossless escaping of `% ? \ :` (wh e4b0dc1, fl c9d27ae, au 55ab3d9, li 0502400) | ✓ | ✓ | ✓ | ✓ | ✓ |
| F6 | unstorage getKeys = plain string prefix: list from last `/` + filter (wh e4b0dc1, fl c9d27ae, au 6d4114c, li 0502400) | ✓ | ✓ | ✓ | ✓ | ✓ |
| F7 | Redis SCAN MATCH escaping `* ? [ ] \` (wh e4b0dc1, fl c9d27ae) | ✓ | ✓ | ✓ | ✓ | ✓ |
| F8 | Redis getKeys exact `startsWith` post-filter (wh e4b0dc1, fl c9d27ae, au ed8bc48) | ✓ | ✓ | ✓ | ✓ | ✓ |
| F9 | drizzle-orm 1.0-beta: `DrizzleKvTable` return type + peer `>=0.44.0 \|\| >=1.0.0-0` (fl 8397b69) | ✓ | ✓ | ✓ | ✓ | ✓ |
| F10 | redis watch test runs `CONFIG SET notify-keyspace-events KEA` itself (fl b32f043) | ✓ | ✓ | ✓ | ✓ | ✓ |

### Fixes present in some copies but missing elsewhere (no fix commit)

| # | fix | wh | fl | au | li | en |
|---|---|---|---|---|---|---|
| O1 | file watch: `rename` reported as `remove` only when the file is gone | ✗ | ✗ | ✓ | ✓ | ✓ |
| O2 | Redis watch `PSUBSCRIBE` pattern glob-escaped | ✗ | ✗ | ✓ | ✓ | ✓ |
| O3 | Redis getKeys de-duplicates SCAN results | ✗ | ✗ | ✗ | ✓ | ✗ |
| O4 | file: empty key segments encoded (`a//b` ≠ `a/b`) | ✗ | ✗ | ✗ | ✗ | ✓ |
| O5 | file: atomic write (tmp + rename) | ✗ | ✗ | ✓ | ✗ | ✓ |
| O6 | unstorage: `$` escaped (meta-key suffix hidden by `getKeys`) | ✗ | ✗ | ✗ | ✗ | ✓ |
| O7 | postgres: failed DDL is retried, not cached as rejected | ✗ | ✗ | ✓ | ✗ | ✓ |
| O7b | libsql: failed connect/DDL is retried | ✗ | ✗ | ✗ | ✗ | ✓ |
| O8 | postgres key `COLLATE "C"` (index-usable `LIKE` prefix; bytewise) | ✗ | ✗ | ✗ (KV) | ✗ | ✓ |
| O9 | SQLite getKeys via `GLOB` (case-sensitive, index-usable) | ✗ | ✗ | ✗ | ✗ | ✓ |
| O10 | mongodb getKeys `startsWith` post-filter | ✗ | ✗ | ✗ | ✗ | ✓ |
| O11 | canonical JSON on write, so CAS / equality is key-order-insensitive in SQL and Mongo | ✗ | ✗ | ✗ | ✗ (compares by re-reading instead) | ✓ |
| O12 | Mongo CAS safe for `$`-prefixed value keys (`$expr`/`$literal`) | n/a | n/a | n/a | ✗ | ✓ |
| O13 | CAS on MySQL drizzle | n/a | n/a | n/a | ✗ (omitted) | ✓ |
| O14 | `deepEqual` checks `hasOwnProperty` | ✗ | n/a | ✗ | ✗ | ✓ `util.ts` (not used by en's `memory.ts`) |

Related, but not storage code: wh 5b151c1 makes the core's idempotency comparison canonical
(`src/canonical.ts`). O11 is the storage-side counterpart in en. wh 543e1fa validates
idempotency-key segments; the file driver's F4 encoding makes path traversal impossible anyway.

## 5. Generic vs product-specific, and the seams the kit needs

**Generic (move to the kit):**
- The contract and `is*` guards.
- All ten KV drivers (en's as the base) and `withWatch`/`pgListenNotify`.
- `DrizzleKvTable` + the KV table factories.
- en's `util.ts`: `assertIdentifier`, `escapeLike`, `escapeGlob`, `escapeRedisGlob`, `escapeRegex`,
  `canonical`, `canonicalJson`, `deepEqual`, `parseJsonValue`.
- en's `sqlite-kv.ts`.
- en's connection helpers (`pgConnection`, `mongoConnection`, `redisConnection`, `libsqlConnection`,
  `scanKeys`, `isDuplicateKey`, `affectedRows`, `detectDrizzleDialect`).
- The column helpers (`textC`, `binVarchar`).
- The key-segment helpers (§2 keys).
- The conformance suite.

**Product-specific (stays in the product):**
- wh `DeliveryQueueStorage`/`claimDue`: the memory scan and the redis due zset + Lua.
- au `EventLogStorage` + `ChainConflictError`, `sql.ts` event DDL/query compilation,
  `sqlite-event-log.ts`, and the drizzle event tables.
- li's CAS comment.
- All `keys.ts` layouts.

**Candidates for generic capabilities later:**
- en's `CounterStore` (`src/counters/*`). An atomic bounded add + claim/release with expiry, with 9
  drivers. li keeps an "approximate click counter" in KV (`li:src/keys.ts:97`), so a generic counter
  port would serve it too.
- The pattern behind wh's due queue: a sorted-set/lease claim keyed by a zero-padded leaf. It could
  become a generic "lease queue" capability with a product payload callback. Today it is welded to
  `Delivery`.

**Seams and parameters the kit must take:**
- **Package name / product id:**
  - `requirePeer` message.
  - Log prefixes (`[@xtandard/X]`).
  - Error messages (`@xtandard/X/storage/mongodb requires …`).
- **Default names:** SQL table / Mongo db + collection (`xtandard_X`, `xtandard_X_kv`, `X_kv`), the
  drizzle factory default name (fl requires one), and the `pgListenNotify` channel.
- **Driver extension points**, so products can add capabilities without forking:
  - wh needs a write hook on redis set/remove (due-zset mirroring) and access to the
    connection/codec/key mapping.
  - au needs the SQL executors and `ready` plumbing to bolt on event tables.
  - en's exported connection helpers already prove the shape works.
- **Product-specific names in docs and examples.** The legacy file-migration text references product
  versions ("v0.1.4").

## 6. Tests and the conformance suite

All suites import from `vitest`, and also run under `bun test` for the `*.bun.test.ts` files.

The suite signature is the same in every repo: `runStorageContractTests(name, make, opts?)`. Options
per repo:

| repo | `opts` |
|---|---|
| wh | `{deliveryQueue}` |
| fl | none |
| au | `{expectNativeEventLog, timeout}` |
| li | `{compareAndSwap, watch: bool \| {settleMs}}` |
| en | `{compareAndSwap}` |

### Cases per copy

| case | wh | fl | au | li | en |
|---|---|---|---|---|---|
| missing → null; object/primitive round-trip; overwrite; remove; remove-missing no-op | ✓ | ✓ | ✓ | ✓ (+ arrays) | ✓ |
| nested getKeys + prefix isolation | ✓ | ✓ | ✓ | ✓ | ✓ |
| empty getKeys | ✓ | ✓ | ✗ | ✓ | ✗ |
| case-distinct keys | ✓ | ✓ | ✓ | ✓ | ✓ |
| accent-distinct keys | ✓ | ✓ | ✓ | ✓ | ✓ (raw + encoded) |
| literal LIKE/GLOB metachars in prefixes | `% _ ! * [ ] ? \` | same | `% _ ! * [ ] ? \ : %25` | `% _ ! \ * ? [ ] : %25` | `% _ ! \ * [` |
| `? \ ] : %` / `%25` keys round-trip and stay distinct | ✓ | ✓ (`? \ :`) | ✓ (via the prefix test's keys) | ✓ | ✓ (`? \ ] : #`) |
| plain prefix ending mid-segment | ✓ | ✓ | ✓ | implicit (`getKeys("lnk/x")`) | ✓ |
| case-distinct tenants isolated | ✓ | ✗ | ✓ (event chains) | ✓ | ✗ |
| zero-padded keys sort lexicographically | ✓ (due) | ✗ | ✓ (seq) | ✗ | ✗ |
| unicode / encoded keys | ✗ | ✗ | ✗ | ✓ | ✗ |
| many keys (pagination) | ✗ | ✗ | ✗ | ✓ | ✗ |
| CAS semantics + concurrent claim (exactly one wins) | ✗ | ✗ | ✗ (own CAS tests per driver) | ✓ | ✓ |
| watch semantics | ✗ (separate tests) | ✗ | ✗ | ✓ | ✗ |
| product suites | claimDue ×5 | – | event log ×16 + `appendEvents` stale-seq | – | – |

### Drivers that run the shared suite

- **wh/fl:** memory, file, pglite postgres, pglite drizzle, unstorage, fake cloudflare-kv, live redis,
  live mongo, live drizzle-mysql.
  - sqlite/libsql have **bespoke** bun tests, not the shared suite
    (`wh:test/storage-sqlite.bun.test.ts`).
  - Live RedisJSON only runs with `REDIS_STACK_URL`.
- **au:** everything wh has, plus:
  - the shared suite on sqlite, libsql (bun:sqlite-backed fake client), drizzle-sqlite (bun);
  - a fake redis and fake RedisJSON client;
  - a "KV fallback" memory variant that strips capabilities.
- **li:** the shared suite on all drivers including sqlite/libsql, live postgres, and live RedisJSON
  (`REDIS_STACK_URL`).
- **en:** the shared suite on all drivers, plus:
  - drizzle on pglite, libsql and bun:sqlite;
  - live redis + RedisJSON;
  - live mongo and mysql, also with a counters suite (`test/counter-contract.ts`).
- **Extra test files:**
  - fl: `test/storage-contract-helpers.test.ts` (guard tests).
  - wh: `test/keys.test.ts`.
  - au: no `storage-watch.test.ts`.
- **Best suite:** a union. Take li's (arrays, unicode, many keys, tenants, watch) + en's (CAS
  concurrency, `#`, accent raw+encoded, empty segment, `$`) + wh's sortable-key case. Also add:
  - Redis SCAN duplicates and `PSUBSCRIBE` with glob chars in the prefix (O2/O3).
  - Empty segments for every driver.
  - Capability options: `cas`, `watch`, plus product-registered extra suites.

## 7. Docker-backed tests and CI

- No repo has a compose file.
- Scripts are identical in all five: `test: vp test run`, `test:coverage`,
  `test:bun: bun test ./test/*.bun.test.ts`, `test:e2e`. CI runs `test:coverage` then `test:bun`.
- **CI service containers (`.github/workflows/ci.yml`):** `redis:7` (wh/fl/au/li) or `redis:8` (en),
  `mongo:7`, `postgres:16`, `mysql:8` (DB named after the product), plus `clickhouse:24.8` in li.
  - Env: `REDIS_URL`, `MONGO_URL`, `POSTGRES_URL`, `MYSQL_URL` (li adds `CLICKHOUSE_*`).
  - **`REDIS_STACK_URL` is never set and `redis:7` has no JSON module, so live RedisJSON conformance
    never runs in CI for wh/fl/au/li.** en uses `redis:8`, which has JSON built in, and opts out with
    `REDIS_JSON=0`.
- **Gating is inconsistent:**
  - Env-var presence: wh/fl/li redis, postgres; en everything.
  - Connectivity probe with a default URL: wh/fl/au/li mongo default `mongodb://localhost:27117`;
    au redis; au/li mysql default `mysql://root:root@127.0.0.1:3306/<prod>`.
  - The kit should pick one: env-presence, as en does.
- Local instructions are only in docs:
  - `docs/TESTING.md` env table (wh: line 58).
  - li lists `docker run` lines (`li:docs/TESTING.md:104-105`).

## 8. Public API surface to preserve

### Subpaths (package.json `"exports"`)

Identical in all five:
- `./storage/{cloudflare-kv,drizzle,file,libsql,memory,mongodb,postgres,redis,sqlite,unstorage}`
- `./drizzle/{mysql,pg,sqlite}`

Extras: au `./drizzle-audit` (bridge, not storage); en `./counters/{buffered,drizzle,kv,libsql,memory,mongodb,postgres,redis,sqlite}`.

Peer deps are identical in all five (all optional): `@libsql/client@0.15.15`,
`drizzle-orm@>=0.44.0 || >=1.0.0-0`, `mongodb@^5||^6`, `pg@^8`, `redis@^4||^5`, `unstorage@^1`.

### Entry files

- **wh/fl/au/li:** every entry is `export * from "./storage/<x>.ts"`, so every module-level export
  leaks into the public API. For example:
  - li `storage/memory` exports `deepEqual`;
  - wh `storage/file` exports `encodeSegment`, `decodeSegment`, `migrateFileStorage`,
    `clearFileStorage`;
  - wh `storage/drizzle` re-exports `DrizzleKvTable`.
- **en** narrows drizzle, file, libsql, memory, mongodb, postgres and redis to named lists, so its
  internal `*Connection` helpers stay private:
  - `storage/postgres` → `createPostgresStorage`, `postgresStorageSchema`, `ClosableSqlClient`,
    `SqlClient`, …;
  - `storage/redis` → `createRedisStorage`, `createRedisJSONStorage`, `RedisLike`, …

### Names per subpath (product name substituted)

- `createMemoryStorage` / `MemoryStorageOptions` / `MemoryXStorage` (not in fl).
- `createFileStorage`, `clearFileStorage`, `FileStorageOptions`, `encodeSegment`, `decodeSegment`
  (`migrateFileStorage` wh only; `FileXStorage` en only; en's narrowed entry does *not* export
  `encodeSegment`/`decodeSegment`).
- `createSqliteStorage`/`SqliteXStorage`.
- `createLibsqlStorage`/`LibsqlXStorage`.
- `createPostgresStorage`/`PostgresXStorage` (`postgresStorageSchema` en only).
- `createMongoStorage`/`MongoXStorage`.
- `createRedisStorage`, `createRedisJSONStorage`, `RedisXStorage`, `RedisStorageOptions`.
- `createCloudflareKvStorage`.
- `createUnstorageStorage`.
- `createDrizzleStorage`, `DrizzleStorageOptions`, `DrizzleXStorage`, `DrizzleKvTable`
  (`DrizzleDialect` en; `DrizzleEventLogAuditStorage` au).
- `{pg,mysql,sqlite}XTable` + `…TableOptions` (au adds the `…AuditEventsTable` /
  `…EventTargetsTable` / `…AuditTables` factories; en adds the `…CountersTable` factories).

### Root index (`src/index.ts`)

- `isWatchable`, `isTransactional`, `isCompareAndSwap`, `requirePeer`.
- Types: `XStorage`, `WatchableXStorage`, `TransactionalXStorage`, `CompareAndSwapXStorage`,
  `StorageChangeEvent`.
- `withWatch`, `pgListenNotify`, `PgNotificationClient`, `WatchSubscribe`.
- `keys` namespace (`export * as keys`).
- Plus wh `hasDeliveryQueue`/`DeliveryQueueStorage`, and au `hasEventLog`/`EventLogStorage`/`ChainConflictError`.

### Migration constraint

Each product subpath must keep re-exporting kit drivers under the product-named types and option
defaults: table/db/channel names, and the `requirePeer` package string. wh's `migrateFileStorage`
and the `encodeSegment`/`decodeSegment` exports must stay reachable from `@xtandard/webhooks/storage/file`.
