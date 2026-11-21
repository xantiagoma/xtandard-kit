/**
 * SQLite storage driver on `bun:sqlite`: **Bun only**, zero npm dependencies. Durable, fast and
 * file-backed (or in-memory) for single-node deployments and local persistence.
 *
 * `bun:sqlite` is loaded lazily on first use, so importing this module works under any runtime
 * (only opening a database needs Bun). Values are canonical JSON, so `compareAndSwap` is one
 * conditional `UPDATE` (atomic across processes sharing the file); see `kv-sqlite.ts`.
 *
 * @module
 */

import type { Database } from "bun:sqlite";
import { importPeer } from "../internal/peer.ts";
import type { CompareAndSwapKvStorage } from "./contract.ts";
import { sqliteKvSchema, sqliteKvStorage, type SqliteExecutor } from "./kv-sqlite.ts";
import { assertIdentifier } from "./util.ts";

const SUBPATH = "@xtandard/kit/storage/sqlite";

/** Options for {@link createSqliteStorage}. */
export interface SqliteStorageOptions {
  /** Database file path. Default `":memory:"`. Ignored when `database` is given. */
  path?: string;
  /** An existing `bun:sqlite` `Database` to use instead of opening one. Never closed. */
  database?: Database;
  /** Table name (default `"xtandard_kv"`; products pass theirs). Validated as a safe identifier. */
  table?: string;
}

/** A compare-and-swap capable storage backed by SQLite, plus `close()`. */
export interface SqliteKvStorage extends CompareAndSwapKvStorage {
  /** Close the database if this driver opened it; no-op for a borrowed one. */
  close(): void;
}

/** A lazily opened `bun:sqlite` database whose DDL runs once (semi-public, ADR 0004). */
export interface SqliteConnection {
  /** Resolve the database, opening it and running the DDL on first use (retried after a failure). */
  get(): Promise<Database>;
  /** Close the database if this connection opened it. */
  close(): void;
}

/**
 * Build a {@link SqliteConnection} that opens `path` (or borrows `database`) and runs `ddl` once.
 * Products add their own tables by passing extra statements.
 */
export function sqliteConnection(
  options: Pick<SqliteStorageOptions, "path" | "database">,
  ddl: string[],
): SqliteConnection {
  let db: Database | undefined = options.database;
  const ownsDb = !options.database;
  let ready: Promise<Database> | undefined;
  return {
    get(): Promise<Database> {
      ready ??= (async () => {
        if (!db) {
          if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") {
            throw new Error(`${SUBPATH} requires the Bun runtime (bun:sqlite)`);
          }
          const { Database: Ctor } = await importPeer(
            "bun:sqlite",
            SUBPATH,
            () => import("bun:sqlite"),
          );
          db = new Ctor(options.path ?? ":memory:");
        }
        for (const statement of ddl) db.run(statement);
        return db;
      })().catch((error: unknown) => {
        ready = undefined;
        throw error;
      });
      return ready;
    },
    close(): void {
      if (ownsDb) db?.close();
    },
  };
}

/** Adapt a `bun:sqlite` database to the positional-args {@link SqliteExecutor}. */
export function bunSqliteExecutor(db: Database): SqliteExecutor {
  return {
    async all(sql, args) {
      return db.query(sql).all(...(args as never[])) as Array<Record<string, unknown>>;
    },
  };
}

/**
 * Create a SQLite-backed storage. Requires the Bun runtime once used.
 *
 * @example
 * ```ts
 * import { createSqliteStorage } from "@xtandard/kit/storage/sqlite";
 *
 * const storage = createSqliteStorage({ path: "./data.sqlite", table: "xtandard_kv" });
 * ```
 */
export function createSqliteStorage(options: SqliteStorageOptions = {}): SqliteKvStorage {
  const table = assertIdentifier(options.table ?? "xtandard_kv");
  const connection = sqliteConnection(options, [sqliteKvSchema(table)]);
  return {
    ...sqliteKvStorage(table, async () => bunSqliteExecutor(await connection.get())),
    close: connection.close,
  };
}
