/**
 * Live MySQL suite for the Drizzle storage driver (`drizzle-orm/mysql2`): case/accent-distinct keys
 * (utf8mb4_bin), LIKE metacharacters (`ESCAPE '!'`) and single-statement CAS (O13). Skips unless
 * `MYSQL_URL` is set. Each run works in its own database, dropped afterwards.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, test, vi } from "vitest";
import { mysqlKvTable } from "../src/drizzle/mysql.ts";
import { createDrizzleStorage, KeyCollisionError } from "../src/storage/drizzle.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";
import { createTableSql } from "./drizzle-helpers.ts";

const MYSQL_URL = process.env.MYSQL_URL;
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const dbName = `kit_storage_test_${process.pid}_${Date.now()}`;
let pool: mysql.Pool | undefined;
async function getPool(): Promise<mysql.Pool> {
  if (pool) return pool;
  const admin = await mysql.createConnection({ uri: MYSQL_URL! });
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await admin.end();
  pool = mysql.createPool({ uri: MYSQL_URL!, database: dbName, connectionLimit: 16 });
  return pool;
}

let n = 0;
let current = "";
describe.skipIf(!MYSQL_URL)("drizzle mysql (live)", () => {
  runStorageConformance(
    "drizzle (mysql2, utf8mb4_0900_bin keys)",
    async () => {
      const p = await getPool();
      current = `kv_${n++}`;
      const table = mysqlKvTable(current, { keyCollation: "utf8mb4_0900_bin" });
      await p.query(createTableSql(table, "mysql"));
      return createDrizzleStorage({ db: drizzle(p as never), table });
    },
    {
      t: { describe, test, expect },
      capabilities: { compareAndSwap: true },
      timeout: 30_000,
      seedLegacy: async (_s, key, raw) => {
        await (
          await getPool()
        ).query(`INSERT INTO \`${current}\` (\`key\`, \`value\`) VALUES (?, ?)`, [key, raw]);
      },
    },
  );

  test("a PAD SPACE utf8mb4_bin table refuses trailing-space collisions instead of overwriting", async () => {
    const p = await getPool();
    const name = `kv_pad_${n++}`;
    const table = mysqlKvTable(name); // default collation: utf8mb4_bin (PAD SPACE)
    await p.query(createTableSql(table, "mysql"));
    const storage = createDrizzleStorage({ db: drizzle(p as never), table });
    await storage.setItem("k/a", { v: "a" });
    const error = await storage.setItem("k/a ", { v: "a-space" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeyCollisionError);
    expect((error as KeyCollisionError).storedKey).toBe("k/a");
    expect((error as Error).message).toContain(
      `ALTER TABLE \`${name}\` MODIFY \`key\` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL;`,
    );
    // Nothing crossed over: reads, removes and swaps match byte-exactly.
    expect(await storage.getItem("k/a")).toEqual({ v: "a" });
    expect(await storage.getItem("k/a ")).toBeNull();
    await storage.removeItem("k/a ");
    expect(await storage.getItem("k/a")).toEqual({ v: "a" });
    expect(
      await storage.compareAndSwap({ key: "k/a ", expected: { v: "a" }, next: { v: "x" } }),
    ).toBe(false);
    expect(await storage.compareAndSwap({ key: "k/a ", expected: null, next: { v: "x" } })).toBe(
      false,
    );
    expect(await storage.getItem("k/a")).toEqual({ v: "a" });
    // Same key, same spelling: still an ordinary overwrite.
    await storage.setItem("k/a", { v: "b" });
    expect(await storage.getItem("k/a")).toEqual({ v: "b" });
    // The migration SQL from the error makes both keys storable.
    const message = (error as Error).message;
    await p.query(message.slice(message.indexOf("ALTER TABLE"), message.indexOf("NOT NULL;") + 8));
    await storage.setItem("k/a ", { v: "a-space" });
    expect(await storage.getItem("k/a ")).toEqual({ v: "a-space" });
    expect(await storage.getItem("k/a")).toEqual({ v: "b" });
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await pool.end();
  });
});
