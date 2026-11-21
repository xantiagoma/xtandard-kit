import { EventEmitter } from "node:events";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toBunFetch } from "../src/adapters/bun.ts";
import { createPass } from "../src/adapters/elysia.ts";
import { toExpressMiddleware } from "../src/adapters/express.ts";
import { mountPanel, toHonoHandler, waitUntilOf } from "../src/adapters/hono.ts";
import { toNextHandler } from "../src/adapters/next.ts";
import {
  headersFrom,
  requestUrl,
  toNodeHandler,
  toWebRequest,
  writeWebResponse,
  type NodeRequest,
} from "../src/adapters/node.ts";

/** A fetch handler that echoes what it received. */
const echo = async (request: Request): Promise<Response> =>
  Response.json({
    method: request.method,
    url: request.url,
    body: request.method === "GET" || request.method === "HEAD" ? null : await request.text(),
    type: request.headers.get("content-type"),
    length: request.headers.get("content-length"),
    multi: request.headers.get("x-multi"),
  });

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Raw GET returning the IncomingMessage (to see repeated headers). */
const rawGet = (url: string): Promise<IncomingMessage> =>
  new Promise((resolve, reject) => httpRequest(url, resolve).on("error", reject).end());

const fakeReq = (init: Partial<NodeRequest> & { headers?: Record<string, string | string[]> }) =>
  Object.assign(new EventEmitter(), {
    method: "POST",
    url: "/x",
    headers: {},
    readableEnded: true,
    socket: {},
    ...init,
  }) as unknown as NodeRequest;

