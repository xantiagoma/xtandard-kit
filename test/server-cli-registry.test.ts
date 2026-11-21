/**
 * The CLI's REAL default storage registry (no mocks): the persisted names a product passes as
 * role defaults (or `<ROLE>_*` env) must reach the drivers, or a product CLI would silently write
 * to the kit's neutral `xtandard_kv` table and miss the product's existing data.
 * sqlite (bun:sqlite) is covered in `server.bun.test.ts`.
 */
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { storageFromEnv, type StorageRole } from "../src/cli/index.ts";

type Storage = {
  setItem(key: string, value: unknown): Promise<void>;
  getItem(key: string): Promise<unknown>;
  close?(): unknown;
};

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

/** A product role, as webhooks would declare it. */
const role = (dir: string): StorageRole => ({
  name: "STORAGE",
  defaults: {
    prefix: `xtandard:webhooks:test:${Date.now()}`,
    pgTable: `xtandard_webhooks_t${Date.now()}`,
    mongoDb: "xtandard_kit_cli_test",
    mongoCollection: `webhooks_${Date.now()}`,
    sqliteTable: "xtandard_webhooks",
    libsqlUrl: `file:${join(dir, "webhooks.db")}`,
    fileDir: join(dir, "store"),
  },
});

const build = (r: StorageRole, env: Record<string, string>) =>
  storageFromEnv({ role: r, env }) as Promise<Storage>;

describe("default registry, real drivers", () => {
  it("memory", async () => {
    const storage = await build(role(tmp("kit-reg-")), { STORAGE_DRIVER: "memory" });
    await storage.setItem("a", { b: 1 });
    expect(await storage.getItem("a")).toEqual({ b: 1 });
  });

  it("file: writes under the role's fileDir (default and <ROLE>_FILE_DIR)", async () => {
    const dir = tmp("kit-reg-");
    const storage = await build(role(dir), {});
    await storage.setItem("apps:acme", { ok: true });
    expect(await storage.getItem("apps:acme")).toEqual({ ok: true });
    expect(readdirSync(join(dir, "store")).length).toBeGreaterThan(0);
    const other = join(dir, "override");
    const overridden = await build(role(dir), { STORAGE_FILE_DIR: other });
    await overridden.setItem("k", 1);
    expect(existsSync(other)).toBe(true);
  });

  it("libsql file: uses the role's table, not the kit's xtandard_kv", async () => {
    const dir = tmp("kit-reg-");
    const r = role(dir);
    const storage = await build(r, { STORAGE_DRIVER: "libsql" });
    await storage.setItem("apps:acme", { ok: true });
    expect(await storage.getItem("apps:acme")).toEqual({ ok: true });
    await storage.close?.();
    const { createClient } = await import("@libsql/client");
    const tables = async (url: string) => {
      const client = createClient({ url });
      try {
        const rs = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
        return rs.rows.map((row) => String(row.name));
      } finally {
        client.close();
      }
    };
    expect(await tables(r.defaults?.libsqlUrl as string)).toEqual(["xtandard_webhooks"]);

    // <ROLE>_SQLITE_TABLE and <ROLE>_LIBSQL_URL override the defaults.
    const url = `file:${join(dir, "override.db")}`;
    const overridden = await build(r, {
      STORAGE_DRIVER: "libsql",
      STORAGE_LIBSQL_URL: url,
      STORAGE_SQLITE_TABLE: "custom_kv",
    });
    await overridden.setItem("k", 1);
    await overridden.close?.();
    expect(await tables(url)).toEqual(["custom_kv"]);
  });

  it.skipIf(!process.env.POSTGRES_URL)("postgres: uses the role's pgTable", async () => {
    const r = role(tmp("kit-reg-"));
    const table = r.defaults?.pgTable as string;
    const storage = await build(r, {
      STORAGE_DRIVER: "postgres",
      POSTGRES_URL: process.env.POSTGRES_URL as string,
    });
    await storage.setItem("k", { v: 1 });
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: process.env.POSTGRES_URL });
    await client.connect();
    try {
      const rs = await client.query("SELECT to_regclass($1) AS t", [table]);
      expect(rs.rows[0]?.t).toBe(table);
      await client.query(`DROP TABLE IF EXISTS ${table}`);
    } finally {
      await client.end();
      await storage.close?.();
    }
  });

  it.skipIf(!process.env.MONGO_URL)("mongodb: uses the role's db and collection", async () => {
    const r = role(tmp("kit-reg-"));
    const storage = await build(r, {
      STORAGE_DRIVER: "mongodb",
      MONGO_URL: process.env.MONGO_URL as string,
    });
    await storage.setItem("k", { v: 1 });
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(process.env.MONGO_URL as string);
    try {
      const db = client.db(r.defaults?.mongoDb);
      const names = (await db.listCollections().toArray()).map((c) => c.name);
      expect(names).toContain(r.defaults?.mongoCollection);
      await db.collection(r.defaults?.mongoCollection as string).drop();
    } finally {
      await client.close();
      await storage.close?.();
    }
  });

  const redisUrl = process.env.REDIS_JSON_URL ?? process.env.REDIS_URL;
  it.skipIf(!redisUrl)(
    "redis: the role's prefix; `redis` stores strings, `redis-json` RedisJSON",
    async () => {
      const { createClient } = await import("redis");
      const client = createClient({ url: redisUrl });
      await client.connect();
      try {
        const drivers = process.env.REDIS_JSON_URL ? ["redis", "redis-json"] : ["redis"];
        for (const driver of drivers) {
          const r = role(tmp("kit-reg-"));
          const prefix = `${r.defaults?.prefix as string}:${driver}`;
          const storage = await build(r, {
            STORAGE_DRIVER: driver,
            REDIS_URL: redisUrl as string,
            STORAGE_PREFIX: prefix,
          });
          await storage.setItem("k", { v: 1 });
          expect(await storage.getItem("k")).toEqual({ v: 1 });
          const keys = await client.keys(`${prefix}:*`);
          expect(keys).toHaveLength(1);
          const type = await client.type(keys[0] as string);
          expect(type).toBe(driver === "redis" ? "string" : "ReJSON-RL");
          await client.del(keys);
          await storage.close?.();
        }
      } finally {
        await client.quit();
      }
    },
  );
});
