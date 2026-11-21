import * as v from "valibot";
import { describe, expect, test } from "vitest";
import { durationToMs, parseDurationList } from "../src/util/duration.ts";
import { createIdGenerator } from "../src/util/id.ts";
import {
  assertValid,
  issuesFrom,
  jsonObjectSchema,
  jsonValueSchema,
  parseInput,
  resultOf,
  validateKeySegment,
  validateUrl,
  ValidationError,
  type UrlPolicyOptions,
} from "../src/util/validation.ts";
import { collectingSink, createTestClock } from "../src/testing/index.ts";

describe("duration", () => {
  test("units including weeks", () => {
    expect(durationToMs(250)).toBe(250);
    expect(durationToMs("250ms")).toBe(250);
    expect(durationToMs("1.5s")).toBe(1_500);
    expect(durationToMs("5m")).toBe(300_000);
    expect(durationToMs("2h")).toBe(7_200_000);
    expect(durationToMs("14d")).toBe(1_209_600_000);
    expect(durationToMs("2w")).toBe(1_209_600_000);
    expect(durationToMs(" 3s " as "3s")).toBe(3_000);
  });

  test("rejects bad input", () => {
    expect(() => durationToMs(-1)).toThrow("Invalid duration");
    expect(() => durationToMs(Number.NaN)).toThrow("Invalid duration");
    expect(() => durationToMs(Number.POSITIVE_INFINITY)).toThrow("Invalid duration");
    expect(() => durationToMs("5y" as "5s")).toThrow('expected e.g. "30s"');
    expect(() => durationToMs("-5s" as "5s")).toThrow();
  });

  test("parseDurationList", () => {
    expect(parseDurationList("0, 30s,5m,, 1h ")).toEqual([0, "30s", "5m", "1h"]);
    expect(parseDurationList("")).toEqual([]);
    expect(() => parseDurationList("1s,soon")).toThrow("Invalid duration");
  });
});

describe("createIdGenerator", () => {
  test("ulid: shape, pattern and embedded time", () => {
    const ids = createIdGenerator({ format: "ulid", prefixes: ["evt", "chk"] });
    const id = ids.newId("evt", 1_700_000_000_000);
    expect(id).toMatch(ids.idPattern("evt"));
    expect(id).not.toMatch(ids.idPattern("chk"));
    expect(id).toHaveLength(4 + 26);
    expect(ids.idTime(id)).toBe(1_700_000_000_000);
    expect(ids.format).toBe("ulid");
  });

  test("ulid: integer milliseconds (fractional clocks are floored)", () => {
    // Regression (au 6761a34): a fractional clock produced a non-Crockford time part.
    const ids = createIdGenerator({ format: "ulid", now: () => 1_700_000_000_000.7 });
    const id = ids.newId("evt");
    expect(id).toMatch(ids.idPattern("evt"));
    expect(ids.idTime(id)).toBe(1_700_000_000_000);
  });

  test("ulid-lower22 is monotonic within one millisecond", () => {
    // Regression: entitlements' generator drew fresh randomness per id, so ids minted in the same
    // millisecond sorted randomly (li 2acc19a fixed it for links only).
    const ids = createIdGenerator({ format: "ulid-lower22", now: () => 1_000 });
    const minted = Array.from({ length: 200 }, () => ids.newId("sub"));
    expect([...minted].sort()).toEqual(minted);
    expect(new Set(minted).size).toBe(200);
    for (const id of minted) expect(id).toMatch(ids.idPattern("sub"));
    expect(minted[0]).toHaveLength(4 + 22);
    expect(minted[0]).toBe(minted[0]?.toLowerCase());
    expect(ids.idTime(minted[0] as string)).toBe(1_000);
  });

  test("monotonic when the clock goes backwards", () => {
    let now = 5_000;
    const ids = createIdGenerator({ format: "ulid", now: () => now });
    const a = ids.newId("x");
    now = 4_000;
    const b = ids.newId("x");
    expect(b > a).toBe(true);
    expect(ids.idTime(b)).toBe(5_000);
  });

  test("random-part overflow moves to the next millisecond", () => {
    const ids = createIdGenerator({ format: "ulid-lower22", now: () => 0 });
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((arr: Uint8Array) => arr.fill(31)) as typeof crypto.getRandomValues;
    try {
      const first = ids.newId("x");
      const second = ids.newId("x");
      expect(ids.idTime(first)).toBe(0);
      expect(ids.idTime(second)).toBe(1);
      expect(second > first).toBe(true);
    } finally {
      crypto.getRandomValues = original;
    }
  });

  test("generators keep separate state", () => {
    const a = createIdGenerator({ format: "ulid", now: () => 9 });
    const b = createIdGenerator({ format: "ulid", now: () => 1 });
    a.newId("x");
    expect(b.idTime(b.newId("x"))).toBe(1);
  });

  test("base62: random, fixed length, no time", () => {
    const ids = createIdGenerator({ format: "base62", prefixes: ["msg", "ep"] });
    const id = ids.newId("msg");
    expect(id).toMatch(/^msg_[0-9A-Za-z]{22}$/);
    expect(id).toMatch(ids.idPattern("msg"));
    expect(ids.newId("msg")).not.toBe(id);
    expect(ids.idTime(id)).toBeNull();
    expect(() => ids.newId("nope" as "msg")).toThrow('unknown id prefix "nope"');
  });

  test("idTime rejects malformed ids; patterns escape the prefix; unknown formats throw", () => {
    const ids = createIdGenerator({ format: "ulid" });
    expect(ids.idTime("evt_short")).toBeNull();
    expect(ids.idTime("evt_UUUUUUUUUU0000")).toBeNull();
    expect(ids.idPattern("a.b").test("aXb_0000000000000000000000000A")).toBe(false);
    expect(() => ids.newId("anything")).not.toThrow();
    expect(() => createIdGenerator({ format: "uuid" as "ulid" })).toThrow('unknown format "uuid"');
  });

  test("reads ids written by the products' current generators", () => {
    const au = createIdGenerator({ format: "ulid" });
    expect("evt_01HF7YAT00ABCDEFGHJKMNPQRS").toMatch(au.idPattern("evt"));
    expect(au.idTime("evt_01HF7YAT00ABCDEFGHJKMNPQRS")).toBe(1_700_000_000_000);
    const en = createIdGenerator({ format: "ulid-lower22" });
    expect("sub_01hf7yat00abcdefghjkmn").toMatch(en.idPattern("sub"));
    expect(en.idTime("sub_01hf7yat00abcdefghjkmn")).toBe(1_700_000_000_000);
    const wh = createIdGenerator({ format: "base62" });
    expect("msg_00Az9bQ3kLmN0pQrStUvWx").toMatch(wh.idPattern("msg"));
  });
});

