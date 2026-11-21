# Server area: build summary (for product migrations)

PRs: #1 (auth, authorization, hooks, util, tokens, testing), #4 (server, server/router), #9
(adapters, cli), #12 (follow-up: the CLI passes the sqlite/libsql table). Guides: `docs/AUTH.md`,
`AUTHORIZATION.md`, `HOOKS.md`, `TOKENS.md`, `UTIL.md`, `SERVER.md`, `ADAPTERS.md`, `CLI.md`.

## Subpaths

| Subpath                                        | Main exports                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`, `auth/{none,basic,delegated}`          | `Principal`, `AuthProvider`, `noAuth`, `basicAuth`, `hashPassword`, `verifyPassword`, `delegatedAuth`                                                                                      |
| `authorization`                                | `AuthorizeInput<A,R>`, `AuthorizationProvider<A,R>`, `defineActions({ all, mutating, portal })`                                                                                            |
| `authorization/{none,roles,delegated}`         | `noAuthorization`, `rolesAuthorization({ policy, actions, readonly })`, `delegatedAuthorization`                                                                                           |
| `hooks`, `hooks/log`                           | `Hooks<B,A>`, `runBefore`/`runAfter`, `HookDeniedError`, `isNamed`, `hookDeniedStatus`, `createHookErrorReporter`, `createLogHook`                                                         |
| `tokens`                                       | `createScopedTokens({ prefix, ttl, validateClaims, label, errorName, now })`, `TokenError`                                                                                                 |
| `util`                                         | durations, `createIdGenerator`, validation core, `validateUrl`, `canonicalStringify`, JSON types, `Actor`                                                                                  |
| `testing`                                      | `createTestClock`, `collectingSink`                                                                                                                                                        |
| `server`                                       | `createPanelHandler`, `intervalTask`, `renderIndexHtml`, `resolveUiDir`, static, CORS, base path, `json`/`error`/`match`/`intParam`/`mapError`, `authenticate`/`authorize`, `requireOneOf` |
| `server/router`                                | `createRouter`, `Route`/`RouteSpec`/`Call`, `buildOpenApiDocument`, `openApiOperation`                                                                                                     |
| `adapters/{node,express,hono,bun,next,elysia}` | `toNodeHandler`/`toWebRequest`/`writeWebResponse`, `toExpressMiddleware`, `mountPanel`/`waitUntilOf`, `toBunFetch`, `toNextHandler`, `createPass`                                          |
| `cli`                                          | `env`, `parseArgs`, `buildAuthFromEnv`, `storageFromEnv`, `describeStorage`, `startServer`, `serve`, `pkgVersion`, `isMainModule`                                                          |

## Inventory §3 fixes in this area → regression test

| Fix                                                                         | Test (file › case)                                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| fl 723121c HookDeniedError mapped by name; generalised to all domain errors | `server-hooks` › "SEPARATE bundle", "isNamed…"; `server-router` › mapError "foreign"         |
| wh 543e1fa throwing auth provider → 500, not 401                            | `server-router` › "a throwing host provider propagates (→ 500)"                              |
| wh 5b151c1 panel requires storage or core                                   | `server-router` › "requireOneOf" (each product calls it)                                     |
| fl 7475369 resolve `dist/ui` from source                                    | `server-panel` › "resolveUiDir prefers an existing candidate…"                               |
| au 6761a34 integer ms in ids                                                | `server-util` › "ulid: integer milliseconds"                                                 |
| li 2acc19a monotonic ids (en lacked)                                        | `server-util` › "ulid-lower22 is monotonic…", clock backwards, overflow                      |
| au 6761a34 CLI self-run guard                                               | `server-cli` › "isMainModule … is true only for the entry point"                             |
| li bf20268 `waitUntil` as a method                                          | `server-adapters` › "waitUntilOf calls waitUntil as a method…"                               |
| index.html escapes title + base + U+2028 (+ `$` patterns, new)              | `server-panel` › "escapes the title, the base href…", "keeps `$` sequences intact"           |
| `match()` survives malformed `%`                                            | `server-router` › "match … malformed % escapes", router 404                                  |
| all domain errors by name                                                   | `server-router` › mapError; `*TokenError` names → 401 (review follow-up)                     |
| unknown `STORAGE_DRIVER` is an error                                        | `server-cli` › "an unknown driver throws instead of silently using file"                     |
| unknown `AUTH_MODE` is an error                                             | `server-cli` › "an unknown AUTH_MODE throws…"                                                |
| Express/Node bridge keeps multiple `Set-Cookie`                             | `server-adapters` › "keeps every Set-Cookie header"; `server-cli` + `server.bun` startServer |
| Express/Node bridge streams responses (backpressure, cancel)                | `server-adapters` › "streams the body", "cancels…", "waits for drain"                        |
| Elysia rebuild: stale content-length / PATCH+DELETE / multi-mount `seed`    | `server-adapters` › createPass; `server-elysia` (Elysia 1); `server.elysia2` (Elysia 2)      |
| valibot root issue path without a trailing `.`                              | `server-util` › "issuesFrom: root issues…"                                                   |
| JSON values must be finite                                                  | `server-util` › "jsonValueSchema requires finite numbers"                                    |
| scoped token rejects an empty secret                                        | `server-tokens` › "rejects an empty secret on create and on verify"                          |
| OpenAPI `info.version` not hard-coded                                       | `server-router` › buildOpenApiDocument (version required)                                    |
| SPA `cache-control: no-cache`; `/healthcheck` inside the panel              | `server-panel` › "serves the healthcheck inside the panel", "…SPA with no-cache"             |
| panel `close()` stops background work                                       | `server-panel` › "starts tasks and stops them once on close()"                               |
| §3.3 no `kid`/rotation for scoped tokens                                    | `server-tokens` › "rotation" (a list of secrets; wire format unchanged)                      |
| new: static traversal accepted prefix-sharing siblings (`ui-private/`)      | `server-panel` › "…prefix-sharing siblings"                                                  |
| new: empty env var counts as unset (`\|\|`)                                 | `server-cli` › "treats an empty value as unset"                                              |
| new: the CLI registry passes the sqlite/libsql table (#12)                  | `server-cli-registry` (real drivers) + `server.bun` › sqlite                                 |

Token and id compatibility: `server-tokens` verifies a frozen token from each product's current mint
code (`whpt_`, `audpt_`, `lvt_`, `entpt_`). `server-util` reads ids in each persisted format.

## What each product migration must pass explicitly (ADR 0010 / ADR 0005)

| Parameter                                      | wh                                                                                                                                                                                                                                                                                      | fl                  | au                               | li                             | en                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------- | ------------------------------ | -------------------------------------------------- |
| `basicAuth` / `buildAuthFromEnv` realm         | `xtandard-webhooks`                                                                                                                                                                                                                                                                     | `xtandard-flags`    | `xtandard-audit`                 | `xtandard-links`               | `xtandard-entitlements`                            |
| `rolesAuthorization` policy (no kit default)   | admin/editor/viewer                                                                                                                                                                                                                                                                     | admin/editor/viewer | admin/auditor/viewer             | admin/editor/viewer            | viewer/support/billing-admin/admin/runtime-service |
| router `readonlyStatus`                        | 403                                                                                                                                                                                                                                                                                     | 403                 | 423                              | 403                            | 423                                                |
| `intParam({ invalid })`                        | `"ignore"`                                                                                                                                                                                                                                                                              | `"ignore"`          | `"throw"` (any int)              | `"ignore"`                     | `"throw"`                                          |
| token `prefix` / `errorName` / `label` / `ttl` | `whpt_` / PortalTokenError / 7d                                                                                                                                                                                                                                                         | — (none)            | `audpt_` / PortalTokenError / 1h | `lvt_` / ViewerTokenError / 1d | `entpt_` / PortalTokenError / 1h                   |
| `createIdGenerator({ format })`                | `base62`                                                                                                                                                                                                                                                                                | —                   | `ulid`                           | `ulid`                         | `ulid-lower22`                                     |
| panel `globalName`                             | `__WEBHOOKS_CONFIG__` etc. — each product's existing global, plus its bootstrap extras (`bootstrap()`)                                                                                                                                                                                  |                     |                                  |                                |                                                    |
| `uiDir`                                        | `resolveUiDir(import.meta.url)` from the product's own module (the kit can't know `dist/ui`)                                                                                                                                                                                            |                     |                                  |                                |                                                    |
| `mapError` error map                           | each product's names → statuses/codes (e.g. au `ValidationError` 422, `PORTAL_TOKEN`/`VIEWER_TOKEN` codes)                                                                                                                                                                              |                     |                                  |                                |                                                    |
| `buildOpenApiDocument({ version })`            | the product's API/package version (was a hard-coded `0.1.0` in wh/fl/au)                                                                                                                                                                                                                |                     |                                  |                                |                                                    |
| hook reporter / log `source`                   | `createHookErrorReporter("@xtandard/<p>")`, `createLogHook({ source, describe })` (fl `project/env`, en customer)                                                                                                                                                                       |                     |                                  |                                |                                                    |
| CLI storage roles + persisted names            | every `StorageRoleDefaults` field the previous CLI used: `prefix`, `pgTable`, `mongoDb`, `mongoCollection`, `sqlitePath`, **`sqliteTable`**, `libsqlUrl`, `fileDir`; the driver env var (`driverEnv`); `allowed` drivers. Or the product's own `drivers` registry of wrapped factories. |                     |                                  |                                |                                                    |
| Elysia `createPass` `name`                     | `xtandard-<product>` (plus the typed chain, which stays in the product)                                                                                                                                                                                                                 |                     |                                  |                                |                                                    |

Behaviour changes inherited as fixes (product CHANGELOG "Fixed"):

- unknown `AUTH_MODE` / `STORAGE_DRIVER` fail;
- empty env vars fall back to defaults;
- multiple `Set-Cookie` headers are kept, and responses are streamed;
- index.html escaping;
- malformed `%` → 404;
- every panel gets `/healthcheck` and `no-cache` SPA HTML;
- `405` + `Allow` (router and panel);
- foreign-bundle domain errors map by name;
- `Bearer` accepted case-insensitively;
- Elysia PATCH/DELETE bodies and stale `content-length`.

## Notes

- `isNamed(error, name)` replaces the products' `isNamed(err, Ctor, name)`.
- `ValidationError` has `errors` plus an `issues` alias. en keeps its `InputValidationError` via `parseInput(…, { error })`.
- Bun 1.3.14 (the CI pin): `node:http`'s `closeAllConnections()` stops the server; `startServer().stop()` handles it.
- Elysia mis-routes one-character hosts (`http://h/`); use `localhost` in tests.
