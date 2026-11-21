import { describe, expect, test } from "vitest";
import { createScopedTokens, TokenError } from "../src/tokens/scoped.ts";

const EXP = Date.UTC(2030, 0, 1);
const BEFORE = EXP - 60_000;

// Each product's mint code, ported verbatim (wh/au/li/en share the encoder byte for byte; only the
// claim keys and their order differ). Used to prove the kit verifies tokens the products mint today.
const b64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function hmac(secret: string, content: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content)));
}
async function legacyMint(prefix: string, claims: object, secret: string): Promise<string> {
  const payloadPart = b64(new TextEncoder().encode(JSON.stringify(claims)));
  return `${prefix}${payloadPart}.${b64(await hmac(secret, payloadPart))}`;
}

const str = (p: Record<string, unknown>, key: string): string => {
  const value = p[key];
  if (typeof value !== "string" || !value) throw new Error(`missing ${key}`);
  return value;
};

const products = {
  wh: createScopedTokens({
    prefix: "whpt_",
    ttl: "7d",
    label: "portal token",
    errorName: "PortalTokenError",
    validateClaims: (p) => ({ app: str(p, "app") }),
  }),
  au: createScopedTokens({
    prefix: "audpt_",
    ttl: "1h",
    label: "portal token",
    errorName: "PortalTokenError",
    validateClaims: (p) => ({ tenant: str(p, "tenant"), filter: p.filter }),
  }),
  li: createScopedTokens({
    prefix: "lvt_",
    ttl: "1d",
    label: "viewer token",
    errorName: "ViewerTokenError",
    validateClaims: (p) => ({ tenant: str(p, "tenant"), links: p.links, allow: p.allow }),
  }),
  en: createScopedTokens({
    prefix: "entpt_",
    ttl: "1h",
    label: "portal token",
    errorName: "PortalTokenError",
    validateClaims: (p) => {
      if (!Array.isArray(p.scope) || p.scope.length === 0) throw new Error("invalid scope");
      return { customer: str(p, "customer"), scope: p.scope as string[] };
    },
  }),
};

describe("compatibility with tokens minted by each product", () => {
  // Frozen outputs of the products' current mint code (secret, claims and exp as below).
  const frozen = {
    wh: [
      "wh-secret",
      "whpt_eyJhcHAiOiJhY21lIiwiZXhwIjoxODkzNDU2MDAwMDAwfQ.2k39MLCRRl7AvfwaKVF7_yPW_NcErAYI473K2fYOdB4",
      { app: "acme" },
    ],
    au: [
      "au-secret",
      "audpt_eyJ0ZW5hbnQiOiJhY21lIiwiZXhwIjoxODkzNDU2MDAwMDAwLCJmaWx0ZXIiOnsiYWN0aW9ucyI6WyJpbnZvaWNlLnBhaWQiXX19.ijx9Xv4ANWEaOuKv9T7Z-gV9X3KpB4jiyukyC1LKX2Q",
      { tenant: "acme", filter: { actions: ["invoice.paid"] } },
    ],
    li: [
      "li-secret",
      "lvt_eyJ0ZW5hbnQiOiJhY21lIiwibGlua3MiOlsibG5rXzEiXSwiYWxsb3ciOlsiYW5hbHl0aWNzOnJlYWQiXSwiZXhwIjoxODkzNDU2MDAwMDAwfQ.soLiRUXRLuFeMWIyiAoqmBJMsdTl-ZEwlPqp63AFlsM",
      { tenant: "acme", links: ["lnk_1"], allow: ["analytics:read"] },
    ],
    en: [
      "en-secret",
      "entpt_eyJjdXN0b21lciI6Im9yZ18xIiwiZXhwIjoxODkzNDU2MDAwMDAwLCJzY29wZSI6WyJwb3J0YWw6cmVhZCIsInBvcnRhbDpjaGVja291dCJdfQ.RvbNjdEhFymRmh-PnzyXIoeZkr6m-nrTtbZxh3rePWQ",
      { customer: "org_1", scope: ["portal:read", "portal:checkout"] },
    ],
  } as const;

  for (const [name, [secret, token, claims]] of Object.entries(frozen)) {
    test(`verifies a frozen ${name} token`, async () => {
      const tokens = products[name as keyof typeof products];
      const verified = await tokens.verify(secret, token, { now: BEFORE });
      expect(verified).toEqual({ claims: expect.objectContaining(claims), expiresAt: EXP });
    });
  }

  test("verifies freshly minted legacy tokens (claim order as each product writes it)", async () => {
    const cases: [keyof typeof products, object][] = [
      ["wh", { app: "a", exp: EXP }],
      ["au", { tenant: "t", exp: EXP }],
      ["li", { tenant: "t", exp: EXP }],
      ["en", { customer: "c", exp: EXP, scope: ["portal:read"] }],
    ];
    for (const [name, claims] of cases) {
      const t = products[name];
      const token = await legacyMint(t.prefix, claims, "s3cret");
      await expect(t.verify("s3cret", token, { now: BEFORE })).resolves.toMatchObject({
        expiresAt: EXP,
      });
    }
  });

  test("a kit-minted token is what the product's own verifier expects", async () => {
    const token = await products.wh.create("s", { app: "acme" }, { now: 0, expiresIn: "1h" });
    const [payload] = token.slice("whpt_".length).split(".") as [string];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    expect(decoded).toEqual({ app: "acme", exp: 3_600_000 });
    expect(token).toBe(await legacyMint("whpt_", { app: "acme", exp: 3_600_000 }, "s"));
  });
});

