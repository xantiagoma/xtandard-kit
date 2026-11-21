import { describe, expect, test } from "vitest";
import {
  canonical,
  canonicalJson,
  canonicalStringify,
  deepEqual,
  parseJsonValue,
} from "../src/internal/json.ts";
import { importPeer, requirePeer } from "../src/internal/peer.ts";

describe("canonical JSON", () => {
  test("key order does not matter", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 0 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [2, { y: 0, z: 1 }] }, b: 1 }),
    );
    expect(canonical(undefined)).toBeUndefined();
  });
  test("canonicalStringify is strict about non-finite numbers", () => {
    expect(canonicalStringify({ b: 1, a: undefined as never, c: [1, "x"] })).toBe(
      '{"b":1,"c":[1,"x"]}',
    );
    expect(canonicalStringify(undefined)).toBe("null");
    expect(() => canonicalStringify(Number.NaN)).toThrow(TypeError);
    expect(canonicalJson(Number.POSITIVE_INFINITY)).toBe("null");
  });
});

describe("deepEqual", () => {
  test("structural, order-insensitive, own properties only", () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: undefined }, { b: undefined })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

test("parseJsonValue", () => {
  expect(parseJsonValue('{"a":1}')).toEqual({ a: 1 });
  expect(parseJsonValue("not json")).toBe("not json");
  expect(parseJsonValue({ a: 1 })).toEqual({ a: 1 });
});

describe("peers", () => {
  test("requirePeer names the package and the subpath", () => {
    expect(() => requirePeer("redis", "@xtandard/kit/storage/redis")).toThrow(
      /@xtandard\/kit\/storage\/redis requires the optional peer "redis"/,
    );
  });
  test("importPeer maps module-not-found and rethrows other errors", async () => {
    await expect(
      importPeer("nope-pkg", "@xtandard/kit/x", () => import("nope-pkg" as string)),
    ).rejects.toThrow(/optional peer "nope-pkg"/);
    const boom = new Error("boom");
    await expect(importPeer("x", "s", () => Promise.reject(boom))).rejects.toBe(boom);
    await expect(importPeer("x", "s", async () => 42)).resolves.toBe(42);
  });
});

test("canonicalStringify accepts undefined members and items (dropped / null, like JSON.stringify)", () => {
  expect(canonicalStringify({ b: undefined, a: [1, undefined] })).toBe('{"a":[1,null]}');
  expect(canonicalStringify({ b: undefined, a: [1, undefined] })).toBe(
    JSON.stringify({ a: [1, undefined] }),
  );
});
