/**
 * The shared storage conformance suite (ADR 0006). The test API is injected, so the suite runs under
 * vitest, `bun:test` or anything with the same `describe` / `test` / `expect` shape; nothing here
 * imports a test runner.
 *
 * The cases are the union of the products' suites plus the regression cases for every storage fix
 * the kit carries (empty segments, `$` / `#` / unicode keys, many keys, SCAN duplicates, `PSUBSCRIBE`
 * with glob characters, concurrent CAS, `{}` vs `[]`, legacy non-canonical values).
 *
 * @module
 */

import {
  isCompareAndSwap,
  isWatchable,
  type CompareAndSwapKvStorage,
  type KvStorage,
  type StorageChangeEvent,
  type WatchableKvStorage,
} from "../contract.ts";
import { sortableLeaf } from "../keys.ts";

/** The matchers the suite uses. vitest's and `bun:test`'s `expect` both satisfy it. */
export interface ConformanceMatchers {
  /** `Object.is` equality. */
  toBe(expected: unknown): void;
  /** Deep equality. */
  toEqual(expected: unknown): void;
  /** `=== null`. */
  toBeNull(): void;
}

/** The injected test API: pass `{ describe, test, expect }` from your runner. */
export interface ConformanceTestApi {
  /** Group tests. */
  describe(name: string, fn: () => void): void;
  /** Register one test (the third argument is the timeout in ms). */
  test(name: string, fn: () => Promise<void>, timeout?: number): void;
  /** Make an assertion. */
  expect(actual: unknown): ConformanceMatchers;
}

/** A factory producing a fresh, **empty** storage (or an empty namespace of one) for each test. */
export type MakeStorage = () => KvStorage | Promise<KvStorage>;

/**
 * Write a value in a legacy, non-canonical stored form, bypassing the driver (e.g. a raw SQL
 * `INSERT` of `json` text with unsorted keys, a Mongo document with fields in insertion order).
 * Enables the legacy-value CAS case (ADR 0005).
 */
export type SeedLegacy = (storage: KvStorage, key: string, rawJson: string) => Promise<void>;

/** Optional capabilities the driver under test implements. */
export interface ConformanceCapabilities {
  /** Run the compare-and-swap cases (the storage must implement `compareAndSwap`). */
  compareAndSwap?: boolean;
  /**
   * Run the watch cases (the storage must implement `watch`). `settleMs` is how long to wait for
   * notifications to arrive (default 50 ms).
   */
  watch?: boolean | { settleMs: number };
}

/** Options for {@link runStorageConformance}. */
export interface ConformanceOptions {
  /** The injected test API. */
  t: ConformanceTestApi;
  /** Capabilities to exercise. */
  capabilities?: ConformanceCapabilities;
  /** First segment of every key the suite writes (products pass their root, e.g. `"whk"`). Default `"kit"`. */
  keyRoot?: string;
  /** Per-test timeout in ms (live backends may need more than the runner default). */
  timeout?: number;
  /** Enables the legacy-value CAS case; see {@link SeedLegacy}. */
  seedLegacy?: SeedLegacy;
}

/** What a {@link ConformanceCase} receives. */
export interface ConformanceContext {
  /** A fresh storage from the factory. */
  storage: KvStorage;
  /** Build a key under the suite's root: `key("a", "b")` → `"<root>/a/b"`. */
  key(...segments: string[]): string;
  /** The injected `expect`. */
  expect: ConformanceTestApi["expect"];
  /** Wait for `ms` (watch notifications, eventual consistency). */
  settle(ms: number): Promise<void>;
  /** The options the suite runs with. */
  options: ConformanceOptions;
}

/** One named case. Products register extra suites as lists of these. */
export interface ConformanceCase {
  /** Test name. */
  name: string;
  /** The test body. */
  run(ctx: ConformanceContext): Promise<void>;
}

/** Resolve after `ms` milliseconds. */
export const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Narrow to {@link CompareAndSwapKvStorage} or throw a clear error. */
export function requireCompareAndSwap(storage: KvStorage): CompareAndSwapKvStorage {
  if (!isCompareAndSwap(storage)) throw new Error("storage has no compareAndSwap capability");
  return storage;
}

/** Narrow to {@link WatchableKvStorage} or throw a clear error. */
export function requireWatchable(storage: KvStorage): WatchableKvStorage {
  if (!isWatchable(storage)) throw new Error("storage has no watch capability");
  return storage;
}

const sorted = (keys: string[]): string[] => [...keys].sort();

