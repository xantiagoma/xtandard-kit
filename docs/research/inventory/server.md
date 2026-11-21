# Inventory — SERVER SIDE (minus storage)

Scope: `src/auth/*`, `src/authorization/*`, `src/hooks/*`, `src/adapters/*`, `src/server/*`, `src/portal.ts`,
`src/cli.ts`, `src/testing.ts`, small utils (`id`, `duration`, `canonical`, `validation`, `version`, `schema`),
`src/index.ts` + server-side `entry-*.ts`, `bin/`, `apps/standalone`, and their tests.

Method: every file normalised (product name → `xprod`, `{@link` protected) and diffed against webhooks; fix commits
from `fixes.txt` verified by reading the current code in all five repos. Repo names abbreviated
**wh** webhooks · **fl** flags · **au** audit · **li** links · **en** entitlements. LOC = `wc -l` (matrix.tsv).
`xtandard-audit-parking` (a stale copy of webhooks living next to the repos) was ignored.

---

## 0. Summary — what the kit builds once

| Kit module                                                                            | From                                              | Status                                       | Seam(s) the kit needs                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| `auth/{contract,basic,none,delegated}`                                                | any (identical)                                   | identical modulo names                       | default `realm` (`xtandard-<product>`)                                  |
| `authorization/{none,delegated}`                                                      | any                                               | identical (only doc-comment examples differ) | `Action`/`Resource` generics                                            |
| `authorization/roles`                                                                 | any (`rolesAuthorization` body byte-identical ×5) | lists diverge = product data                 | `ALL_ACTIONS`, `isMutating`, `DEFAULT_ROLE_POLICY` passed in            |
| `authorization/contract`                                                              | shape identical; enums product                    | diverged (data only)                         | `defineActions({ all, mutating, portal? })` → types + sets              |
| `hooks/contract` machinery                                                            | any (identical code)                              | event unions product                         | `Hooks<Before, After>` generics; log prefix                             |
| `hooks/log`                                                                           | en (adds `json`)                                  | diverged (features)                          | `source` name, extra text-format field                                  |
| `server/{base-path,cors,static-assets}`                                               | any                                               | identical / identical modulo names           | none (static-assets: `uiDir`)                                           |
| `server/render-index-html`                                                            | li (+en)                                          | diverged — **XSS fix** only in li/en         | `globalName` (`__XPROD_CONFIG__`), bootstrap shape                      |
| `server/create-fetch-handler` skeleton                                                | merge (see §5.3)                                  | diverged                                     | product `api` handler, core builder, background tasks, bootstrap extras |
| router plumbing in `server/routes`                                                    | en (declarative table)                            | diverged heavily                             | route table, error map, portal scoping                                  |
| `server/openapi` envelope + generator                                                 | en (generated from route table)                   | diverged                                     | schemas, tags, token prefix text                                        |
| framework adapters (bun/express/hono/elysia/elysia2/next)                             | merge (see §4)                                    | diverged — several bug fixes in later copies | panel factory; product extras (guard/redirect/context) stay in products |
| `portal` HMAC token core                                                              | en (+`now`, secret check)                         | identical mechanics, claims differ           | `prefix`, subject claim name, scope/allow validator, default TTL        |
| CLI plumbing (`env`, `parseArgs`, `startServer`, `buildAuth`, driver loader, `serve`) | merge (au/en loader, li/au parser)                | diverged                                     | env prefix/defaults, product commands, product storage roles            |
| `duration`                                                                            | en (+`w`) + wh/au `parseDurationList`             | identical except en adds weeks               | none                                                                    |
| `canonical`                                                                           | au                                                | au = wh + non-finite guard                   | none                                                                    |
| `id`                                                                                  | au (monotonic ULID)                               | 4 different schemes                          | prefix union                                                            |
| `validation` primitives                                                               | au/li                                             | diverged                                     | —                                                                       |
| `version` / pkg version                                                               | —                                                 | 3 hard-coded constants, 2 read package.json  | build-time inject                                                       |
| `testing`                                                                             | almost all product                                | —                                            | only `createTestClock`, collecting-sink helper are generic              |
| `bin/*.mjs`                                                                           | any                                               | identical modulo names (3 lines)             | bin name                                                                |
| `apps/standalone`                                                                     | wh/au/li/en pattern (delegate to `cli serve`)     | fl duplicates CLI (drift)                    | product only (thin)                                                     |

---

## 1. Auth — `src/auth/*`

**Status: identical modulo names in all 5.** Only diffs: en `basic.ts:193` doc example `realm: "Billing Admin"`.

| file              | wh  | fl  | au  | li  | en  |
| ----------------- | --- | --- | --- | --- | --- |
| auth/basic.ts     | 249 | 249 | 249 | 249 | 249 |
| auth/contract.ts  | 29  | 29  | 29  | 29  | 29  |
| auth/delegated.ts | 57  | 57  | 57  | 57  | 57  |
| auth/none.ts      | 46  | 46  | 46  | 46  | 46  |

- `contract.ts`: `Principal { id; email?; name?; roles?; metadata? }`, `AuthProvider { authenticate(req): Promise<Principal|null>; challenge?(req) }`.
- `basic.ts`: `basicAuth({ users, realm?, passwordVerifier? })`, `hashPassword` / `verifyPassword` (scrypt, `scrypt$<salt>$<hash>`),
  constant-time compare. **Uses `node:crypto` + `Buffer`** (not edge-portable without nodejs_compat) — note for the kit.
  Default realm `"xtandard-<product>"` → seam.
- `none.ts`: `noAuth()`, `ANONYMOUS_PRINCIPAL`. `delegated.ts`: `delegatedAuth({ authenticate, challenge? })`.
- Best copy: any. Kit: move verbatim; `realm` default from kit config.
- Bugs: none found / no fixes diverge.

## 2. Authorization — `src/authorization/*`

| file         | wh  | fl  | au  | li  | en  |
| ------------ | --- | --- | --- | --- | --- |
| contract.ts  | 75  | 72  | 85  | 79  | 108 |
| roles.ts     | 139 | 131 | 122 | 135 | 152 |
| delegated.ts | 49  | 46  | 50  | 48  | 51  |
| none.ts      | 35  | 35  | 35  | 35  | 35  |

