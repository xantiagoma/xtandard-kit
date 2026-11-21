# Server

The HTTP side of a panel. Each product's `createFetchHandler` is a thin wrapper over these pieces:

- `@xtandard/kit/server`: the panel handler, `index.html`, base path, CORS and the API plumbing.
- `@xtandard/kit/server/router`: an optional declarative router plus an OpenAPI generator.

Everything is web-standard (`Request` → `Response`), so the same handler runs under Bun, Node (via
`@xtandard/kit/adapters/node`), Hono, Elysia, Express, Next.js and Workers.

## The panel — `createPanelHandler`

```ts
import { createPanelHandler, intervalTask, requireOneOf, resolveUiDir } from "@xtandard/kit/server";

export function createFetchHandler(options: WebhooksPanelOptions) {
  requireOneOf("createFetchHandler", options, ["storage", "core"]); // product guard
  const panel = createPanelHandler({
    basePath: options.basePath, // "/webhooks" → everything below is relative to it
    title: options.title ?? "@xtandard/webhooks",
    logoUrl: options.logoUrl,
    readonly: options.readonly,
    globalName: "__WEBHOOKS_CONFIG__", // the SPA's bootstrap global
    uiDir: options.uiDir ?? resolveUiDir(import.meta.url), // the product's dist/ui
    cors: options.cors,
    api: (request, path) => handleApiRequest(request, path, ctx), // product routes
    bootstrap: () => ({ version: VERSION }), // extra bootstrap fields
    openapi: () => buildOpenApiDocument({ … }),
    tasks: [intervalTask("1m", () => core.sweep(), { source: "@xtandard/webhooks" })],
  });
  return { fetch: panel.fetch, close: panel.close, core };
}
```

Request flow:

| Step | Request                                    | Response                                                       |
| ---- | ------------------------------------------ | -------------------------------------------------------------- |
| 1    | `OPTIONS` (with `cors`)                    | preflight `204`                                                |
| 2    | `GET /healthcheck`                         | `{ ok: true }`, inside the panel (`healthcheck: false` off)    |
| 3    | anything                                   | the product's `api(request, path)`, unless it returns `null`   |
| 4    | `GET /api/openapi.json`, `/openapi.json`   | `openapi()` (public)                                           |
| 5    | any other method                           | `405`, `Allow: GET, HEAD`                                      |
| 6    | a file in `uiDir`                          | the file; `assets/*` are cached immutable, the rest `no-cache` |
| 7    | a missing path with an extension (`/x.js`) | `404` (not masked by the SPA)                                  |
| 8    | anything else                              | the SPA `index.html`, `cache-control: no-cache`                |

- `close()` stops every task, once, and is safe to call repeatedly.
- `intervalTask(every, run)` is an `unref`'d timer. A run that rejects is reported, never thrown.
- Only links had steps 2 and 8 before; every panel now has them. An embedded panel gets a
  healthcheck, and an upgrade never serves a stale `index.html` that points at deleted hashed
  assets.

### UI directory and Workers

`resolveUiDir(import.meta.url)` finds the product's built SPA (fl 7475369):

- `./ui` next to the compiled chunk, for npm consumers;
- `<repo>/dist/ui` when running from source.

`node:fs` and `node:path` are loaded lazily, and only when a file is served. On a runtime without
them (Workers without `nodejs_compat`), `resolveUiDir` returns `undefined`. The panel then serves
the API and a small fallback page.

On Node 20.0–20.15, which lacks `process.getBuiltinModule`, `resolveUiDir` cannot check which
directory exists, so it assumes the compiled layout (`./ui`, the npm case). Running from source on
those versions needs an explicit `uiDir`.

## `renderIndexHtml`

```ts
await renderIndexHtml(uiDir, {
  globalName: "__WEBHOOKS_CONFIG__",
  config: { title, basePath, readonly },
});
```

It injects `<base href="<basePath>/">` and `window.<globalName> = <config>` into the built
`index.html`, or into a fallback page when there is none. Everything operator-controlled is escaped:

- the title (HTML);
- the base href (attribute);
- the JSON (`<`, `>`, U+2028/U+2029).

`$` sequences in the config are kept verbatim. Before, only links escaped the base href and U+2028,
and webhooks, flags and audit wrote the title raw.

## API plumbing

For products that keep a hand-written router:

```ts
import {
  authenticate,
  authorize,
  error,
  HttpError,
  intParam,
  json,
  mapError,
  match,
  methodNotAllowed,
} from "@xtandard/kit/server";
```

- `json(data, status?, headers?)`, `error(status, message, extra?)` → `{ error, ...extra }`,
  `methodNotAllowed(allow)` (sets `Allow`), `noContent()`.
- `HttpError(status, message, extra)` short-circuits from inside a handler.
- `match("/api/items/:id", path)` → decoded params or `null`. **A malformed `%` escape is no
  match (404), never a `URIError` (500).**
- `intParam(value, { invalid, positive, name })`: `invalid: "throw"` (400; audit, entitlements) or
  `"ignore"` (webhooks, flags, links). This is part of each product's HTTP contract (ADR 0010).
- `requireOneOf(caller, options, ["storage", "core"])` is the "requires storage or core" guard.

