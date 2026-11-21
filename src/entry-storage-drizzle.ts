/**
 * `@xtandard/kit/storage/drizzle` — storage over a Drizzle table and database you own (Postgres,
 * MySQL or SQLite): no DDL, no connection of its own, single-statement compare-and-swap.
 *
 * Optional peer: `drizzle-orm` (loaded on first use; build the table with
 * `@xtandard/kit/drizzle/{pg,mysql,sqlite}`).
 *
 * @module
 */

export {
  createDrizzleStorage,
  type DrizzleDialect,
  type DrizzleKvStorage,
  type DrizzleKvTable,
  type DrizzleStorageOptions,
} from "./storage/drizzle.ts";
