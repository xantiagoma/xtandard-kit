/**
 * HTTP plumbing shared by the products' API routers: JSON responses, a safe
 * `:param` matcher, integer query params, domain-error mapping by name, the
 * authentication step (with the scoped-token short-circuit) and the
 * authorization step that keeps scoped principals away from the host's
 * provider.
 *
 * @module
 */

import type { AuthProvider, Principal } from "../auth/contract.ts";
import type { AuthorizationProvider } from "../authorization/contract.ts";
import { hookDeniedStatus } from "../hooks/contract.ts";
import { TokenError } from "../tokens/scoped.ts";

/** Content type of every JSON response. */
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** A JSON response. */
export const json = (data: unknown, status = 200, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": JSON_CONTENT_TYPE, ...headers },
  });

/** A JSON error response: `{ error: message, ...extra }`. */
export const error = (
  status: number,
  message: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
): Response => json({ error: message, ...extra }, status, headers);

/** `405` with the `Allow` header listing the methods the path supports. */
export const methodNotAllowed = (allow: Iterable<string>): Response =>
  error(405, "Method Not Allowed", undefined, { allow: [...new Set(allow)].join(", ") });

/** An empty `204`. */
export const noContent = (): Response => new Response(null, { status: 204 });

/** Throw inside a router to short-circuit with `error(status, message, extra)`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Match `pattern` (with `:name` segments) against `path`; returns the decoded
 * params, or `null`. A malformed `%` escape is **no match** (404), never a
 * thrown `URIError` (500).
 */
export function match(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const ap = path.split("/").filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i] as string;
    const val = ap[i] as string;
    if (seg.startsWith(":")) {
      try {
        params[seg.slice(1)] = decodeURIComponent(val);
      } catch {
        return null;
      }
    } else if (seg !== val) return null;
  }
  return params;
}

/** Options for {@link intParam}. */
export interface IntParamOptions {
  /**
   * What an unparseable value does: `"throw"` an {@link HttpError} 400
   * (audit, entitlements) or `"ignore"` it as if absent (webhooks, flags,
   * links). Part of a product's HTTP contract (ADR 0010). Default `"throw"`.
   */
  invalid?: "throw" | "ignore";
  /** Require a value > 0 (fractions are floored). With `false`, any integer. Default `true`. */
  positive?: boolean;
  /** The parameter name, for the error message. */
  name?: string;
}

/** Parse an integer query param; `undefined` when absent or empty. */
export function intParam(value: string | null, options: IntParamOptions = {}): number | undefined {
  if (value === null || value === "") return undefined;
  const positive = options.positive ?? true;
  const n = Number(value);
  const ok = positive ? Number.isFinite(n) && n > 0 : Number.isInteger(n);
  if (ok) return positive ? Math.floor(n) : n;
  if (options.invalid === "ignore") return undefined;
  const what = positive ? "a positive integer" : "an integer";
  throw new HttpError(
    400,
    `Invalid query parameter${options.name ? ` ${options.name}` : ""}: expected ${what}, got "${value}"`,
  );
}

/** How one named domain error maps to a response. */
export type ErrorMapping =
  | { status: number; code?: string; extra?: (error: Error) => Record<string, unknown> }
  | ((error: Error) => Response);

/**
 * Domain errors by `name` → response. Names, not classes, so an error thrown
 * from another bundle's copy of the class still maps (see `isNamed`).
 */
export type ErrorMap = Record<string, ErrorMapping>;

/**
 * Map an error to a response:
 *
 * 1. {@link HttpError} → its status and extras.
 * 2. An entry of `errors` matching the error's `name`.
 * 3. Built-ins (each overridable by an `errors` entry of the same name):
 *    `HookDeniedError` (any bundle) → its status, `code: "HOOK_DENIED"`; a
 *    kit `TokenError`, or any error named `*TokenError` (`PortalTokenError`,
 *    `ViewerTokenError` from another bundle) → 401 `code: "TOKEN"`; `ValidationError` → 400 `code: "VALIDATION"`
 *    with `errors`; `SyntaxError` → 400 "Invalid JSON body".
 * 4. Anything else → 500 with the error message.
 */
