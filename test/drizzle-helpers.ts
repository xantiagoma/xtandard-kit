/**
 * Test helpers for the SQL drivers: one in-process PGlite per test file (booting the WASM Postgres
 * is the slow part) with a fresh table name per test, and `CREATE TABLE` DDL generated from a
 * Drizzle table factory's own column config, so the factory's column types are what get tested.
 *
 * @module
 */

import { PGlite } from "@electric-sql/pglite";
import { getTableConfig as getMysqlTableConfig, type MySqlTable } from "drizzle-orm/mysql-core";
import { getTableConfig as getPgTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { getTableConfig as getSqliteTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";

let shared: PGlite | undefined;
let n = 0;

/** The file's shared PGlite instance (created on first use). */
export const pglite = (): PGlite => (shared ??= new PGlite());

/** A table name not used before in this process. */
export const uniqueTable = (base = "t"): string => `${base}_${process.pid}_${n++}`;

/** `CREATE TABLE` from a factory-built table. */
export function createTableSql(table: unknown, dialect: "pg" | "mysql" | "sqlite"): string {
  const q = dialect === "mysql" ? "`" : '"';
  const c =
    dialect === "mysql"
      ? getMysqlTableConfig(table as MySqlTable)
      : dialect === "pg"
        ? getPgTableConfig(table as PgTable)
        : getSqliteTableConfig(table as SQLiteTable);
  const schema = "schema" in c && c.schema ? `${q}${c.schema}${q}.` : "";
  const cols = c.columns.map(
    (col) =>
      `${q}${col.name}${q} ${col.getSQLType()}${col.notNull ? " NOT NULL" : ""}${col.primary ? " PRIMARY KEY" : ""}`,
  );
  return `CREATE TABLE ${schema}${q}${c.name}${q} (${cols.join(", ")})`;
}
