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

## Drivers

| Subpath                 | Factory                     | Peer          | watch           | CAS            | Extension points (ADR 0004) |
| ----------------------- | --------------------------- | ------------- | --------------- | -------------- | --------------------------- |
| `storage/memory`        | `createMemoryStorage`       | —             | ✓               | ✓              | `onWrite`                   |
| `storage/file`          | `createFileStorage`         | —             | ✓ (`fs.watch`)  | ✓ (in-process) | —                           |
| `storage/unstorage`     | `createUnstorageStorage`    | `unstorage`   | via `withWatch` | —              | —                           |
| `storage/cloudflare-kv` | `createCloudflareKvStorage` | — (a binding) | via `withWatch` | —              | —                           |

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

### Cloudflare KV

```ts
import { createCloudflareKvStorage } from "@xtandard/kit/storage/cloudflare-kv";

const storage = createCloudflareKvStorage({ namespace: env.DATA, prefix: "prod" });
```

Eventually consistent (up to ~60 s), paginated listing, no `compareAndSwap`. `prefix` is joined
with `:` and stripped from `getKeys`.

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

- **`onWrite(key, value | null)`** on memory: called after every successful write, swap and remove
  (`null`). wh mirrors its due keys into its own index with it.

## Stored-data compatibility (ADR 0005)

Upgrading a product never makes existing keys unreadable or swaps fail forever:

- **File:** keys without empty segments map to the same paths as before; legacy unencoded trees are
  handled by `legacy` and `migrateFileStorage`.
- **unstorage:** only a trailing `$` changed spelling, and reads fall back to both older spellings.
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
  capabilities: { compareAndSwap: true, watch: false }, // watch: true | { settleMs }
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