describe("validation", () => {
  const schema = v.strictObject({ name: v.string(), tags: v.array(v.string()) });

  test("issuesFrom: root issues get the base path without a trailing dot", () => {
    // Regression: webhooks produced "base." for root-level issues.
    const root = v.safeParse(schema, "nope");
    expect(root.success).toBe(false);
    expect(issuesFrom(root.issues ?? [], "link")[0]?.path).toBe("link");
    expect(issuesFrom(root.issues ?? [])[0]?.path).toBe("");
    const nested = v.safeParse(schema, { name: 1, tags: ["a", 2], extra: true });
    expect(issuesFrom(nested.issues ?? [], "link").map((i) => i.path)).toEqual([
      "link.name",
      "link.tags.1",
      "link.extra",
    ]);
    expect(issuesFrom(nested.issues ?? [], "link")[2]?.message).toBe("unknown field");
  });

  test("parseInput returns the output or throws a ValidationError (or the product's error)", () => {
    expect(parseInput(schema, { name: "a", tags: [] })).toEqual({ name: "a", tags: [] });
    const error = (() => {
      try {
        parseInput(schema, { name: 1, tags: [] });
      } catch (e) {
        return e;
      }
    })() as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.errors).toEqual([{ path: "name", message: expect.any(String) }]);
    expect(error.issues).toBe(error.errors);
    expect(error.message).toMatch(/^Validation failed:\n {2}- name: /);
    class InputValidationError extends Error {
      override name = "InputValidationError";
    }
    expect(() =>
      parseInput(schema, null, {
        basePath: "grant",
        error: (issues) => new InputValidationError(issues.map((i) => i.path).join()),
      }),
    ).toThrow(new InputValidationError("grant"));
  });

  test("assertValid / resultOf / message without a path", () => {
    expect(() => assertValid(resultOf([]))).not.toThrow();
    expect(() => assertValid(resultOf([{ path: "", message: "bad" }]))).toThrow(
      "Validation failed:\n  - bad",
    );
    expect(new ValidationError([], "custom").message).toBe("custom");
  });

  test("jsonValueSchema requires finite numbers", () => {
    // Regression: only audit rejected NaN/Infinity, which serialise to null.
    expect(v.is(jsonValueSchema, { a: [1, "x", true, null, { b: 2.5 }] })).toBe(true);
    expect(v.is(jsonValueSchema, { a: Number.NaN })).toBe(false);
    expect(v.is(jsonValueSchema, [Number.POSITIVE_INFINITY])).toBe(false);
    expect(v.is(jsonValueSchema, { a: undefined })).toBe(false);
    expect(v.is(jsonObjectSchema, [])).toBe(false);
    expect(v.is(jsonObjectSchema, { a: 1 })).toBe(true);
  });

  test("validateKeySegment", () => {
    expect(validateKeySegment("acme-1.prod_x", "tenant")).toEqual([]);
    expect(validateKeySegment("", "tenant")).toEqual([{ path: "tenant", message: "is required" }]);
    expect(validateKeySegment(7, "tenant")[0]?.message).toBe("is required");
    expect(validateKeySegment("a/b", "tenant")[0]?.message).toMatch(/must match/);
    expect(validateKeySegment("a:b", "tenant")).toHaveLength(1);
    expect(validateKeySegment("..", "tenant")[0]?.message).toBe('".." is not an allowed key');
  });

  test("validateUrl: defaults (link destinations)", () => {
    expect(validateUrl("https://example.com/x", "url")).toEqual([]);
    expect(validateUrl("myapp://open/1", "url")).toEqual([]);
    expect(validateUrl("http://example.com", "url")).toEqual([]);
    const msg = (value: unknown, o = {}) => validateUrl(value, "url", o)[0]?.message;
    expect(msg("")).toBe("is required");
    expect(msg(undefined)).toBe("is required");
    expect(msg(`https://e.com/${"a".repeat(8200)}`)).toBe("must be at most 8192 characters");
    expect(msg("/relative")).toBe("must be an absolute URL");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd"]) {
      expect(msg(bad)).toMatch(/^scheme .* is not allowed$/);
    }
    expect(msg("https://user:pw@e.com")).toBeUndefined();
    expect(msg("https://e.com", { policy: () => "blocked host" })).toBe("blocked host");
    expect(msg("https://e.com", { policy: () => false })).toBe(
      "URL rejected by the configured policy",
    );
    expect(msg("https://e.com", { policy: () => true })).toBeUndefined();
    expect(msg("http:", { maxLength: 4 })).toBe("must be at most 4 characters");
  });

  test("validateUrl: webhook endpoint policy", () => {
    const endpoint: UrlPolicyOptions = {
      allowedSchemes: ["https:", "http:"],
      requireHttps: true,
      rejectCredentials: true,
    };
    const msg = (value: string, o = endpoint) => validateUrl(value, "endpoint.url", o)[0]?.message;
    expect(msg("https://hooks.example.com")).toBeUndefined();
    expect(msg("http://localhost:3000/hook")).toBeUndefined();
    expect(msg("http://127.0.0.1/hook")).toBeUndefined();
    expect(msg("http://[::1]/hook")).toBeUndefined();
    expect(msg("http://example.com")).toBe("http URLs are only allowed for localhost");
    expect(msg("http://localhost", { ...endpoint, allowLocalhost: false })).toBe(
      "http URLs are only allowed for localhost",
    );
    expect(msg("ftp://example.com")).toBe('unsupported protocol "ftp:"');
    expect(msg("https://u:p@example.com")).toBe("URL must not contain credentials");
  });
});

