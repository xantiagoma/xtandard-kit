/**
 * `@xtandard/kit/server` — the HTTP side of a panel: `createPanelHandler`
 * (healthcheck, API, OpenAPI, static UI, SPA fallback, CORS, `close()`), the
 * index.html renderer, base-path and CORS helpers, and the plumbing for
 * product API routers (`json`, `error`, `match`, `intParam`, `mapError`,
 * `authenticate` with the scoped-token short-circuit, `authorize`).
 *
 * `node:fs` is only loaded when static files are served, so the panel API
 * runs on Workers too.
 *
 * @module
 */

export { normalizeBasePath, stripBasePath } from "./server/base-path.ts";
export { applyCorsHeaders, preflightResponse, type CorsOptions } from "./server/cors.ts";
export {
  authenticate,
  authorize,
  error,
  HttpError,
  intParam,
  json,
  JSON_CONTENT_TYPE,
  mapError,
  match,
  methodNotAllowed,
  noContent,
  requireOneOf,
  type AuthenticateOptions,
  type Authenticated,
  type AuthorizeOptions,
  type ErrorMap,
  type ErrorMapping,
  type IntParamOptions,
  type ScopedAuth,
} from "./server/http.ts";
export {
  createPanelHandler,
  intervalTask,
  type IntervalTaskOptions,
  type PanelHandler,
  type PanelOptions,
  type PanelTask,
} from "./server/panel.ts";
export {
  renderIndexHtml,
  type BootstrapConfig,
  type RenderIndexHtmlOptions,
} from "./server/render-index-html.ts";
export { looksLikeAsset, resolveUiDir, serveStaticAsset } from "./server/static-assets.ts";
