import { afterAll, describe, expect, test, vi } from "vitest";
import {
  createPostgresStorage,
  pgConnection,
  pgReady,
  postgresStorageSchema,
  type SqlClient,
} from "../src/storage/postgres.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";
import { pglite, uniqueTable } from "./drizzle-helpers.ts";

// PGlite boots and runs single-threaded WASM; give loaded machines room.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let table = "";
runStorageConformance(
  "postgres (PGlite)",
  () => createPostgresStorage({ client: pglite(), table: (table = uniqueTable("kv")) }),
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true },
    timeout: 60_000,
    seedLegacy: async (storage, key, raw) => {
      await storage.getKeys(""); // run the DDL
      await pglite().query(`INSERT INTO ${table} (key, value) VALUES ($1, $2::jsonb)`, [key, raw]);
    },
  },
);

const POSTGRES_URL = process.env.POSTGRES_URL;
const liveTables: string[] = [];
const liveStores: Array<{ close(): Promise<void> }> = [];
describe.skipIf(!POSTGRES_URL)("postgres (live)", () => {
  let liveTable = "";
  runStorageConformance(
    "postgres (pg Pool from connectionString)",
    () => {
      liveTable = uniqueTable("kit_kv");
      liveTables.push(liveTable);
      const storage = createPostgresStorage({ connectionString: POSTGRES_URL, table: liveTable });
      liveStores.push(storage);
      return storage;
    },
    {
      t: { describe, test, expect },
      capabilities: { compareAndSwap: true },
      timeout: 30_000,
      seedLegacy: async (storage, key, raw) => {
        await storage.getKeys("");
        const conn = pgConnection(undefined, POSTGRES_URL);
        const c = await conn.get();
        await c.query(`INSERT INTO ${liveTable} (key, value) VALUES ($1, $2::jsonb)`, [key, raw]);
        await conn.close();
      },
    },
  );
  afterAll(async () => {
    const conn = pgConnection(undefined, POSTGRES_URL);
    const c = await conn.get();
    for (const t of liveTables) await c.query(`DROP TABLE IF EXISTS ${t}`);
    await conn.close();
  });
});

describe("postgres driver", () => {
  test('schema: COLLATE "C" keys, jsonb values, validated table name', () => {
    expect(postgresStorageSchema("xtandard_webhooks")).toBe(
      'CREATE TABLE IF NOT EXISTS xtandard_webhooks (key text COLLATE "C" PRIMARY KEY, value jsonb NOT NULL)',
    );
    expect(postgresStorageSchema()).toContain("xtandard_kv");
    expect(() => postgresStorageSchema("x; drop")).toThrow(/Invalid table name/);
    expect(() => createPostgresStorage({ client: pglite(), table: "x y" })).toThrow();
  });

  test('an existing table without COLLATE "C" keeps working (prefix post-filter)', async () => {
    const t = uniqueTable("old");
    await pglite().exec(`CREATE TABLE ${t} (key text PRIMARY KEY, value jsonb NOT NULL)`);
    const storage = createPostgresStorage({ client: pglite(), table: t });
    await storage.setItem("a/B", 1);
    await storage.setItem("a/b", 2);
    expect(await storage.getKeys("a/B")).toEqual(["a/B"]);
  });

  test("a failed DDL is retried on the next call, not cached (O7)", async () => {
    let fail = true;
    const client: SqlClient = {
      async query(text, params) {
        if (fail && text.startsWith("CREATE")) {
          fail = false;
          throw new Error("connection reset");
        }
        return pglite().query(text, params) as never;
      },
    };
    const storage = createPostgresStorage({ client, table: uniqueTable("retry") });
    await expect(storage.getItem("k")).rejects.toThrow("connection reset");
    await storage.setItem("k", { v: 1 });
    expect(await storage.getItem("k")).toEqual({ v: 1 });
    await storage.close(); // borrowed: no-op
  });

  test("pgReady runs product DDL once; pgConnection creates a Pool lazily and closes it", async () => {
    const queries: string[] = [];
    const client: SqlClient = {
      async query(text) {
        queries.push(text);
        return { rows: [] };
      },
    };
    const ready = pgReady(pgConnection(client, undefined), ["CREATE A", "CREATE B"]);
    await Promise.all([ready(), ready()]);
    await ready();
    expect(queries).toEqual(["CREATE A", "CREATE B"]);

    const end = vi.fn(async () => {});
    vi.doMock("pg", () => ({
      Pool: class {
        query = async () => ({ rows: [] });
        end = end;
      },
    }));
    const conn = pgConnection(undefined, "postgres://x");
    const [a, b] = await Promise.all([conn.get(), conn.get()]);
    expect(a).toBe(b);
    await conn.close();
    expect(end).toHaveBeenCalledOnce();
    vi.doUnmock("pg");
  });
});
