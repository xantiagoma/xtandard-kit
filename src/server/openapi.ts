/**
 * OpenAPI 3.1 generation from a route table (entitlements' design): every
 * operation, its parameters, request body, success response and the standard
 * error responses are derived from the {@link RouteSpec}s, so the document
 * cannot drift from the router.
 *
 * The product supplies the component schemas, tags, descriptions and its
 * readonly status; the document `version` is an explicit option (the copies
 * hard-coded `"0.1.0"`).
 *
 * @module
 */

import type { RouteSpec } from "./router.ts";

type Schema = Record<string, unknown>;

/** Options for {@link buildOpenApiDocument}. */
export interface OpenApiOptions<Action extends string = string, Tag extends string = string> {
  /** The documented routes (hidden ones are skipped). */
  routes: readonly RouteSpec<Action, Tag>[];
  /** `info.title`. */
  title: string;
  /**
   * `info.version` — the HTTP API version (entitlements: `"1"`) or the package
   * version (links). Required: never a hard-coded default.
   */
  version: string;
  /** `info.description`. */
  description?: string;
  /** Mount prefix used in the `servers` url (e.g. `"/webhooks"`). */
  basePath?: string;
  /** Tag descriptions, in display order. */
  tags?: readonly { name: Tag; description?: string }[];
  /** `components.schemas`. Route `body`/`response.schema` names refer to these. */
  schemas?: Record<string, Schema>;
  /**
   * `components.securitySchemes`. Default: `basicAuth` and `bearerAuth` (the
   * latter described with `bearerDescription`).
   */
  securitySchemes?: Record<string, Schema>;
  /** Description of the default `bearerAuth` scheme, e.g. "Portal tokens (whpt_…)". */
  bearerDescription?: string;
  /** Which actions the readonly switch blocks (documents the readonly status on them). */
  isMutatingAction?: (action: Action) => boolean;
  /** Status of a readonly denial (403 or 423). Default `403`. */
  readonlyStatus?: number;
  /** Adjust one generated operation (extra responses, headers, examples…). */
  operation?: (spec: RouteSpec<Action, Tag>, operation: Schema) => Schema;
  /** Extra top-level fields merged into the document. */
  extra?: Schema;
}

/** `{ $ref: "#/components/schemas/<name>" }`. */
export const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

/** The `{ error, code? }` body every error response uses. */
export const ERROR_SCHEMA: Schema = {
  type: "object",
  properties: { error: { type: "string" }, code: { type: "string" } },
  required: ["error"],
  additionalProperties: true,
};

/** A JSON error response object with `description`. */
export const errorResponse = (description: string): Schema => ({
  description,
  content: { "application/json": { schema: ref("Error") } },
});

/** `/a/:id/b` → `/a/{id}/b`. */
export const toOpenApiPath = (path: string): string =>
  path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");

const PARAM = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/** The success response object of a route. */
function responseOf(spec: RouteSpec): Schema {
  const { status, schema, description } = spec.response;
  if (status === 204 || schema === undefined) return { description };
  return {
    description,
    content: {
      "application/json": { schema: typeof schema === "string" ? ref(schema) : schema },
    },
  };
}

/** The OpenAPI operation object for one route. */
export function openApiOperation<Action extends string, Tag extends string>(
  spec: RouteSpec<Action, Tag>,
  options: Pick<OpenApiOptions<Action, Tag>, "isMutatingAction" | "readonlyStatus"> = {},
): Schema {
  const responses: Record<string, Schema> = { [String(spec.response.status)]: responseOf(spec) };
  if (spec.body || spec.query?.length) responses["400"] = errorResponse("Invalid input");
  if (spec.action !== undefined) {
    responses["401"] = errorResponse("Not authenticated");
    responses["403"] = errorResponse("Not authorized for this action");
    if (options.isMutatingAction?.(spec.action)) {
      responses[String(options.readonlyStatus ?? 403)] = errorResponse(
        options.readonlyStatus === 423
          ? "The panel is readonly"
          : "Not authorized for this action, or the panel is readonly",
      );
    }
  }
  if (spec.path.includes(":")) responses["404"] = errorResponse("Not found");
  const parameters: Schema[] = [
    ...[...spec.path.matchAll(PARAM)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    })),
    ...(spec.query ?? []).map((q) => ({
      name: q.name,
      in: "query",
      required: q.required ?? false,
      description: q.description,
      schema: { type: q.type },
    })),
  ];
  return {
    operationId: spec.operationId,
    tags: [spec.tag],
    summary: spec.summary,
    ...(spec.description ? { description: spec.description } : {}),
    ...(spec.action !== undefined ? { "x-action": spec.action } : { security: [] }),
    ...(parameters.length ? { parameters } : {}),
    ...(spec.body
      ? {
          requestBody: {
            required: spec.bodyRequired ?? true,
            content: { "application/json": { schema: ref(spec.body) } },
          },
        }
      : {}),
    responses,
  };
}

/**
 * Build the OpenAPI 3.1 document for a route table.
 *
 * @example
 * ```ts
 * const openapi = () =>
 *   buildOpenApiDocument({ routes: ROUTES, title, version: VERSION, basePath, schemas, tags });
 * ```
 */
export function buildOpenApiDocument<Action extends string, Tag extends string>(
  options: OpenApiOptions<Action, Tag>,
): Record<string, unknown> {
  if (!options.version) throw new TypeError("buildOpenApiDocument: a version is required");
  const paths: Record<string, Record<string, Schema>> = {};
  for (const spec of options.routes) {
    if (spec.hidden) continue;
    const generated = openApiOperation(spec, options);
    const p = (paths[toOpenApiPath(spec.path)] ??= {});
    p[spec.method.toLowerCase()] = options.operation
      ? options.operation(spec, generated)
      : generated;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: options.title,
      version: options.version,
      ...(options.description ? { description: options.description } : {}),
    },
    servers: [{ url: options.basePath || "/" }],
    ...(options.tags?.length ? { tags: options.tags } : {}),
    security: [{ basicAuth: [] }, { bearerAuth: [] }],
    paths,
    components: {
      schemas: { Error: ERROR_SCHEMA, ...options.schemas },
      securitySchemes: options.securitySchemes ?? {
        basicAuth: { type: "http", scheme: "basic" },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          ...(options.bearerDescription ? { description: options.bearerDescription } : {}),
        },
      },
    },
    ...options.extra,
  };
}