describe("node bridge — requests", () => {
  it("appends each value of a multi-value header", () => {
    // Regression: wh/fl/au/en joined arrays into one "a, b" value.
    const headers = headersFrom(fakeReq({ headers: { "set-cookie": ["a=1", "b=2"], host: "h" } }));
    expect(headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(headers.get("host")).toBe("h");
  });

  it("builds the URL from originalUrl (mount prefix), protocol and Host", () => {
    expect(
      requestUrl(fakeReq({ url: "/api", originalUrl: "/panel/api?x=1", headers: { host: "h:1" } })),
    ).toBe("http://h:1/panel/api?x=1");
    expect(
      requestUrl(
        fakeReq({ url: "/a", socket: { encrypted: true } as never, headers: { host: "h" } }),
      ),
    ).toBe("https://h/a");
    expect(requestUrl(fakeReq({ url: "/a", protocol: "https" }))).toBe("https://localhost/a");
    expect(requestUrl(fakeReq({ url: undefined }), "https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  it("re-serialises bodies parsed by middleware (JSON, string, bytes, urlencoded) and drops content-length", async () => {
    // Regression: only links handled Uint8Array + urlencoded; entitlements handled bytes only.
    const read = async (body: unknown, type = "application/json") => {
      const r = await toWebRequest(
        fakeReq({ body, headers: { "content-type": type, "content-length": "999" } }),
      );
      return { text: await r.text(), length: r.headers.get("content-length") };
    };
    expect(await read({ a: 1 })).toEqual({ text: '{"a":1}', length: null });
    expect((await read("plain", "text/plain")).text).toBe("plain");
    expect((await read(new Uint8Array([104, 105]), "application/octet-stream")).text).toBe("hi");
    expect((await read(new Uint8Array([104, 105]).buffer, "application/octet-stream")).text).toBe(
      "hi",
    );
    expect((await read({ a: "1", b: "x y" }, "application/x-www-form-urlencoded")).text).toBe(
      "a=1&b=x+y",
    );
    // express.json() leaves `{}` when there was no body at all.
    const empty = await toWebRequest(fakeReq({ body: {}, headers: {} }));
    expect(empty.body).toBeNull();
    const withLength = await toWebRequest(
      fakeReq({ body: {}, headers: { "content-length": "2" } }),
    );
    expect(await withLength.text()).toBe("{}");
    const nothing = await toWebRequest(fakeReq({ body: undefined }));
    expect(nothing.body).toBeNull();
    const get = await toWebRequest(fakeReq({ method: "GET", body: { a: 1 } }));
    expect(get.body).toBeNull();
  });

  it("reads the raw stream, or streams it lazily", async () => {
    const url = await listen(
      createServer(async (req, res) => {
        const lazy = req.url === "/lazy";
        const request = await toWebRequest(req, { lazyBody: lazy });
        res.end(
          JSON.stringify({
            text: await request.text(),
            lazy,
            length: request.headers.get("content-length"),
          }),
        );
      }),
    );
    for (const path of ["/buffered", "/lazy"]) {
      const res = await fetch(`${url}${path}`, { method: "PUT", body: "payload" });
      expect(await res.json()).toMatchObject({ text: "payload", lazy: path === "/lazy" });
    }
    const empty = await fetch(`${url}/buffered`, { method: "POST" });
    expect((await empty.json()).text).toBe("");
  });
});

describe("node bridge — responses", () => {
  it("keeps every Set-Cookie header", async () => {
    // Regression: wh/fl/au/en collapsed multiple cookies into one header via forEach.
    const url = await listen(
      createServer(
        toNodeHandler(() => {
          const headers = new Headers({ "x-a": "1" });
          headers.append("set-cookie", "a=1; Path=/");
          headers.append("set-cookie", "b=2; Path=/");
          return new Response("ok", { status: 201, statusText: "Made", headers });
        }),
      ),
    );
    const res = await rawGet(url);
    expect(res.statusCode).toBe(201);
    expect(res.statusMessage).toBe("Made");
    expect(res.headers["set-cookie"]).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(res.headers["x-a"]).toBe("1");
    res.resume();
  });

  it("streams the body (first chunk arrives before the stream ends)", async () => {
    // Regression: wh/li/en buffered every response (SSE and large exports never flushed).
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const url = await listen(
      createServer(
        toNodeHandler(
          () =>
            new Response(
              new ReadableStream({
                async start(controller) {
                  controller.enqueue(new TextEncoder().encode("first"));
                  await gate;
                  controller.enqueue(new TextEncoder().encode("second"));
                  controller.close();
                },
              }),
            ),
        ),
      ),
    );
    const res = await rawGet(url);
    const chunks: string[] = [];
    await new Promise<void>((resolve) =>
      res.once("data", (c: Buffer) => {
        chunks.push(c.toString());
        resolve();
      }),
    );
    expect(chunks).toEqual(["first"]);
    release();
    for await (const c of res) chunks.push((c as Buffer).toString());
    expect(chunks.join("")).toBe("firstsecond");
  });

  it("cancels the body when the client disconnects", async () => {
    let stopped = false;
    const cancelled = new Promise<unknown>((resolve) => {
      void listen(
        createServer(
          toNodeHandler(
            () =>
              new Response(
                new ReadableStream({
                  pull: (c) =>
                    new Promise<void>((r) =>
                      setTimeout(() => {
                        // A pull can still be pending when the stream is cancelled.
                        if (!stopped) c.enqueue(new Uint8Array(8));
                        r();
                      }, 5),
                    ),
                  cancel: (reason) => {
                    stopped = true;
                    resolve(reason);
                  },
                }),
              ),
          ),
        ),
      ).then(async (url) => {
        const res = await rawGet(url);
        res.once("data", () => res.destroy());
      });
    });
    await expect(cancelled).resolves.toBeUndefined();
  });

  it("waits for drain when the socket buffer is full (backpressure)", async () => {
    const writes: string[] = [];
    const res = Object.assign(new EventEmitter(), {
      statusCode: 0,
      statusMessage: "",
      destroyed: false,
      headers: {} as Record<string, unknown>,
      setHeader(k: string, v: unknown) {
        this.headers[k] = v;
      },
      write(chunk: Uint8Array) {
        writes.push(new TextDecoder().decode(chunk));
        return writes.length > 1; // the first write fills the buffer
      },
      end: vi.fn(),
    });
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("a"));
        c.enqueue(new TextEncoder().encode("b"));
        c.close();
      },
    });
    const done = writeWebResponse(res as never, new Response(body));
    await new Promise((r) => setTimeout(r, 10));
    expect(writes).toEqual(["a"]); // paused until drain
    res.emit("drain");
    await done;
    expect(writes).toEqual(["a", "b"]);
    expect(res.end).toHaveBeenCalledOnce();
  });

  it("HEAD and empty bodies end without writing", async () => {
    const res = Object.assign(new EventEmitter(), {
      statusCode: 0,
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    });
    await writeWebResponse(res as never, new Response("body"), { method: "HEAD" });
    await writeWebResponse(res as never, new Response(null, { status: 204 }));
    expect(res.write).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(2);
  });

  it("toNodeHandler answers 500 on a throwing handler, or calls onError", async () => {
    const url = await listen(
      createServer(
        toNodeHandler(() => {
          throw new Error("boom");
        }),
      ),
    );
    const res = await fetch(url);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Internal error: boom");
    const onError = vi.fn((_e: unknown, _req: unknown, r: { statusCode: number; end(): void }) => {
      r.statusCode = 418;
      r.end();
    });
    const custom = await listen(
      createServer(toNodeHandler(() => Promise.reject("x"), { onError })),
    );
    expect((await fetch(custom)).status).toBe(418);
    expect(onError).toHaveBeenCalledWith("x", expect.anything(), expect.anything());
  });
});

