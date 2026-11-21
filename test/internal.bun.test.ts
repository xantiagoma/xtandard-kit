/** Bun-runtime smoke test: the shared helpers behave the same under `bun test` as under vitest. */
import { expect, test } from "bun:test";
import { canonicalJson, deepEqual } from "../src/internal/json.ts";
import { importPeer } from "../src/internal/peer.ts";

test("canonical JSON and deepEqual under Bun", () => {
  expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  expect(deepEqual({ a: [1] }, { a: [1] })).toBe(true);
});

test("importPeer maps a missing module under Bun", async () => {
  await expect(
    importPeer("nope-pkg", "@xtandard/kit/x", () => import("nope-pkg" as string)),
  ).rejects.toThrow(/optional peer "nope-pkg"/);
});
