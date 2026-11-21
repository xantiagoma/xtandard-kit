/**
 * CLI building blocks for the products' `xtandard-<product>` binaries:
 * environment reading, an argv parser, auth and storage from env (both
 * **fail closed** on unknown values), the startup banner and a server that
 * runs under Bun or Node.
 *
 * The products keep their command tables; these are the parts every CLI
 * re-implemented.
 *
 * @module
 */

import { filePath } from "../server/static-assets.ts";
import type { AuthorizationProvider } from "../authorization/contract.ts";
import type { AuthProvider } from "../auth/contract.ts";
import type { RolesAuthorizationOptions } from "../authorization/roles.ts";
import { normalizeBasePath } from "../server/base-path.ts";
import type { FetchHandler } from "../adapters/node.ts";

/** An environment: `process.env` or a test double. */
export type Env = Record<string, string | undefined>;

const processEnv = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

/**
 * Read an env var. An **empty** value counts as unset (`||` semantics), so
 * `FOO=` in a `.env` file falls back to the default instead of becoming `""`.
 */
export const env = (key: string, fallback = "", source: Env = processEnv()): string =>
  source[key] || fallback;

/** `"1"` or `"true"` (any case). */
export const isTruthy = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true";

/** Parsed argv. */
export interface ParsedArgs {
  /** Positional arguments. */
  _: string[];
  /** `--key value`, `--key=value`, `--flag` and mapped short flags. */
  flags: Record<string, string | boolean>;
}

/** Options for {@link parseArgs}. */
export interface ParseArgsOptions {
  /** Short flags → long names. Default `{ h: "help", v: "version" }`. */
  short?: Record<string, string>;
  /** Flags that never take a value (`--help foo` keeps `foo` positional). Default `["help", "version"]`. */
  boolean?: readonly string[];
}

/**
 * Minimal argv parser:
 *
 * - `--key value`, `--key=value` (the value may contain `=`), `--flag`;
 * - short flags from `short` (`-t acme` → `tenant: "acme"`, `-h` → `help: true`);
 * - `--` ends the flags; a malformed `--=x` stays positional.
 *
 * @example
 * ```ts
 * parseArgs(["serve", "--port=4000", "-t", "acme"], { short: { t: "tenant" } });
 * // { _: ["serve"], flags: { port: "4000", tenant: "acme" } }
 * ```
 */
export function parseArgs(argv: readonly string[], options: ParseArgsOptions = {}): ParsedArgs {
  const short = options.short ?? { h: "help", v: "version" };
  const booleans = new Set(options.boolean ?? ["help", "version"]);
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const takeValue = (key: string, i: number): number => {
    const next = argv[i + 1];
    if (booleans.has(key) || next === undefined || next.startsWith("-")) {
      flags[key] = true;
      return i;
    }
    flags[key] = next;
    return i + 1;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--") {
      _.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === 2) _.push(a);
      else if (eq > 2) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else i = takeValue(a.slice(2), i);
    } else if (/^-[A-Za-z]$/.test(a) && short[a.slice(1)]) {
      i = takeValue(short[a.slice(1)] as string, i);
    } else _.push(a);
  }
  return { _, flags };
}

/** Options for {@link buildAuthFromEnv}. */
export interface AuthFromEnvOptions<Action extends string = string> {
  /** The `WWW-Authenticate` realm, e.g. `"xtandard-webhooks"`. */
  realm: string;
  /** The roles provider used with `AUTH_MODE=basic` (the product's policy and actions). */
  roles: RolesAuthorizationOptions<Action>;
  /** Default `AUTH_ROLE`. Default `"admin"`. */
  defaultRole?: string;
  env?: Env;
  /** Where warnings go. Default: stderr. */
  warn?: (line: string) => void;
  /** Log prefix for warnings. Default `"xtandard"`. */
  name?: string;
}

/** What {@link buildAuthFromEnv} returns. */
export interface AuthFromEnv<Action extends string = string> {
  mode: "none" | "basic";
  auth: AuthProvider;
  authorization: AuthorizationProvider<Action>;
}

