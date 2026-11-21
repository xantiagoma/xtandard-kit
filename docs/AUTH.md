# Auth

Who is making this request? Authentication is a pluggable provider. The kit ships three, and the
contract is one method if you need your own. Whether the caller _may_ do something is authorization
(`docs/AUTHORIZATION.md`). Scoped portal/viewer tokens are a separate lane (`docs/TOKENS.md`).

## The contract — `@xtandard/kit/auth`

```ts
interface Principal {
  id: string;
  email?: string;
  name?: string;
  roles?: string[];
  metadata?: unknown;
}

interface AuthProvider {
  authenticate(request: Request): Promise<Principal | null>;
  challenge?(request: Request): Response | undefined;
}
```

- Return a `Principal` to admit the request, or `null` for "not authenticated". The panel then
  answers with `challenge()`, or a plain 401.
- **A provider that throws is a server error (500), not a 401.** A broken identity provider must
  not look like bad credentials to the client. The server plumbing enforces this
  (`docs/SERVER.md`).

## Bundled providers

### `@xtandard/kit/auth/none`

```ts
import { noAuth, ANONYMOUS_PRINCIPAL } from "@xtandard/kit/auth/none";
```

Every request is `{ id: "anonymous" }`. This means "no credential check", not "reject everyone":
authorization still runs, so a readonly panel still denies writes. Use it for embedded panels,
local development, or behind a gateway.

### `@xtandard/kit/auth/basic`

```ts
import { basicAuth, hashPassword } from "@xtandard/kit/auth/basic";

const auth = basicAuth({
  realm: "xtandard-webhooks", // the product passes its own; the kit default is "xtandard"
  users: [{ username: "ops", passwordHash: await hashPassword("s3cret"), roles: ["admin"] }],
});
```

- HTTP Basic with scrypt hashes (`scrypt$<salt>$<hash>`), compared in constant time.
- Plaintext `password` is accepted for development only.
- A `passwordVerifier(username, password)` callback delegates to your own user store.
- Uses `node:crypto`: Node, Bun and Deno, or Workers with `nodejs_compat`.

The CLI builds this provider from `AUTH_MODE=basic` (`docs/CLI.md`).

### `@xtandard/kit/auth/delegated`

```ts
import { delegatedAuth } from "@xtandard/kit/auth/delegated";

const auth = delegatedAuth({
  authenticate: async (request) => {
    const session = await app.getSession(request); // your cookie / JWT / IdP
    return session ? { id: session.userId, email: session.email, roles: session.roles } : null;
  },
});
```

This is where the auth your app already has plugs in. The panel never sees credentials, only the
principal you resolve. `authenticate` may be sync or async.

## In a product

Products re-export these from their own subpaths (`@xtandard/webhooks/auth/basic`…) and pass their
default realm. Everything else is identical across products.
