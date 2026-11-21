/**
 * The validation core shared by the products, built on `valibot` (the kit's
 * only runtime dependency): the issue and error types, a valibot issue mapper,
 * `parseInput`, a finite JSON-value schema, the storage key-segment check and
 * a URL policy check. Product schemas stay in the products.
 *
 * @module
 */

import * as v from "valibot";
import type { JsonObject, JsonValue } from "../internal/json.ts";

/** A single validation problem with a dotted path into the offending data. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** Result of a `validate*` function. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}

/**
 * Raised when an input fails validation. It carries the issues as both
 * `errors` (webhooks/audit/links) and `issues` (entitlements); they are the
 * same array.
 */
export class ValidationError extends Error {
  readonly errors: ValidationIssue[];
  constructor(errors: ValidationIssue[], message?: string) {
    super(
      message ??
        `Validation failed:\n${errors.map((e) => `  - ${e.path ? `${e.path}: ` : ""}${e.message}`).join("\n")}`,
    );
    this.name = "ValidationError";
    this.errors = errors;
  }
  /** Alias of {@link ValidationError.errors}. */
  get issues(): ValidationIssue[] {
    return this.errors;
  }
}

/** Throw a {@link ValidationError} when `result` is invalid. */
export function assertValid(result: ValidationResult): void {
  if (!result.valid) throw new ValidationError(result.errors);
}

/** A `{ valid, errors }` result from a list of issues. */
export const resultOf = (errors: ValidationIssue[]): ValidationResult => ({
  valid: errors.length === 0,
  errors,
});

/**
 * Map valibot issues to {@link ValidationIssue}s under `basePath`. A root
 * issue gets `basePath` itself (no trailing `.`); a strict object's extra key
 * (valibot reports it as "expected never") reads `"unknown field"`.
 *
 * @example
 * ```ts
 * const r = v.safeParse(schema, input);
 * if (!r.success) return { valid: false, errors: issuesFrom(r.issues, "link") };
 * ```
 */
export function issuesFrom(
  issues: readonly v.BaseIssue<unknown>[],
  basePath = "",
): ValidationIssue[] {
  return issues.map((issue) => {
    const sub = (issue.path ?? []).map((p) => String(p.key)).join(".");
    const path = sub ? (basePath ? `${basePath}.${sub}` : sub) : basePath;
    return { path, message: issue.expected === "never" ? "unknown field" : issue.message };
  });
}

/** Options for {@link parseInput}. */
export interface ParseInputOptions {
  /** Prefix for every issue path. Default `""` (paths are relative to the input). */
  basePath?: string;
  /**
   * Build the error to throw. Default: a {@link ValidationError}. A product
   * passes its own error class here to keep its `name`/HTTP mapping.
   */
  error?: (issues: ValidationIssue[]) => Error;
}

/**
 * Validate `input` against `schema`; return the typed output or throw a
 * {@link ValidationError} listing every issue.
 *
 * @example
 * ```ts
 * const grant = parseInput(grantSchema, await request.json());
 * ```
 */
export function parseInput<S extends v.GenericSchema>(
  schema: S,
  input: unknown,
  options: ParseInputOptions = {},
): v.InferOutput<S> {
  const result = v.safeParse(schema, input);
  if (result.success) return result.output;
  const issues = issuesFrom(result.issues, options.basePath);
  throw options.error ? options.error(issues) : new ValidationError(issues);
}

/**
 * A valibot schema for a JSON value. Numbers must be **finite**: `NaN` and
 * `±Infinity` would silently serialise to `null`.
 */
export const jsonValueSchema: v.GenericSchema<JsonValue> = v.lazy(() =>
  v.union([
    v.string(),
    v.pipe(v.number(), v.finite()),
    v.boolean(),
    v.null(),
    v.array(jsonValueSchema),
    v.record(v.string(), jsonValueSchema),
  ]),
);

/** A valibot schema for a JSON object (finite numbers, see {@link jsonValueSchema}). */
export const jsonObjectSchema: v.GenericSchema<unknown, JsonObject> = v.pipe(
  v.custom<object>(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value),
    "must be an object",
  ),
  v.record(v.string(), jsonValueSchema),
);

