# Storage

Every xtandard product runs on one four-method async key/value contract. The kit owns the contract,
the drivers, the shared helpers and the conformance suite. Products alias the types under their own
names and pass their persisted defaults (table, database, collection, prefix, channel) explicitly.

## The contract

```ts
import type { KvStorage } from "@xtandard/kit/storage";

interface KvStorage {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  getKeys(prefix: string): Promise<string[]>; // a plain, case-sensitive string prefix
}
```

Optional capabilities are separate interfaces, feature-detected with guards:

| Capability       | Interface                 | Guard              | Meaning                                                                                              |
| ---------------- | ------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `watch`          | `WatchableKvStorage`      | `isWatchable`      | `watch(prefix, cb)` pushes `{ type: "update" \| "remove", key }` and resolves to an unsubscribe.     |
| `compareAndSwap` | `CompareAndSwapKvStorage` | `isCompareAndSwap` | `compareAndSwap({ key, expected, next })` writes atomically when the stored value equals `expected`. |

`expected: null` means "the key is absent". Equality is structural: object key order is ignored,
arrays are ordered, and only own properties count (`{ a: undefined }` is not `{ b: undefined }`). Of
several concurrent swaps from the same `expected`, exactly one wins.

`TransactionalKvStorage` and `isTransactional` are exported for API compatibility only. They are
`@deprecated`: no driver implements them and nothing calls them.

### Product aliases

```ts
// xtandard-webhooks/src/storage/contract.ts
export type {
  KvStorage as WebhooksStorage,
  WatchableKvStorage as WatchableWebhooksStorage,
  CompareAndSwapKvStorage as CompareAndSwapWebhooksStorage,
} from "@xtandard/kit/storage";
export { isWatchable, isCompareAndSwap, requirePeer } from "@xtandard/kit/storage";
```

Wrappers should also pass `subpath` (sqlite, libsql, postgres, mongodb, redis, drizzle), so that
errors such as a missing peer or a missing `client`/`url` name the import path the user wrote:

```ts
export const createMongoStorage = (o: MongoStorageOptions) =>
  kit.createMongoStorage({
    dbName: "xtandard_webhooks",
    ...o,
    subpath: "@xtandard/webhooks/storage/mongodb",
  });
```

## Drivers

| Subpath                                         | Factory                                                             | Peer                                              | watch                              | CAS                   | Extension points (ADR 0004)          |
| ----------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------- | --------------------- | ------------------------------------ |
| `storage/memory`                                | `createMemoryStorage`                                               | —                                                 | ✓                                  | ✓                     | `onWrite`                            |
| `storage/file`                                  | `createFileStorage`                                                 | —                                                 | ✓ (`fs.watch`)                     | ✓ (in-process)        | —                                    |
| `storage/unstorage`                             | `createUnstorageStorage`                                            | `unstorage`                                       | via `withWatch`                    | —                     | —                                    |
| `storage/cloudflare-kv`                         | `createCloudflareKvStorage`                                         | — (a binding)                                     | via `withWatch`                    | —                     | —                                    |
| `storage/sqlite`                                | `createSqliteStorage`                                               | — (`bun:sqlite`, Bun only)                        | via `withWatch`                    | ✓                     | `storage/sqlite/internals`           |
| `storage/libsql`                                | `createLibsqlStorage`                                               | `@libsql/client`                                  | via `withWatch`                    | ✓                     | `storage/libsql/internals`           |
| `storage/postgres`                              | `createPostgresStorage`, `postgresStorageSchema`                    | `pg` (only for a connection string)               | via `withWatch` + `pgListenNotify` | ✓                     | `storage/postgres/internals`         |
| `storage/drizzle`                               | `createDrizzleStorage`                                              | `drizzle-orm`                                     | via `withWatch`                    | ✓ (pg, mysql, sqlite) | `storage/drizzle/internals`          |
| `storage/mongodb`                               | `createMongoStorage`                                                | `mongodb`                                         | via `withWatch`                    | ✓                     | `storage/mongodb/internals`          |
| `storage/redis`                                 | `createRedisStorage`, `createRedisJSONStorage`                      | `redis`                                           | ✓ (keyspace notifications)         | ✓                     | `onWrite`, `storage/redis/internals` |
| `drizzle/pg`, `drizzle/mysql`, `drizzle/sqlite` | `pgKvTable`, `mysqlKvTable`, `sqliteKvTable`, `textC`, `binVarchar` | `drizzle-orm` (**required**: imported statically) | —                                  | —                     | —                                    |

