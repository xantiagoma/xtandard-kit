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

test("the panel serves static files and the SPA under Bun", async () => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createPanelHandler } = await import("../src/server/panel.ts");
  const uiDir = await mkdtemp(join(tmpdir(), "kit-bun-ui-"));
  await mkdir(join(uiDir, "assets"));
  await writeFile(join(uiDir, "assets", "a.js"), "1");
  await writeFile(join(uiDir, "index.html"), "<html><head></head></html>");
  const panel = createPanelHandler({ title: "T", globalName: "__T__", basePath: "/p", uiDir });
  expect((await panel.fetch(new Request("http://x/p/assets/a.js"))).status).toBe(200);
  const spa = await panel.fetch(new Request("http://x/p/anything"));
  expect(await spa.text()).toContain('window.__T__={"title":"T","basePath":"/p","readonly":false}');
  expect(await (await panel.fetch(new Request("http://x/p/healthcheck"))).json()).toEqual({
    ok: true,
  });
});