describe("express", () => {
  it("serves the panel under a mount path, before or after body parsers", async () => {
    const app = express();
    app.use("/raw", toExpressMiddleware(echo));
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use("/panel", toExpressMiddleware(echo));
    const url = await listen(createServer(app));
    const raw = await fetch(`${url}/raw/api?x=1`, { method: "POST", body: "untouched" });
    expect(await raw.json()).toMatchObject({ url: `${url}/raw/api?x=1`, body: "untouched" });
    const json = await fetch(`${url}/panel/api`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ b: 2, a: [1] }),
    });
    expect(await json.json()).toMatchObject({
      method: "PATCH",
      body: '{"b":2,"a":[1]}',
      length: null,
    });
    const form = await fetch(`${url}/panel/form`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1&b=2",
    });
    expect((await form.json()).body).toBe("a=1&b=2");
  });

  it("falls through on a chosen status and forwards errors to next()", async () => {
    const app = express();
    app.use(
      toExpressMiddleware(() => new Response("nf", { status: 404 }), { fallthroughStatus: 404 }),
    );
    app.use(
      "/boom",
      toExpressMiddleware(() => Promise.reject(new Error("bad"))),
    );
    app.get("/after", (_req, res) => void res.send("next route"));
    app.use(
      (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(503).send(`handled ${err.message}`);
      },
    );
    const url = await listen(createServer(app));
    expect(await (await fetch(`${url}/after`)).text()).toBe("next route");
    const boom = await fetch(`${url}/boom/x`);
    expect(boom.status).toBe(503);
    expect(await boom.text()).toBe("handled bad");
  });
});

describe("hono", () => {
  it("mounts a panel at the root or under a path", async () => {
    const root = mountPanel(new Hono(), echo);
    const res = await root.request("http://h/anything?q=1", { method: "DELETE" });
    expect(await res.json()).toMatchObject({ method: "DELETE", url: "http://h/anything?q=1" });
    const nested = mountPanel(new Hono(), echo, "/webhooks/");
    expect((await nested.request("http://h/webhooks")).status).toBe(200);
    expect((await nested.request("http://h/webhooks/api/x")).status).toBe(200);
    expect((await nested.request("http://h/other")).status).toBe(404);
    expect((await mountPanel(new Hono(), echo, "/*").request("http://h/a")).status).toBe(200);
    const handler = toHonoHandler(echo);
    expect((await handler({ req: { raw: new Request("http://h/") } })).status).toBe(200);
  });

  it("waitUntilOf calls waitUntil as a method and survives a throwing executionCtx", async () => {
    const calls: unknown[] = [];
    const ctx = {
      waitUntil(this: unknown, p: Promise<unknown>) {
        calls.push(this, p);
      },
    };
    const p = Promise.resolve();
    waitUntilOf({ req: { raw: new Request("http://h/") }, executionCtx: ctx })?.waitUntil(p);
    expect(calls).toEqual([ctx, p]);
    const throwing = {
      req: { raw: new Request("http://h/") },
      get executionCtx(): unknown {
        throw new Error("This context has no ExecutionContext");
      },
    };
    expect(waitUntilOf(throwing)).toBeUndefined();
    expect(
      waitUntilOf({ req: { raw: new Request("http://h/") }, executionCtx: {} }),
    ).toBeUndefined();
    // Real Hono under Node: executionCtx throws; waitUntilOf hides it.
    const app = new Hono().get("/", (c) => c.text(String(waitUntilOf(c))));
    expect(await (await app.request("http://h/")).text()).toBe("undefined");
  });
});

