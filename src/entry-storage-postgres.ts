/**
 * `@xtandard/kit/storage/postgres` — Postgres storage: one `jsonb` key/value table over `pg` or
 * PGlite, created on first use, with single-statement compare-and-swap.
 *
 * Optional peer: `pg` (only when the driver creates its own pool from a connection string).
 *
 * @module
 */

export {
  createPostgresStorage,
  postgresStorageSchema,
  type ClosableSqlClient,
  type PostgresKvStorage,
  type PostgresStorageOptions,
  type SqlClient,
} from "./storage/postgres.ts";
