/**
 * `createApiClient`: the au/li `send`/`req`/`apiUrl` split, en's `getApiToken`, li's `toQuery`, the
 * product error class, and one client per product (no shared module state).
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, toQuery, type FetchLike } from "../src/ui/api-client.ts";

class WebhooksApiError extends ApiError {
  constructor(...args: ConstructorParameters<typeof ApiError>) {
    super(...args);
    this.name = "WebhooksApiError";
  }
}

function recorder(respond: (url: string, init?: RequestInit) => Response = () => json({})) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (input, init) => {
    calls.push({ url: String(input), init });
    return respond(String(input), init);
  };
  return { calls, fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createApiClient", () => {
  it("joins the base (trailing slash dropped) and keeps relative paths without one", () => {
    const client = createApiClient();
    expect(client.apiUrl("config")).toBe("config");
    client.setApiBase("https://x.test/webhooks/");
    expect(client.apiUrl("api/apps")).toBe("https://x.test/webhooks/api/apps");
  });

  it("sends credentials, JSON content-type for string bodies only, and the bearer token", async () => {
    const r = recorder();
    const client = createApiClient({ fetch: r.fetch, base: "/p" });
    client.setApiBase("/p", { credentials: "include" });
    client.setApiToken("whpt_abc");
    expect(client.getApiToken()).toBe("whpt_abc");
    await client.req("api/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    await client.send("api/upload", { method: "POST", body: new Blob(["a,b"]) });
    await client.send("api/csv", {
      method: "POST",
      body: "a,b",
      headers: new Headers({ "Content-Type": "text/csv" }),
    });
    expect(r.calls[0]!.url).toBe("/p/api/x");
    expect(r.calls[0]!.init).toMatchObject({
      credentials: "include",
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer whpt_abc" },
    });
    expect(r.calls[1]!.init!.headers).toEqual({ authorization: "Bearer whpt_abc" });
    // One content-type, the caller's (a duplicate would be sent as "application/json, text/csv").
    expect(r.calls[2]!.init!.headers).toEqual({
      "content-type": "text/csv",
      authorization: "Bearer whpt_abc",
    });
    client.setApiToken(null);
    await client.req("config");
    expect(r.calls[3]!.init!.headers).toEqual({});
    expect(r.calls[3]!.init!.credentials).toBe("include");
  });

  it("returns undefined for an empty body and the raw Response from send", async () => {
    const r = recorder((url) =>
      url.endsWith("empty") ? new Response(null, { status: 204 }) : new Response("k=v"),
    );
    const client = createApiClient({ fetch: r.fetch });
    await expect(client.req("empty")).resolves.toBeUndefined();
    const res = await client.send("jwks");
    await expect(res.text()).resolves.toBe("k=v");
  });

  it("throws the product error class with the status forced into the body", async () => {
    const r = recorder(() => json({ error: "Nope", status: 200, code: "denied" }, 403));
    const client = createApiClient({ fetch: r.fetch, errorClass: WebhooksApiError });
    const err = await client.req("api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WebhooksApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      name: "WebhooksApiError",
      message: "Nope",
      status: 403,
      body: { error: "Nope", status: 403, code: "denied" },
    });
  });

  it("falls back to the status text for non-JSON or message-less errors", async () => {
    const r = recorder((url) =>
      url === "html"
        ? new Response("<html>", { status: 502, statusText: "Bad Gateway" })
        : url === "arr"
          ? json([1], 500)
          : new Response("{}", { status: 404 }),
    );
    const client = createApiClient({ fetch: r.fetch });
    await expect(client.req("html")).rejects.toMatchObject({
      name: "ApiError",
      message: "Bad Gateway",
      body: { error: "Bad Gateway", status: 502 },
    });
    await expect(client.req("arr")).rejects.toMatchObject({ body: { error: "HTTP 500" } });
    await expect(client.req("none")).rejects.toMatchObject({ message: "HTTP 404", status: 404 });
  });

  it("keeps each client's state separate", async () => {
    const a = createApiClient({ base: "/a" });
    const b = createApiClient({ base: "/b" });
    a.setApiToken("t");
    expect(b.getApiToken()).toBeNull();
    expect(b.apiUrl("x")).toBe("/b/x");
  });

  it("uses the global fetch by default, read at call time", async () => {
    const spy = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", spy);
    try {
      await expect(createApiClient().req("config")).resolves.toEqual({ ok: true });
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("exposes toQuery as query", () => {
    expect(createApiClient().query({ a: 1 })).toBe("?a=1");
  });
});

describe("toQuery", () => {
  it("skips undefined, null and empty values; joins arrays; stringifies booleans", () => {
    expect(
      toQuery({ a: "x y", b: undefined, c: null, d: "", e: 0, f: false, g: ["1", "2"], h: [] }),
    ).toBe("?a=x+y&e=0&f=false&g=1%2C2");
  });
  it("is empty when nothing is left", () => {
    expect(toQuery({ a: undefined })).toBe("");
  });
});
