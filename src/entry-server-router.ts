/**
 * `@xtandard/kit/server/router` — the optional declarative router: one route
 * table drives dispatch, auth, authorization, readonly, `405` + `Allow`, body
 * validation and the generated OpenAPI 3.1 document.
 *
 * @module
 */

export {
  createRouter,
  type Call,
  type Route,
  type RouteMethod,
  type RouteQueryParam,
  type Router,
  type RouterOptions,
  type RouteSpec,
} from "./server/router.ts";
export {
  buildOpenApiDocument,
  ERROR_SCHEMA,
  errorResponse,
  openApiOperation,
  ref,
  toOpenApiPath,
  type OpenApiOptions,
} from "./server/openapi.ts";