/**
 * Build the auth + authorization providers from env:
 *
 * - `AUTH_MODE=none` (or empty / unset): anonymous, allow-all.
 * - `AUTH_MODE=basic`: one Basic user from `AUTH_USERNAME` (default `admin`),
 *   `AUTH_PASSWORD_HASH` or `AUTH_PASSWORD`, with role `AUTH_ROLE`, and the
 *   product's roles provider.
 * - **Anything else throws.** A typo such as `basci` must not open the panel.
 */
export async function buildAuthFromEnv<Action extends string = string>(
  options: AuthFromEnvOptions<Action>,
): Promise<AuthFromEnv<Action>> {
  const source = options.env ?? processEnv();
  const warn = options.warn ?? stderr;
  const mode = env("AUTH_MODE", "none", source);
  if (mode === "basic") {
    const [{ basicAuth }, { rolesAuthorization }] = await Promise.all([
      import("../auth/basic.ts"),
      import("../authorization/roles.ts"),
    ]);
    const passwordHash = env("AUTH_PASSWORD_HASH", "", source);
    const password = env("AUTH_PASSWORD", "", source);
    if (!passwordHash && !password) {
      warn(
        `[${options.name ?? "xtandard"}] AUTH_MODE=basic but neither AUTH_PASSWORD_HASH nor AUTH_PASSWORD is set.`,
      );
    }
    return {
      mode,
      auth: basicAuth({
        realm: options.realm,
        users: [
          {
            username: env("AUTH_USERNAME", "admin", source),
            ...(passwordHash ? { passwordHash } : {}),
            ...(password ? { password } : {}),
            roles: [env("AUTH_ROLE", options.defaultRole ?? "admin", source)],
          },
        ],
      }),
      authorization: rolesAuthorization<Action>(options.roles),
    };
  }
  if (mode !== "none") throw new Error(`Unknown AUTH_MODE "${mode}" (expected none or basic)`);
  const [{ noAuth }, { noAuthorization }] = await Promise.all([
    import("../auth/none.ts"),
    import("../authorization/none.ts"),
  ]);
  return { mode, auth: noAuth(), authorization: noAuthorization<Action>() };
}

// --- Storage from env --------------------------------------------------------------------

/** Per-role defaults. The persisted ones (table, db, collection, paths) are the product's (ADR 0005). */
export interface StorageRoleDefaults {
  /** Driver when the driver env var is unset. Default `"file"`. */
  driver?: string;
  /** Redis key prefix (`<ROLE>_PREFIX`). */
  prefix?: string;
  /** Postgres table (`<ROLE>_PG_TABLE`). */
  pgTable?: string;
  /** Mongo database (`MONGO_DB`). */
  mongoDb?: string;
  /** Mongo collection (`<ROLE>_MONGO_COLLECTION`). */
  mongoCollection?: string;
  /** SQLite file (`<ROLE>_SQLITE_PATH`). */
  sqlitePath?: string;
  /**
   * Table of the `sqlite` and `libsql` drivers (`<ROLE>_SQLITE_TABLE`). Without
   * it the drivers use the kit's neutral `xtandard_kv` and miss a product's
   * existing rows.
   */
  sqliteTable?: string;
  /** libSQL URL (`<ROLE>_LIBSQL_URL`, then `LIBSQL_URL`). */
  libsqlUrl?: string;
  /** File-driver directory (`<ROLE>_FILE_DIR`). */
  fileDir?: string;
}

/** A storage role: `STORAGE`, `QUEUE`, `SOURCE`, `RUNTIME`, `COUNTERS`… */
export interface StorageRole {
  /** The env-var prefix of the role's settings, e.g. `"QUEUE"` → `QUEUE_PG_TABLE`. */
  name: string;
  /**
   * The env var naming the driver. Default: `STORAGE_DRIVER` for the
   * `STORAGE` role, `<NAME>_STORAGE_DRIVER` otherwise (webhooks
   * `QUEUE_STORAGE_DRIVER`, flags `SOURCE_STORAGE_DRIVER`).
   */
  driverEnv?: string;
  defaults?: StorageRoleDefaults;
}