Conventions shared by every driver:

- Optional peers are loaded lazily with a dynamic `import()` on first use. A missing peer fails with
  an error that names the package to install and the subpath that needs it. Importing a driver
  subpath never loads its peer.
- A driver that creates its own client (from a `url` or `connectionString`) closes it in `close()`.
  A client you pass in is never closed.
- `getKeys` re-checks every key with an exact `startsWith`, so a backend that over-matches (a
  case-folding collation, a glob) never leaks keys from another prefix.

### Memory

```ts
import { createMemoryStorage } from "@xtandard/kit/storage/memory";

const storage = createMemoryStorage({ initial: { "app/config": { theme: "dark" } } });
```

Values are deep-cloned on write and read. `watch` callbacks fire on the next microtask. `onWrite`
is the extension point products use to keep their own indexes (see below).

### File

```ts
import { createFileStorage } from "@xtandard/kit/storage/file";

const storage = createFileStorage({ dir: "./data" });
```

- Each key is a JSON file; each `/`-separated segment is a directory. Segments are encoded into
  reversible, case-safe names: an uppercase letter becomes `^` + the letter (`Acme` → `^acme`), `^`
  becomes `^^`, anything outside `[a-z0-9._~!@,=+-]` becomes `%XX` of its UTF-8 bytes, a leading `.`
  becomes `%2E`, and an empty segment (`a//b`, `a/`) is a lone `%`. Keys without empty segments map to
  the same paths as in every earlier product release.
- Writes go to a temporary file that is renamed into place, so a crash never leaves a half-written
  value.
- `compareAndSwap` is serialized per key **within one process**. Several processes sharing one
  directory need a database driver.
- `watch` uses a recursive `fs.watch`; a `rename` is reported as `remove` only when the file is gone.

**Stores written before segment encoding** (raw segment names) are handled by `legacy`:

| `legacy`             | Behaviour                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"ignore"` (default) | Legacy leaves are invisible.                                                                                                                               |
| `"warn"`             | Invisible, and `onLegacy(dir)` runs once. The default `onLegacy` is a `console.warn` that points at `migrateFileStorage`. Products pass their own message. |
| `"read-through"`     | `getItem` falls back to the legacy file, `getKeys` lists legacy leaves (once), and the next write or remove of the key deletes the legacy file.            |

`migrateFileStorage({ dir })` moves every legacy leaf to its encoded path once (idempotent; run it
with no writer). On a case-insensitive filesystem a legacy directory such as `Acme/` can still alias
the encoded `acme/` until you migrate; `"read-through"` reads guard against it with `realpath`, but
writes do not, so migrate stores you keep writing to.

### unstorage

```ts
import { createUnstorageStorage } from "@xtandard/kit/storage/unstorage";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";

const storage = createUnstorageStorage({
  storage: createStorage({ driver: fsDriver({ base: "./data" }) }),
});
```

unstorage rewrites keys (`/` and `\` become `:`, `?…` is dropped, separators collapse, keys ending
in `$` are hidden meta keys). The driver encodes `%`, `:`, `\` and `?` (as every product did), a
**trailing** `$` as `%24`, and an empty segment as a lone `%`. Reads fall back to the older
spellings of keys containing `$` (raw, as wh/fl/au/li wrote them, and every-`$`-encoded, as en wrote
them), and writes retire the old spelling. No `compareAndSwap`: unstorage drivers have no atomic
primitive.

String values are written JSON-encoded (`"hello"` is stored as `"\"hello\""`): unstorage reads
strings back through `destr`, which turned a stored `"123"` into the number `123` in every earlier
release. A plain unstorage `getItem` (an older product release) still reads the original string.
Strings stored verbatim by earlier releases read back exactly as those releases returned them,
including that legacy parse (`"123"` → `123`).

### Cloudflare KV

```ts
import { createCloudflareKvStorage } from "@xtandard/kit/storage/cloudflare-kv";

const storage = createCloudflareKvStorage({ namespace: env.DATA, prefix: "prod" });
```

Eventually consistent (up to ~60 s), paginated listing, no `compareAndSwap`. `prefix` is joined
with `:` and stripped from `getKeys`.

### SQLite (`bun:sqlite`) and libSQL

```ts
import { createSqliteStorage } from "@xtandard/kit/storage/sqlite";
import { createLibsqlStorage } from "@xtandard/kit/storage/libsql";

