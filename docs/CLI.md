# CLI building blocks

Each product ships an `xtandard-<product>` binary with its own command table. `@xtandard/kit/cli`
holds the parts every CLI re-implemented, and drifted on: env reading, argv parsing, auth and
storage from env, the startup banner, and a server that runs under Bun or Node.

## `env` and `isTruthy`

```ts
import { env, isTruthy } from "@xtandard/kit/cli";

env("PORT", "3000"); // empty counts as unset: `PORT=` → "3000"
isTruthy(env("READONLY")); // "1" | "true" (any case)
```

webhooks, flags, audit and links used `??`, so an empty variable in a `.env` file became `""`. The
kit uses `||`, like entitlements.

## `parseArgs`

```ts
parseArgs(["serve", "--port=4000", "--readonly", "-t", "acme"], {
  short: { t: "tenant", h: "help", v: "version" },
});
// { _: ["serve"], flags: { port: "4000", readonly: true, tenant: "acme" } }
```

- Supports `--k v`, `--k=v` (the value may contain `=`) and `--flag`.
- Short flags come from `short` (links); `-h`/`-v` are the default.
- `boolean` flags never take a value, so `--help cmd` keeps `cmd` positional.
- `--` ends the flags, and a malformed `--=x` stays positional (entitlements' guard).

## `buildAuthFromEnv`

```ts
const { auth, authorization, mode } = await buildAuthFromEnv({
  realm: "xtandard-webhooks",
  roles: { policy: DEFAULT_ROLE_POLICY, actions }, // used with AUTH_MODE=basic
});
```

| `AUTH_MODE`          | Result                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `none`, empty, unset | `noAuth()` + `noAuthorization()`                                                                                                       |
| `basic`              | one user: `AUTH_USERNAME` (`admin`), `AUTH_PASSWORD_HASH` or `AUTH_PASSWORD`, role `AUTH_ROLE` (`admin`), the product's roles provider |
| anything else        | **throws** `Unknown AUTH_MODE "…"`                                                                                                     |

A typo such as `basci` used to open the panel in four products. It was hot-fixed in each of them,
and is now enforced here.

## `storageFromEnv`

Storage drivers are configured per **role**:

| Product      | Roles                 | Driver variable(s)                                |
| ------------ | --------------------- | ------------------------------------------------- |
| webhooks     | `STORAGE`, `QUEUE`    | `STORAGE_DRIVER`, `QUEUE_STORAGE_DRIVER`          |
| flags        | `SOURCE`, `RUNTIME`   | `SOURCE_STORAGE_DRIVER`, `RUNTIME_STORAGE_DRIVER` |
| audit, links | `STORAGE`             | `STORAGE_DRIVER`                                  |
| entitlements | `STORAGE`, `COUNTERS` | `STORAGE_DRIVER`, `COUNTERS_DRIVER` (`driverEnv`) |

```ts
const storage = await storageFromEnv<WebhooksStorage>({
  role: {
    name: "STORAGE",
    defaults: {
      // persisted defaults are the product's (ADR 0005)
      prefix: "xtandard:webhooks:storage",
      pgTable: "xtandard_webhooks_storage",
      mongoDb: "xtandard_webhooks",
      mongoCollection: "webhooks_storage",
      sqlitePath: "./.webhooks/storage.sqlite",
      libsqlUrl: "file:./.webhooks/storage.db",
      fileDir: "./.webhooks/storage",
    },
  },
  allowed: ["memory", "file", "redis", "postgres", "mongodb", "sqlite", "libsql"], // optional
});
```

The variable names are the products' own:

- `REDIS_URL` and `<ROLE>_PREFIX`;
- `DATABASE_URL` (falling back to `POSTGRES_URL`) and `<ROLE>_PG_TABLE`;
- `MONGO_URL`, `MONGO_DB` and `<ROLE>_MONGO_COLLECTION`;
- `<ROLE>_SQLITE_PATH`;
- `<ROLE>_LIBSQL_URL` (falling back to `LIBSQL_URL`) and `LIBSQL_AUTH_TOKEN`;
- `<ROLE>_FILE_DIR`.

Behaviour:

- **An unknown driver throws.** webhooks, flags and links used to fall back to `file`.
- The default registry imports the kit's storage entries lazily, so a peer such as `redis` loads
  only when its driver is chosen. A driver missing from the build says so; other import errors
  propagate.
- The registry's drivers are `memory`, `file`, `sqlite`, `libsql`, `postgres`, `mongodb`, `redis`,
  `redis-json` and `unstorage`. They use the products' factory names and options
  (`createPostgresStorage({ connectionString, table })`…).
- Pass `drivers` to add drivers or replace them, e.g. a product's counters.

`describeStorage(role)` gives the banner line:

- the absolute path for `file`, `sqlite` and `file:` libSQL URLs;
- `memory (ephemeral — not persisted)`;
- the driver name only for everything else. Connection strings, which may contain credentials,
  are never printed.

## `serve` and `startServer`

```ts
await serve({
  name: "xtandard/webhooks",
  port: flags.port ? Number(flags.port) : undefined,
  buildPanel: async ({ basePath, title, logoUrl, readonly, env }) =>
    createFetchHandler({ storage, auth, authorization, basePath, title, logoUrl, readonly }),
  banner: async () => [`storage: ${await describeStorage(STORAGE)}`],
}); // never resolves: the server owns the process
```

- `serve` reads `PORT` (3000), `BASE_PATH` (normalized), `TITLE`, `LOGO_URL` and `READONLY`.
- It warns on `AUTH_MODE=none`, prints the banner and `listening on http://localhost:<port><base>`.
- `startServer(port, fetch)` uses `Bun.serve` under Bun. Under Node it uses `node:http` over the
  shared Node bridge, which keeps every `Set-Cookie` and streams responses. It returns
  `{ port, stop }`.

## `pkgVersion` and the self-run guard

```ts
// src/cli.ts
import { isMainModule, pkgVersion } from "@xtandard/kit/cli";

export async function run(argv: string[]): Promise<number> {
  if (flags.version) return void console.log(await pkgVersion(import.meta.url)), 0;
  …
}

// au 6761a34: run only when executed directly, not when imported
// (by bin/xtandard-<product>.mjs, the standalone app, or a test).
if (isMainModule(import.meta)) run(process.argv.slice(2)).then((code) => process.exit(code));
```

- `isMainModule` uses `import.meta.main` where the runtime has it (Bun, recent Node). Otherwise it
  compares the module with `process.argv[1]`.
- `pkgVersion(import.meta.url)` reads `../package.json`, which is right for both `dist/cli.mjs` and
  `src/cli.ts`. It returns `"unknown"` when the file can't be read.
