/**
 * MySQL Drizzle table factories: {@link mysqlKvTable} for the KV storage, and {@link binVarchar},
 * the binary-collated key column products reuse. MySQL's default `utf8mb4_0900_ai_ci` is case- and
 * accent-insensitive, which would make `app/Acme` and `app/acme` one primary key. Schema-only
 * (imports `drizzle-orm/mysql-core`), so importing this subpath requires `drizzle-orm`.
 *
 * @module
 */

import type { BuildColumns } from "drizzle-orm";
import {
  customType,
  json,
  mysqlTable,
  type MySqlColumnBuilderBase,
  type MySqlTableExtraConfigValue,
} from "drizzle-orm/mysql-core";
import type { DrizzleKvTable } from "./table.ts";

export type { DrizzleKvTable } from "./table.ts";

/**
 * A `varchar(length) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin` column: case- and accent-sensitive,
 * byte-exact. `length` defaults to 512; keep it within your InnoDB index-prefix limit for keys.
 */
export function binVarchar(name: string, length = 512) {
  return customType<{ data: string; driverData: string }>({
    dataType: () => `varchar(${length}) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  })(name);
}

/** The `self` passed to a {@link MysqlKvTableOptions.extraIndexes} callback. */
export type MysqlKvColumns = BuildColumns<string, Record<string, MySqlColumnBuilderBase>, "mysql">;

/** Options for {@link mysqlKvTable}. */
export interface MysqlKvTableOptions {
  /** `varchar` length of the `key` primary key. Default `512`. */
  keyLength?: number;
  /** Additional columns merged into the table. */
  extraColumns?: () => Record<string, MySqlColumnBuilderBase>;
  /** Additional indexes/constraints; receives the built columns. */
  extraIndexes?: (table: MysqlKvColumns) => MySqlTableExtraConfigValue[];
}

/**
 * Build a Drizzle `mysqlTable` for the KV storage: `key varchar(keyLength) … COLLATE utf8mb4_bin
 * PRIMARY KEY`, `value json NOT NULL`. `name` is required (ADR 0005).
 *
 * Tables created before the key column was binary-collated can be fixed with:
 *
 * ```sql
 * ALTER TABLE <name> MODIFY `key` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
 * ```
 */
export function mysqlKvTable(name: string, opts?: MysqlKvTableOptions): DrizzleKvTable {
  const columns = {
    key: binVarchar("key", opts?.keyLength ?? 512).primaryKey(),
    value: json("value").notNull(),
    ...opts?.extraColumns?.(),
  };
  // The public `extraIndexes` type uses a generic column map, a supertype of the inferred one.
  const extraConfig = opts?.extraIndexes as
    | ((self: BuildColumns<string, typeof columns, "mysql">) => MySqlTableExtraConfigValue[])
    | undefined;
  return mysqlTable(name, columns, extraConfig) as unknown as DrizzleKvTable;
}