/**
 * Register `describe(title, …)` with one test per case. Each test gets a fresh storage from `make`.
 * This is how products register their own extra suites next to {@link runStorageConformance}.
 */
export function runConformanceCases(
  title: string,
  cases: ConformanceCase[],
  make: MakeStorage,
  options: ConformanceOptions,
): void {
  const { t, keyRoot = "kit", timeout } = options;
  t.describe(title, () => {
    for (const c of cases) {
      t.test(
        c.name,
        async () => {
          const storage = await make();
          try {
            await c.run({
              storage,
              key: (...segments) => [keyRoot, ...segments].join("/"),
              expect: t.expect,
              settle,
              options,
            });
          } finally {
            await (storage as { close?: () => unknown }).close?.();
          }
        },
        timeout,
      );
    }
  });
}

/** The base-contract cases every driver must pass. */
export const contractCases: ConformanceCase[] = [
  {
    name: "returns null for a missing key",
    async run({ storage, key, expect }) {
      expect(await storage.getItem(key("missing"))).toBeNull();
    },
  },
  {
    name: "round-trips objects, arrays, primitives and empty containers",
    async run({ storage, key, expect }) {
      const values: Record<string, unknown> = {
        object: { url: "https://x.example/a?b=1", tags: ["a", "b"], nested: { x: 1, y: null } },
        array: ["a", { b: [1, 2] }],
        string: "hello",
        number: 42.5,
        zero: 0,
        boolTrue: true,
        boolFalse: false,
        emptyObject: {},
        emptyArray: [],
      };
      for (const [k, v] of Object.entries(values)) await storage.setItem(key("v", k), v);
      for (const [k, v] of Object.entries(values))
        expect(await storage.getItem(key("v", k))).toEqual(v);
      expect(Array.isArray(await storage.getItem(key("v", "emptyArray")))).toBe(true);
      expect(Array.isArray(await storage.getItem(key("v", "emptyObject")))).toBe(false);
    },
  },
  {
    name: "strings that look like JSON stay strings",
    async run({ storage, key, expect }) {
      const values = ["123", "true", "null", '{"a":1}', '"quoted"', "[1]", ""];
      for (const [i, v] of values.entries()) await storage.setItem(key("str", String(i)), v);
      for (const [i, v] of values.entries())
        expect(await storage.getItem(key("str", String(i)))).toBe(v);
    },
  },
  {
    name: "overwrites an existing key",
    async run({ storage, key, expect }) {
      await storage.setItem(key("k"), { v: 1 });
      await storage.setItem(key("k"), { v: 2 });
      expect(await storage.getItem(key("k"))).toEqual({ v: 2 });
    },
  },
  {
    name: "removeItem deletes a key; removing a missing key is a no-op",
    async run({ storage, key, expect }) {
      await storage.setItem(key("k"), { v: 1 });
      await storage.removeItem(key("k"));
      expect(await storage.getItem(key("k"))).toBeNull();
      expect(await storage.getKeys(key(""))).toEqual([]);
      expect(await storage.removeItem(key("nope"))).toBe(undefined);
    },
  },
  {
    name: "getKeys lists nested keys under a prefix, isolated from sibling prefixes",
    async run({ storage, key, expect }) {
      await storage.setItem(key("app1", "a"), 1);
      await storage.setItem(key("app1", "deep", "b"), 2);
      await storage.setItem(key("app10", "c"), 3);
      expect(sorted(await storage.getKeys(key("app1", "")))).toEqual(
        sorted([key("app1", "a"), key("app1", "deep", "b")]),
      );
      expect(await storage.getKeys(key("app10", ""))).toEqual([key("app10", "c")]);
      expect(sorted(await storage.getKeys(key("app1")))).toEqual(
        sorted([key("app1", "a"), key("app1", "deep", "b"), key("app10", "c")]),
      );
      expect(await storage.getKeys(key("nothing", ""))).toEqual([]);
    },
  },
  {
    name: "keys are case- and accent-sensitive (no collation folding)",
    async run({ storage, key, expect }) {
      await storage.setItem(key("t", "Acme", "x"), { v: "upper" });
      await storage.setItem(key("t", "acme", "x"), { v: "lower" });
      await storage.setItem(key("t", "acmé", "x"), { v: "accent" });
      expect(await storage.getItem(key("t", "Acme", "x"))).toEqual({ v: "upper" });
      expect(await storage.getItem(key("t", "acme", "x"))).toEqual({ v: "lower" });
      expect(await storage.getItem(key("t", "acmé", "x"))).toEqual({ v: "accent" });
      expect(await storage.getItem(key("t", "ACME", "x"))).toBeNull();
      expect(await storage.getKeys(key("t", "Acme", ""))).toEqual([key("t", "Acme", "x")]);
      expect(await storage.getKeys(key("t", "acme", ""))).toEqual([key("t", "acme", "x")]);
      expect(await storage.getKeys(key("t", "A"))).toEqual([key("t", "Acme", "x")]);
      await storage.removeItem(key("t", "ACME", "x"));
      expect(await storage.getItem(key("t", "Acme", "x"))).toEqual({ v: "upper" });
    },
  },
  {
    name: "case-distinct tenants are isolated",
    async run({ storage, key, expect }) {
      for (const tenant of ["Acme", "acme", "ACME"]) {
        await storage.setItem(key("tenant", tenant, "item"), { tenant });
        await storage.setItem(key("tenants", tenant), tenant);
      }
      for (const tenant of ["Acme", "acme", "ACME"]) {
        expect(await storage.getItem(key("tenant", tenant, "item"))).toEqual({ tenant });
        expect(await storage.getKeys(key("tenant", tenant, ""))).toEqual([
          key("tenant", tenant, "item"),
        ]);
      }
      expect(sorted(await storage.getKeys(key("tenants", "")))).toEqual(
        sorted(["Acme", "acme", "ACME"].map((t) => key("tenants", t))),
      );
    },
  },
  {
    name: "LIKE / GLOB / Redis-glob / unstorage metacharacters in keys and prefixes are literal",
    async run({ storage, key, expect }) {
      const specials = ["%", "_", "!", "\\", "*", "?", "[", "]", ":", "%25", "#", "$", "[x]"];
      const keys = specials.map((c) => key(`x${c}y`, "a"));
      keys.push(key("xzy", "a"), key("xay", "a"), key("x", "y", "a"), key("xy", "a"));
      for (const k of keys) await storage.setItem(k, { k });
      for (const k of keys) expect(await storage.getItem(k)).toEqual({ k });
      for (const c of specials) {
        expect(sorted(await storage.getKeys(key(`x${c}y`, "")))).toEqual(
          keys.filter((k) => k.startsWith(key(`x${c}y`, ""))),
        );
        // A plain prefix ending mid-segment, right after the metacharacter.
        expect(sorted(await storage.getKeys(key(`x${c}`)))).toEqual(
          sorted(keys.filter((k) => k.startsWith(key(`x${c}`)))),
        );
      }
      expect(sorted(await storage.getKeys(key("x")))).toEqual(sorted(keys));
    },
  },
  {
    name: "keys with ? \\ ] : # % %25 stay distinct (no normalization)",
    async run({ storage, key, expect }) {
      const keys = ["a?b", "ab", "a\\b", "a:b", "a]b", "a#b", "a%b", "a%25b", "a/b"].map((s) =>
        key("s", s),
      );
      for (const [i, k] of keys.entries()) await storage.setItem(k, { i });
      for (const [i, k] of keys.entries()) expect(await storage.getItem(k)).toEqual({ i });
      expect(sorted(await storage.getKeys(key("s", "")))).toEqual(sorted(keys));
      expect(await storage.getKeys(key("s", "a?"))).toEqual([key("s", "a?b")]);
      expect(await storage.getKeys(key("s", "a%25"))).toEqual([key("s", "a%25b")]);
      expect(await storage.getItem(key("s", "a%b"))).toEqual({ i: 6 });
    },
  },
  {
    name: "keys with $ (trailing, inner, alone) round-trip and are listed",
    async run({ storage, key, expect }) {
      const keys = [
        key("d", "end$"),
        key("d", "a$b"),
        key("d", "$"),
        key("d$", "x"),
        key("d", "$$"),
      ];
      for (const [i, k] of keys.entries()) await storage.setItem(k, i);
      for (const [i, k] of keys.entries()) expect(await storage.getItem(k)).toBe(i);
      expect(sorted(await storage.getKeys(key("d")))).toEqual(sorted(keys));
      expect(await storage.getKeys(key("d$", ""))).toEqual([key("d$", "x")]);
      await storage.removeItem(key("d", "end$"));
      expect(await storage.getItem(key("d", "end$"))).toBeNull();
    },
  },
  {
    name: "keys differing only by trailing spaces stay distinct",
    async run({ storage, key, expect }) {
      const keys = [key("sp", "a"), key("sp", "a "), key("sp", "a  "), key("sp", "a", " ")];
      for (const [i, k] of keys.entries()) await storage.setItem(k, { i });
      for (const [i, k] of keys.entries()) expect(await storage.getItem(k)).toEqual({ i });
      expect(sorted(await storage.getKeys(key("sp", "")))).toEqual(sorted(keys));
      expect(sorted(await storage.getKeys(key("sp", "a ")))).toEqual(
        sorted([key("sp", "a "), key("sp", "a  ")]),
      );
      await storage.removeItem(key("sp", "a "));
      expect(await storage.getItem(key("sp", "a"))).toEqual({ i: 0 });
      expect(await storage.getItem(key("sp", "a "))).toBeNull();
    },
  },
  {
    name: "unicode keys (emoji, CJK, NFC ≠ NFD) round-trip and stay distinct",
    async run({ storage, key, expect }) {
      const nfc = "café";
      const nfd = "café";
      const keys = [
        key("u", "🚀"),
        key("u", "日本語"),
        key("u", nfc),
        key("u", nfd),
        key("u", "cafe"),
      ];
      for (const [i, k] of keys.entries()) await storage.setItem(k, { i });
      for (const [i, k] of keys.entries()) expect(await storage.getItem(k)).toEqual({ i });
      expect(sorted(await storage.getKeys(key("u", "")))).toEqual(sorted(keys));
      expect(await storage.getKeys(key("u", "日"))).toEqual([key("u", "日本語")]);
    },
  },
  {
    name: "empty key segments are distinct keys (a//b ≠ a/b, trailing /)",
    async run({ storage, key, expect }) {
      const keys = [
        key("e", "", "b"),
        key("e", "b"),
        key("e", ""),
        key("e", "x", ""),
        key("e", "x"),
      ];
      for (const [i, k] of keys.entries()) await storage.setItem(k, { i });
      for (const [i, k] of keys.entries()) expect(await storage.getItem(k)).toEqual({ i });
      expect(sorted(await storage.getKeys(key("e", "")))).toEqual(sorted(keys));
      expect(await storage.getKeys(key("e", "", ""))).toEqual([key("e", "", "b")]);
      expect(sorted(await storage.getKeys(key("e", "x")))).toEqual(
        sorted([key("e", "x", ""), key("e", "x")]),
      );
      await storage.removeItem(key("e", "", "b"));
      expect(await storage.getItem(key("e", "b"))).toEqual({ i: 1 });
    },
  },
  {
    name: "zero-padded sortable leaves list in chronological order once sorted",
    async run({ storage, key, expect }) {
      const times = [1_700_000_000_123, 5, 1_700_000_000_122, 99_999, 1_600_000_000_000];
      for (const [i, ms] of times.entries())
        await storage.setItem(key("due", sortableLeaf(ms, `id${i}`)), i);
      const listed = sorted(await storage.getKeys(key("due", "")));
      expect(listed).toEqual(
        [...times.entries()]
          .sort(([, a], [, b]) => a - b)
          .map(([i, ms]) => key("due", sortableLeaf(ms, `id${i}`))),
      );
    },
  },
  {
    name: "lists many keys (pagination) without duplicates",
    async run({ storage, key, expect }) {
      const keys = Array.from({ length: 250 }, (_, i) => key("bulk", String(i).padStart(3, "0")));
      await Promise.all(keys.map((k, i) => storage.setItem(k, { i })));
      const listed = await storage.getKeys(key("bulk", ""));
      expect(listed.length).toBe(250);
      expect(new Set(listed).size).toBe(250);
      expect(sorted(listed)).toEqual(keys);
    },
  },
];

