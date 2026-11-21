/**
 * `@xtandard/kit/storage/sqlite` — SQLite storage on `bun:sqlite` (Bun only, zero npm deps), with
 * single-statement compare-and-swap. `bun:sqlite` is loaded on first use, so importing this subpath
 * works under any runtime.
 *
 * @module
 */

export {
  createSqliteStorage,
  type SqliteKvStorage,
  type SqliteStorageOptions,
} from "./storage/sqlite.ts";
