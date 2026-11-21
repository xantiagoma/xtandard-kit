/** createPass against Elysia 1.x (the `*.elysia2.test.ts` twin runs the same against 2.x). */
import { Elysia, t } from "elysia";
import { describe, expect, it } from "vitest";
import { createPass } from "../src/adapters/elysia.ts";

const echo = async (request: Request): Promise<Response> =>
  Response.json({
    method: request.method,
    path: new URL(request.url).pathname,
    body: request.method === "GET" ? null : await request.text(),
    length: request.headers.get("content-length"),
  });

function app(prefix: string) {
  const { pass, raw, plugin } = createPass({ prefix, fetch: echo });
  return new Elysia(plugin)
    .post("/api/items", pass, { body: t.Object({ name: t.String() }) })
    .patch("/api/items/:id", pass, { body: t.Object({ name: t.String() }) })
    .delete("/api/items/:id", pass, { body: t.Optional(t.Object({ reason: t.String() })) })
    .post("/api/import", pass, { body: t.String() })
    .post("/intake", raw, { parse: "none" })
    .all("/*", pass);
}

const req = (path: string, method: string, body?: string, type = "application/json") =>
  new Request(`http://localhost${path}`, {
    method,
    ...(body !== undefined ? { body, headers: { "content-type": type } } : {}),
  });

describe("createPass on Elysia 1", () => {
  it("rebuilds parsed bodies for POST, PATCH and DELETE", async () => {
    const a = app("/panel");
    for (const [path, method, body] of [
      ["/panel/api/items", "POST", '{"name":"x"}'],
      ["/panel/api/items/1", "PATCH", '{"name":"y"}'],
      ["/panel/api/items/1", "DELETE", '{"reason":"z"}'],
    ] as const) {
      const res = await a.handle(req(path, method, body));
      expect(await res.json()).toMatchObject({ method, path, body, length: null });
    }
  });

  it("passes a string body through, keeps raw routes untouched, and serves the catch-all", async () => {
    const a = app("/panel");
    const csv = await a.handle(req("/panel/api/import", "POST", "name,url\na,b", "text/plain"));
    expect((await csv.json()).body).toBe("name,url\na,b");
    const intake = await a.handle(req("/panel/intake", "POST", '{ "sig" : 1 }'));
    expect((await intake.json()).body).toBe('{ "sig" : 1 }');
    const spa = await a.handle(req("/panel/deliveries/d1", "GET"));
    expect(await spa.json()).toMatchObject({ method: "GET", path: "/panel/deliveries/d1" });
  });

  it("two mounts with different prefixes are not deduplicated (seed)", async () => {
    const both = new Elysia().use(app("/one")).use(app("/two"));
    expect((await both.handle(req("/one/x", "GET"))).status).toBe(200);
    expect((await both.handle(req("/two/x", "GET"))).status).toBe(200);
  });
});