export function mapError(err: unknown, errors: ErrorMap = {}): Response {
  if (err instanceof HttpError) return error(err.status, err.message, err.extra);
  if (typeof err === "object" && err !== null && typeof (err as Error).name === "string") {
    const e = err as Error;
    const mapping = Object.hasOwn(errors, e.name) ? errors[e.name] : undefined;
    if (typeof mapping === "function") return mapping(e);
    if (mapping) {
      return error(mapping.status, e.message, {
        ...(mapping.code ? { code: mapping.code } : {}),
        ...mapping.extra?.(e),
      });
    }
    const denied = hookDeniedStatus(e);
    if (denied !== null) return error(denied, e.message, { code: "HOOK_DENIED" });
    if (e instanceof TokenError || e.name.endsWith("TokenError"))
      return error(401, e.message, { code: "TOKEN" });
    if (e.name === "ValidationError") {
      const list = (e as { errors?: unknown }).errors;
      return error(400, e.message, { code: "VALIDATION", errors: Array.isArray(list) ? list : [] });
    }
    if (e.name === "SyntaxError") return error(400, "Invalid JSON body", { code: "VALIDATION" });
    return error(500, typeof e.message === "string" && e.message ? e.message : "Internal error");
  }
  return error(500, "Internal error");
}

/** How a product verifies its scoped (portal / viewer) tokens. */
export interface ScopedAuth<Grant> {
  /** The token prefix (`"whpt_"`…). A `Bearer <prefix>…` header takes the scoped lane. */
  prefix: string;
  /** Verify the token; throw (e.g. a `TokenError`) when it is invalid or expired. */
  verify(token: string, request: Request): Promise<Grant>;
  /** The principal a verified grant acts as (e.g. `{ id: "portal:acme" }`). */
  principal(grant: Grant): Principal;
}

/** The outcome of {@link authenticate}. */
export interface Authenticated<Grant> {
  principal: Principal | null;
  /** The verified scoped-token grant, or `null` for host-authenticated (or anonymous) requests. */
  scoped: Grant | null;
}

/** Options for {@link authenticate}. */
export interface AuthenticateOptions<Grant> {
  /** The host's provider. */
  auth: AuthProvider;
  /** The product's scoped tokens, when configured. */
  scoped?: ScopedAuth<Grant>;
}

const BEARER = /^bearer\s+/i;

/**
 * Authenticate a request.
 *
 * - A `Bearer <prefix>…` token **short-circuits** the host's provider: a valid
 *   token yields the scoped principal; an invalid or expired one throws
 *   (→ 401 through {@link mapError}). It never falls back to the host's auth
 *   with an explicitly presented, rejected credential.
 * - Otherwise the host's provider runs. **If it throws, the error propagates**
 *   (→ 500): a broken identity provider is a server failure, not bad
 *   credentials. `null` means "not authenticated".
 */
export async function authenticate<Grant>(
  request: Request,
  options: AuthenticateOptions<Grant>,
): Promise<Authenticated<Grant>> {
  const header = request.headers.get("authorization") ?? "";
  if (options.scoped && BEARER.test(header)) {
    const token = header.replace(BEARER, "").trim();
    if (token.startsWith(options.scoped.prefix)) {
      const grant = await options.scoped.verify(token, request);
      return { principal: options.scoped.principal(grant), scoped: grant };
    }
  }
  return { principal: await options.auth.authenticate(request), scoped: null };
}

/** Options for {@link authorize}. */
export interface AuthorizeOptions<Action extends string, Resource, Grant> {
  /** The host's provider, consulted for host-authenticated principals only. */
  authorization: AuthorizationProvider<Action, Resource>;
  /**
   * Decide what a scoped grant may do. Without it, scoped principals are denied
   * everything.
   */
  scope?: (grant: Grant, action: Action, resource: Resource) => boolean | Promise<boolean>;
}

/**
 * Authorize an authenticated request. A scoped principal is decided by
 * `scope` alone — the host's provider is **not consulted** (defence in depth:
 * a permissive host policy can't widen a token).
 */
export async function authorize<Action extends string, Resource, Grant>(
  who: Authenticated<Grant>,
  input: { action: Action; resource: Resource; request: Request },
  options: AuthorizeOptions<Action, Resource, Grant>,
): Promise<boolean> {
  if (who.scoped !== null) {
    return options.scope ? await options.scope(who.scoped, input.action, input.resource) : false;
  }
  return await options.authorization.authorize({ principal: who.principal, ...input });
}

/**
 * Throw a clear error when none of `keys` is set on `options` — the "requires
 * `storage` or a prebuilt `core`" guard every product's panel needs.
 *
 * @example
 * ```ts
 * requireOneOf("createFetchHandler", options, ["storage", "core"]);
 * // Error: createFetchHandler requires either `storage` or `core`.
 * ```
 */
export function requireOneOf(caller: string, options: object, keys: readonly string[]): void {
  const set = options as Record<string, unknown>;
  if (keys.some((k) => set[k] !== undefined && set[k] !== null)) return;
  const list = keys.map((k) => `\`${k}\``);
  const what =
    list.length > 1 ? `either ${list.slice(0, -1).join(", ")} or ${list.at(-1)}` : list[0];
  throw new TypeError(`${caller} requires ${what}.`);
}
