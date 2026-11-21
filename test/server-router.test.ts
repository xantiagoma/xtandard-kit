import * as v from "valibot";
import { describe, expect, it, vi } from "vitest";
import type { AuthProvider } from "../src/auth/contract.ts";
import { defineActions } from "../src/authorization/contract.ts";
import { HookDeniedError } from "../src/hooks/contract.ts";
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
  noContent,
  requireOneOf,
} from "../src/server/http.ts";
import { buildOpenApiDocument, openApiOperation, toOpenApiPath } from "../src/server/openapi.ts";
import { createPanelHandler } from "../src/server/panel.ts";
import { createRouter, type Route } from "../src/server/router.ts";
import { createScopedTokens } from "../src/tokens/scoped.ts";
import { ValidationError } from "../src/util/validation.ts";

const req = (path: string, init: RequestInit = {}) => new Request(`http://host${path}`, init);

describe("http plumbing", () => {
  it("json / error / methodNotAllowed / noContent", async () => {
    const res = json({ a: 1 }, 201, { "x-a": "1" });
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("x-a")).toBe("1");
    expect(await error(400, "bad", { code: "X" }).json()).toEqual({ error: "bad", code: "X" });
    const nope = methodNotAllowed(["GET", "POST", "GET"]);
    expect(nope.status).toBe(405);
    expect(nope.headers.get("allow")).toBe("GET, POST");
    expect(noContent().status).toBe(204);
  });

  it("match decodes params and treats malformed % escapes as no match", () => {
    // Regression: wh/fl let decodeURIComponent's URIError escape → 500 on `/api/endpoints/%E0%A4%A`.
    expect(match("/api/items/:id", "/api/items/a%20b")).toEqual({ id: "a b" });
    expect(match("/api/items/:id", "/api/items/%E0%A4%A")).toBeNull();
    expect(match("/api/items/:id", "/api/items")).toBeNull();
    expect(match("/api/items", "/api/other")).toBeNull();
    expect(match("/", "/")).toEqual({});
  });

  it("intParam: throw (au/en) or ignore (wh/fl/li), positive or any integer", () => {
    expect(intParam(null)).toBeUndefined();
    expect(intParam("")).toBeUndefined();
    expect(intParam("10")).toBe(10);
    expect(intParam("2.7")).toBe(2);
    expect(() => intParam("abc", { name: "limit" })).toThrow(
      'Invalid query parameter limit: expected a positive integer, got "abc"',
    );
    expect(() => intParam("0")).toThrow(HttpError);
    expect(intParam("abc", { invalid: "ignore" })).toBeUndefined();
    expect(intParam("-3", { invalid: "ignore" })).toBeUndefined();
    expect(intParam("-3", { positive: false })).toBe(-3);
    expect(() => intParam("1.5", { positive: false })).toThrow("expected an integer");
  });

  it("requireOneOf: the panel's storage-or-core guard", () => {
    expect(() =>
      requireOneOf("createFetchHandler", { storage: {} }, ["storage", "core"]),
    ).not.toThrow();
    expect(() => requireOneOf("createFetchHandler", { core: null }, ["storage", "core"])).toThrow(
      "createFetchHandler requires either `storage` or `core`.",
    );
    expect(() => requireOneOf("x", {}, ["a", "b", "c"])).toThrow(
      "x requires either `a`, `b` or `c`.",
    );
    expect(() => requireOneOf("x", {}, ["catalog"])).toThrow("x requires `catalog`.");
  });
});

