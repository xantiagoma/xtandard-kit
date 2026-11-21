/**
 * A declarative API router (entitlements' design, made generic): one route
 * table drives dispatch, authentication, authorization, the readonly switch,
 * `405` + `Allow`, request-body validation, and the OpenAPI document
 * (`buildOpenApiDocument`), so the router and its docs cannot drift.
 *
 * Adopting it is optional per product (PLAN §1); the plumbing it is built on
 * (`json`, `match`, `mapError`, `authenticate`, `authorize`) is exported from
 * `@xtandard/kit/server` for hand-written routers.
 *
 * @module
 */

import type { GenericSchema, InferOutput } from "valibot";
import type { AuthProvider, Principal } from "../auth/contract.ts";
import type { AuthorizationProvider } from "../authorization/contract.ts";
import { parseInput, type ValidationIssue } from "../util/validation.ts";
import {
  authenticate,
  authorize,
  error,
  HttpError,
  mapError,
  match,
  methodNotAllowed,
  type Authenticated,
  type ErrorMap,
  type ScopedAuth,
} from "./http.ts";

/** HTTP methods the router serves (`HEAD` is answered by `GET` routes). */
export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A query parameter a route documents. */
export interface RouteQueryParam {
  name: string;
  type: "string" | "integer";
  description: string;
  required?: boolean;
}

/** The documented shape of one route (consumed by the OpenAPI builder). */
export interface RouteSpec<Action extends string = string, Tag extends string = string> {
  method: RouteMethod;
  /** Pattern with `:name` segments, base-path-relative. */
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tag: Tag;
  /** Authorization action; absent = public (no authentication). */
  action?: Action;
  query?: RouteQueryParam[];
  /** Component schema name of the JSON request body. */
  body?: string;
  /** Whether the body is required (default `true` when `body` is set). */
  bodyRequired?: boolean;
  /** Success status, component schema name (or inline JSON schema), description. */
  response: { status: number; schema?: string | Record<string, unknown>; description: string };
  /** Leave the route out of the OpenAPI document. */
  hidden?: boolean;
}

/** Per-request state handed to route handlers. */
export interface Call<Ctx, Grant = never> {
  request: Request;
  /** The base-path-stripped path. */
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** The product's context object (`RouterOptions.context`). */
  ctx: Ctx;
  principal: Principal | null;
  /** The scoped-token grant, or `null` for host principals and anonymous requests. */
  scoped: Grant | null;
  /** Parse + validate the JSON body (an empty body is `{}`). Memoized. */
  body<S extends GenericSchema>(schema: S): Promise<InferOutput<S>>;
}

/** A route: its spec plus the resource it targets and its handler. */
export interface Route<
  Action extends string = string,
  Resource = unknown,
  Ctx = unknown,
  Grant = never,
  Tag extends string = string,
> extends RouteSpec<Action, Tag> {
  /** The resource the action targets (required when `action` is set). */
  resource?(call: Call<Ctx, Grant>): Resource | Promise<Resource>;
  /**
   * Authenticate a public route anyway (e.g. `/config`, which reports the
   * principal). An authenticated-but-anonymous result is not an error.
   */
  authenticate?: boolean;
  handle(call: Call<Ctx, Grant>): Response | Promise<Response>;
}

/** Options for {@link createRouter}. */
export interface RouterOptions<
  Action extends string,
  Resource,
  Ctx,
  Grant = never,
  Tag extends string = string,
> {
  routes: readonly Route<Action, Resource, Ctx, Grant, Tag>[];
  /** Passed to every handler as `call.ctx`. */
  context: Ctx;
  auth: AuthProvider;
  authorization: AuthorizationProvider<Action, Resource>;
  /** Scoped tokens: verification plus what a grant may do. */
  scoped?: ScopedAuth<Grant> & {
    /** Decide a scoped principal's access; the host provider is never consulted for them. */
    allows(grant: Grant, action: Action, resource: Resource): boolean | Promise<boolean>;
  };
  /** Readonly panel. A function is read per request. Default `false`. */
  readonly?: boolean | (() => boolean);
  /** Which actions the readonly switch blocks. */
  isMutatingAction?: (action: Action) => boolean;
  /** Status of a readonly denial: 403 (webhooks, flags, links) or 423 (audit, entitlements). Default `403`. */
  readonlyStatus?: number;
  /** Message of a readonly denial. Default `"The panel is readonly"`. */
  readonlyMessage?: string | ((route: RouteSpec<Action>) => string);
  /** Domain errors by name (see `mapError`). */
  errors?: ErrorMap;
  /** Unmatched paths under this prefix answer a JSON 404 instead of `null`. Default `"/api/"`. */
  apiPrefix?: string;
  /** Build the error a body validation failure throws. Default: a kit `ValidationError`. */
  validationError?: (issues: ValidationIssue[]) => Error;
}

