import { createClient } from "redis";
import { afterAll, describe, expect, test, vi } from "vitest";
import {
  createRedisJSONStorage,
  createRedisKvStorage,
  createRedisStorage,
  jsonCodec,
  redisConnection,
  scanKeys,
  stringCodec,
  type RedisKvStorage,
  type RedisLike,
} from "../src/storage/redis.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";
import { asRedisClient as asClient, fakeRedis } from "../src/storage/testing/fake-redis.ts";
import fixture from "./fixtures/stored-data/products.json" with { type: "json" };

vi.setConfig({ testTimeout: 30_000 });

let fake = fakeRedis();
runStorageConformance(
  "redis (fake client)",
  () => createRedisStorage({ client: asClient((fake = fakeRedis())) }),
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true, watch: { settleMs: 5 } },
    seedLegacy: async (_s, key, raw) => {
      fake.strings.set(key, raw);
    },
  },
);
runStorageConformance(
  "redisJSON (fake client, prefixed)",
  () => createRedisJSONStorage({ client: asClient((fake = fakeRedis())), prefix: "p[1]*" }),
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true, watch: { settleMs: 5 } },
    seedLegacy: async (_s, key, raw) => {
      fake.strings.set(`p[1]*:${key}`, raw);
    },
  },
);

describe("redis driver (fake client)", () => {
  test("getKeys de-duplicates SCAN results (O3)", async () => {
    const c = fakeRedis();
    const storage = createRedisStorage({ client: asClient(c) });
    for (let i = 0; i < 5; i++) await storage.setItem(`k/${i}`, i);
    expect((await storage.getKeys("k/")).sort()).toEqual(["k/0", "k/1", "k/2", "k/3", "k/4"]);
    expect(await scanKeys(c, "*")).toHaveLength(5);
  });

  test("watch PSUBSCRIBEs a glob-escaped pattern (O2)", async () => {
    const c = fakeRedis();
    const storage = createRedisStorage({ client: asClient(c), prefix: "app" });
    const off = await storage.watch("a[b]*?\\/", () => {});
    off();
    expect(c.patterns).toEqual(["__keyspace@*__:app:a\\[b\\]\\*\\?\\\\/*"]);
  });

  test("values are canonical JSON strings", async () => {
    const c = fakeRedis();
    await createRedisStorage({ client: asClient(c) }).setItem("k", { b: 1, a: [{ d: 1, c: 2 }] });
    expect(c.strings.get("k")).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });

  test("onWrite runs after set, successful CAS and remove, with the client (ADR 0004)", async () => {
    const c = fakeRedis();
    const seen: Array<[string, unknown, string]> = [];
    const storage = createRedisStorage({
      client: asClient(c),
      prefix: "x",
      onWrite: async (key, value, ctx) => {
        expect(ctx.client).toBe(c);
        expect(ctx.toRedisKey(key)).toBe(ctx.redisKey);
        seen.push([key, value, ctx.redisKey]);
      },
    });
    await storage.setItem("a", { v: 1 });
    await storage.compareAndSwap({ key: "a", expected: { v: 2 }, next: { v: 3 } });
    await storage.compareAndSwap({ key: "a", expected: { v: 1 }, next: { v: 2 } });
    await storage.removeItem("a");
    expect(seen).toEqual([
      ["a", { v: 1 }, "x:a"],
      ["a", { v: 2 }, "x:a"],
      ["a", null, "x:a"],
    ]);
  });

  test("onWrite can keep a sorted-set index with the typed client (the claimDue pattern)", async () => {
    const c = fakeRedis();
    const storage = createRedisStorage({
      client: asClient(c),
      prefix: "x",
      onWrite: async (key, value, { client, toRedisKey }) => {
        const due = /^whk\/app\/due\/(\d+)~/.exec(key);
        if (!due) return;
        if (value === null) await client.zRem(toRedisKey("whk:due"), key);
        else await client.zAdd(toRedisKey("whk:due"), { score: Number(due[1]), value: key });
      },
    });
    await storage.setItem("whk/app/due/0000000000020~d2", { id: "d2" });
    await storage.setItem("whk/app/due/0000000000010~d1", { id: "d1" });
    await storage.setItem("whk/app/endpoints/e1", { id: "e1" });
    expect(await c.zRangeByScore("x:whk:due", 0, 15)).toEqual(["whk/app/due/0000000000010~d1"]);
    await storage.removeItem("whk/app/due/0000000000010~d1");
    expect(await c.zRangeByScore("x:whk:due", "-inf", "+inf")).toEqual([
      "whk/app/due/0000000000020~d2",
    ]);
  });

  test("fakeRedis: a product's own Lua script is answered through the eval hook", async () => {
    const c = fakeRedis({
      eval: (script, keys, _args, fake) =>
        script.includes("ZRANGEBYSCORE")
          ? [...(fake.zsets.get(keys[0]!)?.keys() ?? [])]
          : undefined,
    });
    await c.zAdd("due", { score: 1, value: "d1" });
    expect(
      await c.eval("return redis.call('ZRANGEBYSCORE', KEYS[1], 0, 1)", { keys: ["due"] }),
    ).toEqual(["d1"]);
    // Anything else still reaches the emulated kit scripts.
    const storage = createRedisStorage({ client: asClient(c) });
    await storage.setItem("k", { a: 1 });
    expect(await storage.compareAndSwap({ key: "k", expected: { a: 1 }, next: { a: 2 } })).toBe(
      true,
    );
  });

  test("createRedisKvStorage shares a connection with a product layer", async () => {
    const c = fakeRedis();
    const connection = redisConnection({ client: asClient(c) });
    const storage = createRedisKvStorage({ codec: stringCodec, connection });
    await storage.setItem("k", 1);
    expect(await (await connection.get()).get("k")).toBe("1");
    expect(jsonCodec.kind).toBe("json");
  });

  test("RedisJSON without json commands fails with an actionable error", async () => {
    const c = fakeRedis();
    delete c.json;
    await expect(createRedisJSONStorage({ client: asClient(c) }).getItem("k")).rejects.toThrow(
      /RedisJSON module/,
    );
  });

  test("a url creates, connects and quits an owned client; errors reach onError", async () => {
    const c = fakeRedis();
    const listeners: Array<(e: unknown) => void> = [];
    c.on = (_event, l) => listeners.push(l as never);
    const createClientSpy = vi.fn(() => c);
    vi.doMock("redis", () => ({ createClient: createClientSpy }));
    const onError = vi.fn();
    const storage = createRedisStorage({ url: "redis://x", onError });
    await Promise.all([storage.getItem("k"), storage.getItem("k")]);
    expect(createClientSpy).toHaveBeenCalledOnce();
    listeners[0]!(new Error("down"));
    expect(onError).toHaveBeenCalledOnce();
    await storage.close();
    expect(c.isOpen).toBe(false);
    vi.doUnmock("redis");
  });
});