describe("mapError", () => {
  const body = async (res: Response) => ({ status: res.status, body: await res.json() });

  it("maps HttpError, the product's errors by name, and built-ins", async () => {
    class NotFoundError extends Error {
      override name = "NotFoundError";
    }
    const errors = {
      NotFoundError: { status: 404, code: "NOT_FOUND" },
      ConflictError: { status: 409, extra: (e: Error) => ({ detail: e.message.length }) },
      CsvParseError: (e: Error) => new Response(e.message, { status: 422 }),
    };
    expect(await body(mapError(new HttpError(418, "teapot", { a: 1 })))).toEqual({
      status: 418,
      body: { error: "teapot", a: 1 },
    });
    expect(await body(mapError(new NotFoundError("gone"), errors))).toEqual({
      status: 404,
      body: { error: "gone", code: "NOT_FOUND" },
    });
    // A copy of the class from another bundle: same name, different constructor.
    expect(mapError({ name: "NotFoundError", message: "foreign" }, errors).status).toBe(404);
    expect(
      await body(mapError(Object.assign(new Error("abc"), { name: "ConflictError" }), errors)),
    ).toEqual({
      status: 409,
      body: { error: "abc", detail: 3 },
    });
    const csv = mapError(Object.assign(new Error("bad csv"), { name: "CsvParseError" }), errors);
    expect(csv.status).toBe(422);
    expect(await csv.text()).toBe("bad csv");
  });

  it("built-ins: hook denial (any bundle), tokens, validation, JSON syntax, fallback 500", async () => {
    expect(await body(mapError(new HookDeniedError("frozen", { status: 423 })))).toEqual({
      status: 423,
      body: { error: "frozen", code: "HOOK_DENIED" },
    });
    expect(mapError(Object.assign(new Error("x"), { name: "HookDeniedError" })).status).toBe(403);
    const tokens = createScopedTokens({ prefix: "p_", ttl: 1, validateClaims: () => ({}) });
    expect(await body(mapError(new tokens.TokenError("expired")))).toEqual({
      status: 401,
      body: { error: "expired", code: "TOKEN" },
    });
    expect(mapError(Object.assign(new Error("x"), { name: "TokenError" })).status).toBe(401);
    // Products name their token errors; a copy from another bundle fails `instanceof` but still
    // maps to 401 by name (not 500).
    for (const name of ["PortalTokenError", "ViewerTokenError"]) {
      const foreign = { name, message: "Portal token has expired" };
      expect(await body(mapError(foreign))).toEqual({
        status: 401,
        body: { error: "Portal token has expired", code: "TOKEN" },
      });
    }
    expect(mapError(Object.assign(new Error("x"), { name: "Tokenizer" })).status).toBe(500);
    expect(
      await body(mapError(new ValidationError([{ path: "a", message: "bad" }]))),
    ).toMatchObject({
      status: 400,
      body: { code: "VALIDATION", errors: [{ path: "a", message: "bad" }] },
    });
    expect(
      (await body(mapError(Object.assign(new Error("v"), { name: "ValidationError" })))).body
        .errors,
    ).toEqual([]);
    expect(await body(mapError(new SyntaxError("Unexpected token")))).toEqual({
      status: 400,
      body: { error: "Invalid JSON body", code: "VALIDATION" },
    });
    expect(await body(mapError(new Error("db down")))).toEqual({
      status: 500,
      body: { error: "db down" },
    });
    expect(await body(mapError(new Error("")))).toEqual({
      status: 500,
      body: { error: "Internal error" },
    });
    expect(await body(mapError("string thrown"))).toEqual({
      status: 500,
      body: { error: "Internal error" },
    });
    // A product entry overrides a built-in.
    expect(mapError(new SyntaxError("x"), { SyntaxError: { status: 422 } }).status).toBe(422);
    expect(mapError(new Error("x"), { toString: { status: 499 } } as never).status).toBe(500);
  });
});

