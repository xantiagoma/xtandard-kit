/**
 * `@xtandard/kit/storage/postgres/internals` — **semi-public** building blocks of the Postgres
 * driver (ADR 0004): the lazy `pg` connection, `pgReady` (one-time, retried DDL; au's event log adds
 * its tables here) and the KV operations over an existing table. Covered by the versioning policy
 * like any export; changes are a MINOR bump.
 *
 * @module
 */

export {
  pgConnection,
  pgReady,
  postgresKvStorage,
  postgresStorageSchema,
  type ClosableSqlClient,
  type PgConnection,
  type SqlClient,
} from "./storage/postgres.ts";
