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

describe("bunSqliteExecutor.atomic", () => {
  test("applies every statement or none (BEGIN IMMEDIATE)", async () => {
    const { bunSqliteExecutor } = await import("../src/storage/sqlite.ts");
    const exec = bunSqliteExecutor(new Database(":memory:"));
    await exec.all("CREATE TABLE t (k TEXT PRIMARY KEY, n INTEGER)", []);
    expect(
      await exec.atomic!([
        { sql: "INSERT INTO t VALUES (?, ?)", args: ["a", 1] },
        { sql: "UPDATE t SET n = n + 1 WHERE k = ?", args: ["a"] },
      ]),
    ).toEqual([1, 1]);
    await expect(
      exec.atomic!([
        { sql: "INSERT INTO t VALUES (?, ?)", args: ["b", 1] },
        { sql: "INSERT INTO t VALUES (?, ?)", args: ["a", 1] },
      ]),
    ).rejects.toThrow();
    expect((await exec.all("SELECT k, n FROM t", [])).map((r) => [r.k, r.n])).toEqual([["a", 2]]);
  });
});
