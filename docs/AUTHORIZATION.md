# Authorization

Can this principal perform this action on this resource? Authorization is a provider, consulted
once per API route with one action and the resource it targets.

## The contract — `@xtandard/kit/authorization`

```ts
interface AuthorizeInput<Action extends string, Resource> {
  principal: Principal | null;
  action: Action;
  resource: Resource;
  request: Request;
}

interface AuthorizationProvider<Action extends string, Resource> {
  authorize(input: AuthorizeInput<Action, Resource>): Promise<boolean>;
}
```

The action and resource unions belong to the product (ADR 0002). A product aliases the generic
types:

```ts
export type WebhooksAuthorizationProvider = AuthorizationProvider<WebhooksAction, WebhooksResource>;
```

## `defineActions` — a product's action constants

```ts
import { defineActions } from "@xtandard/kit/authorization";

export const { ALL_ACTIONS, MUTATING_ACTIONS, isMutatingAction, PORTAL_ACTIONS } = defineActions({
  all: ["customer:read", "customer:update", "runtime:consume", "portal:read"],
  mutating: ["customer:update"], // runtime:consume keeps working when readonly
  portal: ["portal:read"],
});
export type EntitlementsAction = (typeof ALL_ACTIONS)[number];
```

- The `const` type parameter keeps the literal union, so the action type comes from the list.
- `mutating` and `portal` must be subsets of `all`; otherwise `defineActions` throws.
- `PORTAL_ACTIONS` is `[]` when the product has no scoped tokens.

## Bundled providers

### `@xtandard/kit/authorization/none`

`noAuthorization()` allows everything, including anonymous principals. Use it only for embedded
or local panels that untrusted callers can't reach.

### `@xtandard/kit/authorization/roles`

```ts
import { rolesAuthorization, type RolePolicy } from "@xtandard/kit/authorization/roles";

export const DEFAULT_ROLE_POLICY: RolePolicy<WebhooksAction> = {
  admin: "*",
  editor: [...READ_ACTIONS, "endpoint:write"],
  viewer: READ_ACTIONS,
};

const authz = rolesAuthorization({ policy: DEFAULT_ROLE_POLICY, actions, readonly: false });
```

Decision order:

1. If `readonly` is set and the action is mutating, **deny**.
2. If the principal is `null` or has no roles, **deny**.
3. If any role grants the action (`"*"` or an explicit list), **allow**; otherwise **deny**.

The kit has no default policy. Each product passes its own (webhooks/flags/links
`admin/editor/viewer`, audit `admin/auditor/viewer`, entitlements
`viewer/support/billing-admin/admin/runtime-service`). Product wrappers keep the zero-argument
`rolesAuthorization()` by defaulting `policy`.

### `@xtandard/kit/authorization/delegated`

```ts
import { delegatedAuthorization } from "@xtandard/kit/authorization/delegated";

const authz = delegatedAuthorization<MyAction, MyResource>({
  authorize: ({ principal, resource }) => principal?.metadata?.tenants?.includes(resource.tenant),
});
```

Use it for any policy: ABAC, OPA, Cedar, ownership checks. The decision may be sync or async.

## Scoped-token principals

A request carrying a scoped token (`docs/TOKENS.md`) never reaches the host's provider. The server
plumbing scopes it to the token's grant instead (`docs/SERVER.md`, "authorize"). This is defence in
depth: a permissive host policy can't widen a portal token.
