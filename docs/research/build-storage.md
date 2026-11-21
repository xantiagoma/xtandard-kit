# Storage area: build summary (for product migrations)

Full guide: `docs/STORAGE.md`. Tests named below live in `test/`; "suite" = a case in
`src/storage/testing/conformance.ts`, run against every driver.

## Subpaths

| Subpath                            | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                          | `KvStorage`, `WatchableKvStorage`, `CompareAndSwapKvStorage` (+`CompareAndSwapInput`), `StorageChangeEvent`, `isWatchable`, `isCompareAndSwap`, `TransactionalKvStorage`/`isTransactional` (`@deprecated`, types/guard only), `withWatch`, `pgListenNotify` (+`PgNotificationClient`, `WatchSubscribe`), `SAFE_IDENTIFIER`, `assertIdentifier`, `escapeLike`/`escapeGlob`/`escapeRedisGlob`/`escapeRegex`, `canonical`/`canonicalJson`/`deepEqual`/`parseJsonValue`/`JsonValue`/`JsonObject`, `encodeSegment`/`decodeSegment`/`lastSegment`/`padMillis`/`sortableLeaf`/`parseSortableLeaf`, `requirePeer`/`importPeer` |
| `storage/memory`                   | `createMemoryStorage`, `MemoryKvStorage`, `MemoryStorageOptions`, `MemoryWriteHook`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `storage/file`                     | `createFileStorage`, `clearFileStorage`, `migrateFileStorage`, `encodeSegment`/`decodeSegment` (file codec), `FileKvStorage`, `FileStorageOptions`, `FileLegacyMode`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `storage/unstorage`                | `createUnstorageStorage`, `UnstorageKvStorage`, `UnstorageStorageOptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `storage/cloudflare-kv`            | `createCloudflareKvStorage`, `CloudflareKvStorage`, `CloudflareKvStorageOptions`, `KVNamespaceLike`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `storage/sqlite` (+`/internals`)   | `createSqliteStorage`, `SqliteKvStorage`, `SqliteStorageOptions` · internals: `sqliteConnection`, `bunSqliteExecutor`, `sqliteKvStorage`, `sqliteKvSchema`, `SqliteExecutor`, `SqliteRow`, `SqliteConnection`                                                                                                                                                                                                                                                                                                                                                                                                          |
| `storage/libsql` (+`/internals`)   | `createLibsqlStorage`, `LibsqlKvStorage`, `LibsqlStorageOptions`, `LibsqlClientLike` · internals: `libsqlConnection`, `libsqlExecutor`, `LibsqlConnection`, SQLite core                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `storage/postgres` (+`/internals`) | `createPostgresStorage`, `postgresStorageSchema`, `PostgresKvStorage`, `PostgresStorageOptions`, `SqlClient`, `ClosableSqlClient` · internals: `pgConnection`, `pgReady`, `postgresKvStorage`, `PgConnection`                                                                                                                                                                                                                                                                                                                                                                                                          |
| `storage/mongodb` (+`/internals`)  | `createMongoStorage`, `MongoKvStorage`, `MongoStorageOptions` · internals: `mongoConnection`, `mongoKvStorage`, `isDuplicateKey`, `KvDocument`, `MongoConnection`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `storage/redis` (+`/internals`)    | `createRedisStorage`, `createRedisJSONStorage`, `RedisKvStorage`, `RedisLike`, `RedisStorageOptions`, `RedisWriteHook`, `RedisWriteContext` · internals: `createRedisKvStorage`, `redisConnection`, `scanKeys`, `stringCodec`, `jsonCodec`, `RedisConnection`, `RedisValueCodec`, `RedisKvStorageOptions`                                                                                                                                                                                                                                                                                                              |
| `storage/drizzle` (+`/internals`)  | `createDrizzleStorage`, `KeyCollisionError`, `DrizzleKvStorage`, `DrizzleStorageOptions`, `DrizzleDialect`, `DrizzleKvTable` · internals: `detectDrizzleDialect`, `affectedRows`, `drizzleSql`, `prefixSuccessor`, `DrizzleLikeDatabase`                                                                                                                                                                                                                                                                                                                                                                               |
| `storage/testing`                  | `runStorageConformance`, `runConformanceCases`, `contractCases`, `compareAndSwapCases`, `watchCases`, `requireCompareAndSwap`, `requireWatchable`, `settle`, types (`ConformanceOptions`, `ConformanceCase`, `ConformanceContext`, `ConformanceTestApi`, `MakeStorage`, `SeedLegacy`, …)                                                                                                                                                                                                                                                                                                                               |
| `drizzle/pg`                       | `pgKvTable(name, { schema, extraColumns, extraIndexes })`, `textC`, `PgKvTableOptions`, `PgKvColumns`, `DrizzleKvTable`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `drizzle/mysql`                    | `mysqlKvTable(name, { keyLength, keyCollation, extraColumns, extraIndexes })`, `binVarchar(name, length, collation)`, `MysqlKeyCollation`, `MysqlKvTableOptions`, `MysqlKvColumns`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `drizzle/sqlite`                   | `sqliteKvTable(name, { extraColumns, extraIndexes })`, `SqliteKvTableOptions`, `SqliteKvColumns`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Peers are loaded lazily on first use (`importPeer`); `bun:sqlite` too. Only `drizzle/*` import
`drizzle-orm` statically (approved). `storage-node-import.test.ts` bundles every storage entry with
esbuild (packages external) and imports it with plain `node` from a dir without `node_modules`, and
the built `dist/` too when present.

## Capabilities

| Driver                      | watch                              | CAS                                                               | Notes                                                                      |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| memory                      | ✓                                  | ✓                                                                 | `onWrite`                                                                  |
| file                        | ✓ (`fs.watch`)                     | ✓ in-process lock                                                 | atomic writes; legacy `ignore`/`warn`/`read-through`; `migrateFileStorage` |
| sqlite (bun) / libsql       | via `withWatch`                    | ✓ one statement + legacy fallback                                 | shared core `kv-sqlite.ts`, `GLOB`                                         |
| postgres                    | via `withWatch` + `pgListenNotify` | ✓ one statement (`jsonb`)                                         | `COLLATE "C"` on new tables; `value::text` read                            |
| mongodb                     | via `withWatch`                    | ✓ `$expr`/`$literal` + legacy fallback                            |                                                                            |
| redis / redisJSON           | ✓ keyspace notifications           | ✓ Lua string compare + JS structural fallback                     | `onWrite`, shared connection                                               |
| drizzle pg / mysql / sqlite | via `withWatch`                    | ✓ all three (+ sqlite legacy fallback, MySQL found-rows fallback) | MySQL: byte-exact keys, `KeyCollisionError`                                |
| cloudflare-kv, unstorage    | via `withWatch`                    | —                                                                 |                                                                            |

CAS fallback (ADR 0005): canonical fast path → read + `deepEqual` → swap on the raw stored form,
16 retries (`src/storage/cas.ts`).

## Inventory §3 fixes → where tested

| Fix                                                   | Test                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| F1 MySQL `utf8mb4_bin` key                            | `storage-drizzle` factory SQL types; live `storage-drizzle-mysql`                                  |
| F2 `LIKE … ESCAPE '!'`                                | `storage-contract` util; suite metacharacter case (pg, drizzle-pg)                                 |
| F3 SQL literal prefix + `startsWith`                  | suite metacharacter / case cases on every SQL driver; `storage-postgres` "table without COLLATE C" |
| F4 file case-safe encoding                            | `storage-file` codec test; suite case/accent cases                                                 |
| F4b legacy file stores (wh migrate + fl read-through) | `storage-file` legacy block on the fixture tree `fixtures/stored-data/file-legacy/`                |
| F5/F6 unstorage escaping + plain prefix               | suite metacharacter cases; `storage-unstorage` fixture `unstorage-keys.json`                       |
| F7/F8 Redis MATCH escaping + `startsWith`             | suite cases on fake + live redis                                                                   |
| F9 `DrizzleKvTable` typing                            | typecheck of `drizzle/*` (return type `DrizzleKvTable`)                                            |
| F10 redis watch test sets `notify-keyspace-events`    | live `storage-redis` (`CONFIG SET … KEA`)                                                          |
| O1 file watch remove only if gone                     | `storage-file` "never remove"; suite watch case                                                    |
| O2 escaped `PSUBSCRIBE`                               | suite "prefix with glob characters"; `storage-redis` exact-pattern test                            |
| O3 SCAN de-dup                                        | `storage-redis` fake SCAN that repeats keys; suite "many keys without duplicates"                  |
| O4 empty segments                                     | suite "empty key segments" (all drivers; file `%`, unstorage `%`)                                  |
| O5 file atomic write                                  | `storage-file` "no temporary files"                                                                |
| O6 unstorage `$`                                      | suite "$ keys"; `storage-unstorage` encoding + fixture                                             |
| O7/O7b DDL/connect retry                              | `storage-postgres`, `storage-libsql`, `storage-sqlite.bun`, `storage-mongodb` retry tests          |
| O8 `COLLATE "C"`                                      | `storage-postgres` schema test                                                                     |
| O9 SQLite `GLOB`                                      | suite case/metachar on sqlite, libsql, drizzle-sqlite                                              |
| O10 Mongo `startsWith`                                | live `storage-mongodb` case-insensitive collation test                                             |
| O11 canonical JSON on write                           | libsql / sqlite.bun / drizzle / redis "canonical" tests; suite key-order CAS case                  |
| O12 Mongo `$`-prefixed CAS                            | live `storage-mongodb` "swaps as data"                                                             |
| O13 MySQL drizzle CAS                                 | live mysql suite; fake-db found-rows test                                                          |
| O14 `deepEqual` own props                             | `storage-memory` `{a: undefined}` ≠ `{b: undefined}`                                               |
| cjson `{}` vs `[]`                                    | suite "{} and [] are different values" (fake + live, strings + RedisJSON)                          |
| unstorage empty segments (gap)                        | suite empty-segment case                                                                           |
| RedisJSON never in CI                                 | CI now runs live `redisJSON` (`REDIS_JSON_URL`, redis:8)                                           |
| `withWatch` spread pitfall                            | `storage-contract` "survives a spread", class-instance case                                        |
| unknown `STORAGE_DRIVER`                              | not storage drivers: CLI area (worker B)                                                           |

New fixes found during the build (each with a suite case or test):

- unstorage re-parsed strings via `destr` (`"123"` → `123`): strings written JSON-encoded; legacy raw strings fixture `unstorage-strings.json`.
- postgres/drizzle double-parse of JSON-looking strings: read raw text once (suite "strings that look like JSON stay strings").
- MySQL indexed `LIKE` skips emoji on `utf8mb4_bin`: range `key >= p AND key < prefixSuccessor(p)` (suite unicode case, live mysql; `prefixSuccessor` edge tests).
- MySQL PAD SPACE (`"a "` = `"a"`): byte-exact guard + `KeyCollisionError` + opt-in `keyCollation` (suite trailing-space case; live mysql on 0900_bin + dedicated utf8mb4_bin collision test).
- file read-through could open a legacy `Acme/` for `acme` on case-insensitive FS: `realpath` exactness check.

Stored-data fixtures (permanent): `file-legacy/` tree, `unstorage-keys.json`, `unstorage-strings.json`,
`products.json` (each product's table/db/collection/channel/key root + non-canonical rows), driven by
`storage-file`, `storage-unstorage`, `storage-stored-data` (pg + libsql legacy DDL), `storage-mongodb`
and `storage-redis` (live + fake).

## Extension points products will use

- **wh `claimDue`**
  - redis: `createRedisStorage({ …, onWrite(key, value, { client, toRedisKey }) })` to mirror due keys into `<prefix>whk:due` (`zAdd`/`zRem`); or `storage/redis/internals` `redisConnection` + `createRedisKvStorage({ codec: stringCodec|jsonCodec, connection })` so the claim Lua runs on the same client (`connection.get()`), with `stringCodec`/`jsonCodec` to read/write entries.
  - memory: `createMemoryStorage({ onWrite })` to keep a due index, or scan `getKeys` (+ `parseSortableLeaf`).
  - key helpers: `sortableLeaf`/`parseSortableLeaf`/`padMillis` = `dueKey`/`parseDueKey`.
- **au event log**
  - postgres: `pgConnection` + `pgReady(connection, [postgresStorageSchema(table), ...eventDdl])` + `postgresKvStorage(table, ready)`; event queries on `ready()`.
  - libsql: `libsqlConnection(opts, [sqliteKvSchema(table), ...eventDdl])` + `libsqlExecutor` + `sqliteKvStorage`; sqlite (bun): `sqliteConnection` + `bunSqliteExecutor`.
  - mongodb: `mongoConnection` + `mongoKvStorage`; events collection via `connection.collection(name)`, `isDuplicateKey`.
  - drizzle: `detectDrizzleDialect`, `drizzleSql`, `affectedRows`; product tables built with `textC` / `binVarchar`.
- **en counters**: `pgConnection`, `libsqlConnection`/`libsqlExecutor`, `mongoConnection`/`isDuplicateKey`, `redisConnection`/`scanKeys`, `detectDrizzleDialect`/`affectedRows`, `textC`/`binVarchar` (same names as en's own helpers).
- **Extra suites**: `runConformanceCases(title, cases, make, { t, keyRoot, … })` for claimDue / event log / counters; `runStorageConformance(…, { seedLegacy })` for each wrapped driver.

## What a product migration must know

1. **Pass persisted defaults explicitly** (`fixtures/stored-data/products.json`): `table` for sqlite/libsql/postgres (kit default `"xtandard_kv"`), Mongo `dbName`/`collectionName` (kit: `"xtandard"`/`"kv"`), `pgListenNotify` channel (kit: `"xtandard_kv"`), the drizzle factory `name` (now required), file `legacy` mode + `onLegacy` message (wh: `"warn"` with its v0.1.4 text; fl: `"read-through"`).
2. **Name mapping:** kit types are neutral (`KvStorage`, `RedisKvStorage`, …); products alias (`WebhooksStorage = KvStorage`). The table factories are renamed (`pgWebhooksTable` → wrapper over `pgKvTable(name ?? "xtandard_webhooks", opts)`). Keep `encodeSegment`/`decodeSegment`/`migrateFileStorage`/`clearFileStorage` exported from the product's `storage/file`.
3. **Behaviour changes to list under "Fixed"**: all the O-fixes above per product (inventory matrix), plus memory/file/sqlite/libsql/postgres/mongo/redis/drizzle now all have CAS; JSON-looking strings stay strings (pg/drizzle/unstorage); MySQL trailing-space keys never cross (throws `KeyCollisionError` on a utf8mb4_bin table); empty key segments are distinct (file, unstorage); `withWatch` survives spread.
4. **Stored data:** writes are now canonical JSON (key order) everywhere; reads of old data are unchanged; unstorage strings are written JSON-encoded (older releases still read them). No DDL change to existing tables; `COLLATE "C"` / NO PAD are new-table or opt-in only, migration SQL in `docs/STORAGE.md`.
5. **`createSqliteStorage`** creates its table on first use (was: in the constructor).
6. **Live tests:** gate only on `REDIS_URL`, `REDIS_JSON_URL`, `MONGO_URL`, `POSTGRES_URL`, `MYSQL_URL`; the reusable CI sets them (redis:8 → RedisJSON runs).
7. **Run the kit suite** on each wrapped driver with the product `keyRoot`, plus `seedLegacy` for SQL/Mongo/Redis.

Open: #11 (one-line comment on why `VALUES()` stays in the MySQL upsert: MariaDB has no row alias).