/**
 * Permanent stored-data fixture (ADR 0005): values as the copies wrote them (`JSON.stringify` in
 * insertion order) under each product's key root, through the string and the RedisJSON codec.
 */
async function expectLegacyValues(
  make: (
    json: boolean,
  ) => Promise<{ storage: RedisKvStorage; seed(key: string, raw: string): Promise<void> }>,
): Promise<void> {
  for (const json of [false, true]) {
    for (const p of Object.values(fixture.products)) {
      const { storage, seed } = await make(json);
      const rows = fixture.rows.map((r) => ({
        key: r.key.replace("{root}", p.keyRoot),
        json: r.json,
      }));
      for (const r of rows) await seed(r.key, r.json);
      for (const r of rows) expect(await storage.getItem(r.key)).toEqual(JSON.parse(r.json));
      expect((await storage.getKeys(`${p.keyRoot}/`)).sort()).toEqual(
        rows.map((r) => r.key).sort(),
      );
      for (const r of rows) {
        expect(
          await storage.compareAndSwap<unknown>({
            key: r.key,
            expected: JSON.parse(r.json),
            next: { n: 1 },
          }),
        ).toBe(true);
      }
    }
  }
}

test("stored-data fixture: legacy string and RedisJSON values of every product (fake client)", async () => {
  await expectLegacyValues(async (json) => {
    const c = fakeRedis();
    const storage = (json ? createRedisJSONStorage : createRedisStorage)({ client: asClient(c) });
    return { storage, seed: async (key, raw) => void c.strings.set(key, raw) };
  });
});

/** Live servers: REDIS_URL (strings) and REDIS_JSON_URL (RedisJSON; redis:8 has it built in). */
const REDIS_URL = process.env.REDIS_URL;
const REDIS_JSON_URL = process.env.REDIS_JSON_URL;
const run = `kit-${process.pid}-${Date.now()}`;
let n = 0;
const live: RedisKvStorage[] = [];

async function enableKeyspaceEvents(url: string): Promise<void> {
  // F10: the test configures notifications itself.
  const admin = createClient({ url });
  await admin.connect();
  await admin.configSet("notify-keyspace-events", "KEA");
  await admin.quit();
}

function liveSuite(name: string, url: string | undefined, json: boolean): void {
  describe.skipIf(!url)(`${name} (live)`, () => {
    let prefix = "";
    let seeder: ReturnType<typeof createClient> | undefined;
    runStorageConformance(
      name,
      async () => {
        if (n === 0) await enableKeyspaceEvents(url!);
        prefix = `${run}:${n++}`;
        const storage = (json ? createRedisJSONStorage : createRedisStorage)({ url, prefix });
        live.push(storage);
        return storage;
      },
      {
        t: { describe, test, expect },
        capabilities: { compareAndSwap: true, watch: { settleMs: 150 } },
        timeout: 30_000,
        seedLegacy: async (_s, key, raw) => {
          seeder ??= createClient({ url });
          if (!seeder.isOpen) await seeder.connect();
          if (json) await seeder.sendCommand(["JSON.SET", `${prefix}:${key}`, "$", raw]);
          else await seeder.set(`${prefix}:${key}`, raw);
        },
      },
    );
    afterAll(async () => {
      if (seeder?.isOpen) await seeder.quit();
    });
  });
}

liveSuite("redis", REDIS_URL, false);
liveSuite("redisJSON", REDIS_JSON_URL, true);

test.skipIf(!REDIS_JSON_URL)(
  "stored-data fixture: legacy values of every product (live)",
  async () => {
    const seeder = createClient({ url: REDIS_JSON_URL });
    await seeder.connect();
    await expectLegacyValues(async (json) => {
      const prefix = `${run}:fx${n++}`;
      const storage = (json ? createRedisJSONStorage : createRedisStorage)({
        url: REDIS_JSON_URL,
        prefix,
      });
      live.push(storage);
      return {
        storage,
        seed: async (key, raw) => {
          if (json) await seeder.sendCommand(["JSON.SET", `${prefix}:${key}`, "$", raw]);
          else await seeder.set(`${prefix}:${key}`, raw);
        },
      };
    });
    await seeder.quit();
  },
);

afterAll(async () => {
  for (const s of live) await s.close();
  const url = REDIS_URL ?? REDIS_JSON_URL;
  if (!url) return;
  const admin = createClient({ url });
  await admin.connect();
  const keys = await scanKeys(admin as unknown as RedisLike, `${run}:*`);
  if (keys.length > 0) await admin.del(keys);
  await admin.quit();
});