/** The compare-and-swap cases (`capabilities.compareAndSwap`). */
export const compareAndSwapCases: ConformanceCase[] = [
  {
    name: "swaps only when the expectation holds (absence, mismatch, match)",
    async run({ storage, key, expect }) {
      const cas = requireCompareAndSwap(storage);
      const k = key("cas");
      expect(
        await cas.compareAndSwap<unknown>({ key: k, expected: { v: 1 }, next: { v: 2 } }),
      ).toBe(false);
      expect(await cas.getItem(k)).toBeNull();
      expect(
        await cas.compareAndSwap<unknown>({ key: k, expected: null, next: { v: 1, tags: ["a"] } }),
      ).toBe(true);
      expect(await cas.compareAndSwap<unknown>({ key: k, expected: null, next: { v: 9 } })).toBe(
        false,
      );
      expect(
        await cas.compareAndSwap<unknown>({ key: k, expected: { v: 0 }, next: { v: 2 } }),
      ).toBe(false);
      expect(
        await cas.compareAndSwap<unknown>({ key: k, expected: { v: 1 }, next: { v: 2 } }),
      ).toBe(false);
      expect(
        await cas.compareAndSwap<unknown>({
          key: k,
          expected: { v: 1, tags: ["a"] },
          next: { v: 2 },
        }),
      ).toBe(true);
      expect(await cas.getItem(k)).toEqual({ v: 2 });
    },
  },
  {
    name: "compares structurally: object key order is ignored, arrays are ordered",
    async run({ storage, key, expect }) {
      const cas = requireCompareAndSwap(storage);
      const k = key("order");
      await cas.setItem(k, { b: 1, a: { d: [1, 2], c: null } });
      expect(
        await cas.compareAndSwap<unknown>({
          key: k,
          expected: { a: { c: null, d: [2, 1] }, b: 1 },
          next: 0,
        }),
      ).toBe(false);
      expect(
        await cas.compareAndSwap<unknown>({
          key: k,
          expected: { a: { c: null, d: [1, 2] }, b: 1 },
          next: { n: 1 },
        }),
      ).toBe(true);
      expect(await cas.getItem(k)).toEqual({ n: 1 });
    },
  },
  {
    name: "{} and [] are different values",
    async run({ storage, key, expect }) {
      const cas = requireCompareAndSwap(storage);
      await cas.setItem(key("obj"), {});
      await cas.setItem(key("arr"), []);
      expect(await cas.compareAndSwap<unknown>({ key: key("obj"), expected: [], next: 1 })).toBe(
        false,
      );
      expect(await cas.compareAndSwap<unknown>({ key: key("arr"), expected: {}, next: 1 })).toBe(
        false,
      );
      expect(await cas.compareAndSwap<unknown>({ key: key("obj"), expected: {}, next: 2 })).toBe(
        true,
      );
      expect(await cas.compareAndSwap<unknown>({ key: key("arr"), expected: [], next: 3 })).toBe(
        true,
      );
      expect(await cas.getItem(key("obj"))).toBe(2);
      expect(await cas.getItem(key("arr"))).toBe(3);
    },
  },
  {
    name: "swaps primitives",
    async run({ storage, key, expect }) {
      const cas = requireCompareAndSwap(storage);
      await cas.setItem(key("p"), "a");
      expect(await cas.compareAndSwap<unknown>({ key: key("p"), expected: "b", next: "c" })).toBe(
        false,
      );
      expect(await cas.compareAndSwap<unknown>({ key: key("p"), expected: "a", next: 7 })).toBe(
        true,
      );
      expect(await cas.compareAndSwap<unknown>({ key: key("p"), expected: 7, next: false })).toBe(
        true,
      );
      expect(await cas.getItem(key("p"))).toBe(false);
    },
  },
  {
    name: "concurrent claims of an absent key: exactly one wins",
    async run({ storage, key, expect }) {
      const cas = requireCompareAndSwap(storage);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          cas.compareAndSwap<unknown>({ key: key("claim"), expected: null, next: { by: i } }),
        ),
      );
      expect(results.filter(Boolean).length).toBe(1);
      const winner = results.indexOf(true);
      expect(await cas.getItem(key("claim"))).toEqual({ by: winner });
    },
  },
  {
    name: "concurrent swaps from the same expectation: exactly one wins",
    async run({ storage, key, expect }) {
      const cas = requireCompareAndSwap(storage);
      await cas.setItem(key("race"), { n: 0, meta: { b: 1, a: 2 } });
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          cas.compareAndSwap<unknown>({
            key: key("race"),
            expected: { meta: { a: 2, b: 1 }, n: 0 },
            next: { n: i + 1 },
          }),
        ),
      );
      expect(results.filter(Boolean).length).toBe(1);
    },
  },
  {
    name: "legacy non-canonical stored values: read, listed and swapped (ADR 0005)",
    async run({ storage, key, expect, options }) {
      const seed = options.seedLegacy;
      if (!seed) return;
      const cas = requireCompareAndSwap(storage);
      const k = key("legacy", "v");
      const value = { b: 1, a: { d: [1, { z: 1, y: 2 }], c: "x" } };
      await seed(storage, k, '{"b":1,"a":{"d":[1,{"z":1,"y":2}],"c":"x"}}');
      expect(await cas.getItem(k)).toEqual(value);
      expect(await cas.getKeys(key("legacy", ""))).toEqual([k]);
      expect(await cas.compareAndSwap<unknown>({ key: k, expected: { b: 2 }, next: 0 })).toBe(
        false,
      );
      expect(await cas.compareAndSwap<unknown>({ key: k, expected: null, next: 0 })).toBe(false);
      expect(await cas.compareAndSwap<unknown>({ key: k, expected: value, next: { n: 1 } })).toBe(
        true,
      );
      expect(await cas.getItem(k)).toEqual({ n: 1 });
      // Concurrent swaps over a legacy value: still exactly one winner.
      const k2 = key("legacy", "race");
      await seed(storage, k2, '{"b":1,"a":2}');
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          cas.compareAndSwap<unknown>({ key: k2, expected: { a: 2, b: 1 }, next: { i } }),
        ),
      );
      expect(results.filter(Boolean).length).toBe(1);
    },
  },
];

