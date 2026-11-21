/**
 * `@xtandard/kit/storage/libsql` — libSQL / Turso storage over `@libsql/client` (remote, embedded
 * replica or local file), with single-statement compare-and-swap.
 *
 * Optional peer: `@libsql/client` (loaded on first use).
 *
 * @module
 */

export {
  createLibsqlStorage,
  type LibsqlClientLike,
  type LibsqlKvStorage,
  type LibsqlStorageOptions,
} from "./storage/libsql.ts";
