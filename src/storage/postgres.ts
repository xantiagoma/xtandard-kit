/**
 * Postgres storage driver: one key/value table (`key text COLLATE "C" PRIMARY KEY, value jsonb`)
 * over any client exposing `query(text, params?) → { rows }`: [`pg`](https://node-postgres.com)
 * (`Pool`/`Client`) and the in-process [`@electric-sql/pglite`](https://pglite.dev) alike. Pass a
 * `client`, or a `connectionString`/`url` to create a `pg` `Pool` lazily on first use.
 *
 * - The table is created on first use (`CREATE TABLE IF NOT EXISTS`, once); a failed DDL is
 *   retried on the next call, not cached.
 * - The `"C"` collation (new tables only) makes ordering and `LIKE` prefixes bytewise. Existing
 *   tables keep working: prefixes are matched with `LIKE … ESCAPE '!'` plus an exact `startsWith`.
 * - `compareAndSwap` is one statement (`UPDATE … WHERE value = $::jsonb`, or `INSERT … ON CONFLICT
 *   DO NOTHING` for an absent key). `jsonb` equality is structural, so rows written before
 *   canonicalisation swap too.
 *
 * @module
 */

import { canonicalJson } from "../internal/json.ts";
import { importPeer } from "../internal/peer.ts";
import type { CompareAndSwapInput, CompareAndSwapKvStorage } from "./contract.ts";
import { assertIdentifier, escapeLike } from "./util.ts";

const SUBPATH = "@xtandard/kit/storage/postgres";