const local = createSqliteStorage({ path: "./data.sqlite", table: "xtandard_kv" }); // or { database }
const turso = createLibsqlStorage({
  url: process.env.TURSO_DATABASE_URL!,
  authToken,
  table: "xtandard_kv",
}); // or { client }
```

Both share one SQLite-dialect core: `key TEXT PRIMARY KEY, value TEXT NOT NULL`, values written as
canonical JSON, `getKeys` with `GLOB` (case-sensitive, index-usable), and `compareAndSwap` as one
conditional `UPDATE … WHERE value = ?` (or `INSERT … ON CONFLICT DO NOTHING`). The table is created
on first use; a failed connect or DDL is retried on the next call. `bun:sqlite` is loaded on first
use, so importing `storage/sqlite` works under Node (opening a database needs Bun).

### Postgres

```ts
import { createPostgresStorage, postgresStorageSchema } from "@xtandard/kit/storage/postgres";

const storage = createPostgresStorage({
  connectionString: process.env.DATABASE_URL,
  table: "xtandard_kv",
});
// or { client: pool } / { client: new PGlite() }; postgresStorageSchema(table) is the DDL for migrations
```

`key text COLLATE "C" PRIMARY KEY, value jsonb NOT NULL`. The `"C"` collation applies to **new
tables only**; existing tables keep working because prefixes are matched with `LIKE … ESCAPE '!'`
plus an exact `startsWith`. To get bytewise, index-usable prefixes on an older table:

```sql
ALTER TABLE xtandard_kv ALTER COLUMN key TYPE text COLLATE "C";
```

Values are read as `value::text` and parsed once. `compareAndSwap` compares `jsonb` (structural), so
rows written before canonicalisation swap too. A failed DDL is retried, not cached.

### Drizzle

```ts
// schema.ts — needs drizzle-orm installed (the drizzle/* subpaths import it statically)
import { pgKvTable } from "@xtandard/kit/drizzle/pg";
export const kv = pgKvTable("xtandard_kv", { schema: "app" });

