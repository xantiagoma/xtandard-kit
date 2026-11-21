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
  text,
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
  /**
   * Collation of the `key` column. `"C"` (default) is bytewise and case-sensitive, with
   * index-usable `LIKE` prefixes. `null` keeps a plain `text` column: products whose existing
   * table was declared that way pass it, so drizzle-kit doesn't generate an `ALTER` for every
   * existing deployment (ADR 0005). The driver stays correct either way, because prefix queries are
   * post-filtered with an exact `startsWith`.
   *
   * Migration SQL to switch an existing table:
   * `ALTER TABLE <name> ALTER COLUMN key TYPE text COLLATE "C";`
   */
  keyCollation?: "C" | null;
  /** Additional columns merged into the table (e.g. a tenant discriminator). */
  extraColumns?: () => Record<string, PgColumnBuilderBase>;
  /** Additional indexes/constraints; receives the built columns. */
  extraIndexes?: (table: PgKvColumns) => PgTableExtraConfigValue[];
}

/**
 * Build a Drizzle `pgTable` for the KV storage: `key text COLLATE "C" PRIMARY KEY` (or plain
 * `text` with `keyCollation: null`),
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
    key: (opts?.keyCollation === null ? text("key") : textC("key")).primaryKey(),
    value: jsonb("value").notNull(),
    ...opts?.extraColumns?.(),
  };
  const table = opts?.schema
    ? pgSchema(opts.schema).table(name, columns, opts.extraIndexes)
    : pgTable(name, columns, opts?.extraIndexes);
  return table as unknown as DrizzleKvTable;
}