/** The watch cases (`capabilities.watch`). */
export const watchCases: ConformanceCase[] = [
  {
    name: "notifies updates and removals under the prefix only",
    async run({ storage, key, expect, settle, options }) {
      const ms = settleMs(options);
      const watchable = requireWatchable(storage);
      const events: StorageChangeEvent[] = [];
      const off = await watchable.watch(key("w", ""), (e) => events.push(e));
      await settle(ms);
      await watchable.setItem(key("w", "a"), { v: 1 });
      await watchable.setItem(key("other", "b"), { v: 1 });
      // Filesystem watchers coalesce a create immediately followed by a delete.
      await settle(ms);
      await watchable.removeItem(key("w", "a"));
      await settle(ms);
      await off();
      expect(events.some((e) => e.type === "update" && e.key === key("w", "a"))).toBe(true);
      expect(events.some((e) => e.type === "remove" && e.key === key("w", "a"))).toBe(true);
      expect(events.every((e) => e.key.startsWith(key("w", "")))).toBe(true);
    },
  },
  {
    name: "a prefix with glob characters ([ ] * ? \\) matches literally",
    async run({ storage, key, expect, settle, options }) {
      const ms = settleMs(options);
      const watchable = requireWatchable(storage);
      const prefix = key("g[x]*?\\", "");
      const events: StorageChangeEvent[] = [];
      const off = await watchable.watch(prefix, (e) => events.push(e));
      await settle(ms);
      await watchable.setItem(`${prefix}a`, 1);
      await watchable.setItem(key("gx", "b"), 1);
      await settle(ms);
      await off();
      expect(events.some((e) => e.type === "update" && e.key === `${prefix}a`)).toBe(true);
      expect(events.every((e) => e.key.startsWith(prefix))).toBe(true);
    },
  },
  {
    name: "unsubscribe stops notifications",
    async run({ storage, key, expect, settle, options }) {
      const ms = settleMs(options);
      const watchable = requireWatchable(storage);
      const events: StorageChangeEvent[] = [];
      const off = await watchable.watch(key("off", ""), (e) => events.push(e));
      await settle(ms);
      await off();
      await settle(ms);
      await watchable.setItem(key("off", "a"), 1);
      await settle(ms);
      expect(events.length).toBe(0);
    },
  },
];