- `none.ts`: identical. `delegated.ts`: code identical, only the JSDoc example differs (per-app / per-project / per-tenant / per-customer).
- `contract.ts`: **same shape everywhere** — `XprodAction` union, `XprodResource` discriminated union, `AuthorizeInput
{ principal, action, resource, request }`, `AuthorizationProvider`, `MUTATING_ACTIONS`, `isMutatingAction`. The action/resource
  lists are 100 % product data. Additions: au + en move `ALL_ACTIONS` into the contract (au `contract.ts`, en `contract.ts`);
  en adds `PORTAL_ACTIONS`. Readonly semantics differ: en excludes `runtime:consume`/`portal:*` from `MUTATING_ACTIONS` (metering keeps
  working when the panel is readonly).
- `roles.ts`: **`rolesAuthorization()` body is byte-identical in all 5** (md5 of the function equal). Differs only in data:
  `ALL_ACTIONS` (wh/fl/li local, au/en imported from contract), `READ_ACTIONS` (wh/li/en excludes some reads: wh comment says
  `endpoint:read-secret` excluded but the filter `a.endsWith(":read")` doesn't match it anyway; en excludes `portal:*`),
  `DEFAULT_ROLE_POLICY` (wh/fl/li `admin/editor/viewer`; au `admin/auditor/viewer`; en `viewer/support/billing-admin/admin/runtime-service`),
  en `RolePolicy` uses `readonly XprodAction[]` (better typing).
- Best: en's layout (actions in contract; `readonly` arrays). Kit API sketch:
  `defineAuthorization<const A extends string>({ actions: A[], mutating: A[], portal?: A[] })` → `{ ALL_ACTIONS, MUTATING_ACTIONS, isMutatingAction, rolesAuthorization(policy) }`;
  each product passes its own `DEFAULT_ROLE_POLICY`. `Resource` stays a product type parameter.
- Bugs: none diverge.

## 3. Hooks — `src/hooks/contract.ts`, `src/hooks/log.ts`

| file              | wh  | fl  | au  | li  | en  |
| ----------------- | --- | --- | --- | --- | --- |
| hooks/contract.ts | 247 | 256 | 195 | 123 | 156 |
| hooks/log.ts      | 56  | 56  | 56  | 56  | 68  |

- `contract.ts`: everything from `HookDeniedError` down (`XprodHooks {before?, after?}`, `XprodHooksInput`, `HookErrorReporter`,
  `normalizeHooks`, `runBefore` sequential/first-throw-aborts, `runAfter` concurrent/errors→`onError`, `defaultHookErrorReporter`) is
  **code-identical in all 5** (li/en only shortened JSDoc; en reworded the console message). `BeforeEvent`/`AfterEvent` unions are
  product data. au adds `HookActor` (`au:src/hooks/contract.ts:32`).
- `log.ts`: wh = au = li. fl prints `<project>/<env>` in the default line. en adds `json?: boolean` (one JSON object per line,
  `{source, phase, ...event}`) and prints `<customer>`.
- Fix **fl 723121c** "map HookDeniedError from separate bundles by name": **present in all 5** (`hookDeniedStatus()` in
  `routes.ts` — wh:650, fl:722, au:652, li:1107, en:1242). wh/au/li/en generalised it to `isNamed()` for _every_ domain error;
  fl only does it for HookDeniedError (`fl:src/server/routes.ts:731-748` uses `instanceof` for the rest → a ReadonlyError/NotFoundError
  thrown from a separate subpath bundle maps to 500 in fl).
- Kit: `hooks` module generic over `<Before extends {type:string}, After extends {type:string}>`; `createLogHook` from en with a
  `source` option and an optional `describe(event)` for the text format's extra field (fl project/env, en customer).
- Public API: `./hooks/log` subpath (all 5), `createLogHook`, `LogHookOptions`; index re-exports `HookDeniedError,
defaultHookErrorReporter, normalizeHooks, runAfter, runBefore` + types (all 5).

## 4. Framework adapters — `src/adapters/*`

| file             | wh  | fl  | au                   | li                    | en           |
| ---------------- | --- | --- | -------------------- | --------------------- | ------------ |
| bun.ts           | 27  | 26  | 76                   | 76                    | 64           |
| elysia-shared.ts | 71  | 62  | 71                   | 69                    | 123          |
| elysia.ts        | 149 | 156 | 153                  | 162                   | 240          |
| elysia2.ts       | 163 | 194 | 150                  | 186                   | 241          |
| express.ts       | 103 | 95  | 149                  | 166                   | 149          |
| hono.ts          | 38  | 28  | 59                   | 68                    | 79           |
| next.ts          | –   | –   | –                    | 104                   | 112          |
| product helpers  | –   | –   | context-shared.ts 68 | redirect-shared.ts 22 | guard.ts 126 |

Every adapter = **generic `<product>Panel(options)` wrapper over `createFetchHandler`** + **product extras**:
au `withAuditContext`/`auditContext` (AsyncLocalStorage request scope), li `linksRedirect`/`linksMiddleware`, en `requireEntitlement`/`withEntitlement` guards.
The attached handles differ by product: wh `core+dispatcher+openapi`, fl `core+openapi`, au `core+streams+openapi+close`, li `core+openapi`,
en `engine+openapi+close`.

### 4.1 bun.ts

Panel part is a passthrough everywhere. Extras product-specific (see above).

### 4.2 elysia-shared.ts — `createPass` (re-building the Request after Elysia parsed the body) — **4 variants**

| behaviour                                 | wh/fl (`:55`/`:46`)  | au `:51`                              | li `:53`                 | en `:70`                |
| ----------------------------------------- | -------------------- | ------------------------------------- | ------------------------ | ----------------------- |
| methods rebuilt                           | POST, PUT            | POST, PUT                             | POST, PUT, PATCH, DELETE | POST, PUT, PATCH        |
| condition                                 | `ctx.body != null`   | `r.bodyUsed` (only if stream drained) | `ctx.body != null`       | `ctx.body != null`      |
| stale `content-length` removed            | **no**               | yes                                   | **no**                   | yes                     |
| string body passthrough                   | no (re-JSON-encodes) | yes                                   | yes (CSV import)         | no                      |
| forces `content-type: application/json`   | no                   | no                                    | no                       | yes                     |
| raw (unparsed) route for signature checks | –                    | –                                     | –                        | `raw` + `parse: "none"` |
| returns                                   | `{prefix, pass}`     | `+handler`                            | `+core`                  | `+handler, raw`         |

Bugs: wh/fl drop the body of PATCH/DELETE routes (n/a today — wh/fl/au have no PATCH routes; li 1, en 3 have), and forward the
original `content-length` with a re-serialised body (li too). **Best: combine** au (bodyUsed + content-length delete + string passthrough)

- li method set + en `raw`. The plugin also needs li's `seed: prefix` (`li:src/adapters/elysia.ts:78`) so two mounts with different
  prefixes aren't deduped by Elysia's `name` — only li has it.

### 4.3 elysia.ts / elysia2.ts

Generic skeleton identical: `new Elysia({ prefix, name: "xtandard-<product>" })`, `.get("/config")`, `.get("/api/openapi.json")`,
product route table with typebox `t.*` bodies (for Eden inference), `.all("/*", pass)` UI catch-all. elysia2 differs only in argument order
`(path, opts, handler)` vs `(path, handler, opts)`. Route tables = product data. Kit seam: build the Eden-typed plugin from a route
descriptor list (en already has one — `API_ROUTES`), but typed Eden inference requires literal chains, so realistically the kit ships
`createPass` + a helper and each product keeps its typed chain. Public API: `xprodElysia`, `XprodElysiaPlugin`, `xprodPanel`,
`ElysiaXprodHandler`, `XprodElysiaOptions` (+au `auditContext`, li `linksRedirect`, en `requireEntitlement`).

### 4.4 express.ts — Express ↔ Fetch bridge

| behaviour                        | wh/fl                                           | au                                                             | li                                       | en                           |
| -------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------- | ---------------------------- |
| multi-value request headers      | joined `", "`                                   | joined                                                         | **`append` each**                        | joined                       |
| pre-parsed body re-serialise     | JSON / string                                   | JSON / string                                                  | JSON, string, **Uint8Array, urlencoded** | JSON, string, **Uint8Array** |
| response `set-cookie` (multiple) | `forEach` → **collapsed into one header (bug)** | same bug                                                       | **`getSetCookie()` array** (`li:117`)    | same bug                     |
| response body                    | buffered                                        | **streamed with backpressure + cancel on close** (`au:85-105`) | buffered                                 | buffered                     |
| lazy request body stream         | –                                               | –                                                              | `lazyBody` (redirect)                    | –                            |

Best: **merge** li (headers/cookies/parsed bodies) + au (streaming writer) + en Uint8Array passthrough. The same Node bridge is
re-implemented a third time in each `cli.ts startServer` (see §8).

### 4.5 hono.ts

Panel: `new Hono(); app.all("*", c => handler.fetch(c.req.raw))` + attached handles — identical. Extras product-specific.
li's `waitUntilOf(c)` (defensive `executionCtx` read) is generic and belongs in the kit (relates to li fix **bf20268**:
call `waitUntil` as a method; li next.ts uses `waitUntil.call(event, p)`).

