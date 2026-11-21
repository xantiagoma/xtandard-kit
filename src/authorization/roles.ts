/**
 * Role-based {@link AuthorizationProvider}. Maps each role name to the set of
 * actions it grants, then allows an action when _any_ of the principal's roles
 * grants it.
 *
 * The policy is a flat `Record<roleName, Action[] | "*">` — `"*"` is a wildcard
 * granting every action. The kit has no default policy: each product passes its
 * own `DEFAULT_ROLE_POLICY` (ADR 0002).
 *
 * A `readonly` switch denies every mutating action (as defined by the
 * product's {@link defineActions} result) regardless of role — handy for
 * read-only mirrors or "break glass" lockdowns.
 *
 * @module
 */

import type { ActionsDefinitionResult, AuthorizationProvider, AuthorizeInput } from "./contract.ts";

/** A role policy: each role maps to an explicit action list or the `"*"` wildcard. */
export type RolePolicy<Action extends string = string> = Record<string, readonly Action[] | "*">;

/** Options for {@link rolesAuthorization}. */
export interface RolesAuthorizationOptions<Action extends string = string> {
  /** Role → granted actions. `"*"` grants everything. */
  policy: RolePolicy<Action>;
  /** The product's actions; only `isMutatingAction` is used (for `readonly`). */
  actions: Pick<ActionsDefinitionResult<Action>, "isMutatingAction">;
  /**
   * When `true`, every mutating action is denied regardless of the principal's
   * roles.
   * @default false
   */
  readonly?: boolean;
}

/**
 * Create a role-based {@link AuthorizationProvider}.
 *
 * Decision order:
 * 1. If `readonly` and the action mutates → **deny**.
 * 2. If the principal is `null` → **deny**.
 * 3. If any of the principal's roles grants the action (via `"*"` or an explicit
 *    list) → **allow**; otherwise **deny**.
 *
 * @example
 * ```ts
 * import { rolesAuthorization } from "@xtandard/kit/authorization/roles";
 *
 * const authz = rolesAuthorization({
 *   actions, // from defineActions(...)
 *   policy: { admin: "*", viewer: ["endpoint:read", "message:read"] },
 * });
 * ```
 */
export function rolesAuthorization<Action extends string = string, Resource = unknown>(
  options: RolesAuthorizationOptions<Action>,
): AuthorizationProvider<Action, Resource> {
  const readonly = options.readonly ?? false;
  const { isMutatingAction } = options.actions;

  // Pre-compute each role's granted action set for O(1) lookups. A role mapped
  // to "*" is recorded as `null` (wildcard).
  const grants = new Map<string, Set<Action> | null>();
  for (const [role, actions] of Object.entries(options.policy)) {
    grants.set(role, actions === "*" ? null : new Set(actions));
  }

  return {
    async authorize(input: AuthorizeInput<Action, Resource>): Promise<boolean> {
      if (readonly && isMutatingAction(input.action)) return false;

      const principal = input.principal;
      if (!principal) return false;

      const roles = principal.roles;
      if (!roles || roles.length === 0) return false;

      for (const role of roles) {
        if (!grants.has(role)) continue;
        const granted = grants.get(role);
        if (granted === null) return true; // wildcard
        if (granted?.has(input.action)) return true;
      }
      return false;
    },
  };
}
