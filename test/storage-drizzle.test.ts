import { createClient, type Client } from "@libsql/client";
import { getTableName } from "drizzle-orm";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { getTableConfig as mysqlConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgConfig, index, integer, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig as sqliteConfig } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { binVarchar, mysqlKvTable } from "../src/drizzle/mysql.ts";
import { pgKvTable, textC } from "../src/drizzle/pg.ts";
import { sqliteKvTable } from "../src/drizzle/sqlite.ts";
import { isWatchable } from "../src/storage/contract.ts";
import {
  affectedRows,
  createDrizzleStorage,
  detectDrizzleDialect,
  KeyCollisionError,
  prefixSuccessor,
} from "../src/storage/drizzle.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";
import { createTableSql, pglite, uniqueTable } from "./drizzle-helpers.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** A fresh KV table in the shared PGlite, created from the factory's own DDL. */
async function pgTable() {
  const table = pgKvTable(uniqueTable("dkv"));
  await pglite().exec(createTableSql(table, "pg"));
  return table;
}

let pgCurrent = "";
runStorageConformance(
  "drizzle (pg/PGlite)",
  async () => {
    const table = await pgTable();
    pgCurrent = getTableName(table);
    return createDrizzleStorage({ db: drizzle(pglite()), table });
  },
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true },
    timeout: 60_000,
    seedLegacy: async (_s, key, raw) => {
      await pglite().query(`INSERT INTO ${pgCurrent} (key, value) VALUES ($1, $2::jsonb)`, [
        key,
        raw,
      ]);
    },
  },
);

const clients: Client[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});
let libsqlCurrent: Client | undefined;
runStorageConformance(
  "drizzle (sqlite/libsql)",
  async () => {
    const client = createClient({ url: ":memory:" });
    clients.push(client);
    libsqlCurrent = client;
    const table = sqliteKvTable("kv");
    await client.execute(createTableSql(table, "sqlite"));
    return createDrizzleStorage({ db: drizzleLibsql(client), table });
  },
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true },
    // Rows as the copies' drizzle-sqlite wrote them: JSON text in insertion order.
    seedLegacy: async (_s, key, raw) => {
      await libsqlCurrent!.execute({
        sql: "INSERT INTO kv (key, value) VALUES (?, ?)",
        args: [key, raw],
      });
    },
  },
);

describe("createDrizzleStorage", () => {
  test("detects the dialect from the db, or refuses", () => {
    expect(detectDrizzleDialect(drizzle(pglite()))).toBe("pg");
    const c = createClient({ url: ":memory:" });
    clients.push(c);
    expect(detectDrizzleDialect(drizzleLibsql(c))).toBe("sqlite");
    expect(() => detectDrizzleDialect({})).toThrow(/dialect/);
    expect(() => detectDrizzleDialect(null)).toThrow(/dialect/);
  });

  test("an explicit dialect skips detection; no watch capability", async () => {
    const storage = createDrizzleStorage({
      db: drizzle(pglite()),
      table: await pgTable(),
      dialect: "pg",
    });
    await storage.setItem("k", { n: 1 });
    await storage.setItem("k", { n: 2 });
    expect(await storage.getItem("k")).toEqual({ n: 2 });
    expect(isWatchable(storage)).toBe(false);
  });

  test("writes canonical JSON (sqlite text)", async () => {
    const client = createClient({ url: ":memory:" });
    clients.push(client);
    const table = sqliteKvTable("kv");
    await client.execute(createTableSql(table, "sqlite"));
    await createDrizzleStorage({ db: drizzleLibsql(client), table }).setItem("k", { b: 1, a: 2 });
    expect((await client.execute("SELECT value FROM kv")).rows[0]?.value).toBe('{"a":2,"b":1}');
  });

  test("affectedRows reads mysql2 and PlanetScale result shapes", () => {
    expect(affectedRows([{ affectedRows: 1 }, []])).toBe(1);
    expect(affectedRows({ rowsAffected: 2 })).toBe(2);
    expect(affectedRows(undefined)).toBe(0);
  });

  test("MySQL without CLIENT_FOUND_ROWS: a swap to an equal value still reports success", async () => {
    // A fake mysql-dialect db whose UPDATE reports 0 changed rows, and whose read returns the value.
    const db = {
      dialect: undefined,
      select: () => ({ from: () => ({ where: async () => [{ value: '{"a":1}' }] }) }),
      insert: () => ({}),
      update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows: 0 }]) }) }),
      delete: () => ({}),
    };
    const storage = createDrizzleStorage({ db, table: mysqlKvTable("kv"), dialect: "mysql" });
    expect(await storage.compareAndSwap({ key: "k", expected: { a: 1 }, next: { a: 1 } })).toBe(
      true,
    );
    expect(
      await storage.compareAndSwap<unknown>({ key: "k", expected: { a: 1 }, next: { a: 2 } }),
    ).toBe(false);
  });
});