describe("bun / next", () => {
  it("toBunFetch passes the request through and ignores the server argument", async () => {
    const res = await toBunFetch(echo)(new Request("http://h/x"), { any: "server" });
    expect((await res.json()).url).toBe("http://h/x");
  });

  it("toNextHandler exports every method", async () => {
    const handlers = toNextHandler({ fetch: echo });
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const) {
      const res = await handlers[method](new Request("http://h/p", { method }), {});
      expect(res.status).toBe(200);
    }
  });
});

describe("elysia createPass (no Elysia)", () => {
  const consumed = async (init: RequestInit & { headers?: Record<string, string> }) => {
    const request = new Request("http://h/panel/api", init);
    await request.text(); // what Elysia's parser does
    return request;
  };
  const { pass, raw, plugin, prefix } = createPass({ prefix: "/panel", fetch: echo });

  it("plugin options carry seed: prefix (multi-mount)", () => {
    expect(prefix).toBe("/panel");
    expect(plugin).toEqual({ prefix: "/panel", name: "xtandard-panel", seed: "/panel" });
    expect(createPass({ prefix: "/b", fetch: echo, name: "xtandard-links" }).plugin.name).toBe(
      "xtandard-links",
    );
  });

  it("rebuilds POST/PUT/PATCH/DELETE bodies after Elysia drained the stream", async () => {
    // Regression: wh/fl/au dropped PATCH/DELETE bodies; wh/fl/li forwarded a stale content-length.
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const request = await consumed({
        method,
        headers: { "content-type": "application/json", "content-length": "999" },
        body: '{"a":1}',
      });
      const out = await (await pass({ request, body: { a: 1, b: "long" } })).json();
      expect(out).toMatchObject({
        method,
        body: '{"a":1,"b":"long"}',
        length: null,
        type: "application/json",
      });
    }
  });

  it("strings, bytes, urlencoded, FormData and non-JSON objects", async () => {
    const send = async (body: unknown, type: string) =>
      (
        await pass({
          request: await consumed({ method: "POST", headers: { "content-type": type }, body: "x" }),
          body,
        })
      ).json();
    expect(await send("name,url\na,b", "text/csv")).toMatchObject({
      body: "name,url\na,b",
      type: "text/csv",
    });
    expect(await send(new Uint8Array([104, 105]), "application/octet-stream")).toMatchObject({
      body: "hi",
    });
    expect(await send({ a: "1" }, "application/x-www-form-urlencoded")).toMatchObject({
      body: "a=1",
    });
    expect(await send({ a: 1 }, "text/plain")).toMatchObject({
      body: '{"a":1}',
      type: "application/json",
    });
    const form = new FormData();
    form.set("f", "v");
    const multipart = await send(form, "multipart/form-data; boundary=old");
    expect(multipart.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(multipart.type).not.toContain("boundary=old");
    expect(multipart.body).toContain('name="f"');
    expect((await send(undefined, "application/json")).body).toBe("");
    expect((await send("", "application/json")).body).toBe("");
  });

  it("forwards untouched requests as-is; raw never rebuilds", async () => {
    const intact = new Request("http://h/panel/api", { method: "POST", body: "signed" });
    expect((await (await pass({ request: intact, body: { ignored: true } })).json()).body).toBe(
      "signed",
    );
    expect((await (await pass({ request: new Request("http://h/panel/api") })).json()).method).toBe(
      "GET",
    );
    const signed = new Request("http://h/panel/intake", { method: "POST", body: "raw-bytes" });
    expect((await (await raw({ request: signed })).json()).body).toBe("raw-bytes");
  });
});