/** The resolved settings a driver factory receives. Connection strings are never logged. */
export interface StorageConfig {
  driver: string;
  role: string;
  /** `REDIS_URL` (default `redis://localhost:6379`). */
  redisUrl: string;
  prefix: string | undefined;
  /** `DATABASE_URL`, else `POSTGRES_URL` (default `postgres://localhost:5432/postgres`). */
  postgresUrl: string;
  pgTable: string | undefined;
  /** `MONGO_URL` (default `mongodb://localhost:27017`). */
  mongoUrl: string;
  mongoDb: string | undefined;
  mongoCollection: string | undefined;
  sqlitePath: string | undefined;
  /** `<ROLE>_SQLITE_TABLE`: the `sqlite` and `libsql` table. */
  sqliteTable: string | undefined;
  libsqlUrl: string | undefined;
  /** `LIBSQL_AUTH_TOKEN`. */
  libsqlAuthToken: string | undefined;
  fileDir: string | undefined;
  env: Env;
}

/** Builds a storage for a driver from the resolved config. */
export type StorageFactory<S = unknown> = (config: StorageConfig) => Promise<S> | S;

/** Driver name → factory. */
export type StorageRegistry<S = unknown> = Record<string, StorageFactory<S>>;

type Factories = Record<string, (options: Record<string, unknown>) => unknown>;

/** Load a kit storage entry; a missing or stub entry is "not available in this build". */
/** The module-not-found error in `error`'s cause chain (loaders wrap import errors), if any. */
function moduleNotFound(error: unknown): unknown {
  for (let e = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: string }).code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return e;
    if (/Cannot find (module|package)/i.test(String((e as { message?: unknown }).message ?? e))) {
      return e;
    }
  }
  return undefined;
}

async function loadEntry(
  driver: string,
  load: () => Promise<unknown>,
  factory: string,
): Promise<(options: Record<string, unknown>) => unknown> {
  let mod: Factories;
  try {
    mod = (await load()) as Factories;
  } catch (error) {
    const missing = moduleNotFound(error);
    if (missing) {
      throw new Error(
        `The "${driver}" storage driver is not available in this build (${String(missing)}).`,
      );
    }
    throw error;
  }
  const fn = mod[factory];
  if (typeof fn !== "function") {
    throw new Error(
      `The "${driver}" storage driver is not available in this build (no ${factory}).`,
    );
  }
  return fn;
}

const defined = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * The default registry: each driver lazily imports the kit's storage entry, so
 * an optional peer loads only when its driver is chosen. Factory names and
 * options match the products' CLIs.
 */
export const defaultStorageRegistry: StorageRegistry = {
  memory: async () =>
    (await loadEntry("memory", () => import("../entry-storage-memory.ts"), "createMemoryStorage"))(
      {},
    ),
  file: async (c) =>
    (await loadEntry("file", () => import("../entry-storage-file.ts"), "createFileStorage"))(
      defined({ dir: c.fileDir }),
    ),
  sqlite: async (c) =>
    (await loadEntry("sqlite", () => import("../entry-storage-sqlite.ts"), "createSqliteStorage"))(
      defined({ path: c.sqlitePath, table: c.sqliteTable }),
    ),
  libsql: async (c) =>
    (await loadEntry("libsql", () => import("../entry-storage-libsql.ts"), "createLibsqlStorage"))(
      defined({ url: c.libsqlUrl, authToken: c.libsqlAuthToken, table: c.sqliteTable }),
    ),
  postgres: async (c) =>
    (
      await loadEntry(
        "postgres",
        () => import("../entry-storage-postgres.ts"),
        "createPostgresStorage",
      )
    )(defined({ connectionString: c.postgresUrl, table: c.pgTable })),
  mongodb: async (c) =>
    (await loadEntry("mongodb", () => import("../entry-storage-mongodb.ts"), "createMongoStorage"))(
      defined({ url: c.mongoUrl, dbName: c.mongoDb, collectionName: c.mongoCollection }),
    ),
  redis: async (c) =>
    (await loadEntry("redis", () => import("../entry-storage-redis.ts"), "createRedisStorage"))(
      defined({ url: c.redisUrl, prefix: c.prefix }),
    ),
  "redis-json": async (c) =>
    (
      await loadEntry(
        "redis-json",
        () => import("../entry-storage-redis.ts"),
        "createRedisJSONStorage",
      )
    )(defined({ url: c.redisUrl, prefix: c.prefix })),
  unstorage: async () => {
    const create = await loadEntry(
      "unstorage",
      () => import("../entry-storage-unstorage.ts"),
      "createUnstorageStorage",
    );
    const { importPeer } = await import("../internal/peer.ts");
    const { createStorage } = await importPeer(
      "unstorage",
      "@xtandard/kit/cli",
      () => import("unstorage" as string) as Promise<{ createStorage(): unknown }>,
    );
    return create({ storage: createStorage() });
  },
};

