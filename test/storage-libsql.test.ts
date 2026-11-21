import { createClient, type Client } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import {
  createLibsqlStorage,
  libsqlConnection,
  type LibsqlClientLike,
  type LibsqlKvStorage,
} from "../src/storage/libsql.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";

const clients: Client[] = [];
const owned: LibsqlKvStorage[] = [];
let dir: string | undefined;
afterEach(() => {
  for (const s of owned.splice(0)) s.close();
  for (const c of clients.splice(0)) c.close();
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

let current: Client | undefined;
const asLike = (c: Client) => c as unknown as LibsqlClientLike;

runStorageConformance(
  "libsql (:memory:, borrowed client)",
  () => {
    current = createClient({ url: ":memory:" });
    clients.push(current);
    return createLibsqlStorage({ client: asLike(current), table: "kv" });
  },
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true },
    // Rows as the copies wrote them: JSON.stringify in insertion order, not canonical.
    seedLegacy: async (storage, key, raw) => {
      await storage.getKeys(""); // run the DDL
      await current!.execute({
        sql: "INSERT INTO kv (key, value) VALUES (?, ?)",
        args: [key, raw],
      });
    },
  },
);

let fileN = 0;
runStorageConformance(
  "libsql (file:, owned client from url)",
  async () => {
    dir ??= await mkdtemp(join(tmpdir(), "kit-libsql-"));
    const storage = createLibsqlStorage({ url: `file:${join(dir, `db-${fileN++}.sqlite`)}` });
    owned.push(storage);
    return storage;
  },
  { t: { describe, test, expect }, capabilities: { compareAndSwap: true } },
);

describe("libsql driver", () => {
  test("stores canonical JSON; a borrowed client is not closed", async () => {
    const client = createClient({ url: ":memory:" });
    clients.push(client);
    const storage = createLibsqlStorage({ client: asLike(client) });
    await storage.setItem("k", { b: 1, a: { d: 1, c: 2 } });
    const { rows } = await client.execute("SELECT value FROM xtandard_kv");
    expect(rows[0]?.value).toBe('{"a":{"c":2,"d":1},"b":1}');
    storage.close();
    expect((await client.execute("SELECT 1 AS one")).rows[0]?.one).toBe(1);
  });

  test("rejects unsafe table names", () => {
    expect(() => createLibsqlStorage({ url: ":memory:", table: "bad; drop" })).toThrow(
      /Invalid table name/,
    );
  });

  test("requires a client or url", async () => {
    await expect(createLibsqlStorage({}).getItem("k")).rejects.toThrow(
      /storage\/libsql requires either a `client` or a `url`/,
    );
  });

  test("a failed DDL is retried on the next call, not cached (O7b)", async () => {
    const real = createClient({ url: ":memory:" });
    clients.push(real);
    let fail = true;
    const flaky: LibsqlClientLike = {
      async execute(stmt) {
        if (fail) {
          fail = false;
          throw new Error("connection reset");
        }
        return real.execute(stmt as never) as never;
      },
      close: () => {},
    };
    const storage = createLibsqlStorage({ client: flaky });
    await expect(storage.getItem("k")).rejects.toThrow("connection reset");
    await storage.setItem("k", 1);
    expect(await storage.getItem("k")).toBe(1);
  });

  test("libsqlConnection runs extra product DDL once, in order", async () => {
    const client = createClient({ url: ":memory:" });
    clients.push(client);
    const executed: string[] = [];
    const spy: LibsqlClientLike = {
      execute: (stmt) => {
        executed.push(typeof stmt === "string" ? stmt : stmt.sql);
        return client.execute(stmt as never) as never;
      },
      close: () => {},
    };
    const conn = libsqlConnection({ client: spy }, ["CREATE TABLE a (x)", "CREATE TABLE b (y)"]);
    await Promise.all([conn.get(), conn.get()]);
    await conn.get();
    expect(executed).toEqual(["CREATE TABLE a (x)", "CREATE TABLE b (y)"]);
    conn.close();
  });
});