describe("authenticate / authorize", () => {
  const tokens = createScopedTokens({
    prefix: "whpt_",
    ttl: "1h",
    errorName: "PortalTokenError",
    validateClaims: (p) => ({ app: String(p.app) }),
  });
  const scoped = {
    prefix: tokens.prefix,
    verify: async (token: string) => (await tokens.verify("s", token)).claims,
    principal: (g: { app: string }) => ({ id: `portal:${g.app}` }),
  };
  const host: AuthProvider = {
    authenticate: vi.fn(async () => ({ id: "host-user", roles: ["admin"] })),
  };

  it("a scoped bearer token short-circuits the host provider", async () => {
    const token = await tokens.create("s", { app: "acme" });
    for (const scheme of ["Bearer", "bearer"]) {
      const who = await authenticate(
        req("/", { headers: { authorization: `${scheme} ${token}` } }),
        {
          auth: host,
          scoped,
        },
      );
      expect(who).toEqual({ principal: { id: "portal:acme" }, scoped: { app: "acme" } });
    }
    expect(host.authenticate).not.toHaveBeenCalled();
  });

  it("an invalid scoped token throws (401) and never falls back to the host's auth", async () => {
    const bad = req("/", { headers: { authorization: "Bearer whpt_forged.sig" } });
    const err = await authenticate(bad, { auth: host, scoped }).catch((e: unknown) => e);
    expect(mapError(err, { PortalTokenError: { status: 401, code: "PORTAL_TOKEN" } }).status).toBe(
      401,
    );
    expect(host.authenticate).not.toHaveBeenCalled();
  });

  it("other bearers and no scoped config go to the host provider", async () => {
    const other = req("/", { headers: { authorization: "Bearer host-jwt" } });
    expect((await authenticate(other, { auth: host, scoped })).principal?.id).toBe("host-user");
    const token = await tokens.create("s", { app: "acme" });
    const unconfigured = req("/", { headers: { authorization: `Bearer ${token}` } });
    expect((await authenticate(unconfigured, { auth: host })).scoped).toBeNull();
  });

  it("a throwing host provider propagates (→ 500), it is not 'unauthenticated'", async () => {
    // Regression (wh 543e1fa; fl lacked it): flags caught the throw and answered 401.
    const broken: AuthProvider = {
      authenticate: async () => {
        throw new Error("IdP down");
      },
    };
    const err = await authenticate(req("/"), { auth: broken }).catch((e: unknown) => e);
    expect(err).toEqual(new Error("IdP down"));
    expect(mapError(err).status).toBe(500);
  });

  it("authorize never consults the host provider for scoped principals", async () => {
    const authorization = { authorize: vi.fn(async () => true) };
    const input = { action: "endpoint:write", resource: { app: "acme" }, request: req("/") };
    const scopedWho = { principal: { id: "portal:acme" }, scoped: { app: "acme" } };
    expect(await authorize(scopedWho, input, { authorization })).toBe(false);
    expect(
      await authorize(scopedWho, input, {
        authorization,
        scope: (g, _a, r: { app: string }) => g.app === r.app,
      }),
    ).toBe(true);
    expect(authorization.authorize).not.toHaveBeenCalled();
    expect(
      await authorize({ principal: { id: "u" }, scoped: null }, input, { authorization }),
    ).toBe(true);
    expect(authorization.authorize).toHaveBeenCalledWith({ principal: { id: "u" }, ...input });
  });
});

// --- The declarative router ---------------------------------------------------------------

const actions = defineActions({
  all: ["item:read", "item:write", "portal:read"],
  mutating: ["item:write"],
  portal: ["portal:read"],
});
type Action = (typeof actions.ALL_ACTIONS)[number];
type Resource = { type: "item"; id?: string; tenant?: string };
type Grant = { tenant: string };
type Ctx = { items: Map<string, { id: string; name: string }> };

const itemSchema = v.strictObject({ name: v.pipe(v.string(), v.minLength(1)) });

