/**
 * Scoped tokens: compact HMAC-signed grants that scope their bearer to a
 * subset of a panel (one tenant, one customer, a few actions) for a limited
 * time. The products call them portal tokens (`whpt_`, `audpt_`, `entpt_`) or
 * viewer tokens (`lvt_`); the mechanics are the same, the claims differ.
 *
 * Wire format:
 *
 * ```txt
 * <prefix><base64url(JSON { ...claims, exp })>.<base64url(HMAC-SHA256(secret, payloadPart))>
 * ```
 *
 * - The secret is an **arbitrary string**, fed to the HMAC as raw UTF-8 bytes.
 *   An empty secret is rejected (it would let anyone mint tokens).
 * - The signature is checked first, in constant time; claims are never
 *   interpreted before it passes.
 * - `exp` is unix epoch milliseconds.
 * - **Rotation:** `verify` accepts a list of secrets. Mint with the new secret
 *   first in the list and keep the old one until its tokens have expired. The
 *   wire format has no key id, so tokens minted by older releases keep
 *   verifying.
 *
 * Zero dependencies (Web Crypto only), so it runs on Workers and in browsers.
 *
 * @module
 */

import { durationToMs, type Duration } from "../util/duration.ts";

/** Base class of every scoped-token error. Maps to HTTP 401 at the API layer. */
export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

/** One secret, or a rotation list (the first one signs, all of them verify). */
export type TokenSecret = string | readonly string[];

/** Options for {@link createScopedTokens}. */
export interface ScopedTokensOptions<Claims extends object> {
  /** Token prefix, e.g. `"whpt_"`. A product's tokens depend on it, so it never changes. */
  prefix: string;
  /** Default lifetime when `create` gets no `expiresIn`. */
  ttl: Duration;
  /**
   * Check the decoded payload and return the typed claims (without `exp`), or
   * throw. Runs on `create` too, so a bad grant can't be minted. A thrown
   * non-{@link TokenError} becomes `Invalid <label>: <message>`.
   */
  validateClaims: (payload: Record<string, unknown>) => Claims;
  /** Clock (unix ms). Default `Date.now`. */
  now?: () => number;
  /** How errors name the token: `"portal token"`, `"viewer token"`. Default `"token"`. */
  label?: string;
  /**
   * The `name` of the errors this instance throws (the products map
   * `PortalTokenError` / `ViewerTokenError` to 401 by name). Default
   * `"TokenError"`.
   */
  errorName?: string;
}

/** Per-call options for {@link ScopedTokens.create}. */
export interface CreateTokenOptions {
  /** Lifetime. Default: the instance `ttl`. */
  expiresIn?: Duration;
  /** Clock override (unix ms) for this call. */
  now?: number;
}

/** A verified token: its claims and expiry. */
export interface VerifiedToken<Claims> {
  claims: Claims;
  /** Expiry, unix epoch milliseconds. */
  expiresAt: number;
}

/** What {@link createScopedTokens} returns. */
export interface ScopedTokens<Claims extends object> {
  /** The token prefix. */
  readonly prefix: string;
  /** Mint a token for `claims`. Call it server-side, after your own authentication. */
  create(secret: TokenSecret, claims: Claims, options?: CreateTokenOptions): Promise<string>;
  /** Verify format, signature, claims and expiry; throws {@link ScopedTokens.TokenError}. */
  verify(
    secret: TokenSecret,
    token: string,
    options?: { now?: number },
  ): Promise<VerifiedToken<Claims>>;
  /** True when `value` looks like one of these tokens (prefix only, no verification). */
  matches(value: string): boolean;
  /** The error class this instance throws (a {@link TokenError} subclass named `errorName`). */
  readonly TokenError: new (message: string) => TokenError;
}

const encoder = new TextEncoder();

const base64urlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const base64urlDecode = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new TypeError("not base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** HMAC-SHA256 keyed by the raw UTF-8 bytes of the (arbitrary-string) secret. */
async function hmac(secret: string, content: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(content)));
}

