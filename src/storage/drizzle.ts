/**
 * Drizzle storage driver: a {@link KvStorage} over a **consumer-owned** Drizzle table and database.
 * It issues no DDL (the table lives in your schema and migrations; build it with
 * `@xtandard/kit/drizzle/{pg,mysql,sqlite}`) and owns no connection (it never closes `db`).
 *
 * Postgres, MySQL and SQLite: the dialect is read from `db`, or set with `dialect`.
 *
 * - `getKeys` matches prefixes literally: `LIKE … ESCAPE '!'` on Postgres/MySQL (a backslash
 *   escape is a syntax error on MySQL), `GLOB` on SQLite (whose `LIKE` folds ASCII case), plus an
 *   exact `startsWith` filter.
 * - Values are written canonically and read as raw JSON text, parsed once (so a stored string that
 *   looks like JSON stays a string).
 * - `compareAndSwap` is one conditional `UPDATE` (or a conflict-ignoring `INSERT` for an absent
 *   key): `jsonb` equality on Postgres and `JSON` equality on MySQL (both structural), canonical
 *   text on SQLite with a structural fallback for rows written before canonicalisation.
 *
 * `drizzle-orm` is loaded lazily on first use, so importing this subpath never loads the peer.
 *
 * @module
 */

import type { Column, SQL, Table } from "drizzle-orm";
import type { DrizzleKvTable } from "../drizzle/table.ts";
import { canonical, canonicalJson, deepEqual } from "../internal/json.ts";
import { importPeer } from "../internal/peer.ts";
import { swapWithFallback } from "./cas.ts";
import type { CompareAndSwapInput, CompareAndSwapKvStorage } from "./contract.ts";
import { escapeGlob, escapeLike } from "./util.ts";

export type { DrizzleKvTable } from "../drizzle/table.ts";

const SUBPATH = "@xtandard/kit/storage/drizzle";

/** The SQL dialect of a Drizzle database. */
export type DrizzleDialect = "pg" | "mysql" | "sqlite";

/**
 * Minimal structural view of a Drizzle database (the query-builder entry points the driver uses).
 * The public `db` option is `unknown` because a dialect-agnostic type cannot match every dialect's
 * builders.
 */
export interface DrizzleLikeDatabase {
  /** The dialect object (its class chain names the dialect). */
  dialect?: unknown;
  /** `select(fields).from(table).where(sql)`. */
  select(fields: Record<string, unknown>): {
    from(table: Table): { where(where: SQL): PromiseLike<unknown[]> };
  };
  /** `insert(table)`. */
  insert(table: Table): DrizzleInsert;
  /** `update(table).set(values).where(sql)`. */
  update(table: Table): {
    set(values: Record<string, unknown>): {
      where(where: SQL): PromiseLike<unknown> & {
        returning?(fields: Record<string, Column>): PromiseLike<unknown[]>;
      };
    };
  };
  /** `delete(table).where(sql)`. */
  delete(table: Table): { where(where: SQL): PromiseLike<unknown> };
}

/** The insert builder surface (upsert methods differ by dialect). */
interface DrizzleInsert {
  ignore?(): DrizzleInsert;
  values(row: Record<string, unknown>): PromiseLike<unknown> & {
    onConflictDoUpdate?(config: { target: Column; set: Record<string, unknown> }): DrizzleReturning;
    onConflictDoNothing?(config?: { target?: Column }): DrizzleReturning;
    onDuplicateKeyUpdate?(config: { set: Record<string, unknown> }): PromiseLike<unknown>;
  };
}

type DrizzleReturning = PromiseLike<unknown> & {
  returning(fields: Record<string, Column>): PromiseLike<unknown[]>;
};

/** Drizzle's `entityKind` symbol (`Symbol.for`, so no `drizzle-orm` import is needed). */
const ENTITY_KIND = Symbol.for("drizzle:entityKind");

const DIALECT_KINDS: Record<string, DrizzleDialect> = {
  PgDialect: "pg",
  MySqlDialect: "mysql",
  SQLiteDialect: "sqlite",
};

/**
 * Detect a Drizzle database's dialect from its `dialect` object's class chain (`PgDialect` /
 * `MySqlDialect` / `SQLite{Sync,Async}Dialect`). Semi-public (ADR 0004).
 */
export function detectDrizzleDialect(db: unknown): DrizzleDialect {
  let proto: unknown = (db as DrizzleLikeDatabase | null)?.dialect;
  while (proto) {
    const kind = (proto as { constructor?: Record<symbol, unknown> }).constructor?.[ENTITY_KIND];
    if (typeof kind === "string" && kind in DIALECT_KINDS) return DIALECT_KINDS[kind]!;
    proto = Object.getPrototypeOf(proto);
  }
  throw new Error(
    `${SUBPATH}: cannot detect the Drizzle dialect of \`db\`; pass \`dialect: "pg" | "mysql" | "sqlite"\`.`,
  );
}

/** Rows affected by a MySQL write, across driver result shapes (mysql2, PlanetScale…). Semi-public. */
export function affectedRows(result: unknown): number {
  const header = (Array.isArray(result) ? result[0] : result) as
    | { affectedRows?: number; rowsAffected?: number }
    | undefined;
  return Number(header?.affectedRows ?? header?.rowsAffected ?? 0);
}

type SqlTag = typeof import("drizzle-orm").sql;
let sqlTag: Promise<SqlTag> | undefined;

