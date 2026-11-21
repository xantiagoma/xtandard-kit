/**
 * The SQLite-dialect key/value core shared by the `bun:sqlite` and libSQL drivers, exported from
 * their `…/internals` subpaths (semi-public, ADR 0004).
 *
 * - Values are written as **canonical JSON** text (object keys sorted), so `compareAndSwap` is one
 *   `UPDATE … WHERE key = ? AND value = ?`. A row written before canonicalisation (unsorted keys)
 *   misses that fast path; the swap then reads the row, compares it structurally and swaps on the
 *   exact stored text, with bounded retries (ADR 0005).
 * - `getKeys` uses `GLOB` (case-sensitive and index-usable; SQLite's `LIKE` folds ASCII case) with
 *   the prefix's glob metacharacters escaped, plus an exact `startsWith` filter.
 *
 * @module
 */

import { canonicalJson } from "../internal/json.ts";
import { swapWithFallback } from "./cas.ts";
import type { CompareAndSwapInput, CompareAndSwapKvStorage } from "./contract.ts";
import { assertIdentifier, escapeGlob } from "./util.ts";

/** One row returned by an executor. */
export type SqliteRow = Record<string, unknown>;

/** The tiny async SQL surface the core needs (positional `?` parameters). */
export interface SqliteExecutor {
  /** Run a statement and return its rows (empty for statements without `RETURNING`). */
  all(sql: string, args: unknown[]): Promise<SqliteRow[]>;
}

/** The DDL for a KV table: `key TEXT PRIMARY KEY, value TEXT NOT NULL` (validates `table`). */
export const sqliteKvSchema = (table: string): string =>
  `CREATE TABLE IF NOT EXISTS ${assertIdentifier(table)} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;

/**
 * Build a compare-and-swap capable storage over a SQLite-dialect executor. `exec` resolves the
 * executor before every operation (lazy connect + DDL); the core issues no DDL of its own.
 */
export function sqliteKvStorage(
  table: string,
  exec: () => Promise<SqliteExecutor>,
): CompareAndSwapKvStorage {
  assertIdentifier(table);
  return {
    async getItem<T>(key: string): Promise<T | null> {
      const rows = await (await exec()).all(`SELECT value FROM ${table} WHERE key = ?`, [key]);
      const value = rows[0]?.value;
      return typeof value === "string" ? (JSON.parse(value) as T) : null;
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      await (
        await exec()
      ).all(
        `INSERT INTO ${table} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, canonicalJson(value)],
      );
    },

    async removeItem(key: string): Promise<void> {
      await (await exec()).all(`DELETE FROM ${table} WHERE key = ?`, [key]);
    },

    async getKeys(prefix: string): Promise<string[]> {
      const rows = await (
        await exec()
      ).all(`SELECT key FROM ${table} WHERE key GLOB ?`, [`${escapeGlob(prefix)}*`]);
      return rows.map((r) => String(r.key)).filter((key) => key.startsWith(prefix));
    },

    async compareAndSwap<T>(input: CompareAndSwapInput<T>): Promise<boolean> {
      const db = await exec();
      const next = canonicalJson(input.next);
      const swap = async (current: string): Promise<boolean> =>
        (
          await db.all(`UPDATE ${table} SET value = ? WHERE key = ? AND value = ? RETURNING key`, [
            next,
            input.key,
            current,
          ])
        ).length === 1;
      if (input.expected === null) {
        const rows = await db.all(
          `INSERT INTO ${table} (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING RETURNING key`,
          [input.key, next],
        );
        return rows.length === 1;
      }
      return swapWithFallback<string>(input.expected, {
        fast: () => swap(canonicalJson(input.expected)),
        async read() {
          const raw = (await db.all(`SELECT value FROM ${table} WHERE key = ?`, [input.key]))[0]
            ?.value;
          return typeof raw === "string" ? { raw, value: JSON.parse(raw) as unknown } : null;
        },
        swapRaw: swap,
      });
    },
  };
}