const ROUTES: Route<Action, Resource, Ctx, Grant>[] = [
  {
    method: "GET",
    path: "/config",
    operationId: "getConfig",
    summary: "Bootstrap",
    tag: "panel",
    authenticate: true,
    response: { status: 200, schema: { type: "object" }, description: "Config" },
    handle: (c) => json({ principal: c.principal?.id ?? null, scoped: c.scoped }),
  },
  {
    method: "GET",
    path: "/api/items",
    operationId: "listItems",
    summary: "List items",
    tag: "items",
    action: "item:read",
    query: [{ name: "limit", type: "integer", description: "Page size" }],
    resource: () => ({ type: "item" }),
    response: { status: 200, schema: "ItemList", description: "Items" },
    handle: (c) => {
      const limit = intParam(c.query.get("limit"), { name: "limit" });
      return json({ items: [...c.ctx.items.values()].slice(0, limit) });
    },
  },
  {
    method: "POST",
    path: "/api/items",
    operationId: "createItem",
    summary: "Create an item",
    tag: "items",
    action: "item:write",
    body: "ItemInput",
    resource: () => ({ type: "item" }),
    response: { status: 201, schema: "Item", description: "Created" },
    async handle(c) {
      const input = await c.body(itemSchema);
      const again = await c.body(itemSchema); // memoized: the stream is read once
      const item = { id: `i${c.ctx.items.size + 1}`, name: again.name || input.name };
      c.ctx.items.set(item.id, item);
      return json(item, 201);
    },
  },
  {
    method: "DELETE",
    path: "/api/items/:id",
    operationId: "deleteItem",
    summary: "Delete an item",
    tag: "items",
    action: "item:write",
    resource: (c) => ({ type: "item", id: c.params.id as string }),
    response: { status: 204, description: "Deleted" },
    handle(c) {
      if (!c.ctx.items.delete(c.params.id as string)) {
        throw Object.assign(new Error(`No item ${c.params.id}`), { name: "NotFoundError" });
      }
      return noContent();
    },
  },
  {
    method: "GET",
    path: "/api/portal/:tenant",
    operationId: "portal",
    summary: "Portal view",
    tag: "portal",
    action: "portal:read",
    resource: (c) => ({ type: "item", tenant: c.params.tenant as string }),
    response: { status: 200, description: "Portal" },
    handle: (c) => json({ tenant: c.params.tenant, via: c.scoped ? "token" : "host" }),
  },
  {
    method: "GET",
    path: "/api/boom",
    operationId: "boom",
    summary: "Throws",
    tag: "items",
    hidden: true,
    response: { status: 200, description: "never" },
    handle: () => {
      throw new HookDeniedError("frozen", { status: 409 });
    },
  },
];

