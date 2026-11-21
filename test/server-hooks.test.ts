import { describe, expect, test, vi } from "vitest";
import {
  createHookErrorReporter,
  defaultHookErrorReporter,
  HookDeniedError,
  hookDeniedStatus,
  isNamed,
  normalizeHooks,
  runAfter,
  runBefore,
  type Hooks,
} from "../src/hooks/contract.ts";
import { createLogHook } from "../src/hooks/log.ts";

type Before = { type: "flag.upsert"; key: string } | { type: "flag.delete"; key: string };
type After = { type: "flag.upserted"; key: string; at: string };
type H = Hooks<Before, After>;

const upsert: Before = { type: "flag.upsert", key: "a" };
const upserted: After = { type: "flag.upserted", key: "a", at: "2026-01-01T00:00:00.000Z" };

describe("runner", () => {
  test("normalizeHooks handles undefined / single / array (and copies)", () => {
    const hook: H = {};
    const list = [hook];
    expect(normalizeHooks<Before, After>(undefined)).toEqual([]);
    expect(normalizeHooks(hook)).toEqual([hook]);
    const normalized = normalizeHooks(list);
    expect(normalized).toEqual([hook]);
    expect(normalized).not.toBe(list);
  });

  test("before hooks run sequentially in order; the first throw aborts the rest", async () => {
    const calls: string[] = [];
    const hooks: H[] = [
      {
        before: async () => {
          await new Promise((r) => setTimeout(r, 5));
          calls.push("1");
        },
      },
      {
        before: () => {
          calls.push("2");
          throw new HookDeniedError("no");
        },
      },
      { before: () => void calls.push("3") },
      { after: () => void calls.push("after-only") },
    ];
    await expect(runBefore(hooks, upsert)).rejects.toThrow("no");
    expect(calls).toEqual(["1", "2"]);
  });

  test("after hooks run concurrently; errors go to onError, never to the caller", async () => {
    const seen: string[] = [];
    const onError = vi.fn();
    const failure = new Error("after failed");
    const hooks: H[] = [
      {
        after: () => {
          throw failure;
        },
      },
      { after: async (e) => void seen.push(e.key) },
      { before: () => undefined },
    ];
    await expect(runAfter(hooks, upserted, onError)).resolves.toBeUndefined();
    expect(seen).toEqual(["a"]);
    expect(onError).toHaveBeenCalledWith(failure, upserted);
  });

  test("error reporters warn with a configurable prefix and never throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = new Error("x");
    createHookErrorReporter("@xtandard/webhooks")(error, upserted);
    defaultHookErrorReporter(error, upserted);
    expect(warn.mock.calls).toEqual([
      ['[@xtandard/webhooks] after-hook for "flag.upserted" threw:', error],
      ['[@xtandard/kit] after-hook for "flag.upserted" threw:', error],
    ]);
    warn.mockRestore();
  });
});

describe("HookDeniedError and name-based mapping", () => {
  test("defaults to 403, honours a status and a cause", () => {
    const cause = new Error("root");
    const denied = new HookDeniedError("frozen", { status: 409, cause });
    expect(denied.name).toBe("HookDeniedError");
    expect(denied.status).toBe(409);
    expect(denied.cause).toBe(cause);
    expect(new HookDeniedError("x").status).toBe(403);
    expect("cause" in new HookDeniedError("x")).toBe(false);
  });

  test("a HookDeniedError from a SEPARATE bundle (name + status, not instanceof) still maps", () => {
    // Regression (fl 723121c): a hook from another subpath bundle throws its own copy of the class.
    const foreign = Object.assign(new Error("denied by foreign hook"), {
      name: "HookDeniedError",
      status: 422,
    });
    expect(foreign instanceof HookDeniedError).toBe(false);
    expect(hookDeniedStatus(foreign)).toBe(422);
    expect(hookDeniedStatus(Object.assign(new Error("x"), { name: "HookDeniedError" }))).toBe(403);
    expect(hookDeniedStatus(new HookDeniedError("x", { status: 451 }))).toBe(451);
    expect(hookDeniedStatus(new Error("plain"))).toBeNull();
    expect(hookDeniedStatus("HookDeniedError")).toBeNull();
  });

  test("isNamed matches any error object by name (other bundles, other realms)", () => {
    // Regression: fl mapped only HookDeniedError by name; a foreign NotFoundError became a 500.
    class NotFoundError extends Error {
      override name = "NotFoundError";
    }
    const foreign = { name: "NotFoundError", message: "gone" };
    expect(isNamed(new NotFoundError("x"), "NotFoundError")).toBe(true);
    expect(isNamed(foreign, "NotFoundError")).toBe(true);
    expect(isNamed(new Error("x"), "NotFoundError")).toBe(false);
    expect(isNamed(null, "NotFoundError")).toBe(false);
    expect(isNamed("NotFoundError", "NotFoundError")).toBe(false);
  });
});

describe("createLogHook", () => {
  test("logs after events only by default, in the text format", async () => {
    const lines: string[] = [];
    const hook = createLogHook<Before, After>({ log: (l) => lines.push(l) });
    expect(hook.before).toBeUndefined();
    await hook.after?.(upserted);
    expect(lines).toEqual([`[@xtandard/kit] after flag.upserted ${JSON.stringify(upserted)}`]);
  });

  test("source and describe shape the text line", async () => {
    const lines: string[] = [];
    const hook = createLogHook<Before, After>({
      log: (l) => lines.push(l),
      includeBefore: true,
      source: "@xtandard/flags",
      describe: (e) => (e.type === "flag.delete" ? "" : `proj/${e.key}`),
    });
    await hook.before?.(upsert);
    await hook.before?.({ type: "flag.delete", key: "b" });
    expect(lines).toEqual([
      `[@xtandard/flags] before flag.upsert proj/a ${JSON.stringify(upsert)}`,
      `[@xtandard/flags] before flag.delete ${JSON.stringify({ type: "flag.delete", key: "b" })}`,
    ]);
  });

  test("json prints one object per line; a custom format wins", async () => {
    const lines: string[] = [];
    const json = createLogHook<Before, After>({
      log: (l) => lines.push(l),
      json: true,
      source: "s",
    });
    await json.after?.(upserted);
    expect(JSON.parse(lines[0] as string)).toEqual({ source: "s", phase: "after", ...upserted });
    const custom = createLogHook<Before, After>({
      log: (l) => lines.push(l),
      json: true,
      format: (phase, e) => `${phase}:${e.type}`,
    });
    await custom.after?.(upserted);
    expect(lines[1]).toBe("after:flag.upserted");
  });

  test("defaults to console.log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createLogHook().after?.({ type: "x" });
    expect(log).toHaveBeenCalledWith('[@xtandard/kit] after x {"type":"x"}');
    log.mockRestore();
  });
});
