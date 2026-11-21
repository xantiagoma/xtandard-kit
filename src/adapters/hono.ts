/**
 * Hono helpers. No `hono` import at runtime: {@link mountPanel} takes the
 * product's (or the user's) `Hono` app structurally, and {@link waitUntilOf}
 * reads the execution context defensively.
 *
 * ```ts
 * import { Hono } from "hono";
 * import { mountPanel } from "@xtandard/kit/adapters/hono";
 *
 * const app = new Hono();
 * mountPanel(app, panel.fetch); // every path, every method
 * ```
 *
 * @module
 */

import type { FetchHandler } from "./node.ts";

/** The part of a Hono context the helpers read. */
export interface HonoContextLike {
  req: { raw: Request };
  /** Throws on runtimes without an execution context (Bun, Node). */
  readonly executionCtx?: unknown;
}

/** The part of a Hono app {@link mountPanel} uses. */
export interface HonoAppLike<App> {
  all(path: string, handler: (c: HonoContextLike) => Response | Promise<Response>): App;
}

/** A Hono handler that forwards the raw request to `fetch`. */
export const toHonoHandler =
  (fetch: FetchHandler) =>
  (c: HonoContextLike): Response | Promise<Response> =>
    fetch(c.req.raw);

/**
 * Route `path` (default `"*"`, everything) to `fetch` on `app`, for every
 * method. Returns the app, so it chains. With a sub-path, mount both the path
 * and everything below it: `mountPanel(app, fetch, "/webhooks")`.
 */
export function mountPanel<App extends HonoAppLike<App>>(
  app: App,
  fetch: FetchHandler,
  path = "*",
): App {
  const handler = toHonoHandler(fetch);
  if (path === "*" || path === "/*") return app.all("*", handler);
  const base = path.replace(/\/+$/, "");
  app.all(base, handler);
  return app.all(`${base}/*`, handler);
}

/** Something that can keep work alive past the response (Workers' `ExecutionContext`). */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * The context's `waitUntil`, bound and safe to call, or `undefined` on runtimes
 * without one. Hono's `c.executionCtx` getter **throws** outside Workers, and
 * `waitUntil` must be called as a method (li bf20268), so read it here.
 */
export function waitUntilOf(c: HonoContextLike): WaitUntil | undefined {
  try {
    const ctx = c.executionCtx as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
    if (ctx && typeof ctx.waitUntil === "function") {
      return { waitUntil: (p) => ctx.waitUntil?.(p) };
    }
  } catch {
    // No ExecutionContext (Bun / Node).
  }
  return undefined;
}