describe("createRouter", () => {
  const tokens = createScopedTokens({
    prefix: "tok_",
    ttl: "1h",
    errorName: "PortalTokenError",
    validateClaims: (p) => ({ tenant: String(p.tenant) }),
  });
  const basic = (user: string) => ({ authorization: `Basic ${btoa(`${user}:pw`)}` });
  const auth: AuthProvider = {
    authenticate: async (r) => {
      const h = r.headers.get("authorization");
      if (!h?.startsWith("Basic ")) return null;
      const user = atob(h.slice(6)).split(":")[0] as string;
      return { id: user, roles: [user] };
    },
  };
  const make = (
    overrides: Partial<Parameters<typeof createRouter<Action, Resource, Ctx, Grant>>[0]> = {},
  ) => {
    const ctx: Ctx = { items: new Map([["i0", { id: "i0", name: "first" }]]) };
    const authorization = {
      authorize: vi.fn(
        async ({ principal, action }: { principal: { roles?: string[] } | null; action: Action }) =>
          principal?.roles?.includes("admin") === true || action === "item:read",
      ),
    };
    const router = createRouter<Action, Resource, Ctx, Grant>({
      routes: ROUTES,
      context: ctx,
      auth,
      authorization,
      isMutatingAction: actions.isMutatingAction,
      scoped: {
        prefix: tokens.prefix,
        verify: async (t) => (await tokens.verify("s", t)).claims,
        principal: (g) => ({ id: `portal:${g.tenant}` }),
        allows: (g, action, resource) => action === "portal:read" && resource.tenant === g.tenant,
      },
      errors: {
        NotFoundError: { status: 404, code: "NOT_FOUND" },
        PortalTokenError: { status: 401, code: "PORTAL_TOKEN" },
      },
      ...overrides,
    });
    return { router, ctx, authorization };
  };

  it("dispatches, authenticates and authorizes", async () => {
    const { router } = make();
    const list = await router.handle(
      req("/api/items?limit=5", { headers: basic("viewer") }),
      "/api/items",
    );
    expect(list?.status).toBe(200);
    expect(await list?.json()).toEqual({ items: [{ id: "i0", name: "first" }] });
    const head = await router.handle(
      req("/api/items", { method: "HEAD", headers: basic("viewer") }),
      "/api/items",
    );
    expect(head?.status).toBe(200);
    const denied = await router.handle(
      req("/api/items", { method: "POST", headers: basic("viewer"), body: '{"name":"x"}' }),
      "/api/items",
    );
    expect(denied?.status).toBe(403);
    expect(await denied?.json()).toEqual({ error: "Forbidden", action: "item:write" });
    const created = await router.handle(
      req("/api/items", { method: "POST", headers: basic("admin"), body: '{"name":"x"}' }),
      "/api/items",
    );
    expect(created?.status).toBe(201);
  });

  it("401 (or the provider's challenge) for anonymous requests to protected routes", async () => {
    const { router } = make();
    const res = await router.handle(req("/api/items"), "/api/items");
    expect(res?.status).toBe(401);
    const challenging = make({
      auth: {
        ...auth,
        challenge: () =>
          new Response("login", { status: 401, headers: { "www-authenticate": "Basic" } }),
      },
    });
    const challenged = await challenging.router.handle(req("/api/items"), "/api/items");
    expect(challenged?.headers.get("www-authenticate")).toBe("Basic");
  });

  it("405 + Allow for a known path with the wrong method; 404 JSON under /api/; null elsewhere", async () => {
    // Regression: only entitlements answered 405 with `Allow`; li sent 405 without it, others 404.
    const { router } = make();
    const res = await router.handle(req("/api/items", { method: "PUT" }), "/api/items");
    expect(res?.status).toBe(405);
    expect(res?.headers.get("allow")).toBe("GET, HEAD, POST");
    const missing = await router.handle(req("/api/nope"), "/api/nope");
    expect(missing?.status).toBe(404);
    expect(await missing?.json()).toEqual({ error: "Not found" });
    expect(await router.handle(req("/deliveries"), "/deliveries")).toBeNull();
    // A malformed escape in a path param is a 404, not a 500.
    expect(
      (await router.handle(req("/api/items/%E0%A4%A", { method: "DELETE" }), "/api/items/%E0%A4%A"))
        ?.status,
    ).toBe(404);
  });

  it("readonlyMessage can name the route (entitlements: 'Cannot <operationId>: … readonly')", async () => {
    const { router } = make({
      readonly: true,
      readonlyStatus: 423,
      readonlyMessage: (route) => `Cannot ${route.operationId}: the panel is in readonly mode.`,
    });
    const res = await router.handle(
      req("/api/items", { method: "POST", headers: basic("admin"), body: '{"name":"x"}' }),
      "/api/items",
    );
    expect(res?.status).toBe(423);
    expect(((await res!.json()) as { error: string }).error).toMatch(
      /^Cannot \w+: the panel is in readonly mode\.$/,
    );
  });

  it("readonly blocks mutating actions with the product's status (403 or 423)", async () => {
    const fixed = make({ readonly: true, readonlyStatus: 423 });
    const res = await fixed.router.handle(
      req("/api/items", { method: "POST", headers: basic("admin"), body: '{"name":"x"}' }),
      "/api/items",
    );
    expect(res?.status).toBe(423);
    expect(await res?.json()).toEqual({ error: "The panel is readonly", code: "READONLY" });
    let ro = false;
    const dynamic = make({ readonly: () => ro, readonlyMessage: "frozen" });
    const del = () =>
      dynamic.router.handle(
        req("/api/items/i0", { method: "DELETE", headers: basic("admin") }),
        "/api/items/i0",
      );
    ro = true;
    expect((await del())?.status).toBe(403);
    ro = false;
    expect((await del())?.status).toBe(204);
    expect((await del())?.status).toBe(404);
    const reads = await fixed.router.handle(
      req("/api/items", { headers: basic("viewer") }),
      "/api/items",
    );
    expect(reads?.status).toBe(200);
  });

  it("validates bodies: invalid JSON, schema issues, empty body = {}", async () => {
    const { router } = make();
    const post = (body: string) =>
      router.handle(
        req("/api/items", { method: "POST", headers: basic("admin"), body }),
        "/api/items",
      );
    const badJson = await post("{nope");
    expect(badJson?.status).toBe(400);
    expect(await badJson?.json()).toEqual({ error: "Invalid JSON body", code: "VALIDATION" });
    const invalid = await post('{"name":"","extra":1}');
    expect(invalid?.status).toBe(400);
    expect((await invalid!.json()).errors).toEqual([
      { path: "name", message: expect.any(String) },
      { path: "extra", message: "unknown field" },
    ]);
    const empty = await post("  ");
    expect((await empty!.json()).errors[0].path).toBe("name");
    class InputValidationError extends Error {
      override name = "InputValidationError";
    }
    const custom = make({
      validationError: (issues) => new InputValidationError(issues[0]?.path ?? ""),
      errors: { InputValidationError: { status: 422 } },
    });
    const res = await custom.router.handle(
      req("/api/items", { method: "POST", headers: basic("admin"), body: "{}" }),
      "/api/items",
    );
    expect(res?.status).toBe(422);
  });

  it("scoped tokens reach only what `allows` grants; the host provider is never consulted", async () => {
    const { router, authorization } = make();
    const token = await tokens.create("s", { tenant: "acme" });
    const bearer = { authorization: `Bearer ${token}` };
    const own = await router.handle(
      req("/api/portal/acme", { headers: bearer }),
      "/api/portal/acme",
    );
    expect(await own?.json()).toEqual({ tenant: "acme", via: "token" });
    expect(
      (await router.handle(req("/api/portal/other", { headers: bearer }), "/api/portal/other"))
        ?.status,
    ).toBe(403);
    expect(
      (await router.handle(req("/api/items", { headers: bearer }), "/api/items"))?.status,
    ).toBe(403);
    expect(authorization.authorize).not.toHaveBeenCalled();
    const forged = await router.handle(
      req("/api/items", { headers: { authorization: "Bearer tok_x.y" } }),
      "/api/items",
    );
    expect(forged?.status).toBe(401);
    expect(await forged?.json()).toMatchObject({ code: "PORTAL_TOKEN" });
    // Without `scoped`, the token is just an unknown host credential.
    const plain = make({ scoped: undefined as never });
    expect(
      (await plain.router.handle(req("/api/portal/acme", { headers: bearer }), "/api/portal/acme"))
        ?.status,
    ).toBe(401);
  });

  it("public routes skip auth unless they opt in; errors map through mapError", async () => {
    const { router } = make();
    const token = await tokens.create("s", { tenant: "acme" });
    const anon = await router.handle(req("/config"), "/config");
    expect(await anon?.json()).toEqual({ principal: null, scoped: null });
    const scopedConfig = await router.handle(
      req("/config", { headers: { authorization: `Bearer ${token}` } }),
      "/config",
    );
    expect(await scopedConfig?.json()).toEqual({
      principal: "portal:acme",
      scoped: { tenant: "acme" },
    });
    const boom = await router.handle(req("/api/boom"), "/api/boom");
    expect(boom?.status).toBe(409);
    expect(await boom?.json()).toEqual({ error: "frozen", code: "HOOK_DENIED" });
    const badLimit = await router.handle(
      req("/api/items?limit=x", { headers: basic("viewer") }),
      "/api/items",
    );
    expect(badLimit?.status).toBe(400);
  });

  it("requires resource() on routes with an action", () => {
    const { resource: _r, ...noResource } = ROUTES[1] as Route<Action, Resource, Ctx, Grant>;
    expect(() => make({ routes: [noResource] })).toThrow(
      "route listItems has an action but no resource()",
    );
  });

  it("plugs into the panel and the generated OpenAPI document", async () => {
    const { router } = make({ apiPrefix: "/v1/" });
    const panel = createPanelHandler({
      title: "T",
      globalName: "__T__",
      basePath: "/p",
      api: router.handle,
      openapi: () =>
        buildOpenApiDocument({ routes: router.routes, title: "T", version: "1", basePath: "/p" }),
    });
    expect((await panel.fetch(req("/p/api/items", { headers: basic("viewer") }))).status).toBe(200);
    expect((await panel.fetch(req("/p/api/nope"))).headers.get("content-type")).toContain(
      "text/html",
    );
    const doc = (await (await panel.fetch(req("/p/api/openapi.json"))).json()) as { paths: object };
    expect(Object.keys(doc.paths)).toEqual([
      "/config",
      "/api/items",
      "/api/items/{id}",
      "/api/portal/{tenant}",
    ]);
  });
});