/** Minimal structural view of a SQL client: `pg` `Pool`/`Client` and `PGlite` satisfy it. */
export interface SqlClient {
  /** Run one parameterized statement (`$1`, `$2`, …). */
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** A client the driver can also shut down (e.g. a `pg` `Pool`). */
export interface ClosableSqlClient extends SqlClient {
  /** End the client. */
  end?(): Promise<unknown>;
}

/** Options for {@link createPostgresStorage}. */
export interface PostgresStorageOptions {
  /**
   * The import path to name in error messages (a missing peer, a missing `client`/`url`…), e.g.
   * `"@xtandard/webhooks/storage/postgres"` when a product re-exports this driver. Default: the kit
   * subpath.
   */
  subpath?: string;
  /** A pre-built client (`pg` `Pool`/`Client`, `PGlite`, …). Never closed by the driver. */
  client?: SqlClient;
  /** Connection string used to create a `pg` `Pool` lazily when no `client` is given. */
  connectionString?: string;
  /** Alias for {@link PostgresStorageOptions.connectionString}. */
  url?: string;
  /** Table name (default `"xtandard_kv"`; products pass theirs). Must be a safe SQL identifier. */
  table?: string;
}

/** A compare-and-swap capable storage backed by Postgres, plus `close()`. */
export interface PostgresKvStorage extends CompareAndSwapKvStorage {
  /** End the pool if this driver created it; no-op for a borrowed client. */
  close(): Promise<void>;
}

/** A lazily created `pg` client (semi-public, ADR 0004). */
export interface PgConnection {
  /** Resolve the client, creating a `pg` `Pool` on first use when needed (retried after a failure). */
  get(): Promise<ClosableSqlClient>;
  /** End the pool if this connection created it. */
  close(): Promise<void>;
}

/** Build a {@link PgConnection} from a borrowed `client` or a `connectionString`. */
export function pgConnection(
  client: SqlClient | undefined,
  connectionString: string | undefined,
  subpath = SUBPATH,
): PgConnection {
  const ownsClient = !client;
  let current: ClosableSqlClient | undefined = client;
  let connecting: Promise<ClosableSqlClient> | undefined;
  return {
    async get(): Promise<ClosableSqlClient> {
      if (current) return current;
      connecting ??= (async () => {
        type PoolCtor = new (config: { connectionString?: string }) => ClosableSqlClient;
        const mod = await importPeer(
          "pg",
          subpath,
          () =>
            import("pg") as unknown as Promise<{ Pool?: PoolCtor; default?: { Pool: PoolCtor } }>,
        );
        const Pool = (mod.Pool ?? mod.default?.Pool) as PoolCtor;
        current = new Pool({ connectionString });
        return current;
      })();
      try {
        return await connecting;
      } finally {
        connecting = undefined;
      }
    },
    async close(): Promise<void> {
      if (ownsClient && current?.end) await current.end();
    },
  };
}

/**
 * Memoize "get the client and run these statements once" (semi-public, ADR 0004). The returned
 * function resolves the client after the DDL has run; a failed DDL is retried on the next call.
 * Products pass extra statements for their own tables (au's event log).
 */
export function pgReady(connection: PgConnection, ddl: string[]): () => Promise<ClosableSqlClient> {
  let ensured: Promise<void> | undefined;
  return async () => {
    const client = await connection.get();
    ensured ??= (async () => {
      for (const statement of ddl) await client.query(statement);
    })();
    try {
      await ensured;
    } catch (error) {
      ensured = undefined; // let a later call retry the DDL
      throw error;
    }
    return client;
  };
}

/**
 * The DDL {@link createPostgresStorage} runs on first use, for migrations when the runtime role may
 * not create tables. Products pass their table name.
 */
export function postgresStorageSchema(table = "xtandard_kv"): string {
  assertIdentifier(table);
  return `CREATE TABLE IF NOT EXISTS ${table} (key text COLLATE "C" PRIMARY KEY, value jsonb NOT NULL)`;
}

/**
 * The KV operations over a table that already exists (semi-public, ADR 0004): `exec` resolves a
 * ready client before every operation. {@link createPostgresStorage} is this plus
 * {@link pgConnection} and {@link pgReady}.
 */
export function postgresKvStorage(
  table: string,
  exec: () => Promise<SqlClient>,
): CompareAndSwapKvStorage {
  assertIdentifier(table);
  return {
    async getItem<T>(key: string): Promise<T | null> {
      // `value::text`, parsed once: a driver that already parsed `jsonb` would otherwise hand back
      // the string "123" for a stored JSON string, and a second parse would turn it into 123.
      const { rows } = await (
        await exec()
      ).query(`SELECT value::text AS value FROM ${table} WHERE key = $1`, [key]);
      const value = rows[0]?.value;
      return typeof value === "string" ? (JSON.parse(value) as T) : null;
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      await (
        await exec()
      ).query(
        `INSERT INTO ${table} (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, canonicalJson(value)],
      );
    },

    async removeItem(key: string): Promise<void> {
      await (await exec()).query(`DELETE FROM ${table} WHERE key = $1`, [key]);
    },

    async getKeys(prefix: string): Promise<string[]> {
      const { rows } = await (
        await exec()
      ).query(`SELECT key FROM ${table} WHERE key LIKE $1 ESCAPE '!'`, [`${escapeLike(prefix)}%`]);
      // Keep only exact (bytewise) prefix matches whatever the column's collation.
      return rows.map((row) => String(row.key)).filter((key) => key.startsWith(prefix));
    },

    async compareAndSwap<T>(input: CompareAndSwapInput<T>): Promise<boolean> {
      const c = await exec();
      const next = canonicalJson(input.next);
      const { rows } =
        input.expected === null
          ? await c.query(
              `INSERT INTO ${table} (key, value) VALUES ($1, $2::jsonb)
               ON CONFLICT (key) DO NOTHING RETURNING key`,
              [input.key, next],
            )
          : await c.query(
              `UPDATE ${table} SET value = $3::jsonb
               WHERE key = $1 AND value = $2::jsonb RETURNING key`,
              [input.key, canonicalJson(input.expected), next],
            );
      return rows.length === 1;
    },
  };
}

/**
 * Create a Postgres-backed {@link PostgresKvStorage}. Connection and table creation are lazy.
 *
 * @example
 * ```ts
 * import { createPostgresStorage } from "@xtandard/kit/storage/postgres";
 *
 * const storage = createPostgresStorage({ connectionString: process.env.DATABASE_URL, table: "xtandard_kv" });
 * // or: createPostgresStorage({ client: new PGlite() })
 * ```
 */
export function createPostgresStorage(options: PostgresStorageOptions = {}): PostgresKvStorage {
  const table = options.table ?? "xtandard_kv";
  const connection = pgConnection(
    options.client,
    options.connectionString ?? options.url,
    options.subpath ?? SUBPATH,
  );
  return {
    ...postgresKvStorage(table, pgReady(connection, [postgresStorageSchema(table)])),
    close: connection.close,
  };
}
