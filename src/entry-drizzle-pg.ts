/**
 * `@xtandard/kit/drizzle/pg` — the Postgres KV table factory `pgKvTable(name, opts)` and the
 * `textC` (`text COLLATE "C"`) column helper. Schema-only; requires `drizzle-orm`.
 *
 * @module
 */

export {
  pgKvTable,
  textC,
  type DrizzleKvTable,
  type PgKvColumns,
  type PgKvTableOptions,
} from "./drizzle/pg.ts";
