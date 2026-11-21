/**
 * The table shape the Drizzle storage driver reads and writes, expressed with the stable,
 * dialect-agnostic root `drizzle-orm` types (`Table`/`Column`).
 *
 * The KV factories annotate their return as {@link DrizzleKvTable} on purpose: the raw inferred
 * `PgTableWithColumns<…>` would freeze the version-specific column brand into the emitted `.d.ts`
 * (breaking consumers on a different `drizzle-orm`, e.g. 1.0 beta) and is not nameable across the
 * `schema` / no-`schema` union.
 *
 * @module
 */

import type { Column, Table } from "drizzle-orm";

/** A table with the fixed `key`/`value` columns the Drizzle KV storage requires. */
export type DrizzleKvTable = Table & { key: Column; value: Column };
