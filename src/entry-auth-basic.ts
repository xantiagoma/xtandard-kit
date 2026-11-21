/**
 * `@xtandard/kit/auth/basic` — HTTP Basic authentication with scrypt password
 * hashes (`hashPassword` / `verifyPassword`). Uses `node:crypto` (Node, Bun,
 * Deno, Workers with `nodejs_compat`).
 *
 * @module
 */

export {
  basicAuth,
  hashPassword,
  verifyPassword,
  type BasicAuthOptions,
  type BasicAuthUser,
} from "./auth/basic.ts";