/** Options for {@link storageFromEnv}. */
export interface StorageFromEnvOptions<S = unknown> {
  role: StorageRole;
  env?: Env;
  /** Driver registry. Default: {@link defaultStorageRegistry} (all kit drivers). */
  drivers?: StorageRegistry<S>;
  /** Restrict the drivers this product's CLI accepts (default: every registry key). */
  allowed?: readonly string[];
}

/** The driver env var of a role. */
export const driverEnvOf = (role: StorageRole): string =>
  role.driverEnv ?? (role.name === "STORAGE" ? "STORAGE_DRIVER" : `${role.name}_STORAGE_DRIVER`);

/** Resolve a role's driver and settings from env. **An unknown driver throws.** */
export function resolveStorageConfig(
  role: StorageRole,
  options: { env?: Env; allowed: readonly string[] },
): StorageConfig {
  const source = options.env ?? processEnv();
  const d = role.defaults ?? {};
  const name = role.name;
  const varName = driverEnvOf(role);
  const driver = env(varName, d.driver ?? "file", source);
  if (!options.allowed.includes(driver)) {
    throw new Error(
      `Unknown ${varName} "${driver}" (expected one of: ${options.allowed.join(", ")})`,
    );
  }
  const opt = (key: string, fallback: string | undefined) => env(key, "", source) || fallback;
  return {
    driver,
    role: name,
    redisUrl: env("REDIS_URL", "redis://localhost:6379", source),
    prefix: opt(`${name}_PREFIX`, d.prefix),
    postgresUrl:
      env("DATABASE_URL", "", source) ||
      env("POSTGRES_URL", "postgres://localhost:5432/postgres", source),
    pgTable: opt(`${name}_PG_TABLE`, d.pgTable),
    mongoUrl: env("MONGO_URL", "mongodb://localhost:27017", source),
    mongoDb: opt("MONGO_DB", d.mongoDb),
    mongoCollection: opt(`${name}_MONGO_COLLECTION`, d.mongoCollection),
    sqlitePath: opt(`${name}_SQLITE_PATH`, d.sqlitePath),
    sqliteTable: opt(`${name}_SQLITE_TABLE`, d.sqliteTable),
    libsqlUrl: opt(`${name}_LIBSQL_URL`, opt("LIBSQL_URL", d.libsqlUrl)),
    libsqlAuthToken: opt("LIBSQL_AUTH_TOKEN", undefined),
    fileDir: opt(`${name}_FILE_DIR`, d.fileDir),
    env: source,
  };
}

/**
 * Build a role's storage from env (au/en's allow-list loader, generic over the
 * product's roles). Unknown drivers fail instead of silently using `file`.
 *
 * @example
 * ```ts
 * const queue = await storageFromEnv<WebhooksStorage>({
 *   role: {
 *     name: "QUEUE",
 *     defaults: { prefix: "xtandard:webhooks:queue", pgTable: "xtandard_webhooks_queue",
 *       mongoDb: "xtandard_webhooks", mongoCollection: "webhooks_queue",
 *       sqlitePath: "./.webhooks/queue.sqlite", sqliteTable: "xtandard_webhooks",
 *       libsqlUrl: "file:./.webhooks/queue.db", fileDir: "./.webhooks/queue" },
 *   },
 * });
 * ```
 */
export async function storageFromEnv<S = unknown>(options: StorageFromEnvOptions<S>): Promise<S> {
  const drivers = (options.drivers ?? defaultStorageRegistry) as StorageRegistry<S>;
  const config = resolveStorageConfig(options.role, {
    ...(options.env ? { env: options.env } : {}),
    allowed: options.allowed ?? Object.keys(drivers),
  });
  const factory = drivers[config.driver];
  if (!factory)
    throw new Error(`The "${config.driver}" storage driver is not available in this build.`);
  return await factory(config);
}

