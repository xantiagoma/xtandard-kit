/**
 * Drizzle storage driver: a {@link KvStorage} over a **consumer-owned** Drizzle table and database.
 * It issues no DDL (the table lives in your schema and migrations; build it with
 * `@xtandard/kit/drizzle/{pg,mysql,sqlite}`) and owns no connection (it never closes `db`).
 *
 * Postgres, MySQL and SQLite: the dialect is read from `db`, or set with `dialect`.
 *
 * - `getKeys` matches prefixes literally: `LIKE … ESCAPE '!'` on Postgres, `GLOB` on SQLite (whose
 *   `LIKE` folds ASCII case), and a bytewise range `key >= p AND key < successor(p)` on MySQL (whose
 *   range optimizer skips emoji for an indexed `LIKE 'p%'` on a `utf8mb4_bin` key), plus an exact
 *   `startsWith` filter everywhere.
 * - Values are written canonically and read as raw JSON text, parsed once (so a stored string that
 *   looks like JSON stays a string).
 * - `compareAndSwap` is one conditional `UPDATE` (or a conflict-ignoring `INSERT` for an absent
 *   key): `jsonb` equality on Postgres and `JSON` equality on MySQL (both structural), canonical
 *   text on SQLite with a structural fallback for rows written before canonicalisation.
 *
 * - MySQL `utf8mb4_bin` keys are PAD SPACE (`"a "` = `"a"`): reads, removes and swaps match keys
 *   byte-exactly, and a write whose key differs from a stored one only by trailing spaces throws
 *   {@link KeyCollisionError} instead of overwriting it. `mysqlKvTable(name, { keyCollation:
 *   "utf8mb4_0900_bin" })` (NO PAD) avoids the collision.
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

/**
 * The smallest string greater than every string that starts with `prefix`, in code-point (=
 * `utf8mb4_bin` byte) order: the last code point incremented (skipping surrogates), dropping
 * trailing U+10FFFF. `undefined` when there is none (empty prefix, or all U+10FFFF).
 */
export function prefixSuccessor(prefix: string): string | undefined {
  const points = [...prefix].map((c) => c.codePointAt(0)!);
  while (points.length > 0) {
    const last = points.pop()!;
    if (last < 0x10ffff) {
      points.push(last === 0xd7ff ? 0xe000 : last + 1);
      return String.fromCodePoint(...points);
    }
  }
  return undefined;
}

/**
 * Thrown by `setItem` on MySQL when the key column's collation is PAD SPACE (`utf8mb4_bin`) and the
 * key differs from a stored key only by trailing spaces (`"a "` vs `"a"`): the write is refused
 * instead of overwriting the other key. The message carries the migration SQL to a NO PAD
 * collation (`utf8mb4_0900_bin`).
 */
export class KeyCollisionError extends Error {
  /** The key that was written. */
  readonly key: string;
  /** The stored key it collides with (when it could be read back). */
  readonly storedKey: string | undefined;

  constructor(key: string, storedKey: string | undefined, table: DrizzleKvTable) {
    const name = String((table as unknown as Record<symbol, unknown>)[Symbol.for("drizzle:Name")]);
    const type = (table.key as { getSQLType?: () => string }).getSQLType?.() ?? "varchar(512)";
    const target = type.replace(/COLLATE\s+\w+/i, "COLLATE utf8mb4_0900_bin");
    const withCollation = /COLLATE/i.test(target)
      ? target
      : `${target} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`;
    super(
      `${SUBPATH}: key ${JSON.stringify(key)} collides with the stored key ${JSON.stringify(storedKey)} ` +
        `in MySQL table \`${name}\`: its key column uses a PAD SPACE collation (utf8mb4_bin), which ` +
        "ignores trailing spaces. Nothing was overwritten. Migrate the column to a NO PAD collation: " +
        `ALTER TABLE \`${name}\` MODIFY \`key\` ${withCollation} NOT NULL; ` +
        "(on MariaDB use utf8mb4_nopad_bin).",
    );
    this.name = "KeyCollisionError";
    this.key = key;
    this.storedKey = storedKey;
  }
}

/** A MySQL "invalid JSON text" error (3141), possibly wrapped by Drizzle in `cause`. */
function isInvalidJsonCast(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    const { errno, code } = e as { errno?: unknown; code?: unknown };
    if (errno === 3141 || code === "ER_INVALID_JSON_TEXT_IN_PARAM") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
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

  /**
   * Exact key match. On MySQL also byte-exact: `utf8mb4_bin` is a PAD SPACE collation, so `key = 'a '`
   * would match the row `'a'`.
   */
  const keyIs = (sql: SqlTag, key: string): SQL =>
    dialect === "mysql"
      ? sql`${table.key} = ${key} and cast(${table.key} as binary) = cast(${key} as binary)`
      : sql`${table.key} = ${key}`;

  /** The stored spelling of the row a PAD SPACE comparison matches for `key`. */
  async function storedSpelling(sql: SqlTag, key: string): Promise<string | undefined> {
    const rows = (await db
      .select({ key: table.key })
      .from(table)
      .where(sql`${table.key} = ${key}`)) as Array<{ key: unknown }>;
    return rows[0] === undefined ? undefined : String(rows[0].key);
  }

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
      if (dialect !== "mysql") {
        await insert.onConflictDoUpdate!({ target: table.key, set: { value: stored } });
        return;
      }
      // On a PAD SPACE key column `'a '` hits the row `'a'`: update only a byte-exact match and make
      // a mismatch fail the statement (an invalid JSON cast) instead of overwriting another key.
      const sql = await drizzleSql();
      try {
        await insert.onDuplicateKeyUpdate!({
          set: {
            value: sql`if(cast(${table.key} as binary) = cast(values(${table.key}) as binary), values(${table.value}), cast(concat('kit-key-collision:', values(${table.key})) as json))`,
          },
        });
      } catch (error) {
        if (!isInvalidJsonCast(error)) throw error;
        throw new KeyCollisionError(key, await storedSpelling(sql, key), table);
      }
    },

    async removeItem(key: string): Promise<void> {
      const sql = await drizzleSql();
      await db.delete(table).where(keyIs(sql, key));
    },

    async getKeys(prefix: string): Promise<string[]> {
      const sql = await drizzleSql();
      const upper = dialect === "mysql" ? prefixSuccessor(prefix) : undefined;
      const where =
        dialect === "sqlite"
          ? sql`${table.key} glob ${`${escapeGlob(prefix)}*`}`
          : dialect === "mysql"
            ? // MySQL's range optimizer skips supplementary characters (emoji) for an indexed
              // `LIKE 'p%'` on a utf8mb4_bin key: match the bytewise range instead.
              upper === undefined
              ? sql`${table.key} >= ${prefix}`
              : sql`${table.key} >= ${prefix} and ${table.key} < ${upper}`
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
