import { MongoClient } from "mongodb";
import { afterAll, describe, expect, test, vi } from "vitest";
import {
  createMongoStorage,
  isDuplicateKey,
  mongoConnection,
  type KvDocument,
  type MongoKvStorage,
} from "../src/storage/mongodb.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";
import fixture from "./fixtures/stored-data/products.json" with { type: "json" };

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const MONGO_URL = process.env.MONGO_URL;
const dbName = `kit_storage_test_${process.pid}_${Date.now()}`;
let client: MongoClient | undefined;
const getClient = async (): Promise<MongoClient> => {
  client ??= new MongoClient(MONGO_URL!);
  await client.connect();
  return client;
};

describe.skipIf(!MONGO_URL)("mongodb (live)", () => {
  let n = 0;
  let collectionName = "";
  runStorageConformance(
    "mongodb (borrowed client)",
    async () =>
      createMongoStorage({
        client: await getClient(),
        dbName,
        collectionName: (collectionName = `kv_${n++}`),
      }),
    {
      t: { describe, test, expect },
      capabilities: { compareAndSwap: true },
      timeout: 30_000,
      // A document as the copies wrote it: fields in insertion order, not sorted.
      seedLegacy: async (_s, key, raw) => {
        const c = (await getClient()).db(dbName).collection<KvDocument>(collectionName);
        await c.insertOne({ _id: key, value: JSON.parse(raw) as unknown });
      },
    },
  );

  const owned: MongoKvStorage[] = [];
  runStorageConformance(
    "mongodb (owned client from url)",
    () => {
      const storage = createMongoStorage({ url: MONGO_URL, dbName, collectionName: `kv_${n++}` });
      owned.push(storage);
      return storage;
    },
    { t: { describe, test, expect }, timeout: 30_000 },
  );

  test("a value with $-prefixed keys swaps as data, not as an expression (O12)", async () => {
    const storage = createMongoStorage({
      client: await getClient(),
      dbName,
      collectionName: `kv_${n++}`,
    });
    const value = { $gt: 1, nested: { $in: [1] } };
    expect(await storage.compareAndSwap({ key: "k", expected: null, next: value })).toBe(true);
    expect(await storage.compareAndSwap<unknown>({ key: "k", expected: { $gt: 0 }, next: 1 })).toBe(
      false,
    );
    expect(await storage.compareAndSwap<unknown>({ key: "k", expected: value, next: 2 })).toBe(
      true,
    );
  });

  test("a case-insensitive collection collation never leaks keys (O10)", async () => {
    const c = await getClient();
    const name = `kv_ci_${n++}`;
    await c.db(dbName).createCollection(name, { collation: { locale: "en", strength: 2 } });
    const storage = createMongoStorage({ client: c, dbName, collectionName: name });
    await storage.setItem("a/B/1", 1);
    await storage.setItem("a/b/2", 2);
    expect(await storage.getKeys("a/B/")).toEqual(["a/B/1"]);
  });

  describe("stored-data fixture: every product's default db/collection with legacy documents", () => {
    test.each(Object.entries(fixture.products))("%s", async (_name, p) => {
      const c = await getClient();
      const db = `${p.mongoDb}_${process.pid}`;
      const coll = c.db(db).collection<KvDocument>(p.mongoCollection);
      const rows = fixture.rows.map((r) => ({
        key: r.key.replace("{root}", p.keyRoot),
        json: r.json,
      }));
      for (const r of rows)
        await coll.insertOne({ _id: r.key, value: JSON.parse(r.json) as unknown });
      const storage = createMongoStorage({
        client: c,
        dbName: db,
        collectionName: p.mongoCollection,
      });
      for (const r of rows) expect(await storage.getItem(r.key)).toEqual(JSON.parse(r.json));
      expect((await storage.getKeys(`${p.keyRoot}/`)).sort()).toEqual(
        rows.map((r) => r.key).sort(),
      );
      for (const r of rows) {
        expect(
          await storage.compareAndSwap<unknown>({
            key: r.key,
            expected: JSON.parse(r.json),
            next: 0,
          }),
        ).toBe(true);
      }
      await c.db(db).dropDatabase();
    });
  });

  afterAll(async () => {
    for (const s of owned) await s.close();
    if (!client) return;
    await client.db(dbName).dropDatabase();
    await client.close();
  });
});

describe("mongodb driver (no server)", () => {
  test("requires a client or url", async () => {
    await expect(createMongoStorage({}).getItem("k")).rejects.toThrow(
      /storage\/mongodb requires either a `client` or a `url`/,
    );
  });

  test("isDuplicateKey", () => {
    expect(isDuplicateKey({ code: 11000 })).toBe(true);
    expect(isDuplicateKey(new Error("x"))).toBe(false);
    expect(isDuplicateKey(null)).toBe(false);
  });

  test("a failed connect is retried; an already-connected client is tolerated", async () => {
    let attempts = 0;
    const fake = {
      async connect() {
        attempts++;
        if (attempts === 1) throw new Error("ECONNREFUSED");
        if (attempts === 2) throw new Error("Client already connected");
      },
      db: () => ({ collection: () => ({}) }),
      async close() {},
    } as unknown as MongoClient;
    const conn = mongoConnection({ client: fake, dbName: "d" });
    await expect(conn.collection("c")).rejects.toThrow("ECONNREFUSED");
    await expect(conn.collection("c")).resolves.toBeTruthy();
    await conn.close(); // borrowed: not closed
  });
});