### 4.6 next.ts (li, en only)

Diverged API: li `linksRouteHandlers(options)` builds a panel and returns `{GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS, core, openapi}`;
en `toNextHandler(panel)` takes any `{ fetch }` and returns the method map. **Best: en's** (decoupled; panel built once). Kit:
`toNextHandler`; li's `linksRouteHandlers` kept as a thin product alias. Product extras: li `linksMiddleware`/`linksRedirect`, en `withEntitlement`.

### 4.7 entry-\*.ts (server side)

All are one-line `export * from "./<area>/<file>.ts"` (+doc header) — **identical modulo names** for `entry-auth-{basic,delegated,none}`,
`entry-authorization-{delegated,none,roles}`, `entry-{bun,elysia,elysia2,express,hono}`, `entry-hooks-log` (×5), `entry-next` (li, en).

---

## 5. `src/server/*`

| file                    | wh                             | fl  | au  | li   | en   | status                                     |
| ----------------------- | ------------------------------ | --- | --- | ---- | ---- | ------------------------------------------ |
| base-path.ts            | 32                             | 32  | 32  | 32   | 32   | identical modulo names (en doc `/billing`) |
| cors.ts                 | 91                             | 91  | 91  | 91   | 91   | identical (doc example only)               |
| static-assets.ts        | 67                             | 67  | 67  | 67   | 67   | **byte-identical**                         |
| render-index-html.ts    | 58                             | 60  | 58  | 65   | 61   | diverged (fix)                             |
| create-fetch-handler.ts | 271                            | 229 | 297 | 221  | 256  | diverged                                   |
| routes.ts               | 689                            | 752 | 694 | 1154 | 1278 | plumbing diverged; routes product          |
| openapi.ts              | 589                            | 856 | 653 | 768  | 708  | envelope diverged; schemas product         |
| fl-only                 | `sse.ts`, `ofrep.ts` (product) |     |     |      |      |                                            |

### 5.1 base-path / cors / static-assets — move verbatim.

`normalizeBasePath`, `stripBasePath`; `XprodCorsOptions {origin: string|string[]|fn, credentials, methods, headers, maxAge}`,
`applyCorsHeaders`, `preflightResponse`; `serveStaticAsset(uiDir, path)` (traversal guard, `/assets/` immutable cache), `looksLikeAsset`.
static-assets imports `node:fs/promises` at top level → not Workers-safe; fl ships a cloudflare-workers example, so the kit should keep
the UI-serving path lazily imported or injectable.

### 5.2 render-index-html — **unescaped title (HTML injection) in wh/fl/au**

`<title>${config.title}</title>` and `<h1>${config.title}</h1>` raw in wh:42, fl:44, au:42. li escapes title **and** the `<base href>`
and ` / ` in the bootstrap JSON (li:24-51) + adds `lang="en"` and an OpenAPI link in the fallback page; en escapes title only
(en:25,45). `TITLE` comes from env/options (operator-controlled), so low severity, but the kit takes **li's**. Bootstrap shape diverges:
fl adds `defaultProjectKey/defaultEnvironmentKey`, li adds `version` → kit: `renderIndexHtml(uiDir, { globalName, config: Record<string, unknown> })`.
No commit carries this fix (introduced at li/en creation). Test coverage: en `server-bits.test.ts:177` "escapes the title".