const settleMs = (options: ConformanceOptions): number => {
  const watch = options.capabilities?.watch;
  return typeof watch === "object" ? watch.settleMs : 50;
};

/**
 * Register the full conformance suite for one driver: the base contract, plus the
 * compare-and-swap and watch cases when `capabilities` says the driver has them.
 *
 * @example
 * ```ts
 * import { describe, expect, test } from "vitest"; // or "bun:test"
 * import { runStorageConformance } from "@xtandard/kit/storage/testing";
 * import { createMemoryStorage } from "@xtandard/kit/storage/memory";
 *
 * runStorageConformance("memory", () => createMemoryStorage(), {
 *   t: { describe, test, expect },
 *   capabilities: { compareAndSwap: true, watch: true },
 *   keyRoot: "whk",
 * });
 * ```
 */
export function runStorageConformance(
  name: string,
  make: MakeStorage,
  options: ConformanceOptions,
): void {
  runConformanceCases(`KvStorage contract: ${name}`, contractCases, make, options);
  if (options.capabilities?.compareAndSwap) {
    runConformanceCases(`compareAndSwap: ${name}`, compareAndSwapCases, make, options);
  }
  if (options.capabilities?.watch) {
    runConformanceCases(`watch: ${name}`, watchCases, make, options);
  }
}
