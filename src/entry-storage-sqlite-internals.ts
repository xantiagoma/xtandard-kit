/**
 * `@xtandard/kit/storage/sqlite/internals` — **semi-public** building blocks of the `bun:sqlite`
 * driver (ADR 0004), for product capability layers (e.g. extra tables over the same database): the
 * lazy connection with one-time DDL, the executor adapter, and the shared SQLite KV core. Covered by
 * the versioning policy like any export; changes are a MINOR bump.
 *
 * @module
 */

export { bunSqliteExecutor, sqliteConnection, type SqliteConnection } from "./storage/sqlite.ts";
export {
  sqliteKvSchema,
  sqliteKvStorage,
  type SqliteExecutor,
  type SqliteRow,
} from "./storage/kv-sqlite.ts";