/** What {@link createRouter} returns. */
export interface Router<Action extends string, Resource, Ctx, Grant, Tag extends string> {
  /**
   * Handle an API request (`path` base-path-stripped). Returns `null` for a
   * path that is not an API route, so the panel serves the UI.
   */
  handle(request: Request, path: string): Promise<Response | null>;
  /** The route table (for `buildOpenApiDocument`). */
  readonly routes: readonly Route<Action, Resource, Ctx, Grant, Tag>[];
}

/**
 * Build a router from a route table.
 *
 * Per request: match (collecting the methods a path supports, `HEAD` served
 * by `GET`) → `405` + `Allow` if only the method is wrong → authenticate
 * (routes with an `action`, or `authenticate: true`) → `401` / challenge →
 * resource → authorize (scoped grants via `scoped.allows`, never the host
 * provider) → `403` → readonly (`readonlyStatus`) → handler. Every thrown
 * error goes through `mapError` with `errors`.
 *
 * @example
 * ```ts
 * const router = createRouter({
 *   routes: ROUTES,
 *   context: { core },
 *   auth,
 *   authorization,
 *   isMutatingAction,
 *   readonly,
 *   readonlyStatus: 423,
 *   errors: { NotFoundError: { status: 404, code: "NOT_FOUND" } },
 * });
 * createPanelHandler({ ..., api: router.handle });
 * ```
 */
export function createRouter<
  Action extends string,
  Resource,
  Ctx,
  Grant = never,
  Tag extends string = string,
>(
  options: RouterOptions<Action, Resource, Ctx, Grant, Tag>,
): Router<Action, Resource, Ctx, Grant, Tag> {
  const { routes } = options;
  const scoped = options.scoped as NonNullable<typeof options.scoped>;
  const apiPrefix = options.apiPrefix ?? "/api/";
  const readonlyStatus = options.readonlyStatus ?? 403;
  const readonlyMessage = (route: RouteSpec<Action>): string =>
    typeof options.readonlyMessage === "function"
      ? options.readonlyMessage(route)
      : (options.readonlyMessage ?? "The panel is readonly");
  const isReadonly =
    typeof options.readonly === "function"
      ? options.readonly
      : () => (options.readonly as boolean | undefined) ?? false;
  for (const route of routes) {
    if (route.action !== undefined && !route.resource) {
      throw new TypeError(
        `createRouter: route ${route.operationId} has an action but no resource()`,
      );
    }
  }

  async function handle(request: Request, path: string): Promise<Response | null> {
    const method = request.method.toUpperCase();
    let route: Route<Action, Resource, Ctx, Grant, Tag> | undefined;
    let params: Record<string, string> = {};
    const allowed = new Set<string>();
    for (const r of routes) {
      const m = match(r.path, path);
      if (!m) continue;
      allowed.add(r.method);
      if (r.method === "GET") allowed.add("HEAD");
      if (!route && (r.method === method || (method === "HEAD" && r.method === "GET"))) {
        route = r;
        params = m;
      }
    }
    if (!route) {
      if (allowed.size > 0) return methodNotAllowed(allowed);
      return path.startsWith(apiPrefix) ? error(404, "Not found") : null;
    }

    try {
      let who: Authenticated<Grant> = { principal: null, scoped: null };
      if (route.action !== undefined || route.authenticate) {
        who = await authenticate(request, {
          auth: options.auth,
          ...(options.scoped ? { scoped: options.scoped } : {}),
        });
      }

      let raw: Promise<unknown> | undefined;
      const call: Call<Ctx, Grant> = {
        request,
        path,
        params,
        query: new URL(request.url).searchParams,
        ctx: options.context,
        principal: who.principal,
        scoped: who.scoped,
        async body(schema) {
          raw ??= request.text().then((text) => {
            if (text.trim() === "") return {};
            try {
              return JSON.parse(text) as unknown;
            } catch {
              throw new HttpError(400, "Invalid JSON body", { code: "VALIDATION" });
            }
          });
          return parseInput(
            schema,
            await raw,
            options.validationError ? { error: options.validationError } : {},
          );
        },
      };

      if (route.action !== undefined) {
        if (who.principal === null) {
          return options.auth.challenge?.(request) ?? error(401, "Unauthorized");
        }
        const resource = await (route.resource as NonNullable<typeof route.resource>)(call);
        const ok = await authorize(
          who,
          { action: route.action, resource, request },
          {
            authorization: options.authorization,
            ...(options.scoped
              ? { scope: (g: Grant, a: Action, r: Resource) => scoped.allows(g, a, r) }
              : {}),
          },
        );
        if (!ok) return error(403, "Forbidden", { action: route.action });
        if (isReadonly() && options.isMutatingAction?.(route.action)) {
          return error(readonlyStatus, readonlyMessage(route), { code: "READONLY" });
        }
      }

      return await route.handle(call);
    } catch (err) {
      return mapError(err, options.errors);
    }
  }

  return { handle, routes };
}
