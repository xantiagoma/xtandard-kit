import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildAuthFromEnv,
  defaultStorageRegistry,
  describeStorage,
  driverEnvOf,
  env,
  isMainModule,
  isTruthy,
  parseArgs,
  pkgVersion,
  resolveStorageConfig,
  serve,
  startServer,
  storageFromEnv,
  type StorageConfig,
  type StorageRegistry,
} from "../src/cli/index.ts";
import { defineActions } from "../src/authorization/contract.ts";
import type { RolesAuthorizationOptions } from "../src/authorization/roles.ts";

// A stub entry (no factory): the driver is not in this build.
vi.mock("../src/entry-storage-redis.ts", () => ({ createRedisStorage: undefined }));
vi.mock("../src/entry-storage-mongodb.ts", () => {
  throw Object.assign(new Error("Cannot find module 'mongodb'"), { code: "ERR_MODULE_NOT_FOUND" });
});
vi.mock("../src/entry-storage-postgres.ts", () => {
  throw new Error("broken install");
});

const actions = defineActions({ all: ["item:read", "item:write"], mutating: ["item:write"] });
type Action = (typeof actions.ALL_ACTIONS)[number];
const roles: RolesAuthorizationOptions<Action> = {
  policy: { admin: "*", viewer: ["item:read"] },
  actions,
};
const basic = (user: string, pw: string) =>
  new Request("http://x/", { headers: { authorization: `Basic ${btoa(`${user}:${pw}`)}` } });