describe("drizzle table factories", () => {
  test('pgKvTable: text COLLATE "C" key, jsonb value, schema, extra columns and indexes', () => {
    const t = pgKvTable("events_kv", {
      schema: "audit",
      extraColumns: () => ({ tenant: text("tenant").notNull(), n: integer("n") }),
      extraIndexes: (self) => [index("events_kv_tenant").on(self.tenant!)],
    });
    const c = pgConfig(t as never);
    expect(c.name).toBe("events_kv");
    expect(c.schema).toBe("audit");
    expect(c.columns.map((col) => [col.name, col.getSQLType()])).toEqual([
      ["key", 'text COLLATE "C"'],
      ["value", "jsonb"],
      ["tenant", "text"],
      ["n", "integer"],
    ]);
    expect(c.indexes.map((i) => i.config.name)).toEqual(["events_kv_tenant"]);
    expect(textC("k").primaryKey()).toBeTruthy();
  });

  test("pgKvTable keyCollation: null keeps a plain text key (schema-stable for existing tables)", () => {
    const plain = pgConfig(pgKvTable("legacy_kv", { keyCollation: null }) as never);
    expect(plain.columns.map((col) => [col.name, col.getSQLType(), col.primary])).toEqual([
      ["key", "text", true],
      ["value", "jsonb", false],
    ]);
    const c = pgConfig(pgKvTable("new_kv", { keyCollation: "C" }) as never);
    expect(c.columns[0]?.getSQLType()).toBe('text COLLATE "C"');
  });

  test("mysqlKvTable: utf8mb4_bin key with keyLength; binVarchar helper (F1)", () => {
    const c = mysqlConfig(mysqlKvTable("kv", { keyLength: 191 }) as never);
    expect(c.columns.map((col) => [col.name, col.getSQLType()])).toEqual([
      ["key", "varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"],
      ["value", "json"],
    ]);
    expect(mysqlConfig(mysqlKvTable("kv") as never).columns[0]?.getSQLType()).toContain(
      "varchar(512)",
    );
    const withId = mysqlConfig(
      mysqlKvTable("kv2", {
        extraColumns: () => ({ id: binVarchar("id", 64).notNull() }),
      }) as never,
    );
    expect(withId.columns[2]?.getSQLType()).toBe(
      "varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin",
    );
    // Opt-in NO PAD collation (default unchanged, ADR 0005).
    const noPad = mysqlConfig(mysqlKvTable("kv3", { keyCollation: "utf8mb4_0900_bin" }) as never);
    expect(noPad.columns[0]?.getSQLType()).toBe(
      "varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin",
    );
    const maria = mysqlConfig(mysqlKvTable("kv4", { keyCollation: "utf8mb4_nopad_bin" }) as never);
    expect(maria.columns[0]?.getSQLType()).toContain("COLLATE utf8mb4_nopad_bin");
  });

  test("sqliteKvTable: text key, JSON text value", () => {
    const c = sqliteConfig(sqliteKvTable("kv", { extraColumns: () => ({}) }) as never);
    expect(c.columns.map((col) => [col.name, col.getSQLType()])).toEqual([
      ["key", "text"],
      ["value", "text"],
    ]);
  });
});

describe("MySQL PAD SPACE guard (fake db)", () => {
  const padDb = (error: unknown) => ({
    dialect: undefined,
    select: () => ({ from: () => ({ where: async () => [{ key: "k/a" }] }) }),
    insert: () => ({
      values: () => ({ onDuplicateKeyUpdate: () => Promise.reject(error) }),
    }),
    update: () => ({}),
    delete: () => ({}),
  });

  test("an invalid-JSON-cast failure (possibly wrapped) becomes a KeyCollisionError", async () => {
    const wrapped = Object.assign(new Error("Failed query"), {
      cause: { errno: 3141, code: "ER_INVALID_JSON_TEXT_IN_PARAM" },
    });
    const storage = createDrizzleStorage({
      db: padDb(wrapped),
      table: mysqlKvTable("kv"),
      dialect: "mysql",
    });
    const error = await storage.setItem("k/a ", 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeyCollisionError);
    expect((error as KeyCollisionError).key).toBe("k/a ");
    expect((error as Error).message).toMatch(
      /PAD SPACE.*ALTER TABLE `kv` MODIFY `key` varchar\(512\)/s,
    );
  });

  test("other write errors pass through unchanged", async () => {
    const boom = new Error("connection lost");
    const storage = createDrizzleStorage({
      db: padDb(boom),
      table: mysqlKvTable("kv"),
      dialect: "mysql",
    });
    await expect(storage.setItem("k", 1)).rejects.toBe(boom);
  });
});

describe("prefixSuccessor (MySQL prefix range)", () => {
  test("increments the last code point, skipping surrogates and dropping U+10FFFF", () => {
    expect(prefixSuccessor("kit/u/")).toBe("kit/u0");
    expect(prefixSuccessor("a🚀")).toBe("a🚁");
    expect(prefixSuccessor("a\u{d7ff}")).toBe("a\u{e000}");
    expect(prefixSuccessor("a\u{10ffff}")).toBe("b");
    expect(prefixSuccessor("\u{10ffff}")).toBeUndefined();
    expect(prefixSuccessor("")).toBeUndefined();
  });
});
