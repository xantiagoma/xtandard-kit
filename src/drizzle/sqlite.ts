/**
 * SQLite Drizzle table factory {@link sqliteKvTable}. Keys are `text PRIMARY KEY` with SQLite's
 * default `BINARY` collation (case-sensitive); the storage driver matches prefixes with `GLOB`,
 * never the case-folding `LIKE`. Schema-only (imports `drizzle-orm/sqlite-core`), so importing this
 * subpath requires `drizzle-orm`.
 *
 * @module
 */

import type { BuildColumns } from "drizzle-orm";
import {
  sqliteTable,
  text,
  type SQLiteColumnBuilderBase,
  type SQLiteTableExtraConfigValue,
} from "drizzle-orm/sqlite-core";
import type { DrizzleKvTable } from "./table.ts";

export type { DrizzleKvTable } from "./table.ts";

/** The `self` passed to a {@link SqliteKvTableOptions.extraIndexes} callback. */
export type SqliteKvColumns = BuildColumns<
  string,
  Record<string, SQLiteColumnBuilderBase>,
  "sqlite"
>;

/** Options for {@link sqliteKvTable}. */
export interface SqliteKvTableOptions {
  /** Additional columns merged into the table. */
  extraColumns?: () => Record<string, SQLiteColumnBuilderBase>;
  /** Additional indexes/constraints; receives the built columns. */
  extraIndexes?: (table: SqliteKvColumns) => SQLiteTableExtraConfigValue[];
}

/**
 * Build a Drizzle `sqliteTable` for the KV storage: `key text PRIMARY KEY`, `value text NOT NULL`
 * (JSON mode). `name` is required (ADR 0005).
 */
export function sqliteKvTable(name: string, opts?: SqliteKvTableOptions): DrizzleKvTable {
  const columns = {
    key: text("key").primaryKey(),
    value: text("value", { mode: "json" }).notNull(),
    ...opts?.extraColumns?.(),
  };
  const extraConfig = opts?.extraIndexes as
    | ((self: BuildColumns<string, typeof columns, "sqlite">) => SQLiteTableExtraConfigValue[])
    | undefined;
  return sqliteTable(name, columns, extraConfig) as unknown as DrizzleKvTable;
}
