/**
 * libSQL / [Turso](https://turso.tech) storage driver over the `@libsql/client` package (an
 * optional peer). Same SQL dialect as SQLite, against a remote, replicated database, an embedded
 * replica or a local file, so it suits multi-node and edge runtimes where `bun:sqlite` does not.
 *
 * Pass a pre-constructed `client`, or `url` (+ `authToken`) to create one lazily on first use. The
 * table is created on first use; a failed connect or DDL is retried on the next call (not cached).
 * Values are canonical JSON, so `compareAndSwap` is one conditional `UPDATE` evaluated by the
 * server (see `kv-sqlite.ts`).
 *
 * @module
 */

import { importPeer } from "../internal/peer.ts";
import type { CompareAndSwapKvStorage } from "./contract.ts";
import { sqliteKvSchema, sqliteKvStorage, type SqliteExecutor } from "./kv-sqlite.ts";
import { assertIdentifier } from "./util.ts";

const SUBPATH = "@xtandard/kit/storage/libsql";

/** Options for {@link createLibsqlStorage}. */
export interface LibsqlStorageOptions {
  /** libSQL URL (`libsql://…`, `https://…`, `file:…`, `:memory:`). Used when no `client`. */
  url?: string;
  /** Turso auth token for remote databases. */
  authToken?: string;
  /** A pre-constructed `@libsql/client` client to use instead of connecting. Never closed. */
  client?: LibsqlClientLike;
  /** Table name (default `"xtandard_kv"`; products pass theirs). Validated as a safe identifier. */
  table?: string;
}

/** A compare-and-swap capable storage backed by libSQL/Turso, plus `close()`. */
export interface LibsqlKvStorage extends CompareAndSwapKvStorage {
  /** Close the client if this driver created it; no-op for a borrowed one. */
  close(): void;
}

/** Minimal structural view of the `@libsql/client` surface the drivers use. */
export interface LibsqlClientLike {
  /** Run one statement. */
  execute(
    stmt: string | { sql: string; args: unknown[] },
  ): Promise<{ rows: ArrayLike<Record<string, unknown>> }>;
  /** Close the client. */
  close(): void;
}

/** A lazily created libSQL client whose DDL runs once (semi-public, ADR 0004). */
export interface LibsqlConnection {
  /** Resolve the client, creating it and running the DDL on first use (retried after a failure). */
  get(): Promise<LibsqlClientLike>;
  /** Close the client if this connection created it. */
  close(): void;
}

/**
 * Build a {@link LibsqlConnection} that runs `ddl` (in order) once before the first use. A failed
 * connect or DDL is not cached: the next `get()` retries. Products add their own tables by passing
 * extra statements (au's event log).
 */
export function libsqlConnection(
  options: Pick<LibsqlStorageOptions, "url" | "authToken" | "client">,
  ddl: string[],
  subpath = SUBPATH,
): LibsqlConnection {
  const ownsClient = !options.client;
  let client: LibsqlClientLike | undefined = options.client;
  let ready: Promise<LibsqlClientLike> | undefined;
  return {
    get(): Promise<LibsqlClientLike> {
      ready ??= (async () => {
        if (!client) {
          if (!options.url) throw new Error(`${subpath} requires either a \`client\` or a \`url\``);
          const { createClient } = await importPeer(
            "@libsql/client",
            subpath,
            () =>
              import("@libsql/client") as unknown as Promise<{
                createClient: (opts: { url: string; authToken?: string }) => LibsqlClientLike;
              }>,
          );
          client = createClient({ url: options.url, authToken: options.authToken });
        }
        for (const statement of ddl) await client.execute(statement);
        return client;
      })().catch((error: unknown) => {
        ready = undefined; // let a later call retry
        throw error;
      });
      return ready;
    },
    close(): void {
      if (ownsClient) client?.close();
    },
  };
}

/** Adapt a libSQL client to the positional-args {@link SqliteExecutor} of the SQLite core. */
export function libsqlExecutor(client: LibsqlClientLike): SqliteExecutor {
  return {
    async all(sql, args) {
      const { rows } = await client.execute({ sql, args });
      return Array.from(rows);
    },
  };
}

/**
 * Create a libSQL/Turso-backed {@link LibsqlKvStorage}.
 *
 * @example
 * ```ts
 * import { createLibsqlStorage } from "@xtandard/kit/storage/libsql";
 *
 * const storage = createLibsqlStorage({
 *   url: process.env.TURSO_DATABASE_URL!,
 *   authToken: process.env.TURSO_AUTH_TOKEN,
 *   table: "xtandard_kv",
 * });
 * ```
 */
export function createLibsqlStorage(options: LibsqlStorageOptions): LibsqlKvStorage {
  const table = assertIdentifier(options.table ?? "xtandard_kv");
  const connection = libsqlConnection(options, [sqliteKvSchema(table)]);
  return {
    ...sqliteKvStorage(table, async () => libsqlExecutor(await connection.get())),
    close: connection.close,
  };
}
