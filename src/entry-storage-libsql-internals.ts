/**
 * `@xtandard/kit/storage/libsql/internals` — **semi-public** building blocks of the libSQL driver
 * (ADR 0004): the lazy connection with one-time, retried DDL (`libsqlConnection`, also the `ready`
 * plumbing for product tables such as au's event log), the executor adapter and the shared SQLite KV
 * core. Covered by the versioning policy like any export; changes are a MINOR bump.
 *
 * @module
 */

export {
  libsqlConnection,
  libsqlExecutor,
  type LibsqlClientLike,
  type LibsqlConnection,
} from "./storage/libsql.ts";
export {
  sqliteKvSchema,
  sqliteKvStorage,
  type SqliteExecutor,
  type SqliteRow,
} from "./storage/kv-sqlite.ts";