### 5.3 create-fetch-handler — the panel

Common skeleton (all 5, same order): `normalizeBasePath` → defaults (`title`, `uiDir` via `defaultUiDir()` — both candidates
`./ui` and `../../dist/ui` present in all 5, i.e. fl fix **7475369** is everywhere) → build/accept core → `ApiContext` → `fetch()` =
CORS preflight + `respond()` + CORS decorate → `respond()` = API → 405 for non-GET/HEAD → static asset → 404 for asset-looking paths →
SPA fallback via `renderIndexHtml`. Anonymous `defaultAuth`/`defaultAuthorization` identical.

Divergences:

- "requires `storage` or a prebuilt `core`" guard (wh fix **5b151c1**): wh:167, au:190, li:144, en:135 (engine/catalog) — **missing in fl**
  (fl passes `options.sourceStorage` straight to `createFlagsCore`).
- Background work + lifecycle: wh starts the dispatcher (with the claim-safety warning, wh fix 543e1fa/5b151c1 — product-specific);
  au starts a stream runner + a `setInterval` prune (`maintenance`, unref'd) and returns `close()`; en starts a `sweepInterval` timer and
  returns `close()`; wh/fl/li have **no `close()`**. Kit: `backgroundTasks` hook + uniform `close()`.
- SPA response: li adds `cache-control: no-cache` to the HTML (li:213) — others none; li also reports `readonly || core.readonly`,
  en defaults `readonly` from `engine.readonly`.
- Router entry: wh/fl/au/en `handleApiRequest(request, path, ctx)`; li `createApiHandler(ctx)` → `(request, path)`; en passes `openapi`.
- `/healthcheck`: li/en serve it inside the API router (li `routes.ts`, en `routes.ts` + cfh); wh/fl/au only in the CLI `serve` wrapper
  → embedded panels in wh/fl/au have no healthcheck. Kit: put it in the panel.

Best: **en's skeleton** (generic over the product, `close()`, healthcheck) + li's no-cache + the storage/core guard.
Kit seam: `createPanelHandler({ basePath, title, logoUrl, readonly, uiDir, cors, api: (req, path) => Promise<Response|null>,
bootstrap: () => object, openapi: () => object, tasks?: Array<{start, stop}> })`; products wrap it in `createFetchHandler`.

### 5.4 routes.ts — separate plumbing from product routes

**Generic plumbing (all 5 have a copy):**

- `json()`, `error()` (au/en add a `headers` param; li a `JSON_HEADERS` const), `match(pattern, path)` `:param` matcher, `intParam`,
  `actorFor(principal)`, `isApi` prefix test, public `/api/openapi.json` + `/openapi.json`, public `/config` + `/api/config` bootstrap
  (`{title, basePath, readonly, authenticated, principal{id,email,name,roles}, portal…, logoUrl}`), portal/viewer-token bearer short-circuit
  (`Bearer <prefix>…` → scoped principal; invalid → 401, never falls back to host auth), 401 via `auth.challenge?.()`, `authorize()` helper
  that **does not consult the host provider for portal principals** (defense in depth), `mapError()` (domain errors → HTTP).
- **Product:** the route bodies, `XprodPortalOptions`/`DEFAULT_PORTAL_ACTIONS`, portal resource checks, error classes in `mapError`.

Plumbing divergences / bugs:

| issue                                                 | wh                                                                               | fl                                                          | au               | li                      | en                                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| throwing `auth.authenticate` → 500 (wh **543e1fa**)   | has (wh:202)                                                                     | **lacks** — `catch { principal = null }` → 401 (fl:149-151) | has (au:283)     | has (li:984-989)        | has (inside router try, en:1159/1223)                                                                                                          |
| `match()` catches `decodeURIComponent` URIError       | **lacks** → bad `%` escapes → 500 (wh:94, called inside try → mapError fallback) | **lacks** (fl:95)                                           | has              | has                     | has                                                                                                                                            |
| `isNamed()` cross-bundle error mapping (all errors)   | has                                                                              | **only HookDenied**                                         | has              | has                     | has                                                                                                                                            |
| readonly status                                       | 403                                                                              | 403                                                         | **423**          | 403                     | **423**                                                                                                                                        |
| invalid int query param                               | ignored                                                                          | ignored                                                     | 400 (QueryError) | ignored                 | **400**                                                                                                                                        |
| 405 with `Allow` header for known path / wrong method | no                                                                               | no                                                          | no               | 405, no Allow (li:1092) | **405 + `Allow`** (en:225)                                                                                                                     |
| declarative route table                               | no (if-chains)                                                                   | no                                                          | no               | no                      | **yes** (`ROUTES`/`API_ROUTES`, `RouteSpec{method,path,operationId,summary,tag,action,query,body,response}`, `resource(call)`, `handle(call)`) |
| body parsing                                          | `request.json()`                                                                 | same                                                        | `optionalBody`   | `readJsonObject`        | memoised `call.body(schema)` via valibot `parseInput`, empty body = `{}`                                                                       |

Best: **en's router** (route table drives dispatch, authorization, readonly, 405/Allow, and OpenAPI) + au/li/en `match()` + `isNamed`.
Readonly code must be unified (423 is au/en's choice and what their OpenAPI documents; wh/fl/li document/test 403) — a decision for the
migration; changing it is an HTTP-API break for wh/fl/li.
Kit: `createRouter<Action, Resource, Ctx>({ routes, auth, authorization, portal?: { prefix, verify, scope(principal, action, resource) }, errors: ErrorMap })`.

### 5.5 openapi.ts

Common: `OpenApiOptions {basePath?, title?, version?}`, `buildOpenApiDocument(options)`, helpers `ref/jsonRes/errorRes/arrayOf/okRef`,
envelope `openapi: "3.1.0"`, `servers: [{url: base||"/"}]`, `securitySchemes {basicAuth, bearerAuth(<token prefix>…)}` (fl: basic only —
no portal). Paths/schemas = product (hand-written in wh/fl/au/li; **generated from the route table in en** — no drift between router and
docs). fl adds `buildImportSchema()` (product).
Bug: `info.version` defaults to hard-coded `"0.1.0"` in wh:213, fl:375, au:399 (packages are 0.2.0/0.2.0/0.1.1); li uses `VERSION`;
en uses `"1"` (API version, documented). Kit: en's generator (`operation(spec)`, `toOpenApiPath`, standard error responses per route
property, `x-action`), version from build.

---

## 6. `src/portal.ts` — scoped panel tokens (wh, au, li, en; **fl has none**)

|                        | wh                                                                         | au                                                                               | li                                                                           | en                                               |
| ---------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| LOC                    | 176                                                                        | 320                                                                              | 198                                                                          | 221                                              |
| prefix                 | `whpt_`                                                                    | `audpt_`                                                                         | `lvt_` (viewer token)                                                        | `entpt_`                                         |
| subject claim          | `app`                                                                      | `tenant` (+`filter`, `allow`)                                                    | `tenant` (+`links`, `allow`)                                                 | `customer` (+`scope`)                            |
| default TTL            | 7d                                                                         | 1h                                                                               | 1d                                                                           | 1h                                               |
| rejects empty secret   | **no**                                                                     | **no**                                                                           | yes (li:118)                                                                 | yes (en:138)                                     |
| clock injection        | no                                                                         | no                                                                               | no                                                                           | `now` option                                     |
| base64url/HMAC helpers | local                                                                      | from `integrity.ts`                                                              | from `password.ts`                                                           | local (same md5 as wh)                           |
| names                  | `createPortalToken/verifyPortalToken/PortalTokenError/PORTAL_TOKEN_PREFIX` | same + `scopeQueryToPortal/portalCanSee/intersectActions/DEFAULT_PORTAL_ACTIONS` | `createViewerToken/verifyViewerToken/ViewerTokenError/VIEWER_TOKEN_PREFIX/…` | same as wh + `PortalAction`, `PortalTokenClaims` |

Mechanics are identical: `<prefix><b64url(JSON claims)>.<b64url(HMAC-SHA256(secret, payloadPart))>`, verify signature first, constant-time
compare, then parse + validate claims + `exp`. Bug: wh/au `createPortalToken("")` signs with an empty key (no check). Missing everywhere:
`kid`/secret rotation, `iat`.
Kit: `createScopedTokens<Claims>({ prefix, ttl, validateClaims })` → `{ create, verify, Error }` (from en: secret check, `now`), WebCrypto only.
Products keep scope semantics (au query scoping, li link filter, en portal actions).

---

## 7. Small utils

### 7.1 duration.ts (wh 63, au 63, li 42, en 43; fl none)

`durationToMs` identical in wh/au/li (li inlined the unit lookup). en adds `w` (weeks) and owns the `Duration` type locally
(others import `XprodDuration` from schema.ts). `parseDurationList` only in wh/au (wh uses it for `RETRY_SCHEDULE`).
Kit: en + `parseDurationList`; export `Duration` type.

### 7.2 canonical.ts (wh 38, au 42)

au = wh + rejects non-finite numbers (`TypeError`) + accepts `undefined` at the top level. en has its own `canonical`/`canonicalJson`
in `storage/util.ts` (storage area). Kit: au's.
wh fix **5b151c1** (canonical idempotency comparison) — wh-specific use, utility is generic.

### 7.3 id.ts (wh 50, au 97, li 88, en 24; fl none) — 4 incompatible schemes

|     | scheme                                           | monotonic in-ms          | integer ms                                       | `idPattern` | `idTime`            |
| --- | ------------------------------------------------ | ------------------------ | ------------------------------------------------ | ----------- | ------------------- |
| wh  | `prefix_` + 22-char base62 random (not sortable) | n/a                      | n/a                                              | yes         | no                  |
| au  | ULID (Crockford, 10 time + 16 rand, uppercase)   | yes (`increment`)        | yes (au fix **6761a34**)                         | yes         | yes (`null` on bad) |
| li  | ULID, same alphabet                              | yes (li fix **2acc19a**) | floors in `encodeTime`, compares unfloored `now` | yes         | yes (`NaN` on bad)  |
| en  | lowercase Crockford, 10 time + **12** rand       | **no**                   | yes (`Math.floor`)                               | no          | no                  |

Kit: au's generator (`sortableId`, `newId(prefix, ms?)`, `idPattern`, `idTime`) generic over a prefix union. Migration: id formats are
persisted — the kit must keep per-product format compatibility (wh random base62, en lowercase 22-char), i.e. offer `idPattern` that
accepts the legacy shape or let products keep their format; don't silently switch.

### 7.4 validation.ts (wh 250, fl 525, au 180, li 359, en 239) — mostly product

Generic pieces:

- `ValidationIssue {path, message}`, `ValidationResult`, `ValidationError(errors)` + `assertValid` — identical in wh/au/li; fl has
  `ValidationError` as an _interface_ + `DraftValidationError`; en `InputValidationError extends EntitlementsValidationError` with `.issues`
  (not `.errors`) + `parseInput(schema, input)`.
- valibot issue → path mapper: wh `structuralIssues` produces `"base."` with a trailing dot for root issues (**bug**, wh:124);
  au fixed (au:124), li uses `v.getDotPath`, en `toIssues` maps strict-object `"never"` to `"unknown field"`.
- `jsonValueSchema`: au uses `v.finite()` (au:46); wh/en accept `NaN/Infinity` (serialises to `null`).
- `KEY_REGEX` + `validateKeySegment` (wh fix **543e1fa**, idempotency keys can't escape storage namespace): wh, li (li stricter: rejects
  non-string/empty first). URL policy: wh `validateEndpointUrl`, li `validateDestinationUrl` (+forbidden schemes) — candidate shared
  `validateUrl({ allowLocalhost, allowedSchemes })`.
  Kit: `ValidationError` family + `issuesFrom` (li's) + `jsonValueSchema` (au's) + `validateKeySegment` (li's) + `parseInput` (en's).

### 7.5 schema.ts generic parts

`JsonValue` (wh/fl/li identical; au allows `undefined` members; en from `catalog.ts`), `JsonObject` (au/li/en), duration template type
`` number | `${number}${"ms"|"s"|"m"|"h"|"d"}` `` (wh/au/li; en adds `w`), `Actor {id, email?, name?}` (wh/fl/li; en adds `type`;
au `AuditActor` adds `type, metadata`), `SCHEMA_VERSION = 1` (wh/au/li). Everything else product. Kit: `JsonValue/JsonObject/Duration/Actor` (en's
`Actor` with optional `type`).

### 7.6 version.ts (wh 10, au 10, li 9)

`export const VERSION = "<x.y.z>"` hand-maintained (currently matches package.json in all three). fl/en CLIs read `../package.json` at
runtime (`pkgVersion()`); wh/au also have `pkgVersion()` in cli.ts. Kit: one build-time-injected constant per product.

---

## 8. CLI — `src/cli.ts` (wh 847, fl 592, au 986, li 800, en 803) + `bin/` + `apps/standalone`

### 8.1 Generic pieces (exist in all 5, drifted)

| piece                                                                     | notes / divergence                                                                                                                                                                                                                                                                                                                                                      | best                                                                                                       |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `env(key, fallback)`                                                      | `??` in wh/fl/au/li; **`\|\|`** in en (empty var → fallback). `isTruthy` identical.                                                                                                                                                                                                                                                                                     | en (`\|\|`)                                                                                                |
| `parseArgs`                                                               | wh/fl: `--k v` / `--flag`. au/li/en: + `--k=v`. li: + short flags (`-t`, `-h`, `-v`). en rejects `--=x` (`eq > 2`).                                                                                                                                                                                                                                                     | li + en guard                                                                                              |
| storage driver selection                                                  | wh/fl/li: switch with static relative `import("./storage/x.ts")`; **unknown `STORAGE_DRIVER` silently falls back to `file`** (wh:165, fl:108, li:83). au/en: driver allow-list, throws `Unknown STORAGE_DRIVER`, lazy `importEntry()` of the built subpath entry (`./entry-storage-x.mjs`, `.ts` from source) with "not available in this build" errors (au:80, en:76). | au/en                                                                                                      |
| storage env names                                                         | `REDIS_URL`, `DATABASE_URL`\|`POSTGRES_URL`, `MONGO_URL`, `MONGO_DB`, `LIBSQL_URL`, `LIBSQL_AUTH_TOKEN`, `<ROLE>_{PREFIX,PG_TABLE,MONGO_COLLECTION,SQLITE_PATH,FILE_DIR,LIBSQL_URL}`; roles: wh `STORAGE`/`QUEUE`, fl `SOURCE`/`RUNTIME`, au/li `STORAGE`, en `STORAGE`/`COUNTERS`. fl lacks libsql, has unstorage.                                                     | generic with `roles` param                                                                                 |
| `describeStorage`                                                         | prints resolved file/sqlite paths, never URLs. Identical idea everywhere.                                                                                                                                                                                                                                                                                               | any                                                                                                        |
| `buildAuth`                                                               | `AUTH_MODE=none\|basic`, `AUTH_USERNAME`, `AUTH_PASSWORD(_HASH)`; au/en add `AUTH_ROLE`; li/en set `realm`; **only en rejects unknown `AUTH_MODE`** (en:331) — others treat typos as `none` (open panel!). fl passes `password: undefined` keys.                                                                                                                        | en                                                                                                         |
| `startServer(port, fetch)`                                                | `Bun.serve` or a `node:http` bridge. Bridge variants: wh/en buffered; fl streams only `text/event-stream`; au streams every body (no backpressure); li fixes multi `set-cookie`. All join multi-value request headers.                                                                                                                                                  | merge (li cookies + au/fl streaming with backpressure from au express) — and reuse the Express bridge code |
| `serve`                                                                   | env `PORT, BASE_PATH, TITLE, LOGO_URL, READONLY, PORTAL_SECRET` (li also `VIEWER_SECRET`), "AUTH_MODE=none" warning, startup banner, wraps `/healthcheck` (wh/fl/au/li), never resolves. basePath normalised ad hoc (wh doesn't strip trailing `/`; en regex) — use `normalizeBasePath`.                                                                                | kit `serveCommand({ buildPanel })`                                                                         |
| `pkgVersion`, `helpText`, `run(argv)` switch, `-h/--help`, `-v/--version` | identical pattern                                                                                                                                                                                                                                                                                                                                                       | —                                                                                                          |
| self-run guard `if (import.meta.main) run(...)`                           | **only au** (au fix **6761a34**, au:982)                                                                                                                                                                                                                                                                                                                                | au                                                                                                         |

Product-specific: all other commands — wh `init, list-apps, list-endpoints, publish, retry, verify, sign, listen, dispatch`; fl `init, list,
validate, publish, rollback, delete-snapshot, eval, inspect`; au `keygen, tenants, actions, record, query, export, verify, prune, checkpoint`;
li `links …, domains …, import, export, stats, qr, prune`; en `check, consume, grant, override, subscribe, customers, sweep`
(+`CATALOG_PATH`, `COUNTERS_DRIVER`). "init" scaffolding exists only in wh/fl and only seeds product data.
li fix **bf20268** CLI parts (prune analytics buckets, `VISITOR_SALT`) — product.

Kit API sketch: `createCli({ name, envPrefix?, storageRoles, buildAuth, commands })` exporting `env`, `parseArgs`, `importEntry`,
`buildStorageFromEnv(role)`, `describeStorage`, `startServer`, `serve`. Product CLI = command table.

### 8.2 bin/\*.mjs — identical modulo names (3 lines: `import { run } from "../dist/cli.mjs"; run(argv).then(process.exit)`).

package.json `bin`: `xtandard-<product>` → `./bin/xtandard-<product>.mjs` (en path lacks `./`).

### 8.3 apps/standalone (Dockerfile 31/31/31/32/35; index.ts 24/172/24/25/31; package.json identical)

- wh/au/li/en `src/index.ts`: set `STORAGE_DRIVER ??= "memory"` (en `||=`), `run(["serve"])`. en also defaults `CATALOG_PATH` to a bundled
  example. **fl re-implements the whole serve path (172 LOC, own env parsing, imports every storage statically)** → drift from fl's CLI.
- Dockerfile: identical two-stage (`oven/bun`, `bun install --frozen-lockfile || bun install`, `bun run build:ui`, copy src + dist/ui +
  node_modules, `HEALTHCHECK` on `/healthcheck`). li pins `oven/bun:1.4.4` (others `1.3`) and sets `ENV BASE_PATH=/links`; en tolerates a
  failed UI build. fl fix **e9210e5** (separate COPY lines) present in all 5.
- Kit: Dockerfile template + 10-line `index.ts`; fl should switch to delegating to its CLI.

---

## 9. `src/testing.ts` (wh 170, fl 150, au 285, li 185, en 104) — product

Fixtures over memory storage per product: wh `createTestWebhooks` + `createTestReceiver` (node:http) + `drainDeliveries`; fl `createTestPanel`,
`booleanFlag`, `variantFlag`, `publishFlags`; au `createTestAudit`, `collectingSink`, `expectRecorded/expectNotRecorded`; li `createTestLinks`,
`createCollectingSink`, `USER_AGENTS`, `clickRequest`; en `createTestEntitlements`, `createTestClock`.
Generic candidates only: `createTestClock` (en) and a `collectingSink<T>()` (au/li pattern). Public subpath `./testing` (all 5) stays per product.

---

## 10. Bug-fix matrix (my scope)

| fix                                                                                   | wh                    | fl                            | au                                  | li                                                      | en                                 |
| ------------------------------------------------------------------------------------- | --------------------- | ----------------------------- | ----------------------------------- | ------------------------------------------------------- | ---------------------------------- |
| fl **723121c** HookDeniedError mapped by name                                         | has                   | has (origin)                  | has                                 | has                                                     | has                                |
| (generalisation) all domain errors by name (`isNamed`)                                | has                   | **lacks**                     | has                                 | has                                                     | has                                |
| wh **543e1fa** throwing auth provider → 500 not 401                                   | has (origin)          | **lacks** (fl:150)            | has                                 | has                                                     | has                                |
| wh **543e1fa** `validateKeySegment` (safe storage key segment)                        | has (origin)          | n/a (no caller-supplied keys) | n/a (regex-validated tenant/action) | has (stricter)                                          | n/a                                |
| wh **543e1fa**/**5b151c1** dispatcher claim-safety warning reads core's queue storage | has                   | n/a                           | n/a                                 | n/a                                                     | n/a                                |
| wh **5b151c1** "requires storage or core" guard in panel                              | has                   | **lacks**                     | has                                 | has                                                     | has (engine/catalog)               |
| wh **5b151c1** canonical comparison util                                              | has                   | n/a                           | has (+non-finite guard)             | n/a                                                     | own (storage/util)                 |
| fl **7475369** resolve `dist/ui` from source                                          | has                   | has (origin)                  | has                                 | has                                                     | has                                |
| fl **e9210e5** Docker multi-source COPY                                               | has                   | has (origin)                  | has                                 | has                                                     | has                                |
| au **6761a34** integer ms in ids                                                      | n/a (random ids)      | n/a                           | has (origin)                        | has (floors in encode)                                  | has (`Math.floor`)                 |
| li **2acc19a** monotonic ids within a ms                                              | n/a                   | n/a                           | has                                 | has (origin)                                            | **lacks**                          |
| au **6761a34** CLI self-run guard (`import.meta.main`)                                | lacks                 | lacks                         | has (origin)                        | lacks                                                   | lacks                              |
| li **bf20268** call `waitUntil` as a method                                           | n/a                   | n/a                           | n/a                                 | has (next `.call(event)`, hono via `ctx.waitUntil?.()`) | n/a (no waitUntil use in adapters) |
| _(no commit)_ escape title/base in index.html                                         | **lacks**             | **lacks**                     | **lacks**                           | has (+base, U+2028)                                     | has (title)                        |
| _(no commit)_ `match()` survives malformed `%` escapes                                | **lacks**             | **lacks**                     | has                                 | has                                                     | has                                |
| _(no commit)_ unknown `STORAGE_DRIVER` is an error                                    | **lacks**             | **lacks**                     | has                                 | **lacks**                                               | has                                |
| _(no commit)_ unknown `AUTH_MODE` is an error                                         | lacks                 | lacks                         | lacks                               | lacks                                                   | has                                |
| _(no commit)_ Express/Node bridge keeps multiple `Set-Cookie`                         | lacks                 | lacks                         | lacks                               | has                                                     | lacks                              |
| _(no commit)_ Express/CLI bridge streams response bodies                              | lacks                 | SSE only (CLI)                | has                                 | lacks                                                   | lacks                              |
| _(no commit)_ Elysia rebuild drops stale `content-length`                             | lacks                 | lacks                         | has                                 | lacks                                                   | has                                |
| _(no commit)_ Elysia rebuild covers PATCH/DELETE                                      | lacks (n/a today)     | lacks (n/a)                   | lacks (n/a)                         | has                                                     | PATCH only (no DELETE body routes) |
| _(no commit)_ Elysia plugin `seed: prefix` (multi-mount)                              | lacks                 | lacks                         | lacks                               | has                                                     | lacks                              |
| _(no commit)_ valibot root-issue path without trailing `.`                            | **lacks** (wh:124)    | own impl                      | has                                 | has                                                     | has                                |
| _(no commit)_ JSON values must be finite                                              | lacks                 | lacks                         | has                                 | lacks (`v.unknown`)                                     | lacks                              |
| _(no commit)_ portal token rejects empty secret                                       | lacks                 | n/a                           | lacks                               | has                                                     | has                                |
| _(no commit)_ panel `close()` stops timers                                            | n/a (dispatcher.stop) | n/a                           | has                                 | n/a                                                     | has                                |
| _(no commit)_ OpenAPI `info.version` not hard-coded                                   | lacks (`"0.1.0"`)     | lacks                         | lacks                               | has                                                     | uses API version `"1"`             |
| _(no commit)_ SPA HTML `cache-control: no-cache`                                      | lacks                 | lacks                         | lacks                               | has                                                     | lacks                              |
| _(no commit)_ `/healthcheck` inside the panel (not only CLI)                          | lacks                 | lacks                         | lacks                               | has                                                     | has                                |

Storage-specific fixes (`e4b0dc1`, `c9d27ae`, `55ab3d9`, `ed8bc48`, `6d4114c`, `0502400`, `8a577b5`, …) are out of this area.

---

## 11. Tests in scope (test count via `it(`/`test(`; `–` = file absent)

| file                                              | wh            | fl               | au              | li        | en                      | generic?                                                           |
| ------------------------------------------------- | ------------- | ---------------- | --------------- | --------- | ----------------------- | ------------------------------------------------------------------ |
| auth-basic (162 LOC each)                         | ✓             | ✓                | ✓               | ✓         | ✓                       | identical → kit                                                    |
| auth-delegated / auth-none                        | 3/2           | 5/3              | 3/2             | 3/2       | 3/2                     | kit                                                                |
| authorization-roles                               | 16            | 13               | 14              | 16        | 10                      | engine kit, policies product                                       |
| server-bits (base-path, static, index.html, cors) | ✓             | –                | ✓ (+panel CORS) | –         | ✓ (+title escaping)     | kit (union of au+en)                                               |
| portal-token                                      | 12            | –                | 17              | 6         | 9                       | token core → kit, scoping product                                  |
| hooks / hooks-log                                 | 9 / –         | 18 / –           | 4 / 1           | – / –     | – / 3                   | runner → kit (fl's foreign-bundle test in `fl:test/hooks.test.ts`) |
| adapters / express / elysia2 / eden               | 5/6/6/5       | 4/6/6/4          | 8/8/7/7         | 10/7/7/6  | 14/7/8/5                | bridge tests → kit; route typing product                           |
| routes / routes-auth                              | 773 / 347 LOC | 404 / –          | 539 / 371       | 579 / 399 | 802 / 326               | router plumbing → kit; routes product                              |
| openapi                                           | –             | 7                | –               | 3         | 5                       | generator → kit                                                    |
| cli / cli-serve.bun / cli-drivers                 | 25/2/2        | 18/1/1           | 23/4/✓          | 7/1/–     | 13/3/–                  | parser/driver loader → kit                                         |
| testing                                           | 4             | 11               | 9               | –         | –                       | product                                                            |
| types.test-d                                      | –             | ✓ (type-testing) | –               | –         | ✓ (vitest expectTypeOf) | product                                                            |

Coverage gaps worth porting into the kit's suite: auth-throws-500 (wh/au/li/en routes tests), foreign-bundle HookDenied (fl), multiple
`Set-Cookie` through Express (li `express.test.ts`), title escaping (en), malformed `%` in path params (none — add).

---

## 12. Public API that must keep working (per product)

Subpath exports in scope, all 5: `./auth/basic`, `./auth/delegated`, `./auth/none`, `./authorization/delegated`, `./authorization/none`,
`./authorization/roles`, `./bun`, `./elysia`, `./elysia2`, `./express`, `./hono`, `./hooks/log`, `./testing`; li/en: `./next`;
`./schema`: wh/fl/au/li (**not en**). Product-only hook subpaths: fl `./hooks/test-gate`, `./hooks/webhook`. `bin`: `xtandard-<product>`.

Exported names (per subpath, `Xprod` = product prefix):

- auth: `basicAuth, hashPassword, verifyPassword, BasicAuthUser, BasicAuthOptions`; `noAuth, ANONYMOUS_PRINCIPAL`; `delegatedAuth, DelegatedAuthOptions`.
- authorization: `rolesAuthorization, ALL_ACTIONS, READ_ACTIONS, RolePolicy, DEFAULT_ROLE_POLICY, RolesAuthorizationOptions` (+en
  `VIEWER_ACTIONS, SUPPORT_ACTIONS, BILLING_ADMIN_ACTIONS, RUNTIME_SERVICE_ACTIONS`; au `AUDITOR_ACTIONS`); `noAuthorization`;
  `delegatedAuthorization, DelegatedAuthorizationOptions`.
- hooks/log: `createLogHook, LogHookOptions`.
- adapters: `xprodPanel` everywhere; bun `CreateFetchHandlerResult`, `XprodPanelOptions` (+au `withAuditContext, auditContext, BunServerLike, BunFetch`;
  li `linksRedirect, BunLinksRedirect(Options), BunServerLike`; en `requireEntitlement, GuardedBunHandler`); elysia/elysia2 `xprodElysia,
XprodElysiaPlugin, ElysiaXprodHandler, XprodElysiaOptions` (+au `auditContext, ElysiaAuditContextCtx`; li `linksRedirect`; en `requireEntitlement`);
  express `ExpressXprodHandler` (+au `auditContext`; li `linksRedirect, ExpressLinksRedirect`; en `requireEntitlement, EntitlementRequest`);
  hono (+au `auditContext`; li `linksRedirect, HonoLinksRedirect`; en `requireEntitlement, HonoEntitlementsPanel, EntitlementVariables`);
  next li `linksRouteHandlers, LinksRouteHandlers, linksMiddleware, linksRedirect, NextLinksMiddleware, NextFetchEventLike, NextRouteHandler`,
  en `toNextHandler, NextRouteHandlers, withEntitlement, WithEntitlementOptions, NextRouteHandler`.
- index (`.`) from my scope: `createFetchHandler, CreateFetchHandlerResult, XprodPanelOptions, XprodCorsOptions, buildOpenApiDocument,
OpenApiOptions, AuthProvider, Principal, AuthorizationProvider, AuthorizeInput, XprodAction, XprodResource, isMutatingAction, MUTATING_ACTIONS`
  (all 5); hook runtime + types (all 5); `durationToMs` (wh/au/li/en; `parseDurationList` wh; `Duration` en); `newId, idPattern, IdPrefix`
  (wh/au/li; `idTime` au/li; en `newId` only); `VERSION` (wh/au/li); `canonicalStringify` (au; wh does **not** export it); portal names (§6;
  wh/au/en `createPortalToken…`, li `createViewerToken…`); `XprodPortalOptions` (wh/au/li/en), `DEFAULT_PORTAL_ACTIONS` (wh, au), `PanelConfig`
  (au, en); en also `API_ROUTES, RouteSpec, buildOverview, catalogView, …` and guard helpers `denialOf, denialResponse, evaluateGuard,
GuardOutcome, RequireEntitlementOptions`; validation exports are product-specific per §7.4.

Migration note: the kit can expose generic names, but each product must keep re-exporting its prefixed names
(`webhooksPanel`, `WebhooksPanelOptions`, `ElysiaWebhooksHandler`, …) from the same subpaths.
