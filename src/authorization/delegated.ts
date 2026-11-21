/**
 * Delegated {@link AuthorizationProvider}. Wraps a caller-supplied `authorize`
 * function so you can implement any policy — ABAC, an external policy engine
 * (OPA, Cedar), per-tenant ownership checks — without implementing the
 * interface by hand.
 *
 * The wrapper normalizes a synchronous-or-asynchronous decision into the
 * `Promise<boolean>` the contract requires.
 *
 * @module
 */

import type { AuthorizationProvider, AuthorizeInput } from "./contract.ts";

/** Options for {@link delegatedAuthorization}. */
export interface DelegatedAuthorizationOptions<Action extends string = string, Resource = unknown> {
  /**
   * Decide whether the {@link AuthorizeInput} is permitted. Return `true` to
   * allow. May be synchronous or asynchronous.
   */
  authorize: (input: AuthorizeInput<Action, Resource>) => Promise<boolean> | boolean;
}

/**
 * Create an {@link AuthorizationProvider} from a plain decision function.
 *
 * @example
 * ```ts
 * import { delegatedAuthorization } from "@xtandard/kit/authorization/delegated";
 *
 * const authz = delegatedAuthorization<MyAction, MyResource>({
 *   // Only the tenant's own members may touch its resources.
 *   authorize: ({ principal, resource }) =>
 *     (principal?.metadata as { tenants?: string[] } | undefined)?.tenants?.includes(
 *       resource.tenant,
 *     ) === true,
 * });
 * ```
 */
export function delegatedAuthorization<Action extends string = string, Resource = unknown>(
  options: DelegatedAuthorizationOptions<Action, Resource>,
): AuthorizationProvider<Action, Resource> {
  return {
    async authorize(input: AuthorizeInput<Action, Resource>): Promise<boolean> {
      return await options.authorize(input);
    },
  };
}
