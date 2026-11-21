import { describe, expect, test, vi } from "vitest";
import * as storageEntry from "../src/entry-storage.ts";
import {
  isCompareAndSwap,
  isTransactional,
  isWatchable,
  type KvStorage,
  type StorageChangeEvent,
} from "../src/storage/contract.ts";
import {
  decodeSegment,
  encodeSegment,
  lastSegment,
  padMillis,
  parseSortableLeaf,
  sortableLeaf,
} from "../src/storage/keys.ts";
import { createMemoryStorage } from "../src/storage/memory.ts";
import {
  assertIdentifier,
  escapeGlob,
  escapeLike,
  escapeRedisGlob,
  escapeRegex,
} from "../src/storage/util.ts";
import { pgListenNotify, withWatch, type PgNotificationClient } from "../src/storage/watch.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";

const plain = (): KvStorage => {
  const m = createMemoryStorage();
  return {
    getItem: m.getItem,
    setItem: m.setItem,
    removeItem: m.removeItem,
    getKeys: m.getKeys,
  };
};

describe("capability guards", () => {
  test("detect watch / compareAndSwap / transaction", () => {
    const base = plain();
    expect(isWatchable(base)).toBe(false);
    expect(isCompareAndSwap(base)).toBe(false);
    expect(isTransactional(base)).toBe(false);
    const memory = createMemoryStorage();
    expect(isWatchable(memory)).toBe(true);
    expect(isCompareAndSwap(memory)).toBe(true);
    expect(isTransactional({ ...base, transaction: async () => 1 } as KvStorage)).toBe(true);
  });
});

