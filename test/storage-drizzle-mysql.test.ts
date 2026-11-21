/**
 * Live MySQL suite for the Drizzle storage driver (`drizzle-orm/mysql2`): case/accent-distinct keys
 * (utf8mb4_bin), LIKE metacharacters (`ESCAPE '!'`) and single-statement CAS (O13). Skips unless
 * `MYSQL_URL` is set. Each run works in its own database, dropped afterwards.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, test, vi } from "vitest";
import { mysqlKvTable } from "../src/drizzle/mysql.ts";
import { createDrizzleStorage } from "../src/storage/drizzle.ts";
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
    "drizzle (mysql2)",
    async () => {
      const p = await getPool();
      current = `kv_${n++}`;
      const table = mysqlKvTable(current);
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

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await pool.end();
  });
});
