/** Bun-runtime smoke test: WebCrypto tokens, `node:crypto` scrypt and the id generators under Bun. */
import { expect, test } from "bun:test";
import { basicAuth, hashPassword, verifyPassword } from "../src/auth/basic.ts";
import { createScopedTokens } from "../src/tokens/scoped.ts";
import { createIdGenerator } from "../src/util/id.ts";

test("scoped tokens round-trip under Bun", async () => {
  const tokens = createScopedTokens({
    prefix: "whpt_",
    ttl: "1h",
    validateClaims: (p) => ({ app: String(p.app) }),
  });
  const token = await tokens.create(["new", "old"], { app: "acme" });
  expect((await tokens.verify(["old", "new"], token)).claims).toEqual({ app: "acme" });
  await expect(tokens.create("", { app: "a" })).rejects.toThrow("secret is required");
});

test("scrypt basic auth under Bun", async () => {
  const hash = await hashPassword("s3cret");
  expect(await verifyPassword("s3cret", hash)).toBe(true);
  const auth = basicAuth({ users: [{ username: "ops", passwordHash: hash }] });
  const request = new Request("http://x/", {
    headers: { authorization: `Basic ${btoa("ops:s3cret")}` },
  });
  expect(await auth.authenticate(request)).toEqual({ id: "ops", name: "ops" });
});

test("monotonic ids under Bun", () => {
  const ids = createIdGenerator({ format: "ulid", now: () => 1 });
  const minted = Array.from({ length: 50 }, () => ids.newId("evt"));
  expect([...minted].sort()).toEqual(minted);
});