### Errors — `mapError(err, errors)`

```ts
mapError(err, {
  NotFoundError: { status: 404, code: "NOT_FOUND" },
  PortalTokenError: { status: 401, code: "PORTAL_TOKEN" },
  ReadonlyError: { status: 423, code: "READONLY" },
  ValidationError: { status: 400, code: "VALIDATION", extra: (e) => ({ errors: e.errors }) },
  CsvParseError: (e) => error(400, e.message, { code: "BAD_CSV" }),
});
```

- Errors are mapped **by name**, so a class copy from another bundle still maps. flags used
  `instanceof`, which turned those errors into 500s.
- Built-ins, each overridable by an entry with the same name:
  - `HttpError`;
  - `HookDeniedError` from any bundle → its status, `HOOK_DENIED`;
  - a kit `TokenError`, or any error named `*TokenError` (`PortalTokenError`, `ViewerTokenError`,
    also from another bundle) → 401 `TOKEN`;
  - `ValidationError` → 400 with `errors`;
  - `SyntaxError` → 400 "Invalid JSON body".
- Anything else → 500 with the error's message.

### Authentication — `authenticate(request, { auth, scoped })`

```ts
const who = await authenticate(request, {
  auth, // the host's AuthProvider
  scoped: {
    prefix: "whpt_",
    verify: async (token) => (await portalTokens.verify(secret, token)).claims,
    principal: (grant) => ({ id: `portal:${grant.app}`, metadata: { portal: true } }),
  },
});
// who = { principal, scoped: grant | null }
```

- A `Bearer <prefix>…` header takes the scoped lane:
  - a valid token yields the scoped principal;
  - an invalid or expired token **throws** (→ 401), and never falls back to the host's auth.
- Otherwise the host provider runs. **A provider that throws propagates as a 500**; it is not
  turned into 401 (wh 543e1fa; flags lacked it).

### Authorization — `authorize(who, { action, resource, request }, { authorization, scope })`

A scoped principal is decided by `scope(grant, action, resource)` alone. **The host provider is
never consulted for it**, and without `scope` it is denied. Everyone else goes to the host's
`AuthorizationProvider`.

## The declarative router — `@xtandard/kit/server/router`

This is entitlements' design. One route table drives dispatch, authentication, authorization, the
readonly switch, `405` + `Allow`, body validation and the OpenAPI document, so the router and its
docs can't drift. Adopting it is optional.

```ts
import { buildOpenApiDocument, createRouter, type Route } from "@xtandard/kit/server/router";

const ROUTES: Route<Action, Resource, Ctx, Grant>[] = [
  {
    method: "POST",
    path: "/api/endpoints",
    operationId: "createEndpoint",
    summary: "Create an endpoint",
    tag: "endpoints",
    action: "endpoint:write", // absent = public
    body: "EndpointInput", // component schema name (OpenAPI)
    resource: (c) => ({ type: "endpoint", app: c.query.get("app") ?? undefined }),
    response: { status: 201, schema: "Endpoint", description: "Created" },
    handle: async (c) => json(await c.ctx.core.upsertEndpoint(await c.body(endpointSchema)), 201),
  },
];

const router = createRouter({
  routes: ROUTES,
  context: { core },
  auth,
  authorization,
  scoped: { ...scopedAuth, allows: (grant, action, resource) => grant.app === resource.app },
  isMutatingAction,
  readonly: options.readonly, // or () => core.readonly
  readonlyStatus: 403, // 403 wh/fl/li, 423 au/en (ADR 0010)
  readonlyMessage: (route) => `Cannot ${route.operationId}: the panel is readonly.`, // or a string
  errors: ERROR_MAP,
});
createPanelHandler({ …, api: router.handle });
```

For each request:

1. Match the path, collecting the methods it supports (`HEAD` is served by `GET`). A wrong method
   gets `405` with `Allow`; an unknown path under `/api/` gets a JSON `404`; anything else gets
   `null`.
2. Authenticate, for routes with an `action` or with `authenticate: true` (e.g. `/config`).
3. Answer `401`, or the provider's `challenge()`, when there is no principal.
4. Resolve the route's `resource(call)`.
5. Authorize, then apply readonly to mutating actions (`readonlyStatus`, `code: "READONLY"`).
6. Run the handler.

- `call.body(schema)` parses the JSON body once and validates it with valibot. An empty body is
  `{}`, and invalid JSON is a 400.
- Every thrown error goes through `mapError(err, errors)`.

### OpenAPI

```ts
buildOpenApiDocument({
  routes: router.routes,
  title,
  version: VERSION, // required: the copies hard-coded "0.1.0"
  basePath,
  tags,
  schemas, // components.schemas
  bearerDescription: "Portal tokens (whpt_…)",
  isMutatingAction,
  readonlyStatus: 403,
  operation: (spec, op) => op, // per-operation hook
});
```

Each operation gets:

- path and query parameters, `requestBody` from `body`, and the success response;
- `400` when the route has a body or query parameters;
- `401`/`403` for routes with an action, plus the readonly status for mutating actions;
- `404` when the path has parameters;
- `x-action`, or `security: []` for public routes.

Routes with `hidden: true` are left out.
