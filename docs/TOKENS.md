# Scoped tokens

A scoped token is a compact HMAC-signed grant. It scopes its bearer to part of a panel (one tenant,
one customer, a few actions) for a limited time. The products call them **portal tokens**
(webhooks `whpt_`, audit `audpt_`, entitlements `entpt_`) or **viewer tokens** (links `lvt_`). The
mechanics are the same, and live in `@xtandard/kit/tokens`. The claims and their scoping rules stay
in each product.

## Wire format

```txt
<prefix><base64url(JSON { ...claims, exp })>.<base64url(HMAC-SHA256(secret, payloadPart))>
```

- `exp` is unix epoch milliseconds.
- The secret is an arbitrary string, fed to the HMAC as raw UTF-8 bytes.
- WebCrypto only, with no dependencies, so it runs on Workers and in browsers.

The format is unchanged from the products. The kit verifies tokens minted by every product's
current code; the tests pin a frozen token from each one.

## Usage

```ts
import { createScopedTokens } from "@xtandard/kit/tokens";

export const portalTokens = createScopedTokens({
  prefix: "entpt_", // the product's prefix (ADR 0010)
  ttl: "1h", // default lifetime
  label: "portal token", // used in messages: "Invalid portal token: signature mismatch"
  errorName: "PortalTokenError", // the products map this name to 401
  validateClaims: (p) => {
    if (typeof p.customer !== "string" || !p.customer) throw new Error("missing customer");
    return { customer: p.customer };
  },
});

const token = await portalTokens.create(secret, { customer: "org_1" }, { expiresIn: "15m" });
const { claims, expiresAt } = await portalTokens.verify(secret, token);
```

- `verify` checks the prefix and shape, then the **signature first** (constant time), then the
  payload, `exp` and `validateClaims`, and finally expiry.
- `validateClaims` also runs on `create`, so an invalid grant can't be minted.
- If `validateClaims` throws a non-`TokenError`, the error becomes `Invalid <label>: <message>`.
- Errors are instances of the exported `TokenError` and of the per-instance `tokens.TokenError`,
  whose `name` is `errorName`.
- `now` (an option, or per call) injects a clock for tests.

## Secrets and rotation

- **An empty secret is rejected** on `create` and `verify`. webhooks and audit didn't check it.
- **Rotation:** pass a list of secrets. The first one signs; any of them verifies.

  ```ts
  const secrets = [process.env.PORTAL_SECRET_NEW!, process.env.PORTAL_SECRET_OLD!];
  await portalTokens.verify(secrets, token);
  ```

  Keep the old secret in the list until the longest-lived token signed with it has expired, then
  drop it. There is no key id in the wire format, so old tokens keep verifying. Each secret in the
  list is tried in full, so timing doesn't reveal which one matched.

To revoke every token before it expires, rotate the secret and don't keep the old one.
