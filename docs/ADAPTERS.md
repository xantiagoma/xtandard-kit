# Adapters

A panel is one web-standard `fetch(request) → Response` (`docs/SERVER.md`). Adapters connect it to
a framework. None of them imports its framework at runtime: Express, Hono and Elysia are type-only
peers, and the app is passed in. Products wrap these in their `xprodPanel` / `xprodElysia`
helpers, and keep their extras: audit's context, links' redirect, entitlements' guards.

## Bun — `@xtandard/kit/adapters/bun`

```ts
import { toBunFetch } from "@xtandard/kit/adapters/bun";

Bun.serve({ port: 3000, fetch: toBunFetch(panel.fetch) });
```

A passthrough. Bun serves `Request` → `Response` natively.

## Node — `@xtandard/kit/adapters/node`

This is the one Fetch ↔ Node bridge. The Express adapter and the CLI's Node server both use it.

```ts
import { createServer } from "node:http";
import { toNodeHandler } from "@xtandard/kit/adapters/node";

createServer(toNodeHandler(panel.fetch)).listen(3000);
```

It also exports `toWebRequest(req, { lazyBody, origin })` and `writeWebResponse(res, response)`
for custom servers.

| Behaviour                                                        | Before (per copy)                          |
| ---------------------------------------------------------------- | ------------------------------------------ |
| Multi-value request headers appended one by one                  | joined into `"a, b"` in wh/fl/au/en        |
| Pre-parsed bodies re-serialised: JSON, string, bytes, urlencoded | JSON/string only (wh/fl/au)                |
| Re-serialised body: stale `content-length` dropped               | —                                          |
| Every `Set-Cookie` kept (`getSetCookie`)                         | collapsed into one in wh/fl/au/en          |
| Response streamed with backpressure (`drain`)                    | buffered in wh/li/en; SSE-only in fl's CLI |
| Body cancelled when the client disconnects                       | au's Express adapter only                  |
| `HEAD` answered without a body                                   | —                                          |

`lazyBody: true` streams the request body to the handler only when the handler reads it. Later
middleware then still sees an untouched stream, which is links' redirect pattern.

## Express — `@xtandard/kit/adapters/express`

```ts
import express from "express";
import { toExpressMiddleware } from "@xtandard/kit/adapters/express";

const app = express();
app.use(express.json()); // before or after: parsed bodies are re-serialised
app.use("/webhooks", toExpressMiddleware(panel.fetch)); // panel basePath: "/webhooks"
```

- The panel sees `req.originalUrl`, so its `basePath` must be the mount path.
- Errors go to `next(error)`.
- With `fallthroughStatus: 404`, a 404 from the panel calls `next()`, so routes mounted after it
  still run.

## Hono — `@xtandard/kit/adapters/hono`

```ts
import { Hono } from "hono";
import { mountPanel, waitUntilOf } from "@xtandard/kit/adapters/hono";

const app = mountPanel(new Hono(), panel.fetch); // every path and method
mountPanel(app, other.fetch, "/other"); // "/other" and "/other/*"

app.get("/r/:slug", (c) => redirect(c.req.raw, waitUntilOf(c)));
```

`waitUntilOf(c)` returns the Workers `waitUntil`, bound and called as a method (li bf20268), or
`undefined` on Bun and Node. On those runtimes, Hono's `c.executionCtx` getter throws.

## Next.js — `@xtandard/kit/adapters/next`

```ts
// app/webhooks/[[...path]]/route.ts
import { toNextHandler } from "@xtandard/kit/adapters/next";

export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = toNextHandler(panel);
```

Build the panel once at module scope, with `basePath` set to the route's mount. This is
entitlements' design; links' `linksRouteHandlers` becomes a thin alias.

## Elysia — `@xtandard/kit/adapters/elysia`

Eden's type inference needs literal route chains, so each product keeps its typed chain. Every
declared route delegates to `createPass`:

```ts
import { Elysia, t } from "elysia";
import { createPass } from "@xtandard/kit/adapters/elysia";

const { pass, raw, plugin } = createPass({
  prefix: "/links",
  fetch: panel.fetch,
  name: "xtandard-links",
});

// Elysia 1.x: (path, handler, hook)
new Elysia(plugin)
  .post("/api/links", pass, { body: t.Object({ url: t.String() }) })
  .post("/api/import", pass, { body: t.String() }) // CSV passes through as a string
  .post("/intake/:provider", raw, { parse: "none" }) // signature over the untouched body
  .all("/*", pass);

// Elysia 2.x: (path, hook, handler)
new Elysia(plugin).post("/api/links", { body: t.Object({ url: t.String() }) }, pass);
```

Elysia parses the body of declared routes and drains the stream. `pass` rebuilds the request before
delegating. The rules combine the copies:

- **Methods:** `POST`, `PUT`, `PATCH` and `DELETE` (links). wh/fl/au dropped `PATCH`/`DELETE`
  bodies.
- **When:** only if the stream was consumed (`bodyUsed`, from audit). An untouched request is
  forwarded as-is.
- **`content-length`:** dropped (au/en); wh/fl/li forwarded a stale one.
- **Body:**
  - strings pass through, for CSV imports (au/li);
  - bytes stay bytes;
  - `FormData` stays multipart, with a new boundary;
  - urlencoded objects are re-encoded;
  - anything else becomes JSON, with a JSON content type.
- **`raw`:** forwards the untouched request (en), for `parse: "none"` routes.
- **`plugin`** is `{ prefix, name, seed: prefix }`. Two mounts with different prefixes are then not
  deduplicated by Elysia's plugin `name` (links).

The kit tests run against both Elysia 1 and Elysia 2 (`test/server.elysia2.test.ts`).
