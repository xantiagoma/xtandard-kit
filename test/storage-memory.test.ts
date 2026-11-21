import { describe, expect, test } from "vitest";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";

runStorageConformance("memory", () => createMemoryStorage(), {
  t: { describe, test, expect },
  capabilities: { compareAndSwap: true, watch: { settleMs: 5 } },
});

runStorageConformance("memory (product key root)", () => createMemoryStorage(), {
  t: { describe, test, expect },
  keyRoot: "whk",
});

describe("memory driver", () => {
  test("seeds initial data, cloned on write and read", async () => {
    const seed = { a: { n: 1 } };
    const storage = createMemoryStorage({ initial: { "k/a": seed } });
    seed.a.n = 2;
    const read = await storage.getItem<{ a: { n: number } }>("k/a");
    expect(read).toEqual({ a: { n: 1 } });
    read!.a.n = 3;
    expect(await storage.getItem("k/a")).toEqual({ a: { n: 1 } });
  });

  test("CAS compares own properties: {a: undefined} ≠ {b: undefined} (O14)", async () => {
    const storage = createMemoryStorage();
    await storage.setItem("k", { a: undefined });
    expect(
      await storage.compareAndSwap<unknown>({ key: "k", expected: { b: undefined }, next: 1 }),
    ).toBe(false);
    expect(
      await storage.compareAndSwap<unknown>({ key: "k", expected: { a: undefined }, next: 1 }),
    ).toBe(true);
  });

  test("onWrite sees every write, CAS and remove (ADR 0004 extension point)", async () => {
    const seen: Array<[string, unknown]> = [];
    const storage = createMemoryStorage({
      initial: { seeded: 1 },
      onWrite: (key, value) => {
        seen.push([key, value]);
      },
    });
    await storage.setItem("a", { v: 1 });
    await storage.compareAndSwap({ key: "a", expected: { v: 1 }, next: { v: 2 } });
    await storage.compareAndSwap({ key: "a", expected: { v: 9 }, next: { v: 3 } });
    await storage.removeItem("a");
    await storage.removeItem("missing");
    expect(seen).toEqual([
      ["a", { v: 1 }],
      ["a", { v: 2 }],
      ["a", null],
      ["missing", null],
    ]);
  });

  test("an async onWrite is awaited and its error rejects the write", async () => {
    const storage = createMemoryStorage({
      onWrite: async (key) => {
        if (key === "bad") throw new Error("hook failed");
      },
    });
    await expect(storage.setItem("bad", 1)).rejects.toThrow("hook failed");
    expect(await storage.getItem("bad")).toBe(1);
  });
});