describe("createScopedTokens", () => {
  const tokens = products.wh;

  test("round-trips claims with the default ttl", async () => {
    const token = await tokens.create("s", { app: "acme" }, { now: 1_000 });
    expect(token.startsWith("whpt_")).toBe(true);
    expect(tokens.matches(token)).toBe(true);
    expect(tokens.matches("audpt_x")).toBe(false);
    const verified = await tokens.verify("s", token, { now: 2_000 });
    expect(verified).toEqual({ claims: { app: "acme" }, expiresAt: 1_000 + 7 * 86_400_000 });
  });

  test("uses the injected clock", async () => {
    let now = 0;
    const clocked = createScopedTokens({
      prefix: "x_",
      ttl: 1_000,
      now: () => now,
      validateClaims: () => ({}),
    });
    const token = await clocked.create("s", {});
    now = 999;
    await expect(clocked.verify("s", token)).resolves.toEqual({ claims: {}, expiresAt: 1_000 });
    now = 1_000;
    await expect(clocked.verify("s", token)).rejects.toThrow("Token has expired");
  });

  test("rejects an empty secret on create and on verify", async () => {
    // Regression: wh/au didn't check the secret. Node and Bun then fail with an opaque WebCrypto
    // "Zero-length key" DataError; runtimes that accept empty HMAC keys would sign with no secret.
    await expect(tokens.create("", { app: "a" })).rejects.toThrow(
      "A portal token secret is required",
    );
    const token = await legacyMint("whpt_", { app: "a", exp: EXP }, "x");
    await expect(tokens.verify("", token, { now: BEFORE })).rejects.toThrow(/secret is required/);
    await expect(tokens.verify([], token, { now: BEFORE })).rejects.toThrow(/secret is required/);
    await expect(tokens.verify(["ok", ""], token)).rejects.toThrow(/secret is required/);
  });

  test("rotation: verifies with any listed secret, mints with the first", async () => {
    const old = await tokens.create("old", { app: "a" });
    const rotated = ["new", "old"] as const;
    await expect(tokens.verify(rotated, old)).resolves.toMatchObject({ claims: { app: "a" } });
    const fresh = await tokens.create(rotated, { app: "a" });
    await expect(tokens.verify("new", fresh)).resolves.toMatchObject({ claims: { app: "a" } });
    await expect(tokens.verify("old", fresh)).rejects.toThrow("signature mismatch");
    await expect(tokens.verify(["other"], old)).rejects.toThrow("signature mismatch");
  });

  test("errors carry the product's name and extend TokenError", async () => {
    const error = await tokens.verify("s", "nope").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TokenError);
    expect(error).toBeInstanceOf(tokens.TokenError);
    expect((error as Error).name).toBe("PortalTokenError");
    expect((error as Error).message).toBe("Invalid portal token: missing whpt_ prefix");
  });

  test("rejects malformed tokens", async () => {
    const good = await tokens.create("s", { app: "a" });
    const [payload, sig] = good.slice(5).split(".") as [string, string];
    await expect(tokens.verify("s", "whpt_abc")).rejects.toThrow("malformed");
    await expect(tokens.verify("s", "whpt_a.b.c")).rejects.toThrow("malformed");
    await expect(tokens.verify("s", `whpt_${payload}.`)).rejects.toThrow("malformed");
    await expect(tokens.verify("s", `whpt_${payload}.!!`)).rejects.toThrow("malformed signature");
    await expect(tokens.verify("s", `whpt_${payload}.${sig}x`)).rejects.toThrow(
      "signature mismatch",
    );
    await expect(tokens.verify("t", good)).rejects.toThrow("signature mismatch");
    await expect(tokens.verify("s", 42 as unknown as string)).rejects.toThrow("prefix");
  });

  test("rejects signed but invalid payloads", async () => {
    const sign = (raw: string) => {
      const p = b64(new TextEncoder().encode(raw));
      return hmac("s", p).then((sig) => `whpt_${p}.${b64(sig)}`);
    };
    await expect(tokens.verify("s", await sign("not json"))).rejects.toThrow("malformed payload");
    await expect(tokens.verify("s", await sign("[1]"))).rejects.toThrow("malformed payload");
    await expect(tokens.verify("s", await sign("null"))).rejects.toThrow("malformed payload");
    await expect(tokens.verify("s", await sign('{"app":"a"}'))).rejects.toThrow("missing expiry");
    await expect(tokens.verify("s", await sign('{"app":"a","exp":"x"}'))).rejects.toThrow(
      "missing expiry",
    );
    await expect(tokens.verify("s", await sign(`{"exp":${EXP}}`))).rejects.toThrow(
      "Invalid portal token: missing app",
    );
  });

  test("validateClaims runs on create; a thrown TokenError passes through", async () => {
    await expect(tokens.create("s", { app: "" })).rejects.toThrow(
      "Invalid portal token: missing app",
    );
    const strict = createScopedTokens<object>({
      prefix: "x_",
      ttl: "1h",
      validateClaims: () => {
        throw new TokenError("custom");
      },
    });
    await expect(strict.create("s", {})).rejects.toThrow(/^custom$/);
    const thrower = createScopedTokens<object>({
      prefix: "x_",
      ttl: "1h",
      validateClaims: () => {
        throw "boom";
      },
    });
    await expect(thrower.create("s", {})).rejects.toThrow("Invalid token: boom");
  });

  test("an `exp` passed as a claim is ignored on create", async () => {
    const token = await tokens.create("s", { app: "a", exp: 1 } as { app: string }, { now: 0 });
    await expect(tokens.verify("s", token, { now: 10 })).resolves.toMatchObject({
      expiresAt: 7 * 86_400_000,
    });
  });

  test("requires a prefix", () => {
    expect(() => createScopedTokens({ prefix: "", ttl: 1, validateClaims: () => ({}) })).toThrow(
      "prefix",
    );
  });
});

describe("create signs the validated claims (audit feedback)", () => {
  test("a normalising validator is honoured at mint time", async () => {
    const tokens = createScopedTokens({
      prefix: "audpt_",
      ttl: "1h",
      validateClaims: (p) => {
        const filter = p.filter as Record<string, unknown> | undefined;
        return {
          tenant: str(p, "tenant"),
          ...(filter && Object.keys(filter).length ? { filter } : {}),
        };
      },
    });
    const token = await tokens.create("s", { tenant: "acme", filter: {} }, { now: 0 });
    const payload = JSON.parse(
      atob(token.slice(6).split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/")),
    );
    expect(payload).toEqual({ tenant: "acme", exp: 3_600_000 });
    expect((await tokens.verify("s", token, { now: 1 })).claims).toEqual({ tenant: "acme" });
  });
});