/**
 * A log-safe description of where a role persists data, for the startup
 * banner: file and SQLite paths are resolved to absolute paths; drivers with a
 * connection string print only their name (never the URL, which may carry
 * credentials).
 */
export async function describeStorage(
  role: StorageRole,
  options: { env?: Env; allowed?: readonly string[] } = {},
): Promise<string> {
  const config = resolveStorageConfig(role, {
    ...(options.env ? { env: options.env } : {}),
    allowed: options.allowed ?? Object.keys(defaultStorageRegistry),
  });
  const { resolve } = await import("node:path");
  switch (config.driver) {
    case "file":
      return config.fileDir ? `file → ${resolve(config.fileDir)}` : "file";
    case "sqlite":
      return config.sqlitePath ? `sqlite → ${resolve(config.sqlitePath)}` : "sqlite";
    case "libsql":
      return config.libsqlUrl?.startsWith("file:")
        ? `libsql → ${resolve(config.libsqlUrl.slice("file:".length))}`
        : "libsql";
    case "memory":
      return "memory (ephemeral — not persisted)";
    default:
      return config.driver;
  }
}

// --- Serving ----------------------------------------------------------------------------

/** A running server. */
export interface RunningServer {
  /** The bound port (useful with port `0`). */
  port: number;
  /** Stop listening. */
  stop(): Promise<void>;
}

/** Options for {@link startServer}. */
export interface StartServerOptions {
  hostname?: string;
  /** Force the Node bridge even under Bun (tests). Default `false`. */
  node?: boolean;
}

/**
 * Serve a fetch handler under whatever runtime the CLI runs on: `Bun.serve`
 * under Bun, a `node:http` server over the shared Node bridge under Node
 * (multi-value headers, every `Set-Cookie`, streamed responses). Resolves once
 * listening.
 */
export async function startServer(
  port: number,
  fetch: FetchHandler,
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const bun = (
    globalThis as {
      Bun?: {
        serve(o: { port: number; hostname?: string; fetch: FetchHandler }): {
          port: number;
          stop(force?: boolean): void | Promise<void>;
        };
      };
    }
  ).Bun;
  if (bun && !options.node) {
    const server = bun.serve({
      port,
      ...(options.hostname ? { hostname: options.hostname } : {}),
      fetch: (request) => fetch(request),
    });
    return { port: server.port, stop: async () => void (await server.stop(true)) };
  }
  const [{ createServer }, { toNodeHandler }] = await Promise.all([
    import("node:http"),
    import("../adapters/node.ts"),
  ]);
  const server = createServer(toNodeHandler(fetch));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, options.hostname, () => resolve());
  });
  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : port,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        // Stop accepting, then drop keep-alive connections (Node's documented order).
        // Bun's node:http shim may already report the server as stopped.
        server.close((error) => {
          const code = (error as { code?: string } | undefined)?.code;
          if (error && code !== "ERR_SERVER_NOT_RUNNING") reject(error);
          else resolve();
        });
        server.closeAllConnections?.();
      }),
  };
}

/** The env-derived settings {@link serve} passes to `buildPanel`. */
export interface ServeSettings {
  port: number;
  /** `BASE_PATH`, normalized (`""` or `/segment`). */
  basePath: string;
  /** `TITLE`, when set. */
  title: string | undefined;
  /** `LOGO_URL`, when set. */
  logoUrl: string | undefined;
  /** `READONLY` is `1`/`true`. */
  readonly: boolean;
  env: Env;
}

/** Options for {@link serve}. */
export interface ServeOptions {
  /** Log prefix, e.g. `"xtandard/webhooks"`. */
  name: string;
  /** Build the panel from the env-derived settings (the product reads its own extra env). */
  buildPanel(settings: ServeSettings): Promise<{ fetch: FetchHandler; close?(): unknown }>;
  /** `--port` override; default `PORT`, then 3000. */
  port?: number;
  env?: Env;
  /** Extra banner lines (e.g. `describeStorage`), printed before listening. */
  banner?: () => Promise<string[]> | string[];
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Resolve with the running server instead of never resolving (tests). Default `false`. */
  returnServer?: boolean;
  startServer?: StartServerOptions;
}