/** The characters allowed in a caller-supplied storage key segment. */
export const KEY_SEGMENT_REGEX = /^[a-zA-Z0-9._-]+$/;

/**
 * Check a caller-supplied value that becomes one storage key segment (a
 * tenant, an idempotency key…). It must be a non-empty string of
 * {@link KEY_SEGMENT_REGEX} characters and must not be only dots, so it can't
 * escape its namespace (`..`) or collide with the separator. `maxLength` caps it (webhooks: 256).
 */
export function validateKeySegment(
  value: unknown,
  path: string,
  options: { maxLength?: number } = {},
): ValidationIssue[] {
  if (typeof value !== "string" || value.length === 0) return [{ path, message: "is required" }];
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    return [{ path, message: `must be at most ${options.maxLength} characters` }];
  }
  if (!KEY_SEGMENT_REGEX.test(value)) return [{ path, message: `must match ${KEY_SEGMENT_REGEX}` }];
  if (/^\.+$/.test(value)) return [{ path, message: `"${value}" is not an allowed key` }];
  return [];
}

/** Schemes {@link validateUrl} always rejects: they run code or read local data. */
export const FORBIDDEN_URL_SCHEMES: ReadonlySet<string> = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "blob:",
  "about:",
]);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Options for {@link validateUrl}. */
export interface UrlPolicyOptions {
  /**
   * Allowed schemes, with the trailing colon (`["https:", "http:"]`). Default:
   * any scheme except {@link FORBIDDEN_URL_SCHEMES} (app deep links such as
   * `myapp://` pass).
   */
  allowedSchemes?: readonly string[];
  /**
   * Reject plain `http:` except for localhost (see `allowLocalhost`). Default
   * `false`. Webhook endpoints set it; link destinations don't.
   */
  requireHttps?: boolean;
  /** With `requireHttps`, still accept `http:` for localhost / loopback. Default `true`. */
  allowLocalhost?: boolean;
  /** Reject URLs with embedded credentials (`https://user:pass@…`). Default `false`. */
  rejectCredentials?: boolean;
  /** Maximum length. Default `8192`. */
  maxLength?: number;
  /**
   * Extra host-supplied check (an SSRF denylist…). Return a message or `false`
   * to reject; `true`, `null` or `undefined` to accept.
   */
  policy?: (url: URL) => string | boolean | null | undefined;
}

/**
 * Check an absolute URL against a policy; returns the issues (empty when the
 * URL is acceptable). Dangerous schemes are always rejected.
 *
 * @example
 * ```ts
 * // A webhook endpoint: https only (http on localhost), no credentials.
 * validateUrl(url, "endpoint.url", {
 *   allowedSchemes: ["https:", "http:"],
 *   requireHttps: true,
 *   rejectCredentials: true,
 * });
 * ```
 */
export function validateUrl(
  value: unknown,
  path: string,
  options: UrlPolicyOptions = {},
): ValidationIssue[] {
  if (typeof value !== "string" || value.length === 0) return [{ path, message: "is required" }];
  const maxLength = options.maxLength ?? 8192;
  if (value.length > maxLength) {
    return [{ path, message: `must be at most ${maxLength} characters` }];
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return [{ path, message: "must be an absolute URL" }];
  }
  if (FORBIDDEN_URL_SCHEMES.has(url.protocol)) {
    return [{ path, message: `scheme ${url.protocol} is not allowed` }];
  }
  if (options.allowedSchemes && !options.allowedSchemes.includes(url.protocol)) {
    return [{ path, message: `unsupported protocol "${url.protocol}"` }];
  }
  const web = url.protocol === "http:" || url.protocol === "https:";
  if (web && !url.hostname) return [{ path, message: "must have a host" }];
  if (options.rejectCredentials && (url.username || url.password)) {
    return [{ path, message: "URL must not contain credentials" }];
  }
  if (
    options.requireHttps &&
    url.protocol === "http:" &&
    !((options.allowLocalhost ?? true) && LOCAL_HOSTS.has(url.hostname))
  ) {
    return [{ path, message: "http URLs are only allowed for localhost" }];
  }
  const verdict = options.policy?.(url);
  if (typeof verdict === "string") return [{ path, message: verdict }];
  if (verdict === false) return [{ path, message: "URL rejected by the configured policy" }];
  return [];
}
