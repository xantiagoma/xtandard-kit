import { cp, mkdtemp, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clearFileStorage,
  createFileStorage,
  decodeSegment,
  encodeSegment,
  migrateFileStorage,
} from "../src/storage/file.ts";
import type { StorageChangeEvent } from "../src/storage/contract.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";
import legacyFixture from "./fixtures/stored-data/file-legacy.json" with { type: "json" };

const dirs: string[] = [];
async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kit-file-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await clearFileStorage({ dir });
});

const pathOf = (dir: string, key: string) =>
  join(dir, ...key.split("/").map(encodeSegment)) + ".json";

let currentDir = "";
runStorageConformance(
  "file",
  async () => createFileStorage({ dir: (currentDir = await freshDir()) }),
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true, watch: { settleMs: 150 } },
    // A hand-written, non-canonical file (as the copies wrote values: insertion order).
    seedLegacy: async (_storage, key, raw) => {
      const path = pathOf(currentDir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, raw, "utf8");
    },
  },
);

// flags' default mode (ADR 0005): legacy files are read through and removed on the next write.
// Keys such as `a%25` (the encoded form of `a%`) must not alias another key's file.
let readThroughDir = "";
runStorageConformance(
  "file (legacy: read-through)",
  async () =>
    createFileStorage({ dir: (readThroughDir = await freshDir()), legacy: "read-through" }),
  {
    t: { describe, test, expect },
    capabilities: { compareAndSwap: true, watch: { settleMs: 150 } },
    seedLegacy: async (_storage, key, raw) => {
      const path = pathOf(readThroughDir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, raw, "utf8");
    },
  },
);

test("read-through: writing x/a%25/k never touches x/a%/k's file", async () => {
  const dir = await freshDir();
  const storage = createFileStorage({ dir, legacy: "read-through" });
  await storage.setItem("x/a%/k", { v: "percent" });
  await storage.setItem("x/a%25/k", { v: "literal" });
  expect(await storage.getItem("x/a%/k")).toEqual({ v: "percent" });
  await storage.removeItem("x/a%25/k");
  expect(await storage.getItem("x/a%/k")).toEqual({ v: "percent" });
  expect(await storage.getItem("x/a%25/k")).toBeNull();
  await storage.setItem("x/A", 1);
  await storage.setItem("x/^a", 2);
  expect(await storage.getItem("x/A")).toBe(1);
});

describe("file segment codec", () => {
  test("case, accents, empty and dot segments map to distinct, safe names", () => {
    expect(encodeSegment("Acme")).toBe("^acme");
    expect(encodeSegment("acme")).toBe("acme");
    expect(encodeSegment("acmé")).toBe("acm%C3%A9");
    expect(encodeSegment("a^b")).toBe("a^^b");
    expect(encodeSegment("")).toBe("%");
    expect(encodeSegment("..")).toBe("%2E.");
    expect(encodeSegment(".env")).toBe("%2Eenv");
    for (const s of ["Acme", "acmé", "a^b", "", "..", "x/y?z:", "🚀"]) {
      expect(decodeSegment(encodeSegment(s))).toBe(s);
    }
  });
});

describe("file driver", () => {
  test("writes are atomic: no temporary files are left behind (O5)", async () => {
    const dir = await freshDir();
    const storage = createFileStorage({ dir });
    await Promise.all(Array.from({ length: 20 }, (_, i) => storage.setItem("k/a", { i })));
    expect(await readdir(join(dir, "k"))).toEqual(["a.json"]);
  });

  test("watch reports a write as update, never remove (O1)", async () => {
    const dir = await freshDir();
    const storage = createFileStorage({ dir });
    const events: StorageChangeEvent[] = [];
    const off = await storage.watch("k/", (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 100));
    await storage.setItem("k/a", { v: 1 });
    await storage.setItem("k/a", { v: 2 });
    await new Promise((r) => setTimeout(r, 200));
    off();
    expect(events.length > 0).toBe(true);
    expect(events.filter((e) => e.key === "k/a").every((e) => e.type === "update")).toBe(true);
  });

  test("a value file is pretty JSON at the encoded path", async () => {
    const dir = await freshDir();
    await createFileStorage({ dir }).setItem("App/x", { a: 1 });
    expect(await readFile(join(dir, "^app", "x.json"), "utf8")).toBe('{\n  "a": 1\n}');
  });
});

