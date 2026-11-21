import { describe, expect, test } from "vitest";
import { createCloudflareKvStorage, type KVNamespaceLike } from "../src/storage/cloudflare-kv.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";

/** An in-memory KVNamespace with byte-exact prefixes, sorted listing and small pages. */
function fakeKv(pageSize = 50): KVNamespaceLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
    async list(opts = {}) {
      const names = [...data.keys()].filter((k) => k.startsWith(opts.prefix ?? "")).sort();
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const page = names.slice(start, start + pageSize);
      const done = start + pageSize >= names.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: done,
        ...(done ? {} : { cursor: String(start + pageSize) }),
      };
    },
  };
}

runStorageConformance(
  "cloudflare-kv (fake binding)",
  () => createCloudflareKvStorage({ namespace: fakeKv() }),
  {
    t: { describe, test, expect },
  },
);
runStorageConformance(
  "cloudflare-kv (fake binding, prefixed)",
  () => createCloudflareKvStorage({ namespace: fakeKv(), prefix: "prod" }),
  { t: { describe, test, expect } },
);

describe("cloudflare-kv driver", () => {
  test("prefix namespaces keys with ':' and is stripped from getKeys", async () => {
    const kv = fakeKv();
    const storage = createCloudflareKvStorage({ namespace: kv, prefix: "prod" });
    await storage.setItem("a/b", { v: 1 });
    await kv.put("other:a/c", "1");
    expect([...kv.data.keys()].sort()).toEqual(["other:a/c", "prod:a/b"]);
    expect(await storage.getKeys("a/")).toEqual(["a/b"]);
  });
});