describe("env / isTruthy", () => {
  it("treats an empty value as unset (|| semantics)", () => {
    // Regression: wh/fl/au/li used ??, so `PORT=` became "" instead of the default.
    expect(env("PORT", "3000", { PORT: "" })).toBe("3000");
    expect(env("PORT", "3000", { PORT: "8080" })).toBe("8080");
    expect(env("MISSING", undefined, {})).toBe("");
    process.env.KIT_CLI_TEST = "from-process";
    expect(env("KIT_CLI_TEST")).toBe("from-process");
    delete process.env.KIT_CLI_TEST;
  });

  it("isTruthy", () => {
    expect([isTruthy("1"), isTruthy("true"), isTruthy("TRUE")]).toEqual([true, true, true]);
    expect([isTruthy("0"), isTruthy("yes"), isTruthy(""), isTruthy(undefined)]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("parseArgs", () => {
  it("long flags, = values, booleans and positionals", () => {
    expect(parseArgs(["serve", "--port", "4000", "--readonly", "--title=a=b", "extra"])).toEqual({
      _: ["serve", "extra"],
      flags: { port: "4000", readonly: true, title: "a=b" },
    });
    expect(parseArgs(["--flag", "--next", "v"]).flags).toEqual({ flag: true, next: "v" });
    expect(parseArgs(["--help", "cmd"])).toEqual({ _: ["cmd"], flags: { help: true } });
  });

  it("short flags (links) and the guards", () => {
    expect(
      parseArgs(["-t", "acme", "-h", "-v", "-x"], {
        short: { t: "tenant", h: "help", v: "version" },
      }),
    ).toEqual({
      _: ["-x"],
      flags: { tenant: "acme", help: true, version: true },
    });
    expect(parseArgs(["-t"], { short: { t: "tenant" } }).flags).toEqual({ tenant: true });
    // en guard: `--=x` is not a flag with an empty name.
    expect(parseArgs(["--=x"])).toEqual({ _: ["--=x"], flags: {} });
    // `--` ends the flags.
    expect(parseArgs(["a", "--", "--not-a-flag", "-h"])).toEqual({
      _: ["a", "--not-a-flag", "-h"],
      flags: {},
    });
    expect(parseArgs(["--x", "-5"], { boolean: [] }).flags).toEqual({ x: true });
  });
});

describe("buildAuthFromEnv", () => {
  it("AUTH_MODE none / empty / unset → anonymous, allow-all", async () => {
    for (const source of [{ AUTH_MODE: "none" }, { AUTH_MODE: "" }, {}]) {
      const { mode, auth, authorization } = await buildAuthFromEnv({
        realm: "r",
        roles,
        env: source,
      });
      expect(mode).toBe("none");
      const principal = await auth.authenticate(new Request("http://x/"));
      expect(principal).toEqual({ id: "anonymous" });
      expect(
        await authorization.authorize({
          principal,
          action: "item:write",
          resource: {},
          request: new Request("http://x/"),
        }),
      ).toBe(true);
    }
  });

  it("an unknown AUTH_MODE throws instead of opening the panel", async () => {
    // Regression: wh/fl/au/li treated typos such as "basci" as none.
    await expect(
      buildAuthFromEnv({ realm: "r", roles, env: { AUTH_MODE: "basci" } }),
    ).rejects.toThrow('Unknown AUTH_MODE "basci" (expected none or basic)');
  });

  it("AUTH_MODE=basic: one user, role, realm and the product's roles provider", async () => {
    const { mode, auth, authorization } = await buildAuthFromEnv({
      realm: "xtandard-webhooks",
      roles,
      env: { AUTH_MODE: "basic", AUTH_USERNAME: "ops", AUTH_PASSWORD: "pw", AUTH_ROLE: "viewer" },
    });
    expect(mode).toBe("basic");
    const principal = await auth.authenticate(basic("ops", "pw"));
    expect(principal).toEqual({ id: "ops", name: "ops", roles: ["viewer"] });
    expect(await auth.authenticate(basic("ops", "nope"))).toBeNull();
    expect(auth.challenge?.(new Request("http://x/"))?.headers.get("www-authenticate")).toBe(
      'Basic realm="xtandard-webhooks"',
    );
    const input = (action: "item:read" | "item:write") => ({
      principal,
      action,
      resource: {},
      request: new Request("http://x/"),
    });
    expect(await authorization.authorize(input("item:read"))).toBe(true);
    expect(await authorization.authorize(input("item:write"))).toBe(false);
  });

  it("basic with a hash; warns when no password is configured", async () => {
    const { hashPassword } = await import("../src/auth/basic.ts");
    const hashed = await buildAuthFromEnv({
      realm: "r",
      roles,
      env: { AUTH_MODE: "basic", AUTH_PASSWORD_HASH: await hashPassword("s3cret") },
    });
    expect(await hashed.auth.authenticate(basic("admin", "s3cret"))).toMatchObject({
      id: "admin",
      roles: ["admin"],
    });
    const warn = vi.fn();
    await buildAuthFromEnv({
      realm: "r",
      roles,
      env: { AUTH_MODE: "basic" },
      warn,
      name: "xtandard/flags",
    });
    expect(warn).toHaveBeenCalledWith(
      "[xtandard/flags] AUTH_MODE=basic but neither AUTH_PASSWORD_HASH nor AUTH_PASSWORD is set.",
    );
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await buildAuthFromEnv({
      realm: "r",
      roles,
      env: { AUTH_MODE: "basic" },
      defaultRole: "viewer",
    });
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("[xtandard] AUTH_MODE=basic"));
    stderr.mockRestore();
  });
});

describe("storage from env", () => {
  const queue = {
    name: "QUEUE",
    defaults: {
      prefix: "xtandard:webhooks:queue",
      pgTable: "xtandard_webhooks_queue",
      mongoDb: "xtandard_webhooks",
      mongoCollection: "webhooks_queue",
      sqlitePath: "./.webhooks/queue.sqlite",
      sqliteTable: "xtandard_webhooks",
      libsqlUrl: "file:./.webhooks/queue.db",
      fileDir: "./.webhooks/queue",
    },
  };

  it("driver env var names per role", () => {
    expect(driverEnvOf({ name: "STORAGE" })).toBe("STORAGE_DRIVER");
    expect(driverEnvOf({ name: "QUEUE" })).toBe("QUEUE_STORAGE_DRIVER"); // webhooks
    expect(driverEnvOf({ name: "SOURCE" })).toBe("SOURCE_STORAGE_DRIVER"); // flags
    expect(driverEnvOf({ name: "COUNTERS", driverEnv: "COUNTERS_DRIVER" })).toBe("COUNTERS_DRIVER"); // entitlements
  });

  it("resolves role settings with the products' env names and the product's defaults", () => {
    const allowed = Object.keys(defaultStorageRegistry);
    const defaults = resolveStorageConfig(queue, { env: {}, allowed });
    expect(defaults).toMatchObject({
      driver: "file",
      role: "QUEUE",
      redisUrl: "redis://localhost:6379",
      prefix: "xtandard:webhooks:queue",
      postgresUrl: "postgres://localhost:5432/postgres",
      pgTable: "xtandard_webhooks_queue",
      mongoUrl: "mongodb://localhost:27017",
      mongoDb: "xtandard_webhooks",
      mongoCollection: "webhooks_queue",
      sqlitePath: "./.webhooks/queue.sqlite",
      sqliteTable: "xtandard_webhooks",
      libsqlUrl: "file:./.webhooks/queue.db",
      libsqlAuthToken: undefined,
      fileDir: "./.webhooks/queue",
    });
    const set = resolveStorageConfig(queue, {
      allowed,
      env: {
        QUEUE_STORAGE_DRIVER: "postgres",
        REDIS_URL: "redis://r",
        QUEUE_PREFIX: "p",
        DATABASE_URL: "postgres://db",
        POSTGRES_URL: "postgres://ignored",
        QUEUE_PG_TABLE: "t",
        MONGO_URL: "mongodb://m",
        MONGO_DB: "d",
        QUEUE_MONGO_COLLECTION: "c",
        QUEUE_SQLITE_PATH: "s.sqlite",
        QUEUE_SQLITE_TABLE: "st",
        LIBSQL_URL: "libsql://shared",
        LIBSQL_AUTH_TOKEN: "tok",
        QUEUE_FILE_DIR: "dir",
      },
    });
    expect(set).toMatchObject({
      driver: "postgres",
      redisUrl: "redis://r",
      prefix: "p",
      postgresUrl: "postgres://db",
      pgTable: "t",
      mongoUrl: "mongodb://m",
      mongoDb: "d",
      mongoCollection: "c",
      sqlitePath: "s.sqlite",
      sqliteTable: "st",
      libsqlUrl: "libsql://shared",
      libsqlAuthToken: "tok",
      fileDir: "dir",
    });
    expect(
      resolveStorageConfig(queue, {
        allowed,
        env: { QUEUE_LIBSQL_URL: "libsql://q", LIBSQL_URL: "x" },
      }).libsqlUrl,
    ).toBe("libsql://q");
    expect(
      resolveStorageConfig(queue, { allowed, env: { POSTGRES_URL: "postgres://pg" } }).postgresUrl,
    ).toBe("postgres://pg");
    expect(
      resolveStorageConfig(
        { name: "STORAGE", defaults: { driver: "memory" } },
        { allowed, env: {} },
      ).driver,
    ).toBe("memory");
  });

  it("an unknown driver throws instead of silently using file", async () => {
    // Regression: wh/fl/li fell back to `file` on a typo such as STORAGE_DRIVER=postgress.
    await expect(
      storageFromEnv({ role: { name: "STORAGE" }, env: { STORAGE_DRIVER: "postgress" } }),
    ).rejects.toThrow(
      'Unknown STORAGE_DRIVER "postgress" (expected one of: memory, file, sqlite, libsql, postgres, mongodb, redis, redis-json, unstorage)',
    );
    await expect(
      storageFromEnv({
        role: { name: "STORAGE" },
        env: { STORAGE_DRIVER: "redis" },
        allowed: ["memory", "file"],
      }),
    ).rejects.toThrow('Unknown STORAGE_DRIVER "redis" (expected one of: memory, file)');
    await expect(
      storageFromEnv({
        role: { name: "STORAGE" },
        env: { STORAGE_DRIVER: "x" },
        drivers: {},
        allowed: ["x"],
      }),
    ).rejects.toThrow('The "x" storage driver is not available in this build.');
  });

  it("uses an injected registry (generic over the product's storage type)", async () => {
    const seen: StorageConfig[] = [];
    type Fake = { kind: string; table?: string | undefined };
    const drivers: StorageRegistry<Fake> = {
      memory: (c: StorageConfig) => {
        seen.push(c);
        return { kind: "memory" as const };
      },
      postgres: async (c: StorageConfig) => ({ kind: "postgres" as const, table: c.pgTable }),
    };
    const storage = await storageFromEnv({
      role: queue,
      drivers,
      env: { QUEUE_STORAGE_DRIVER: "postgres" },
    });
    expect(storage).toEqual({ kind: "postgres", table: "xtandard_webhooks_queue" });
    await storageFromEnv({ role: { ...queue, defaults: { driver: "memory" } }, drivers, env: {} });
    expect(seen[0]?.role).toBe("QUEUE");
  });

  it("the default registry builds kit drivers lazily", async () => {
    const memory = (await storageFromEnv({
      role: { name: "STORAGE" },
      env: { STORAGE_DRIVER: "memory" },
    })) as {
      setItem(k: string, v: unknown): Promise<void>;
      getItem(k: string): Promise<unknown>;
    };
    await memory.setItem("a", { b: 1 });
    expect(await memory.getItem("a")).toEqual({ b: 1 });
    const dir = mkdtempSync(join(tmpdir(), "kit-cli-file-"));
    const file = (await storageFromEnv({
      role: { name: "STORAGE" },
      env: { STORAGE_FILE_DIR: dir },
    })) as typeof memory;
    await file.setItem("k", 1);
    expect(await file.getItem("k")).toBe(1);
  });

  it("a driver missing from this build says so; other import errors propagate", async () => {
    await expect(
      storageFromEnv({ role: { name: "STORAGE" }, env: { STORAGE_DRIVER: "redis" } }),
    ).rejects.toThrow(
      'The "redis" storage driver is not available in this build (no createRedisStorage).',
    );
    await expect(
      storageFromEnv({ role: { name: "STORAGE" }, env: { STORAGE_DRIVER: "mongodb" } }),
    ).rejects.toThrow(
      /The "mongodb" storage driver is not available in this build \(.*Cannot find module/,
    );
    // vitest wraps a throwing mock factory; the original error is the cause.
    const broken = (await storageFromEnv({
      role: { name: "STORAGE" },
      env: { STORAGE_DRIVER: "postgres" },
    }).catch((e: unknown) => e)) as Error & { cause?: Error };
    expect(broken.message).not.toContain("not available in this build");
    expect((broken.cause ?? broken).message).toBe("broken install");
  });

  it("the default registry passes the products' factory options", async () => {
    const calls: unknown[] = [];
    const config = (driver: string): StorageConfig => ({
      ...resolveStorageConfig(queue, { env: { QUEUE_STORAGE_DRIVER: driver }, allowed: [driver] }),
      libsqlAuthToken: "tok",
    });
    const mod = (name: string) =>
      vi.doMock(`../src/entry-storage-${name}.ts`, () => ({
        [`create${{ sqlite: "Sqlite", libsql: "Libsql", redis: "Redis" }[name]}Storage`]: (
          o: unknown,
        ) => calls.push([name, o]),
        createRedisJSONStorage: (o: unknown) => calls.push(["redis-json", o]),
      }));
    for (const name of ["sqlite", "libsql", "redis"]) mod(name);
    vi.resetModules();
    const { defaultStorageRegistry: fresh } = await import("../src/cli/index.ts");
    await fresh.sqlite?.(config("sqlite"));
    await fresh.libsql?.(config("libsql"));
    await fresh.redis?.(config("redis"));
    await fresh["redis-json"]?.(config("redis-json"));
    expect(calls).toEqual([
      ["sqlite", { path: "./.webhooks/queue.sqlite", table: "xtandard_webhooks" }],
      [
        "libsql",
        { url: "file:./.webhooks/queue.db", authToken: "tok", table: "xtandard_webhooks" },
      ],
      ["redis", { url: "redis://localhost:6379", prefix: "xtandard:webhooks:queue" }],
      ["redis-json", { url: "redis://localhost:6379", prefix: "xtandard:webhooks:queue" }],
    ]);
    vi.doUnmock("../src/entry-storage-sqlite.ts");
    vi.doUnmock("../src/entry-storage-libsql.ts");
  });

  it("unstorage builds an in-memory unstorage instance", async () => {
    const storage = (await storageFromEnv({
      role: { name: "SOURCE" },
      env: { SOURCE_STORAGE_DRIVER: "unstorage" },
    })) as {
      setItem(k: string, v: unknown): Promise<void>;
      getItem(k: string): Promise<unknown>;
    };
    await storage.setItem("a:b", "v");
    expect(await storage.getItem("a:b")).toBe("v");
  });

  it("describeStorage never prints connection strings", async () => {
    const d = (source: Record<string, string>) => describeStorage(queue, { env: source });
    expect(await d({})).toBe(`file → ${resolve("./.webhooks/queue")}`);
    expect(await d({ QUEUE_STORAGE_DRIVER: "sqlite" })).toBe(
      `sqlite → ${resolve("./.webhooks/queue.sqlite")}`,
    );
    expect(await d({ QUEUE_STORAGE_DRIVER: "libsql" })).toBe(
      `libsql → ${resolve("./.webhooks/queue.db")}`,
    );
    expect(await d({ QUEUE_STORAGE_DRIVER: "libsql", LIBSQL_URL: "libsql://u:p@host" })).toBe(
      "libsql",
    );
    expect(await d({ QUEUE_STORAGE_DRIVER: "memory" })).toBe("memory (ephemeral — not persisted)");
    expect(
      await d({ QUEUE_STORAGE_DRIVER: "postgres", DATABASE_URL: "postgres://u:secret@h/db" }),
    ).toBe("postgres");
    expect(await describeStorage({ name: "STORAGE" }, { env: { STORAGE_DRIVER: "sqlite" } })).toBe(
      "sqlite",
    );
    expect(await describeStorage({ name: "STORAGE" }, { env: {} })).toBe("file");
    await expect(
      describeStorage({ name: "STORAGE" }, { env: { STORAGE_DRIVER: "x" } }),
    ).rejects.toThrow("Unknown");
  });
});

describe("serving", () => {
  const handler = (request: Request) => {
    const headers = new Headers();
    headers.append("set-cookie", "a=1");
    headers.append("set-cookie", "b=2");
    return new Response(`hello ${new URL(request.url).pathname}`, { headers });
  };

  it("startServer over the Node bridge keeps cookies and binds port 0", async () => {
    const server = await startServer(0, handler, { node: true, hostname: "127.0.0.1" });
    expect(server.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${server.port}/x`);
    expect(await res.text()).toBe("hello /x");
    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    await server.stop();
  });

  it("startServer under Bun uses Bun.serve", async () => {
    const stop = vi.fn();
    const bunServe = vi.fn(() => ({ port: 1234, stop }));
    (globalThis as { Bun?: unknown }).Bun = { serve: bunServe };
    try {
      const server = await startServer(1234, handler, { hostname: "0.0.0.0" });
      expect(server.port).toBe(1234);
      const fetchArg = (bunServe.mock.calls[0] as unknown as [{ fetch(r: Request): Response }])[0];
      expect(await fetchArg.fetch(new Request("http://x/y")).text()).toBe("hello /y");
      expect(bunServe).toHaveBeenCalledWith(
        expect.objectContaining({ port: 1234, hostname: "0.0.0.0" }),
      );
      await server.stop();
      expect(stop).toHaveBeenCalledWith(true);
    } finally {
      delete (globalThis as { Bun?: unknown }).Bun;
    }
  });

  it("startServer rejects when the port is taken", async () => {
    const first = await startServer(0, handler, { node: true, hostname: "127.0.0.1" });
    await expect(
      startServer(first.port, handler, { node: true, hostname: "127.0.0.1" }),
    ).rejects.toThrow(/EADDRINUSE/);
    await first.stop();
  });

  it("serve: env settings, AUTH_MODE=none warning, banner, listening line", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const close = vi.fn();
    const buildPanel = vi.fn(async () => ({ fetch: handler, close }));
    const server = await serve({
      name: "xtandard/webhooks",
      env: { BASE_PATH: "webhooks/", TITLE: "Hooks", LOGO_URL: "/l.svg", READONLY: "true" },
      port: 0,
      buildPanel,
      banner: () => ["storage: memory"],
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      returnServer: true,
      startServer: { node: true, hostname: "127.0.0.1" },
    });
    expect(buildPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 0,
        basePath: "/webhooks",
        title: "Hooks",
        logoUrl: "/l.svg",
        readonly: true,
      }),
    );
    expect(err).toEqual([
      "[xtandard/webhooks] AUTH_MODE=none — do NOT expose this publicly without authentication.",
    ]);
    expect(out).toEqual([
      "[xtandard/webhooks] storage: memory",
      `[xtandard/webhooks] listening on http://localhost:${server.port}/webhooks`,
    ]);
    expect(await (await fetch(`http://127.0.0.1:${server.port}/webhooks/x`)).text()).toBe(
      "hello /webhooks/x",
    );
    await server.stop();
    expect(close).toHaveBeenCalledOnce();
  });

  it("serve: PORT from env, no warning with basic auth, invalid ports, default sinks", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const server = await serve({
      name: "x",
      env: { PORT: "0", AUTH_MODE: "basic" },
      buildPanel: async (s) => {
        expect(s).toMatchObject({
          basePath: "",
          title: undefined,
          logoUrl: undefined,
          readonly: false,
        });
        return { fetch: handler };
      },
      returnServer: true,
      startServer: { node: true, hostname: "127.0.0.1" },
    });
    expect(stdout).toHaveBeenCalledWith(`[x] listening on http://localhost:${server.port}/\n`);
    await server.stop();
    stdout.mockRestore();
    await expect(
      serve({ name: "x", env: { PORT: "nope" }, buildPanel: async () => ({ fetch: handler }) }),
    ).rejects.toThrow('Invalid port "NaN"');
  });

  it("serve never resolves by default (the server owns the process)", async () => {
    const stop = vi.fn();
    (globalThis as { Bun?: unknown }).Bun = { serve: () => ({ port: 9, stop }) };
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const pending = serve({
        name: "x",
        env: {},
        port: 9,
        buildPanel: async () => ({ fetch: handler }),
      });
      const raced = await Promise.race([
        pending.then(() => "resolved"),
        new Promise((r) => setTimeout(() => r("pending"), 30)),
      ]);
      expect(raced).toBe("pending");
    } finally {
      delete (globalThis as { Bun?: unknown }).Bun;
      err.mockRestore();
      out.mockRestore();
    }
  });
});

describe("pkgVersion / isMainModule", () => {
  it("reads the version next to the module, or unknown", async () => {
    const root = mkdtempSync(join(tmpdir(), "kit-pkg-"));
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    const moduleUrl = pathToFileURL(join(root, "dist", "cli.mjs"));
    expect(await pkgVersion(moduleUrl)).toBe("1.2.3");
    expect(await pkgVersion(moduleUrl, "./missing.json")).toBe("unknown");
    await writeFile(join(root, "bad.json"), JSON.stringify({ version: 1 }));
    expect(await pkgVersion(pathToFileURL(join(root, "x.mjs")), "./bad.json")).toBe("unknown");
  });

  it("is true only for the entry point", () => {
    expect(isMainModule({ url: "file:///x.ts", main: true })).toBe(true);
    expect(isMainModule({ url: "file:///x.ts", main: false })).toBe(false);
    const argv = process.argv[1];
    process.argv[1] = new URL(import.meta.url).pathname;
    try {
      expect(isMainModule({ url: import.meta.url })).toBe(true);
      expect(isMainModule({ url: pathToFileURL("/somewhere/else.mjs").href })).toBe(false);
      expect(isMainModule({ url: "not a url" })).toBe(false);
    } finally {
      process.argv[1] = argv as string;
    }
    const saved = process.argv;
    process.argv = [saved[0] as string];
    try {
      expect(isMainModule({ url: import.meta.url })).toBe(false);
    } finally {
      process.argv = saved;
    }
  });
});

describe("pilot feedback (0.1.x)", () => {
  it("isMainModule accepts a URL string", () => {
    const argv1 = process.argv[1];
    process.argv[1] = "/srv/app/dist/cli.mjs";
    try {
      expect(isMainModule("file:///srv/app/dist/cli.mjs")).toBe(true);
      expect(isMainModule("file:///srv/app/dist/x.mjs")).toBe(false);
    } finally {
      process.argv[1] = argv1!;
    }
  });

  it("storageRegistryFrom uses the product's own entry modules (capability layers survive)", async () => {
    const { storageRegistryFrom, storageFromEnv } = await import("../src/cli/index.ts");
    const made: Array<Record<string, unknown>> = [];
    const drivers = storageRegistryFrom({
      postgres: async () => ({
        createPostgresStorage: (o: Record<string, unknown>) => {
          made.push(o);
          return { product: "wrapped", ...o };
        },
      }),
    });
    expect(Object.keys(drivers)).toEqual(["postgres"]);
    const storage = await storageFromEnv({
      role: { name: "STORAGE", defaults: { pgTable: "xtandard_webhooks" } },
      drivers,
      env: { STORAGE_DRIVER: "postgres", POSTGRES_URL: "postgres://h/db" },
    });
    expect(storage).toMatchObject({ product: "wrapped", table: "xtandard_webhooks" });
    expect(made[0]).toEqual({ connectionString: "postgres://h/db", table: "xtandard_webhooks" });
    await expect(
      storageFromEnv({ role: { name: "STORAGE" }, drivers, env: { STORAGE_DRIVER: "redis" } }),
    ).rejects.toThrow(/redis/);
  });
});