describe("file driver: legacy (unencoded) stores (ADR 0005, stored-data fixture)", () => {
  const legacy = legacyFixture as Record<string, unknown>;
  const legacyKeys = Object.keys(legacy).sort();
  async function fixtureDir(): Promise<string> {
    const dir = await freshDir();
    await cp(join(import.meta.dirname, "fixtures/stored-data/file-legacy"), dir, {
      recursive: true,
    });
    return dir;
  }

  test("ignore (default): legacy leaves are invisible, already-valid ones are read", async () => {
    const dir = await fixtureDir();
    const storage = createFileStorage({ dir });
    expect(await storage.getKeys("")).toEqual(["whk/app/endpoints/ep_3"]);
    expect(await storage.getItem("whk/Acme/endpoints/ep_1")).toBeNull();
  });

  test("warn: calls onLegacy once (the product's message), default console.warn", async () => {
    const dir = await fixtureDir();
    const onLegacy = vi.fn();
    const storage = createFileStorage({ dir, legacy: "warn", onLegacy });
    await storage.getKeys("");
    await storage.getKeys("");
    expect(onLegacy).toHaveBeenCalledTimes(1);
    expect(onLegacy).toHaveBeenCalledWith(dir);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await createFileStorage({ dir, legacy: "warn" }).getKeys("");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("migrateFileStorage"));
    warn.mockRestore();
  });

  test("read-through: reads and lists legacy leaves; a write or remove retires the legacy file", async () => {
    const dir = await fixtureDir();
    const storage = createFileStorage({ dir, legacy: "read-through" });
    for (const [key, value] of Object.entries(legacy))
      expect(await storage.getItem(key)).toEqual(value);
    expect((await storage.getKeys("")).sort()).toEqual(legacyKeys);
    expect(await storage.getKeys("whk/Acme/")).toEqual(
      expect.arrayContaining(["whk/Acme/endpoints/ep_1", "whk/Acme/applications/Acme"]),
    );
    // Wrong case never reads the legacy file through a case-insensitive filesystem.
    expect(await storage.getItem("whk/acme/endpoints/ep_1")).toBeNull();

    await storage.setItem("whk/Acme/endpoints/ep_1", { id: "ep_1", url: "new" });
    expect(await storage.getItem("whk/Acme/endpoints/ep_1")).toEqual({ id: "ep_1", url: "new" });
    expect((await storage.getKeys("")).sort()).toEqual(legacyKeys); // no duplicate
    await storage.removeItem("flags/default/café/flags/new-ui");
    expect(await storage.getItem("flags/default/café/flags/new-ui")).toBeNull();
    expect(
      await storage.compareAndSwap({
        key: "flags/default/Production/snapshots/v 1",
        expected: { flags: { a: 1, b: 2 }, version: 1 },
        next: { version: 2 },
      }),
    ).toBe(true);
    const fresh = createFileStorage({ dir });
    expect((await fresh.getKeys("")).sort()).toEqual([
      "flags/default/Production/snapshots/v 1",
      "whk/Acme/endpoints/ep_1",
      "whk/app/endpoints/ep_3",
    ]);
  });

  test("migrateFileStorage moves legacy leaves once and removes emptied directories", async () => {
    const dir = await fixtureDir();
    expect(await migrateFileStorage({ dir })).toEqual({ moved: 4 });
    expect(await migrateFileStorage({ dir })).toEqual({ moved: 0 });
    const storage = createFileStorage({ dir });
    expect((await storage.getKeys("")).sort()).toEqual(legacyKeys);
    for (const [key, value] of Object.entries(legacy))
      expect(await storage.getItem(key)).toEqual(value);
    expect((await readdir(join(dir, "whk"))).sort()).toEqual(["^acme", "app"]);
  });
});