/** The `sql` template tag of `drizzle-orm`, imported once (lazily). Semi-public. */
export function drizzleSql(): Promise<SqlTag> {
  sqlTag ??= importPeer("drizzle-orm", SUBPATH, () => import("drizzle-orm"))
    .then((m) => m.sql)
    .catch((error: unknown) => {
      sqlTag = undefined;
      throw error;
    });
  return sqlTag;
}

/** Options for {@link createDrizzleStorage}. */
export interface DrizzleStorageOptions {
  /** Your Drizzle database (node-postgres, postgres-js, mysql2, bun:sqlite, libsql, pglite, …). */
  db: unknown;
  /** The KV table, built with a `@xtandard/kit/drizzle/*` factory (or matching its shape). */
  table: DrizzleKvTable;
  /** Override dialect detection (normally read from `db`). */
  dialect?: DrizzleDialect;
}

/**
 * A compare-and-swap capable storage over a Drizzle table. For change notifications, compose it with
 * `withWatch` and a change source such as `pgListenNotify`.
 */
export type DrizzleKvStorage = CompareAndSwapKvStorage;

/**
 * Create a Drizzle-backed {@link DrizzleKvStorage}. No DDL, no connection ownership.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/node-postgres";
 * import { createDrizzleStorage } from "@xtandard/kit/storage/drizzle";
 * import { pgKvTable } from "@xtandard/kit/drizzle/pg";
 *
 * export const kv = pgKvTable("xtandard_kv"); // add to your schema + migrate
 * const storage = createDrizzleStorage({ db: drizzle(pool), table: kv });
 * ```
 */
export function createDrizzleStorage(options: DrizzleStorageOptions): DrizzleKvStorage {
  const db = options.db as DrizzleLikeDatabase;
  const { table } = options;
  const dialect = options.dialect ?? detectDrizzleDialect(db);

  /** The value column as JSON text, so it is parsed exactly once. */
  const rawValue = (sql: SqlTag): SQL =>
    dialect === "pg"
      ? sql`${table.value}::text`
      : dialect === "mysql"
        ? sql`cast(${table.value} as char)`
        : sql`cast(${table.value} as text)`;

  const keyIs = (sql: SqlTag, key: string): SQL => sql`${table.key} = ${key}`;

  async function readRaw(key: string): Promise<string | null> {
    const sql = await drizzleSql();
    const rows = (await db
      .select({ value: rawValue(sql) })
      .from(table)
      .where(keyIs(sql, key))) as Array<{ value: unknown }>;
    const value = rows[0]?.value;
    return typeof value === "string" ? value : null;
  }

  return {
    async getItem<T>(key: string): Promise<T | null> {
      const raw = await readRaw(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      const stored = canonical(value);
      const insert = db.insert(table).values({ key, value: stored });
      if (dialect === "mysql") await insert.onDuplicateKeyUpdate!({ set: { value: stored } });
      else await insert.onConflictDoUpdate!({ target: table.key, set: { value: stored } });
    },

    async removeItem(key: string): Promise<void> {
      const sql = await drizzleSql();
      await db.delete(table).where(keyIs(sql, key));
    },

    async getKeys(prefix: string): Promise<string[]> {
      const sql = await drizzleSql();
      const where =
        dialect === "sqlite"
          ? sql`${table.key} glob ${`${escapeGlob(prefix)}*`}`
          : sql`${table.key} like ${`${escapeLike(prefix)}%`} escape '!'`;
      const rows = (await db.select({ key: table.key }).from(table).where(where)) as Array<{
        key: unknown;
      }>;
      // A hand-made table with a case/accent-folding collation could over-match.
      return rows.map((row) => String(row.key)).filter((key) => key.startsWith(prefix));
    },

    async compareAndSwap<T>(input: CompareAndSwapInput<T>): Promise<boolean> {
      const sql = await drizzleSql();
      const next = canonical(input.next);
      if (input.expected === null) {
        if (dialect === "mysql") {
          const result = await db.insert(table).ignore!().values({ key: input.key, value: next });
          return affectedRows(result) === 1;
        }
        const rows = await db.insert(table).values({ key: input.key, value: next })
          .onConflictDoNothing!({ target: table.key }).returning({ key: table.key });
        return rows.length === 1;
      }

      /** Swap when the stored value equals `expected` (SQL expression). */
      const swapWhere = async (valueMatches: SQL): Promise<boolean> => {
        const update = db
          .update(table)
          .set({ value: next })
          .where(sql`${keyIs(sql, input.key)} and ${valueMatches}`);
        if (dialect !== "mysql") return (await update.returning!({ key: table.key })).length === 1;
        if (affectedRows(await update) === 1) return true;
        // Without CLIENT_FOUND_ROWS, MySQL counts *changed* rows: a swap to an equal value reports 0.
        if (canonicalJson(input.next) !== canonicalJson(input.expected)) return false;
        const raw = await readRaw(input.key);
        return raw !== null && deepEqual(JSON.parse(raw), input.expected);
      };

      if (dialect === "pg") {
        return swapWhere(sql`${table.value} = ${canonicalJson(input.expected)}::jsonb`);
      }
      if (dialect === "mysql") {
        return swapWhere(sql`${table.value} = cast(${canonicalJson(input.expected)} as json)`);
      }
      // SQLite stores text: canonical fast path, then the structural fallback on legacy rows.
      return swapWithFallback<string>(input.expected, {
        fast: () => swapWhere(sql`${table.value} = ${canonicalJson(input.expected)}`),
        async read() {
          const raw = await readRaw(input.key);
          return raw === null ? null : { raw, value: JSON.parse(raw) as unknown };
        },
        swapRaw: (raw) => swapWhere(sql`${table.value} = ${raw}`),
      });
    },
  };
}
