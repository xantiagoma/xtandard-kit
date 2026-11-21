/**
 * Postgres Drizzle table factories: {@link pgKvTable} puts a KV table in your Drizzle schema and
 * migrations, and {@link textC} is the bytewise `text COLLATE "C"` column products reuse for their
 * own key columns. Schema-only (imports `drizzle-orm/pg-core`), so importing this subpath requires
 * `drizzle-orm`.
 *
 * @module
 */

import type { BuildExtraConfigColumns } from "drizzle-orm";
import {
  customType,
  jsonb,
  pgSchema,
  pgTable,
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import type { DrizzleKvTable } from "./table.ts";

export type { DrizzleKvTable } from "./table.ts";

/**
 * A `text COLLATE "C"` column: bytewise ordering and case-sensitive, index-usable `LIKE` prefixes
 * whatever the database's default collation.
 *
 * @example
 * ```ts
 * pgTable("events", { key: textC("key").primaryKey(), … });
 * ```
 */
export const textC = customType<{ data: string; driverData: string }>({
  dataType: () => 'text COLLATE "C"',
});

/** The `self` passed to a {@link PgKvTableOptions.extraIndexes} callback. */
export type PgKvColumns = BuildExtraConfigColumns<
  string,
  Record<string, PgColumnBuilderBase>,
  "pg"
>;

/** Options for {@link pgKvTable}. */
export interface PgKvTableOptions {
  /** Postgres schema (namespace) for the table. Defaults to the search path (`public`). */
  schema?: string;
  /** Additional columns merged into the table (e.g. a tenant discriminator). */
  extraColumns?: () => Record<string, PgColumnBuilderBase>;
  /** Additional indexes/constraints; receives the built columns. */
  extraIndexes?: (table: PgKvColumns) => PgTableExtraConfigValue[];
}

/**
 * Build a Drizzle `pgTable` for the KV storage: `key text COLLATE "C" PRIMARY KEY`,
 * `value jsonb NOT NULL`, extended by `schema`/`extraColumns`/`extraIndexes`. `name` is required
 * (products pass their persisted table name; ADR 0005).
 *
 * @example
 * ```ts
 * import { pgKvTable } from "@xtandard/kit/drizzle/pg";
 * export const kv = pgKvTable("xtandard_kv");
 * ```
 */
export function pgKvTable(name: string, opts?: PgKvTableOptions): DrizzleKvTable {
  const columns = {
    key: textC("key").primaryKey(),
    value: jsonb("value").notNull(),
    ...opts?.extraColumns?.(),
  };
  const table = opts?.schema
    ? pgSchema(opts.schema).table(name, columns, opts.extraIndexes)
    : pgTable(name, columns, opts?.extraIndexes);
  return table as unknown as DrizzleKvTable;
}