/** Constant-time byte comparison (XOR accumulate — no early exit on content). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/**
 * Create a product's scoped-token codec.
 *
 * @example
 * ```ts
 * import { createScopedTokens } from "@xtandard/kit/tokens";
 *
 * const portal = createScopedTokens({
 *   prefix: "whpt_",
 *   ttl: "7d",
 *   label: "portal token",
 *   errorName: "PortalTokenError",
 *   validateClaims: (p) => {
 *     if (typeof p.app !== "string" || !p.app) throw new Error("missing application");
 *     return { app: p.app };
 *   },
 * });
 * const token = await portal.create(secret, { app: "acme" });
 * const { claims } = await portal.verify(secret, token); // { app: "acme" }
 * ```
 */
export function createScopedTokens<Claims extends object>(
  options: ScopedTokensOptions<Claims>,
): ScopedTokens<Claims> {
  const { prefix } = options;
  if (!prefix) throw new TypeError("createScopedTokens: a prefix is required");
  const label = options.label ?? "token";
  const errorName = options.errorName ?? "TokenError";
  const clock = options.now ?? Date.now;
  const defaultTtl = durationToMs(options.ttl);

  class ScopedTokenError extends TokenError {
    constructor(message: string) {
      super(message);
      this.name = errorName;
    }
  }

  const secretsOf = (secret: TokenSecret): string[] => {
    const list = typeof secret === "string" ? [secret] : [...secret];
    if (list.length === 0 || list.some((s) => typeof s !== "string" || s.length === 0)) {
      throw new ScopedTokenError(`A ${label} secret is required`);
    }
    return list;
  };

  const validate = (payload: Record<string, unknown>): Claims => {
    try {
      return options.validateClaims(payload);
    } catch (error) {
      if (error instanceof TokenError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ScopedTokenError(`Invalid ${label}: ${message}`);
    }
  };

  return {
    prefix,
    TokenError: ScopedTokenError,
    matches: (value) => value.startsWith(prefix),

    async create(secret, claims, createOptions = {}) {
      const [signing] = secretsOf(secret) as [string];
      const { exp: _ignored, ...rest } = claims as Record<string, unknown>;
      validate(rest);
      const ttl =
        createOptions.expiresIn === undefined ? defaultTtl : durationToMs(createOptions.expiresIn);
      const payload = { ...rest, exp: (createOptions.now ?? clock()) + ttl };
      const payloadPart = base64urlEncode(encoder.encode(JSON.stringify(payload)));
      const signature = base64urlEncode(await hmac(signing, payloadPart));
      return `${prefix}${payloadPart}.${signature}`;
    },

    async verify(secret, token, verifyOptions = {}) {
      const secrets = secretsOf(secret);
      if (typeof token !== "string" || !token.startsWith(prefix)) {
        throw new ScopedTokenError(`Invalid ${label}: missing ${prefix} prefix`);
      }
      const parts = token.slice(prefix.length).split(".");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new ScopedTokenError(`Invalid ${label}: malformed`);
      }
      const [payloadPart, signaturePart] = parts as [string, string];

      // Signature first: never interpret unauthenticated claims.
      let candidate: Uint8Array;
      try {
        candidate = base64urlDecode(signaturePart);
      } catch {
        throw new ScopedTokenError(`Invalid ${label}: malformed signature`);
      }
      let signed = false;
      for (const s of secrets) {
        // Check every secret (no early exit), so timing doesn't reveal which one matched.
        if (timingSafeEqual(await hmac(s, payloadPart), candidate)) signed = true;
      }
      if (!signed) throw new ScopedTokenError(`Invalid ${label}: signature mismatch`);

      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadPart)));
      } catch {
        throw new ScopedTokenError(`Invalid ${label}: malformed payload`);
      }
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new ScopedTokenError(`Invalid ${label}: malformed payload`);
      }
      const { exp, ...rest } = payload as Record<string, unknown>;
      if (typeof exp !== "number" || !Number.isFinite(exp)) {
        throw new ScopedTokenError(`Invalid ${label}: missing expiry`);
      }
      const claims = validate(rest);
      if ((verifyOptions.now ?? clock()) >= exp) {
        throw new ScopedTokenError(`${label[0]?.toUpperCase()}${label.slice(1)} has expired`);
      }
      return { claims, expiresAt: exp };
    },
  };
}