describe("buildOpenApiDocument", () => {
  it("derives operations, parameters, bodies and standard errors from the route table", () => {
    const doc = buildOpenApiDocument({
      routes: ROUTES,
      title: "@xtandard/kit test",
      version: "1.4.0",
      description: "Test API",
      basePath: "/panel",
      tags: [{ name: "items", description: "Items" }],
      schemas: { Item: { type: "object" } },
      bearerDescription: "Portal tokens (tok_…)",
      isMutatingAction: actions.isMutatingAction,
      readonlyStatus: 423,
    }) as Record<string, any>;
    // Regression: wh/fl/au hard-coded info.version "0.1.0" whatever the package version.
    expect(doc.info).toEqual({
      title: "@xtandard/kit test",
      version: "1.4.0",
      description: "Test API",
    });
    expect(doc.servers).toEqual([{ url: "/panel" }]);
    expect(doc.tags).toEqual([{ name: "items", description: "Items" }]);
    expect(doc.paths["/api/boom"]).toBeUndefined();
    const list = doc.paths["/api/items"].get;
    expect(list["x-action"]).toBe("item:read");
    expect(list.parameters).toEqual([
      {
        name: "limit",
        in: "query",
        required: false,
        description: "Page size",
        schema: { type: "integer" },
      },
    ]);
    expect(Object.keys(list.responses).sort()).toEqual(["200", "400", "401", "403"]);
    expect(list.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/ItemList",
    });
    const create = doc.paths["/api/items"].post;
    expect(create.requestBody).toEqual({
      required: true,
      content: { "application/json": { schema: { $ref: "#/components/schemas/ItemInput" } } },
    });
    expect(create.responses["423"].description).toBe("The panel is readonly");
    const del = doc.paths["/api/items/{id}"].delete;
    expect(del.parameters[0]).toEqual({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string" },
    });
    expect(del.responses["204"]).toEqual({ description: "Deleted" });
    expect(del.responses["404"]).toBeDefined();
    expect(doc.paths["/config"].get.security).toEqual([]);
    expect(doc.paths["/config"].get.responses["200"].content["application/json"].schema).toEqual({
      type: "object",
    });
    expect(doc.components.schemas.Error).toBeDefined();
    expect(doc.components.schemas.Item).toEqual({ type: "object" });
    expect(doc.components.securitySchemes.bearerAuth.description).toBe("Portal tokens (tok_…)");
  });

  it("defaults, the operation hook, extra fields and the version guard", () => {
    const doc = buildOpenApiDocument({
      routes: [ROUTES[3] as Route<Action, Resource, Ctx, Grant>],
      title: "T",
      version: "1",
      isMutatingAction: actions.isMutatingAction,
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-key" } },
      operation: (spec, op) => ({ ...op, "x-op": spec.operationId }),
      extra: { "x-generated": true },
    }) as Record<string, any>;
    expect(doc.servers).toEqual([{ url: "/" }]);
    expect(doc.tags).toBeUndefined();
    expect(doc["x-generated"]).toBe(true);
    expect(doc.components.securitySchemes).toEqual({
      apiKey: { type: "apiKey", in: "header", name: "x-key" },
    });
    const del = doc.paths["/api/items/{id}"].delete;
    expect(del["x-op"]).toBe("deleteItem");
    expect(del.responses["403"].description).toBe(
      "Not authorized for this action, or the panel is readonly",
    );
    expect(() => buildOpenApiDocument({ routes: [], title: "T", version: "" })).toThrow(
      "a version is required",
    );
    expect(buildOpenApiDocument({ routes: [], title: "T", version: "1" }).components).toMatchObject(
      {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      },
    );
  });

  it("toOpenApiPath and openApiOperation", () => {
    expect(toOpenApiPath("/a/:app_key/b/:id2")).toBe("/a/{app_key}/b/{id2}");
    const op = openApiOperation({
      method: "GET",
      path: "/x",
      operationId: "x",
      summary: "X",
      tag: "t",
      query: [{ name: "q", type: "string", description: "Q", required: true }],
      response: { status: 200, description: "ok" },
    });
    expect(op).toMatchObject({ security: [], parameters: [{ name: "q", required: true }] });
    expect(Object.keys(op.responses as object)).toEqual(["200", "400"]);
  });
});