// storage.ts
import { createDrizzleStorage } from "@xtandard/kit/storage/drizzle";
const storage = createDrizzleStorage({ db: drizzle(pool), table: kv }); // dialect read from db
```

- The table factories take a **required** `name` (products pass their persisted name; ADR 0005)
  and `extraColumns` / `extraIndexes`; `pgKvTable` takes `schema`, `mysqlKvTable` takes `keyLength`
  (default 512). Keys are `text COLLATE "C"` (pg), `varchar … COLLATE utf8mb4_bin` (MySQL) or `text`
  (SQLite). `textC(name)` and `binVarchar(name, length)` build the same key columns for product
  tables.
- **Schema stability for existing tables.** Changing a factory's key column makes drizzle-kit
  generate an `ALTER` for every existing deployment. So both factories let a product keep the
  column it already declared:
  - `pgKvTable(name, { keyCollation: null })` gives a plain `text` key (the webhooks, flags, audit
    and links tables);
  - `mysqlKvTable(name, { keyCollation })` takes `utf8mb4_bin` (default), `utf8mb4_0900_bin` or
    `utf8mb4_nopad_bin`.

  The driver is correct with either column, because prefix queries are post-filtered with an exact
  `startsWith`.

- The **`drizzle/*` subpaths import `drizzle-orm` statically**: they build tables synchronously, so
  importing them requires `drizzle-orm`. `storage/drizzle` loads it lazily.
- `createDrizzleStorage` issues no DDL and never closes `db`. CAS is one statement on all three
  dialects: `jsonb` equality on pg, `JSON` equality on MySQL (with a found-rows fallback for drivers
  without `CLIENT_FOUND_ROWS`), canonical text on SQLite with the structural fallback for legacy rows.
- `getKeys` on MySQL matches the bytewise range `key >= prefix AND key < successor(prefix)` rather
  than `LIKE 'prefix%'`: MySQL's range optimizer skips supplementary characters (emoji) for an
  indexed `LIKE` on a `utf8mb4_bin` key. Both are index-usable.
- A MySQL table created before the key column was binary-collated:

  ```sql
  ALTER TABLE xtandard_kv MODIFY `key` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
  ```

#### MySQL: PAD SPACE

`utf8mb4_bin` is a **PAD SPACE** collation: it ignores trailing spaces, so `"app/a "` and
`"app/a"` are the same primary key. Every product's MySQL table uses it (it was the case-sensitivity
fix, F1), and the default stays `utf8mb4_bin` so existing schemas generate no migration.

- The driver guards every operation: reads, removes and swaps match keys byte-exactly, and a write
  whose key differs from a stored key only by trailing spaces throws `KeyCollisionError` (from
  `@xtandard/kit/storage/drizzle`) instead of overwriting it. The error names both keys and carries
  the migration SQL.
- New tables can opt into a NO PAD collation, which keeps such keys distinct: `utf8mb4_0900_bin`
  on MySQL 8.0+ or `utf8mb4_nopad_bin` on MariaDB (MySQL 5.7 has neither):
  `mysqlKvTable(name, { keyCollation: "utf8mb4_0900_bin" })`, or
  `binVarchar(name, length, "utf8mb4_0900_bin")` for product tables.
- Existing tables can migrate in place. The `ALTER` cannot fail on duplicates, because a PAD SPACE
  key never stored two keys that differ only by trailing spaces:

  ```sql
  ALTER TABLE xtandard_kv MODIFY `key` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL;
  -- MariaDB: COLLATE utf8mb4_nopad_bin
  ```

### MongoDB

```ts
import { createMongoStorage } from "@xtandard/kit/storage/mongodb";

const storage = createMongoStorage({
  url: process.env.MONGO_URL,
  dbName: "xtandard_webhooks",
  collectionName: "webhooks_kv",
});
```

One `{ _id: key, value }` collection (defaults `"xtandard"` / `"kv"`; products pass theirs). Values
are written with sorted fields because BSON equality is field-order sensitive. `compareAndSwap` is
one `updateOne` with `$expr` + `$literal` (a value with `$`-prefixed keys stays data); a document
written before canonicalisation is swapped through the structural fallback. `getKeys` re-checks
`startsWith`, so a case-insensitive collection collation never leaks keys. No `watch` (change
streams need a replica set). A failed connect is retried.

### Redis and RedisJSON

```ts
import { createRedisJSONStorage, createRedisStorage } from "@xtandard/kit/storage/redis";

const storage = createRedisStorage({
  url: process.env.REDIS_URL,
  prefix: "app",
  onError: console.error,
});
const docs = createRedisJSONStorage({ url: process.env.REDIS_URL, prefix: "app" }); // Redis 8 / Stack
```

- `prefix` is joined with `:` and stripped from `getKeys`. Never point both variants at the same keys.
- `getKeys` uses `SCAN` with the prefix glob-escaped, **de-duplicated** (SCAN may return a key twice).
- `watch` uses keyspace notifications on a glob-escaped `PSUBSCRIBE` pattern. The server needs
  `notify-keyspace-events` (e.g. `KEA`).
- `compareAndSwap` is a Lua script that compares the stored text with the canonical JSON of
  `expected` as **strings** (the copies decoded both with `cjson`, which cannot tell `{}` from
  `[]`). On a miss it reads the raw text, compares structurally in JS and swaps on the exact raw
  text, so values written before canonicalisation, or serialized differently by RedisJSON, swap too.
- `onWrite(key, value | null, { client, redisKey, toRedisKey })` runs after every successful write,
  swap and remove.

## Change notifications: `withWatch` and `pgListenNotify`

`withWatch(storage, subscribe)` adds `watch` to any storage from a change source you already have.
`pgListenNotify(client, channel)` is such a source for Postgres `LISTEN`/`NOTIFY`; the channel is a
parameter (products pass the one they document, e.g. `"xtandard_webhooks"`; the neutral default is
`"xtandard_kv"`).

```ts
import { pgListenNotify, withWatch } from "@xtandard/kit/storage";

const storage = withWatch(base, pgListenNotify(listenerClient, "xtandard_webhooks"));
```

The wrapper inherits from `storage` and also carries every member as an own property, so spreading
it (`{ ...withWatch(s, sub) }`) keeps the methods.

## Helpers

`@xtandard/kit/storage` also exports what the drivers share, for product capability layers:

- `assertIdentifier(name, what?)`: throws unless `name` is a safe SQL identifier.
- `escapeLike` (for `LIKE … ESCAPE '!'`), `escapeGlob` (SQLite `GLOB`), `escapeRedisGlob` (Redis
  `MATCH`/`PSUBSCRIBE`), `escapeRegex`.
- `canonical`, `canonicalJson` (sorted keys), `deepEqual` (own properties), `parseJsonValue`.
- Key helpers: `encodeSegment` / `decodeSegment` (`encodeURIComponent`, plus `~` → `%7E`),
  `lastSegment` (decoded), `padMillis`, `sortableLeaf(ms, id)` → `"<13-digit ms>~<id>"` and
  `parseSortableLeaf`. Sorting such keys sorts them by time on every backend.
- `requirePeer` / `importPeer` for product subpaths with their own optional peers.

## Extension points (ADR 0004)

Product capabilities (`claimDue`, the event log, counters) are built on top of the drivers, never by
forking them.

- **`onWrite(key, value | null)`** on memory and redis: called after every successful write, swap and
  remove (`null`). On redis it also receives `{ client, redisKey, toRedisKey }`. wh mirrors its due
  keys into a sorted set with it:

  ```ts
  import { createRedisStorage } from "@xtandard/kit/storage/redis";

  const storage = createRedisStorage({
    ...options,
    onWrite: async (key, value, { client, toRedisKey }) => {
      const due = parseDueKey(key); // product code
      if (!due) return;
      if (value === null) await client.zRem(toRedisKey("whk:due"), key);
      else await client.zAdd(toRedisKey("whk:due"), { score: due.dueAtMillis, value: key });
    },
  });
  ```

- **`…/internals` subpaths** (semi-public, versioned like any export):
  - `storage/sqlite/internals`: `sqliteConnection(options, ddl)`, `bunSqliteExecutor`,
    `sqliteKvStorage(table, exec)`, `sqliteKvSchema`, `SqliteExecutor`.
  - `storage/libsql/internals`: `libsqlConnection(options, ddl)`, `libsqlExecutor`, and the same
    SQLite core.
  - `storage/postgres/internals`: `pgConnection(client, connectionString)`, `pgReady(connection,
ddl)`, `postgresKvStorage(table, exec)`, `postgresStorageSchema`.
  - `storage/drizzle/internals`: `detectDrizzleDialect`, `affectedRows`, `drizzleSql`,
    `prefixSuccessor`, `DrizzleLikeDatabase`.
  - `storage/mongodb/internals`: `mongoConnection`, `isDuplicateKey`, `mongoKvStorage(collection)`.
  - `storage/redis/internals`: `redisConnection`, `scanKeys` (de-duplicating), `stringCodec`,
    `jsonCodec`, and `createRedisKvStorage({ codec, connection, … })`, so a capability layer (wh's
    `claimDue` Lua script) runs on the driver's own connection.

  The connection helpers take a list of DDL statements that run once (retried after a failure).
  au's event log passes its own tables there and reuses the executor for its queries:

  ```ts
  import {
    pgConnection,
    pgReady,
    postgresKvStorage,
    postgresStorageSchema,
  } from "@xtandard/kit/storage/postgres/internals";

  const connection = pgConnection(options.client, options.connectionString);
  const ready = pgReady(connection, [postgresStorageSchema(table), ...eventLogDdl]);
  const kv = postgresKvStorage(table, ready);
  const events = createEventLog(ready); // product code
  ```

## Stored-data compatibility (ADR 0005)

Upgrading a product never makes existing keys unreadable or swaps fail forever:

- **File:** keys without empty segments map to the same paths as before; legacy unencoded trees are
  handled by `legacy` and `migrateFileStorage`.
- **unstorage:** only a trailing `$` changed spelling, and reads fall back to both older spellings.
- **New-table DDL only:** `COLLATE "C"` (pg) and `utf8mb4_bin` (MySQL) apply to tables the kit
  or the factories create; older tables keep working through the exact prefix post-filter, and the
  optional migration SQL is above.
- **Mongo and Redis:** documents and values written with fields in insertion order (and RedisJSON
  vs string-codec values) are read, listed and swapped; `test/fixtures/stored-data/products.json`
  drives those fixtures under every product's key root, database and collection.
- **CAS on legacy values:** writes are canonical. A swap first tries the canonical form, then reads
  the stored value, compares it structurally and swaps on the exact stored form, with bounded
  retries.

The fixtures in `test/fixtures/stored-data/` (a pre-encoding file tree, raw unstorage keys from
every product) are permanent tests: a kit change that orphans old data fails CI.

## The conformance suite (ADR 0006)

`@xtandard/kit/storage/testing` runs the same cases against any driver. The test API is injected,
so it works under vitest and `bun:test`:

```ts
import { describe, expect, test } from "vitest"; // or "bun:test"
import { runStorageConformance } from "@xtandard/kit/storage/testing";

runStorageConformance("postgres", () => createPostgresStorage({ client, table: freshTable() }), {
  t: { describe, test, expect },
  capabilities: { compareAndSwap: true, watch: false }, // watch: true | { settleMs, removals }
  keyRoot: "whk", // first segment of every key the suite writes
  timeout: 20_000,
  seedLegacy: async (_storage, key, rawJson) => {
    // write a non-canonical stored form directly, to exercise the legacy CAS path
  },
});
```

- `make` must return an **empty** storage (or an empty namespace of a shared one) for every test.
- The cases cover: round-trips (objects, arrays, primitives, `{}` vs `[]`), overwrite and remove,
  prefix isolation, case and accent sensitivity, LIKE/GLOB/Redis/unstorage metacharacters, `$`, `#`,
  unicode (NFC ≠ NFD), empty segments, zero-padded sortable keys, many keys without duplicates; CAS
  semantics, key-order insensitivity, `{}` ≠ `[]`, concurrent claims and swaps (exactly one wins),
  legacy non-canonical values; watch filtering, glob characters in the watched prefix, unsubscribe.
- Products register their own suites with `runConformanceCases(title, cases, make, options)`, where
  each case is `{ name, run({ storage, key, expect, settle, options }) }`. The kit's case lists
  (`contractCases`, `compareAndSwapCases`, `watchCases`) are exported too.
- **Declare every capability.** A built-in case checks `capabilities` against the storage itself. A
  driver that implements `compareAndSwap` or `watch` without declaring it fails, rather than
  silently skipping those cases, and so does one that declares a capability it lacks. Pass `false`
  for what the driver doesn't have. For a `withWatch` storage, whose notifier only gives a key so
  every event is an `update`, pass `watch: { removals: false }`.
- **No live Redis needed** for a product's wrapped redis driver: `fakeRedis()` (with
  `asRedisClient`) from the same subpath emulates strings, RedisJSON, the kit's Lua scripts, sorted
  sets, a repeating SCAN and glob PSUBSCRIBE. A product's own Lua scripts can be answered through
  `fakeRedis({ eval })`, which returns `undefined` to fall through to the kit's.
- Live backends are gated by environment variables only: `REDIS_URL`, `REDIS_JSON_URL`,
  `MONGO_URL`, `POSTGRES_URL`, `MYSQL_URL`.

## Migration notes for products

- Replace `src/storage/<driver>.ts` with a wrapper that passes the product's persisted defaults:
  the file `legacy` mode and message (wh: `"warn"` with its v0.1.4 message; fl: `"read-through"`).
- Keep exporting `encodeSegment`, `decodeSegment`, `migrateFileStorage` and `clearFileStorage` from
  the product's `storage/file` subpath (re-export them from the kit).
- `createMemoryStorage` now always has `compareAndSwap` (fl's had none) and accepts `onWrite`.
- Behaviour changes that come from inherited fixes, to list under "Fixed" in the product CHANGELOG:
  file watch no longer reports a write as `remove`, file writes are atomic, empty key segments are
  distinct keys (file, unstorage), unstorage keys ending in `$` are listed, memory CAS checks own
  properties, and `withWatch` results survive a spread.
- Redis: `getKeys` no longer returns duplicates, `watch` no longer misses events under a prefix with
  glob characters, values are written as canonical JSON, and every product now has
  `compareAndSwap` on redis (wh and fl had none). Mongo now has `compareAndSwap` everywhere.
- SQL drivers (postgres, drizzle): a stored JSON **string** that looks like JSON (`"123"`) now reads
  back as that string; the copies parsed it a second time (`123`). sqlite/libsql/postgres/drizzle
  now all have `compareAndSwap`, and the drizzle driver has it on MySQL too.
- Pass the persisted names explicitly: `table` (sqlite, libsql, postgres; the kit default is the
  neutral `"xtandard_kv"`), the drizzle table `name` (now required), and the `pgListenNotify`
  channel. `test/fixtures/stored-data/products.json` lists each product's values.
