/**
 * `bun:sqlite` drivers (storage and Drizzle over bun:sqlite) under `bun test`, with the conformance
 * suite's test API injected from `bun:test`.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sqliteKvTable } from "../src/drizzle/sqlite.ts";
import { createDrizzleStorage } from "../src/storage/drizzle.ts";
import { createSqliteStorage, sqliteConnection } from "../src/storage/sqlite.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";

let db: Database | undefined;
runStorageConformance(
  "sqlite (bun:sqlite, borrowed database)",
  () => createSqliteStorage({ database: (db = new Database(":memory:")), table: "kv" }),
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true },
    seedLegacy: async (storage, key, raw) => {
      await storage.getKeys(""); // run the DDL
      db!.run("INSERT INTO kv (key, value) VALUES (?, ?)", [key, raw]);
    },
  },
);

runStorageConformance("sqlite (bun:sqlite, owned :memory:)", () => createSqliteStorage(), {
  t: { describe, test, expect },
  capabilities: { compareAndSwap: true },
});

let ddb: Database | undefined;
runStorageConformance(
  "drizzle (bun:sqlite)",
  () => {
    ddb = new Database(":memory:");
    ddb.run("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    return createDrizzleStorage({ db: drizzle(ddb), table: sqliteKvTable("kv") });
  },
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true },
    seedLegacy: async (_s, key, raw) => {
      ddb!.run("INSERT INTO kv (key, value) VALUES (?, ?)", [key, raw]);
    },
  },
);

describe("sqlite driver", () => {
  test("a borrowed database stays open; values are canonical JSON", async () => {
    const database = new Database(":memory:");
    const storage = createSqliteStorage({ database });
    await storage.setItem("k", { b: 1, a: 2 });
    storage.close();
    expect(database.query("SELECT value FROM xtandard_kv").get()).toEqual({
      value: '{"a":2,"b":1}',
    });
  });

  test("an owned database is closed by close()", async () => {
    const conn = sqliteConnection({}, []);
    const opened = await conn.get();
    conn.close();
    expect(() => opened.query("SELECT 1").get()).toThrow();
  });

  test("a failing DDL is retried on the next call", async () => {
    const database = new Database(":memory:");
    const conn = sqliteConnection({ database }, ["CREATE TABLE IF NOT EXISTS t (x)", "BOGUS"]);
    await expect(conn.get()).rejects.toThrow();
    await expect(conn.get()).rejects.toThrow();
  });
});
