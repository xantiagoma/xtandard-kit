# ADR 0004 — Neutral storage contract, capability guards and driver extension points

**Status:** Accepted

---

## Context

All five products use the same four-method KV contract, with optional `watch` and `compareAndSwap`
capabilities:

- `getItem`, `setItem`, `removeItem`, `getKeys`.

There are two product-specific layers on top:

- webhooks: `claimDue`, which mirrors due keys into a Redis zset on every write;
- audit: a native event log, which reuses each driver's SQL executor and readiness.

`TransactionalXStorage` is declared and exported everywhere, but implemented and used nowhere.

## Decision

- The kit exports `KvStorage`, `WatchableKvStorage`, `CompareAndSwapKvStorage`, `StorageChangeEvent`
  and the `isWatchable` / `isCompareAndSwap` guards.
- `TransactionalKvStorage` and `isTransactional` are kept as **exported types only**, for API
  compatibility, and marked `@deprecated`. No driver implements them.
- Drivers expose their extension points:
  - an `onWrite(key, value | null)` hook, on memory and redis;
  - the connection, codec and key-mapping helpers they use internally (`redisConnection`, `scanKeys`,
    `pgConnection`, `libsqlExecutor`, `mongoConnection`, `detectDrizzleDialect`…). These are exported
    from a dedicated `…/internals` export of each driver subpath, documented as semi-public.
- Products build capability layers (`claimDue`, the event log, counters) on top of these. They never
  fork the driver.

## Consequences

- wh and au keep their capability code, but lose their driver copies.
- The semi-public internals are covered by the kit's versioning policy like any export. Changing them
  is a MINOR bump.
