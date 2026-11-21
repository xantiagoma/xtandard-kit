import { describe, expect, test } from "vitest";
import type { Principal } from "../src/auth/contract.ts";
import { defineActions, type AuthorizeInput } from "../src/authorization/contract.ts";
import { delegatedAuthorization } from "../src/authorization/delegated.ts";
import { noAuthorization } from "../src/authorization/none.ts";
import { rolesAuthorization, type RolePolicy } from "../src/authorization/roles.ts";

// A product's action set, in the shape entitlements uses (runtime + portal actions are not mutating).
const actions = defineActions({
  all: [
    "customer:read",
    "customer:update",
    "grant:write",
    "runtime:consume",
    "portal:read",
    "portal:manage",
  ],
  mutating: ["customer:update", "grant:write"],
  portal: ["portal:read", "portal:manage"],
});
type Action = (typeof actions.ALL_ACTIONS)[number];
type Resource = { type: "customer"; customer?: string };

const POLICY: RolePolicy<Action> = {
  viewer: ["customer:read"],
  support: ["customer:read", "grant:write"],
  admin: "*",
};

const request = new Request("http://localhost/");
const input = (principal: Principal | null, action: Action): AuthorizeInput<Action, Resource> => ({
  principal,
  action,
  resource: { type: "customer", customer: "org_1" },
  request,
});

describe("defineActions", () => {
  test("builds the product's constants and keeps the literal union", () => {
    expect(actions.ALL_ACTIONS).toHaveLength(6);
    expect([...actions.MUTATING_ACTIONS]).toEqual(["customer:update", "grant:write"]);
    expect(actions.isMutatingAction("grant:write")).toBe(true);
    expect(actions.isMutatingAction("runtime:consume")).toBe(false);
    expect(actions.PORTAL_ACTIONS).toEqual(["portal:read", "portal:manage"]);
    // @ts-expect-error — not in the union
    actions.isMutatingAction("nope");
  });

  test("portal defaults to empty; unknown mutating/portal actions throw", () => {
    expect(defineActions({ all: ["a"], mutating: [] }).PORTAL_ACTIONS).toEqual([]);
    expect(() => defineActions({ all: ["a"], mutating: ["b" as "a"] })).toThrow(
      'mutating action "b" is not in `all`',
    );
    expect(() => defineActions({ all: ["a"], mutating: [], portal: ["c" as "a"] })).toThrow(
      'portal action "c"',
    );
  });
});

describe("rolesAuthorization", () => {
  const authz = rolesAuthorization<Action, Resource>({ policy: POLICY, actions });
  const allowed = async (roles: string[] | undefined, provider = authz) => {
    const out: Action[] = [];
    for (const action of actions.ALL_ACTIONS) {
      if (await provider.authorize(input({ id: "u", ...(roles ? { roles } : {}) }, action)))
        out.push(action);
    }
    return out;
  };

  test("explicit lists, wildcard, and roles combining", async () => {
    expect(await allowed(["viewer"])).toEqual(["customer:read"]);
    expect(await allowed(["support"])).toEqual(["customer:read", "grant:write"]);
    expect(await allowed(["admin"])).toEqual([...actions.ALL_ACTIONS]);
    expect(await allowed(["viewer", "support"])).toEqual(["customer:read", "grant:write"]);
  });

  test("denies null principals, no roles, and unknown roles", async () => {
    expect(await authz.authorize(input(null, "customer:read"))).toBe(false);
    expect(await allowed(undefined)).toEqual([]);
    expect(await allowed([])).toEqual([]);
    expect(await allowed(["ghost", "constructor", "__proto__"])).toEqual([]);
  });

  test("readonly denies mutating actions even for the wildcard, keeps the others", async () => {
    const ro = rolesAuthorization<Action, Resource>({ policy: POLICY, actions, readonly: true });
    expect(await allowed(["admin"], ro)).toEqual([
      "customer:read",
      "runtime:consume",
      "portal:read",
      "portal:manage",
    ]);
  });
});

describe("none / delegated", () => {
  test("noAuthorization allows everything, even anonymous", async () => {
    expect(await noAuthorization<Action, Resource>().authorize(input(null, "grant:write"))).toBe(
      true,
    );
  });

  test("delegatedAuthorization normalizes sync and async decisions", async () => {
    const sync = delegatedAuthorization<Action, Resource>({
      authorize: ({ principal, resource }) => principal?.id === resource.customer,
    });
    expect(await sync.authorize(input({ id: "org_1" }, "customer:read"))).toBe(true);
    expect(await sync.authorize(input({ id: "org_2" }, "customer:read"))).toBe(false);
    const async_ = delegatedAuthorization<Action, Resource>({ authorize: async () => true });
    await expect(async_.authorize(input(null, "grant:write"))).resolves.toBe(true);
  });
});
