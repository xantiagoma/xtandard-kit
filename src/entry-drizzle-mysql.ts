/**
 * `@xtandard/kit/drizzle/mysql` — the MySQL KV table factory `mysqlKvTable(name, opts)` and the
 * `binVarchar` (`utf8mb4_bin`) column helper. Schema-only; requires `drizzle-orm`.
 *
 * @module
 */

export {
  binVarchar,
  mysqlKvTable,
  type DrizzleKvTable,
  type MysqlKeyCollation,
  type MysqlKvColumns,
  type MysqlKvTableOptions,
} from "./drizzle/mysql.ts";