describe("testing helpers", () => {
  test("createTestClock", () => {
    const clock = createTestClock("2026-01-01T00:00:00Z");
    expect(clock.iso()).toBe("2026-01-01T00:00:00.000Z");
    clock.advance("1h");
    expect(clock.now()).toBe(Date.parse("2026-01-01T01:00:00Z"));
    clock.set(0);
    expect(clock.iso()).toBe("1970-01-01T00:00:00.000Z");
    clock.set("1970-01-02T00:00:00Z");
    expect(clock.now()).toBe(86_400_000);
    expect(() => clock.set("not a date")).toThrow("invalid time");
    expect(Math.abs(createTestClock().now() - Date.now())).toBeLessThan(1_000);
  });

  test("collectingSink collects, fails on demand, clears", async () => {
    const sink = collectingSink<{ n: number }>();
    const item = { n: 1 };
    await sink.push(item, { n: 2 });
    expect(sink.items).toEqual([{ n: 1 }, { n: 2 }]);
    expect(sink.items[0]).toBe(item);
    sink.failNext(2);
    await expect(sink.push({ n: 3 })).rejects.toThrow("simulated failure");
    const boom = new Error("boom");
    sink.failNext(1, boom);
    await expect(sink.push({ n: 3 })).rejects.toBe(boom);
    await sink.push({ n: 4 });
    expect(sink.items.map((i) => i.n)).toEqual([1, 2, 4]);
    sink.clear();
    expect(sink.items).toEqual([]);
  });

  test("collectingSink clone option", async () => {
    const sink = collectingSink<{ n: number }>({ clone: true });
    const item = { n: 1 };
    await sink.push(item);
    item.n = 2;
    expect(sink.items).toEqual([{ n: 1 }]);
  });
});
