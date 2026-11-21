/**
 * JSON helpers shared across the kit: canonical forms (object keys sorted recursively) for
 * order-insensitive comparison and compare-and-swap, own-property structural equality, and the
 * JSON value types.
 *
 * @module
 */

/** A JSON-serialisable value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * What {@link canonicalStringify} accepts: a {@link JsonValue} whose object members (and array
 * items) may also be `undefined`. Undefined members are dropped and undefined items become `null`,
 * exactly as `JSON.stringify` does.
 */
export type CanonicalInput =
  | string
  | number
  | boolean
  | null
  | undefined
  | CanonicalInput[]
  | { [key: string]: CanonicalInput };

/** A JSON object. */
export type JsonObject = { [key: string]: JsonValue };

/**
 * A JSON-equivalent copy of `value` with object keys sorted recursively, so two structurally equal
 * values serialise identically. `JSON.stringify` semantics apply first (`undefined` members are
 * dropped, `toJSON` is honoured, non-finite numbers become `null`).
 */
export function canonical<T>(value: T): T {
  if (value === undefined) return value;
  return sortKeys(JSON.parse(JSON.stringify(value)) as unknown) as T;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort())
    out[key] = sortKeys((value as Record<string, unknown>)[key]);
  return out;
}

/** `JSON.stringify` of the {@link canonical} form: equal values ⇒ equal strings. */
export const canonicalJson = (value: unknown): string => JSON.stringify(canonical(value));

/**
 * Strict canonical serialisation (keys sorted at every depth, no whitespace) for byte formats that
 * must not silently change values — e.g. integrity hashes and idempotency comparison. Unlike
 * {@link canonicalJson} it **throws** on non-finite numbers instead of writing `null`. Matches RFC 8785
 * (JCS) for strings and integers. A top-level `undefined` serialises as `null`.
 */
export function canonicalStringify(value: CanonicalInput): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`canonicalStringify: non-finite number ${value}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalStringify(v)).join(",")}]`;
  const entries = Object.keys(value)
    .sort()
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Structural equality for JSON-shaped values: key order ignored, arrays ordered, and own
 * properties only (`{a: undefined}` is not equal to `{b: undefined}`).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * Normalise a JSON column value: `pg`, `pglite` and Drizzle usually return `json`/`jsonb` already
 * parsed; a string is parsed defensively (and returned as-is if it is not JSON).
 */
export function parseJsonValue<T>(value: unknown): T {
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}
