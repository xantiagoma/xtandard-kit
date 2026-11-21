/**
 * `@xtandard/kit/auth` — the authentication contract: {@link Principal} and
 * {@link AuthProvider}. Implementations live on `auth/none`, `auth/basic` and
 * `auth/delegated`; any object satisfying the contract works.
 *
 * @module
 */

export type { AuthProvider, Principal } from "./auth/contract.ts";
