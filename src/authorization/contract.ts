/**
 * Authorization contract. Answers: "Can this principal perform this action on
 * this resource?"
 *
 * The contract is generic: each product passes its own action union and
 * resource union, so `AuthorizationProvider<WebhooksAction, WebhooksResource>`
 * and `AuthorizationProvider<EntitlementsAction, EntitlementsResource>` stay
 * distinct types. {@link defineActions} turns a product's action lists into the
 * runtime sets and predicates every product used to hand-write.
 *
 * The kit ships `none` / `roles` / `delegated` implementations.
 *
 * @module
 */

import type { Principal } from "../auth/contract.ts";

/** Input passed to {@link AuthorizationProvider.authorize}. */
export interface AuthorizeInput<Action extends string = string, Resource = unknown> {
  /** The authenticated principal, or `null` for an anonymous request. */
  principal: Principal | null;
  /** The action the request performs (e.g. `"endpoint:write"`). */
  action: Action;
  /** The resource the action targets (a product's discriminated union). */
  resource: Resource;
  /** The incoming request. */
  request: Request;
}

/** Decides whether an action is permitted. */
export interface AuthorizationProvider<Action extends string = string, Resource = unknown> {
  authorize(input: AuthorizeInput<Action, Resource>): Promise<boolean>;
}

/** Input to {@link defineActions}. */
export interface ActionsDefinition<A extends string> {
  /** Every action, in a stable order (role presets, docs, the UI). */
  all: readonly A[];
  /**
   * Actions that write state. They are blocked when the panel, or the roles
   * provider, is readonly. Leave out actions that must keep working in a
   * readonly panel (e.g. runtime metering).
   */
  mutating: readonly A[];
  /** Actions a scoped (portal / viewer) token may be granted, when the product has such tokens. */
  portal?: readonly A[];
}

/** What {@link defineActions} returns. */
export interface ActionsDefinitionResult<A extends string> {
  /** Every action, in the order given. */
  ALL_ACTIONS: readonly A[];
  /** The mutating actions. */
  MUTATING_ACTIONS: ReadonlySet<A>;
  /** True if `action` writes state. */
  isMutatingAction: (action: A) => boolean;
  /** The actions a scoped token may be granted (empty when `portal` is not given). */
  PORTAL_ACTIONS: readonly A[];
}

/**
 * Build a product's action constants from its lists. The `const` type
 * parameter keeps the literal union, so a product can derive its action type
 * from the list instead of writing it twice.
 *
 * Throws if `mutating` or `portal` names an action that is not in `all`.
 *
 * @example
 * ```ts
 * import { defineActions } from "@xtandard/kit/authorization";
 *
 * export const { ALL_ACTIONS, MUTATING_ACTIONS, isMutatingAction } = defineActions({
 *   all: ["endpoint:read", "endpoint:write", "message:read", "message:send"],
 *   mutating: ["endpoint:write", "message:send"],
 * });
 * export type WebhooksAction = (typeof ALL_ACTIONS)[number];
 * ```
 */
export function defineActions<const A extends string>(
  definition: ActionsDefinition<A>,
): ActionsDefinitionResult<A> {
  const all = new Set<string>(definition.all);
  for (const list of ["mutating", "portal"] as const) {
    for (const action of definition[list] ?? []) {
      if (!all.has(action)) {
        throw new TypeError(`defineActions: ${list} action "${action}" is not in \`all\``);
      }
    }
  }
  const mutating: ReadonlySet<A> = new Set(definition.mutating);
  return {
    ALL_ACTIONS: [...definition.all],
    MUTATING_ACTIONS: mutating,
    isMutatingAction: (action) => mutating.has(action),
    PORTAL_ACTIONS: [...(definition.portal ?? [])],
  };
}
