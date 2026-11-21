import { createStorage, type Storage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { describe, expect, test } from "vitest";
import { createUnstorageStorage } from "../src/storage/unstorage.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";
import fixture from "./fixtures/stored-data/unstorage-keys.json" with { type: "json" };
import strings from "./fixtures/stored-data/unstorage-strings.json" with { type: "json" };

runStorageConformance(
  "unstorage (memory driver)",
  () => createUnstorageStorage({ storage: createStorage({ driver: memoryDriver() }) }),
  { t: { describe, test, expect } },
);

describe("unstorage key encoding", () => {
  const make = () => {
    const raw = createStorage({ driver: memoryDriver() });
    return { raw, storage: createUnstorageStorage({ storage: raw }) };
  };

  test("only a trailing $ is encoded; empty segments are a lone % (O6, ADR 0005)", async () => {
    const { raw, storage } = make();
    await storage.setItem("a/end$", 1);
    await storage.setItem("a/x$y", 2);
    await storage.setItem("a//b", 3);
    await storage.setItem("a/", 4);
    expect((await raw.getKeys()).sort()).toEqual(["a:%", "a:%:b", "a:end%24", "a:x$y"]);
  });

  test("a legacy raw trailing $ written next to the current form is retired on write", async () => {
    const { raw, storage } = make();
    await raw.setItem("t/price$", { old: true });
    await storage.setItem("t/price$", { old: false });
    expect(await raw.getItem("t/price$")).toBeNull();
    expect(await storage.getItem("t/price$")).toEqual({ old: false });
    await storage.removeItem("t/price$");
    expect(await storage.getItem("t/price$")).toBeNull();
  });

  test("stored-data fixture: keys written by every product release read, list and remove", async () => {
    const raw: Storage = createStorage({ driver: memoryDriver() });
    for (const e of fixture.entries) await raw.setItem(e.raw, e.value);
    const storage = createUnstorageStorage({ storage: raw });
    for (const e of fixture.entries) expect(await storage.getItem(e.key)).toEqual(e.value);
    const listed = fixture.entries.filter((e) => e.listed).map((e) => e.key);
    const roots = ["whk/", "flags/", "aud/", "lnk/", "ent/"];
    const all = (await Promise.all(roots.map((r) => storage.getKeys(r)))).flat();
    expect(all.sort()).toEqual([...listed].sort());
    expect(await storage.getKeys("ent/x$/")).toEqual(["ent/x$/y"]);
    expect(await storage.getKeys("lnk/x$/")).toEqual(["lnk/x$/y"]);
    for (const e of fixture.entries) {
      await storage.removeItem(e.key);
      expect(await storage.getItem(e.key)).toBeNull();
    }
    expect(await raw.getKeys()).toEqual([]);
  });

  test("a key stored in both spellings is listed once", async () => {
    const { raw, storage } = make();
    await raw.setItem("ent/s/a%24b", 1); // en spelling
    await storage.setItem("ent/s/a$b", 2); // current spelling, retires the en one
    expect(await storage.getKeys("ent/s/")).toEqual(["ent/s/a$b"]);
    expect(await storage.getItem("ent/s/a$b")).toBe(2);
  });

  test("stored-data fixture: legacy raw strings read back as older releases returned them", async () => {
    const { raw, storage } = make();
    for (const e of strings.entries) await raw.setItem(e.key, e.stored);
    for (const e of strings.entries) expect(await storage.getItem(e.key)).toEqual(e.reads);
  });

  test("new strings are JSON-encoded, and a plain unstorage getItem (an older release) reads the original", async () => {
    const { raw, storage } = make();
    const values = ["hello", "123", "true", '{"a":1}', 'with "quotes" and \\ backslash', ""];
    for (const [i, v] of values.entries()) await storage.setItem(`s/${i}`, v);
    expect(await raw.getItemRaw("s/1")).toBe('"123"');
    for (const [i, v] of values.entries()) {
      expect(await raw.getItem(`s/${i}`)).toBe(v);
      expect(await storage.getItem(`s/${i}`)).toBe(v);
    }
  });
});