describe("withWatch", () => {
  test("adds watch from a change source; filters by prefix; keyless → prefix", async () => {
    let notify: ((key?: string) => void) | undefined;
    const unsubscribe = vi.fn();
    const storage = withWatch(plain(), (n) => {
      notify = n;
      return unsubscribe;
    });
    const events: StorageChangeEvent[] = [];
    const off = await storage.watch("a/", (e) => events.push(e));
    notify!("a/1");
    notify!("b/1");
    notify!();
    notify!("");
    expect(events).toEqual([
      { type: "update", key: "a/1" },
      { type: "update", key: "a/" },
      { type: "update", key: "a/" },
    ]);
    await off();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  test("the wrapper survives a spread (the copies' Object.create wrapper lost its methods)", async () => {
    const base = createMemoryStorage();
    const wrapped = withWatch(base, () => () => {});
    const spread = { ...wrapped };
    await spread.setItem("k", 1);
    expect(await spread.getItem("k")).toBe(1);
    expect(isCompareAndSwap(spread)).toBe(true);
    expect(await spread.compareAndSwap({ key: "k", expected: 1, next: 2 })).toBe(true);
    expect(isWatchable(spread)).toBe(true);
    expect(Object.getPrototypeOf(wrapped)).toBe(base);
  });

  test("class instances: prototype methods keep their `this`, fields stay live", async () => {
    class Store {
      calls = 0;
      private readonly inner = createMemoryStorage();
      async getItem<T>(key: string) {
        this.calls++;
        return this.inner.getItem<T>(key);
      }
      async setItem<T>(key: string, value: T) {
        await this.inner.setItem(key, value);
      }
      async removeItem(key: string) {
        await this.inner.removeItem(key);
      }
      async getKeys(prefix: string) {
        return this.inner.getKeys(prefix);
      }
    }
    const store = new Store();
    const wrapped = withWatch(store, () => () => {});
    await wrapped.setItem("x", 1);
    expect(await { ...wrapped }.getItem("x")).toBe(1);
    expect(store.calls).toBe(1);
    expect(wrapped.calls).toBe(1);
    wrapped.calls = 5;
    expect(store.calls).toBe(5);
    expect(wrapped instanceof Store).toBe(true);
  });

  runStorageConformance(
    "withWatch(memory) via its own notify",
    () => {
      const listeners = new Set<(key?: string) => void>();
      const inner = createMemoryStorage({
        onWrite: (key) => {
          for (const l of listeners) l(key);
        },
      });
      return withWatch({ ...inner, watch: undefined } as unknown as KvStorage, (notify) => {
        listeners.add(notify);
        return () => {
          listeners.delete(notify);
        };
      });
    },
    {
      t: { describe, test, expect },
      capabilities: { compareAndSwap: true, watch: { removals: false } },
    },
  );
});

describe("pgListenNotify", () => {
  test("LISTENs on the quoted channel, filters by channel, UNLISTENs", async () => {
    const queries: string[] = [];
    let listener: ((msg: { channel: string; payload?: string }) => void) | undefined;
    const client: PgNotificationClient = {
      query: async (sql) => {
        queries.push(sql);
      },
      on: (_e, l) => {
        listener = l;
      },
      removeListener: (_e, l) => {
        if (listener === l) listener = undefined;
      },
    };
    const storage = withWatch(plain(), pgListenNotify(client, 'my"chan'));
    const events: StorageChangeEvent[] = [];
    const off = await storage.watch("k/", (e) => events.push(e));
    listener!({ channel: 'my"chan', payload: "k/1" });
    listener!({ channel: "other", payload: "k/2" });
    await off();
    expect(listener).toBeUndefined();
    expect(queries).toEqual(['LISTEN "my""chan"', 'UNLISTEN "my""chan"']);
    expect(events).toEqual([{ type: "update", key: "k/1" }]);
  });

  test("the channel defaults to a neutral name", async () => {
    const queries: string[] = [];
    const sub = pgListenNotify({
      query: async (sql) => void queries.push(sql),
      on: () => {},
      removeListener: () => {},
    });
    await sub(() => {});
    expect(queries).toEqual(['LISTEN "xtandard_kv"']);
  });
});

describe("util escapes", () => {
  test("assertIdentifier", () => {
    expect(assertIdentifier("xtandard_webhooks")).toBe("xtandard_webhooks");
    expect(() => assertIdentifier("a; drop table x")).toThrow(/Invalid table name/);
    expect(() => assertIdentifier("1a", "column")).toThrow(/Invalid column name/);
  });
  test("LIKE uses '!' (F2), GLOB classes, Redis backslashes, regex", () => {
    expect(escapeLike("a%b_c!d\\")).toBe("a!%b!_c!!d\\");
    expect(escapeGlob("a*b?c[d]")).toBe("a[*]b[?]c[[]d]");
    expect(escapeRedisGlob("a*b?c[d]\\")).toBe("a\\*b\\?c\\[d\\]\\\\");
    expect(new RegExp(`^${escapeRegex("a.b*(c)$")}$`).test("a.b*(c)$")).toBe(true);
  });
});

describe("key helpers", () => {
  test("encodeSegment escapes / and ~; lastSegment decodes", () => {
    expect(encodeSegment("a/b~c d")).toBe("a%2Fb%7Ec%20d");
    expect(decodeSegment("a%2Fb%7Ec")).toBe("a/b~c");
    expect(lastSegment(`x/y/${encodeSegment("a/b~")}`)).toBe("a/b~");
    expect(lastSegment("plain")).toBe("plain");
  });
  test("sortable leaves", () => {
    expect(padMillis(5)).toBe("0000000000005");
    expect(padMillis(-3)).toBe("0000000000000");
    expect(padMillis(12.9, 4)).toBe("0012");
    expect(sortableLeaf(1_700_000_000_000, "d_1")).toBe("1700000000000~d_1");
    expect(parseSortableLeaf("whk/app/due/1700000000000~d_1")).toEqual({
      ms: 1_700_000_000_000,
      id: "d_1",
    });
    expect(parseSortableLeaf("0000000000005~a~b")).toEqual({ ms: 5, id: "a~b" });
    for (const bad of ["x/no-sep", "x/~id", "x/abc~id", "x/123~"]) {
      expect(parseSortableLeaf(bad)).toBeNull();
    }
  });
});

test("@xtandard/kit/storage exports the contract, helpers and requirePeer", () => {
  expect(Object.keys(storageEntry).sort()).toEqual(
    [
      "SAFE_IDENTIFIER",
      "assertIdentifier",
      "canonical",
      "canonicalJson",
      "decodeSegment",
      "deepEqual",
      "encodeSegment",
      "escapeGlob",
      "escapeLike",
      "escapeRedisGlob",
      "escapeRegex",
      "importPeer",
      "isCompareAndSwap",
      "isTransactional",
      "isWatchable",
      "lastSegment",
      "padMillis",
      "parseJsonValue",
      "parseSortableLeaf",
      "pgListenNotify",
      "requirePeer",
      "sortableLeaf",
      "withWatch",
    ].sort(),
  );
});
