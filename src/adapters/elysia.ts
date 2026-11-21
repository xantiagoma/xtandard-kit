/**
 * Elysia-version-agnostic plumbing for the 1.x and 2.x adapters. No `elysia`
 * import: products keep their typed route chain (Eden inference needs literal
 * chains) and delegate each declared route to {@link createPass}'s handlers.
 *
 * Elysia parses the body of declared routes, draining the request stream;
 * `pass` rebuilds the `Request` before delegating to the panel:
 *
 * - for `POST`, `PUT`, `PATCH` and `DELETE`, when the stream was consumed
 *   (`bodyUsed`);
 * - a string body is passed through as-is (CSV imports), bytes as bytes, form
 *   data as `FormData`, urlencoded objects re-encoded, everything else as
 *   JSON (with a JSON content type);
 * - the stale `content-length` is dropped.
 *
 * `raw` forwards the untouched request, for routes declared with
 * `parse: "none"` (signature-verified webhook intake). `plugin` carries
 * `seed: prefix`, so two mounts with different prefixes aren't deduplicated by
 * Elysia's plugin `name`.
 *
 * ```ts
 * const { prefix, pass, raw, plugin } = createPass({ prefix: "/webhooks", fetch: panel.fetch, name: "xtandard-webhooks" });
 * new Elysia(plugin)
 *   .post("/api/endpoints", pass, { body: t.Object({ url: t.String() }) })
 *   .post("/intake/:provider", raw, { parse: "none" })
 *   .all("/*", pass);
 * ```
 *
 * @module
 */

import type { FetchHandler } from "./node.ts";

/** Options for {@link createPass}. */
export interface CreatePassOptions {
  /** Mount prefix (also the panel's `basePath`), e.g. `"/webhooks"`. */
  prefix: string;
  /** The panel's fetch handler. */
  fetch: FetchHandler;
  /** The Elysia plugin name. Default `"xtandard-panel"`. */
  name?: string;
}

/** The Elysia context fields `pass` reads. */
export interface PassContext {
  request: Request;
  body?: unknown;
}

/** What {@link createPass} returns. */
export interface CreatePassResult {
  prefix: string;
  /** Rebuild the request from Elysia's parsed body, then delegate. */
  pass: (ctx: PassContext) => Promise<Response>;
  /** Delegate the untouched request (routes with `parse: "none"`). */
  raw: (ctx: { request: Request }) => Promise<Response>;
  /** `new Elysia(plugin)` options: `{ prefix, name, seed: prefix }`. */
  plugin: { prefix: string; name: string; seed: string };
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function rebuiltBody(body: unknown, headers: Headers): BodyInit | undefined {
  if (body === undefined || body === null || body === "") return undefined;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) return body as BodyInit;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    headers.delete("content-type"); // a new multipart boundary is generated
    return body;
  }
  const type = headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") && typeof body === "object") {
    return new URLSearchParams(body as Record<string, string>).toString();
  }
  if (!type.includes("json")) headers.set("content-type", "application/json");
  return JSON.stringify(body);
}

/** Build the handlers every declared Elysia route delegates to. */
export function createPass(options: CreatePassOptions): CreatePassResult {
  const { prefix, fetch } = options;
  const pass = async (ctx: PassContext): Promise<Response> => {
    const r = ctx.request;
    if (BODY_METHODS.has(r.method.toUpperCase()) && r.bodyUsed) {
      const headers = new Headers(r.headers);
      headers.delete("content-length");
      const body = rebuiltBody(ctx.body, headers);
      return fetch(
        new Request(r.url, { method: r.method, headers, ...(body !== undefined ? { body } : {}) }),
      );
    }
    return fetch(r);
  };
  const raw = async (ctx: { request: Request }): Promise<Response> => fetch(ctx.request);
  return {
    prefix,
    pass,
    raw,
    plugin: { prefix, name: options.name ?? "xtandard-panel", seed: prefix },
  };
}
