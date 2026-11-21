/**
 * Entity id generation, in the three formats the products persist (ADR 0005:
 * a product keeps the format its stored ids already use).
 *
 * | format           | shape                                                       | sortable | used by        |
 * | ---------------- | ----------------------------------------------------------- | -------- | -------------- |
 * | `"ulid"`         | `prefix_` + 26 Crockford base32 (10 time + 16 random), A–Z  | yes      | audit, links   |
 * | `"ulid-lower22"` | `prefix_` + 22 lowercase Crockford (10 time + 12 random)    | yes      | entitlements   |
 * | `"base62"`       | `prefix_` + 22 base62 characters (128 random bits)          | no       | webhooks       |
 *
 * The time-sortable formats encode integer milliseconds (fractional clock
 * values are floored) and are **monotonic within a generator**: ids minted in
 * the same millisecond, or under a clock that goes backwards, increment the
 * random part, so lexicographic order equals creation order. Each generator
 * keeps its own state. Zero dependencies (Web Crypto).
 *
 * @module
 */

/** The id formats {@link createIdGenerator} supports. */
export type IdFormat = "ulid" | "ulid-lower22" | "base62";

/** Options for {@link createIdGenerator}. */
export interface IdGeneratorOptions<Prefix extends string = string> {
  /** The id format. Persisted ids depend on it, so a product never changes it. */
  format: IdFormat;
  /**
   * The allowed prefixes. When given, the prefix union is inferred from it and
   * `newId` rejects any other prefix at runtime.
   */
  prefixes?: readonly Prefix[];
  /** Clock for the time-sortable formats (unix ms). Default `Date.now`. */
  now?: () => number;
}

/** What {@link createIdGenerator} returns. */
export interface IdGenerator<Prefix extends string = string> {
  /** The generator's format. */
  readonly format: IdFormat;
  /** A new id, e.g. `newId("evt")` → `"evt_01JD…"`. `ms` overrides the clock for this id. */
  newId(prefix: Prefix, ms?: number): string;
  /** The regex an id of `prefix` must match. */
  idPattern(prefix: Prefix): RegExp;
  /**
   * The unix-ms timestamp embedded in a time-sortable id, or `null` when the
   * id is malformed or the format (`base62`) embeds no time.
   */
  idTime(id: string): number | null;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TIME_LEN = 10;
const MAX_TIME = 32 ** TIME_LEN - 1;

interface SortableSpec {
  alphabet: string;
  randomLen: number;
  charClass: string;
}

const SORTABLE: Record<"ulid" | "ulid-lower22", SortableSpec> = {
  ulid: { alphabet: CROCKFORD, randomLen: 16, charClass: "[0-9A-HJKMNP-TV-Z]" },
  "ulid-lower22": {
    alphabet: CROCKFORD.toLowerCase(),
    randomLen: 12,
    charClass: "[0-9a-hjkmnp-tv-z]",
  },
};

function randomDigits(length: number): number[] {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // 256 is a multiple of 32: `b % 32` is unbiased.
  return Array.from(bytes, (b) => b % 32);
}

/** Increment a base32 digit array by one (carry to the left); `null` on overflow. */
function increment(digits: number[]): number[] | null {
  const next = digits.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if ((next[i] as number) < 31) {
      next[i] = (next[i] as number) + 1;
      return next;
    }
    next[i] = 0;
  }
  return null;
}

function encodeTime(ms: number, alphabet: string): string {
  let out = "";
  let value = ms;
  for (let i = 0; i < TIME_LEN; i++) {
    out = alphabet[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function randomBase62(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  while (value > 0n) {
    out = BASE62[Number(value % 62n)] + out;
    value /= 62n;
  }
  return out.padStart(22, "0");
}

/**
 * Create an id generator for one product. The prefix union is a type
 * parameter, so `newId("typo")` fails to compile.
 *
 * @example
 * ```ts
 * import { createIdGenerator } from "@xtandard/kit/util";
 *
 * export const { newId, idPattern, idTime } = createIdGenerator({
 *   format: "ulid",
 *   prefixes: ["evt", "chk"],
 * });
 * newId("evt"); // "evt_01JD3Z…" — sorts by creation time
 * ```
 */
export function createIdGenerator<const Prefix extends string = string>(
  options: IdGeneratorOptions<Prefix>,
): IdGenerator<Prefix> {
  const { format } = options;
  const allowed = options.prefixes ? new Set<string>(options.prefixes) : null;
  const checkPrefix = (prefix: string): void => {
    if (allowed && !allowed.has(prefix)) {
      throw new TypeError(`newId: unknown id prefix "${prefix}"`);
    }
  };
  if (format === "base62") {
    return {
      format,
      newId: (prefix) => {
        checkPrefix(prefix);
        return `${prefix}_${randomBase62()}`;
      },
      idPattern: (prefix) => new RegExp(`^${escapeRegex(prefix)}_[0-9A-Za-z]{22}$`),
      idTime: () => null,
    };
  }
  const spec = SORTABLE[format];
  if (!spec) throw new TypeError(`createIdGenerator: unknown format "${String(format)}"`);
  const clock = options.now ?? Date.now;
  let lastTime = -1;
  let lastRandom: number[] = [];

  const sortable = (input: number): string => {
    let ms = Math.min(Math.max(0, Math.floor(input)), MAX_TIME);
    let random: number[] | null = null;
    if (ms <= lastTime) {
      random = increment(lastRandom);
      // Random part exhausted within one millisecond: move to the next one.
      if (random) ms = lastTime;
      else ms = lastTime + 1;
    }
    random ??= randomDigits(spec.randomLen);
    lastTime = ms;
    lastRandom = random;
    return encodeTime(ms, spec.alphabet) + random.map((d) => spec.alphabet[d]).join("");
  };

  return {
    format,
    newId: (prefix, ms) => {
      checkPrefix(prefix);
      return `${prefix}_${sortable(ms ?? clock())}`;
    },
    idPattern: (prefix) =>
      new RegExp(`^${escapeRegex(prefix)}_${spec.charClass}{${TIME_LEN + spec.randomLen}}$`),
    idTime(id) {
      const start = id.indexOf("_") + 1;
      const raw = id.slice(start, start + TIME_LEN);
      if (raw.length !== TIME_LEN) return null;
      let ms = 0;
      for (const ch of raw) {
        const digit = spec.alphabet.indexOf(ch);
        if (digit === -1) return null;
        ms = ms * 32 + digit;
      }
      return ms;
    },
  };
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