/**
 * The `serve` command: read the common env (`PORT`, `BASE_PATH`, `TITLE`,
 * `LOGO_URL`, `READONLY`), warn on `AUTH_MODE=none`, build the panel, print
 * the banner and listen. The server owns the process: it **never resolves**,
 * so the bin doesn't exit (unless `returnServer`).
 */
export async function serve(options: ServeOptions & { returnServer: true }): Promise<RunningServer>;
export async function serve(options: ServeOptions): Promise<never>;
export async function serve(options: ServeOptions): Promise<RunningServer> {
  const source = options.env ?? processEnv();
  const out = options.stdout ?? stdout;
  const err = options.stderr ?? stderr;
  const port = options.port ?? Number(env("PORT", "3000", source));
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error(`Invalid port "${port}"`);
  const settings: ServeSettings = {
    port,
    basePath: normalizeBasePath(env("BASE_PATH", "", source)),
    title: env("TITLE", "", source) || undefined,
    logoUrl: env("LOGO_URL", "", source) || undefined,
    readonly: isTruthy(env("READONLY", "", source)),
    env: source,
  };
  if (env("AUTH_MODE", "none", source) === "none") {
    err(`[${options.name}] AUTH_MODE=none — do NOT expose this publicly without authentication.`);
  }
  const panel = await options.buildPanel(settings);
  for (const line of (await options.banner?.()) ?? []) out(`[${options.name}] ${line}`);
  const server = await startServer(port, panel.fetch, options.startServer);
  out(`[${options.name}] listening on http://localhost:${server.port}${settings.basePath || "/"}`);
  if (options.returnServer) {
    return {
      port: server.port,
      stop: async () => {
        await server.stop();
        await panel.close?.();
      },
    };
  }
  return await new Promise<never>(() => {});
}

/**
 * The `version` of the package.json at `relative` to `moduleUrl` (default
 * `../package.json`, which is right for `dist/cli.mjs` and `src/cli.ts`), or
 * `"unknown"`.
 */
export async function pkgVersion(
  moduleUrl: string | URL,
  relative = "../package.json",
): Promise<string> {
  try {
    const [{ readFile }, { fileURLToPath }] = await Promise.all([
      import("node:fs/promises"),
      import("node:url"),
    ]);
    const pkg = JSON.parse(await readFile(fileURLToPath(new URL(relative, moduleUrl)), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * The self-run guard (au 6761a34): true when the module is the program's entry
 * point (`bun src/cli.ts`, `node dist/cli.mjs`), false when it is imported —
 * by the `bin/` wrapper, a test or the standalone app — so `run()` executes
 * exactly once.
 *
 * ```ts
 * // src/cli.ts
 * export async function run(argv: string[]): Promise<number> { … }
 * if (isMainModule(import.meta)) run(process.argv.slice(2)).then((code) => process.exit(code));
 * ```
 */
export function isMainModule(meta: { url: string; main?: boolean }): boolean {
  if (typeof meta.main === "boolean") return meta.main;
  const proc = (
    globalThis as {
      process?: { argv?: string[]; getBuiltinModule?: (id: string) => unknown };
    }
  ).process;
  const entry = proc?.argv?.[1];
  const url = proc?.getBuiltinModule?.("node:url") as
    | { fileURLToPath(u: string): string; pathToFileURL(p: string): URL }
    | undefined;
  const fs = proc?.getBuiltinModule?.("node:fs") as { realpathSync(p: string): string } | undefined;
  if (!entry) return false;
  try {
    // Without synchronous built-ins (Node < 20.16) compare the plain file path, symlinks unresolved.
    const fromUrl = (u: string) => (url ? url.fileURLToPath(u) : filePath(new URL(u)));
    const real = (p: string) => (fs ? fs.realpathSync(p) : p);
    return real(fromUrl(meta.url)) === real(entry);
  } catch {
    return false;
  }
}

const stdout = (line: string): void => {
  (globalThis as { process?: { stdout?: { write(s: string): void } } }).process?.stdout?.write(
    `${line}\n`,
  );
};
const stderr = (line: string): void => {
  (globalThis as { process?: { stderr?: { write(s: string): void } } }).process?.stderr?.write(
    `${line}\n`,
  );
};
