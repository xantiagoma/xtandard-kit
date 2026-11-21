/**
 * Redis storage drivers over [`redis`](https://github.com/redis/node-redis) (node-redis v4/v5, an
 * optional peer). Pass a (optionally pre-connected) `client`, or a `url` to connect lazily on first
 * use. An optional `prefix` is prepended (joined with `:`) to every key and stripped from `getKeys`.
 *
 * Two variants over the same plumbing, differing only in the value codec:
 *
 * - {@link createRedisStorage}: values are JSON **strings** (`SET`/`GET`), on any Redis.
 * - {@link createRedisJSONStorage}: values are **RedisJSON** documents (`JSON.SET`/`JSON.GET`),
 *   queryable with JSONPath. Needs the JSON module (Redis 8, Redis Stack). Never point both variants
 *   at the same keys (`WRONGTYPE`).
 *
 * - `getKeys` uses a non-blocking `SCAN` (never `KEYS`) with the prefix glob-escaped, de-duplicated
 *   (SCAN may return a key more than once) and re-checked with `startsWith`.
 * - `watch` uses keyspace notifications (`notify-keyspace-events` must include `KEA` or similar) on a
 *   glob-escaped `PSUBSCRIBE` pattern, so a prefix with `[`, `*`, `?` or `\` never misses events.
 * - `compareAndSwap` is a Lua script that compares the stored text with the canonical JSON of
 *   `expected` **as strings** and writes `next` on a match, atomically. A value written before
 *   canonicalisation (or serialized differently by RedisJSON) misses that fast path; the swap then
 *   reads the raw text, compares it structurally in JS (`{}` ≠ `[]`, unlike a `cjson` decode) and
 *   swaps on the exact raw text, with bounded retries (ADR 0005).
 * - `onWrite(key, value | null, ctx)` runs after every successful write, swap and remove, with the
 *   connected client: wh mirrors due keys into a sorted set with it (ADR 0004).
 *
 * @module
 */

import type { RedisClientType } from "redis";
import { canonical, canonicalJson } from "../internal/json.ts";
import { importPeer } from "../internal/peer.ts";
import { swapWithFallback } from "./cas.ts";
import type {
  CompareAndSwapInput,
  CompareAndSwapKvStorage,
  StorageChangeEvent,
  WatchableKvStorage,
} from "./contract.ts";
import { escapeRedisGlob } from "./util.ts";

const SUBPATH = "@xtandard/kit/storage/redis";

/** What an {@link RedisStorageOptions.onWrite} hook receives besides the key and value. */
export interface RedisWriteContext {
  /** The connected client (run your own commands, e.g. `zAdd`, on it). */
  client: RedisLike;
  /** The full Redis key (with the `prefix:` namespace). */
  redisKey: string;
  /** Map another caller key to its full Redis key. */
  toRedisKey(key: string): string;
}

/**
 * A write hook (ADR 0004): called after every successful `setItem`, successful `compareAndSwap`
 * (with the new value) and `removeItem` (with `null`, whether or not the key existed). An error
 * thrown by the hook rejects the call; the write itself has already happened.
 */
export type RedisWriteHook = (
  key: string,
  value: unknown,
  ctx: RedisWriteContext,
) => void | Promise<void>;

/** Options for {@link createRedisStorage} and {@link createRedisJSONStorage}. */
export interface RedisStorageOptions {
  /** Connection URL (e.g. `redis://localhost:6379`). Used when no `client` is given. */
  url?: string;
  /** A pre-constructed (optionally pre-connected) node-redis client. Never closed by the driver. */
  client?: RedisClientType;
  /** Optional key namespace prepended to every key, joined with `:`. */
  prefix?: string;
  /**
   * Called on client `error` events (connection drops, reconnects). A handler is always attached so
   * a downed Redis never crashes the process with an unhandled `error` event.
   */
  onError?: (error: unknown) => void;
  /** Called after every write, swap and remove; see {@link RedisWriteHook}. */
  onWrite?: RedisWriteHook;
}

/** A watchable, compare-and-swap capable storage backed by Redis, plus `close()`. */
export interface RedisKvStorage extends WatchableKvStorage, CompareAndSwapKvStorage {
  /** Disconnect the client if this driver created it; no-op for a borrowed one. */
  close(): Promise<void>;
}

/** Minimal structural view of the node-redis client surface the drivers use. */
export interface RedisLike {
  /** Whether the socket is open. */
  isOpen?: boolean;
  /** Register an event listener. */
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  /** Connect. */
  connect(): Promise<unknown>;
  /** Close gracefully. */
  quit(): Promise<unknown>;
  /** `GET`. */
  get(key: string): Promise<string | null>;
  /** `SET`. */
  set(key: string, value: string): Promise<unknown>;
  /** `DEL`. */
  del(key: string | string[]): Promise<unknown>;
  /** `ZADD` (sorted sets; products keep their own indexes with it, e.g. a due-time index). */
  zAdd(
    key: string,
    members: { score: number; value: string } | { score: number; value: string }[],
  ): Promise<unknown>;
  /** `ZREM`. */
  zRem(key: string, members: string | string[]): Promise<unknown>;
  /** `ZRANGEBYSCORE` (members only). */
  zRangeByScore(
    key: string,
    min: number | string,
    max: number | string,
    options?: { LIMIT?: { offset: number; count: number } },
  ): Promise<string[]>;
  /** `EVAL`. */
  eval(script: string, options?: { keys?: string[]; arguments?: string[] }): Promise<unknown>;
  /** RedisJSON commands (bundled in node-redis; the server needs the module). */
  json?: {
    get(key: string): Promise<unknown>;
    set(key: string, path: string, value: unknown): Promise<unknown>;
  };
  /** `SCAN` iterator (v4 yields keys, v5 yields batches). */
  scanIterator(options?: { MATCH?: string; COUNT?: number }): AsyncIterable<string | string[]>;
  /** A new client with the same options (for subscriptions). */
  duplicate(): RedisLike;
  /** `PSUBSCRIBE`. */
  pSubscribe(
    pattern: string,
    listener: (message: string, channel: string) => void,
  ): Promise<unknown>;
  /** Close immediately. */
  disconnect(): Promise<unknown>;
}

/** How a variant stores values (semi-public, ADR 0004). */
export interface RedisValueCodec {
  /** Passed to the CAS script so it reads/writes with the matching commands. */
  kind: "string" | "json";
  /** Read and decode a value (`null` when absent). */
  get(c: RedisLike, key: string): Promise<unknown>;
  /** Encode and write a value. */
  set(c: RedisLike, key: string, value: unknown): Promise<void>;
}

/** Plain strings containing canonical JSON; works on any Redis. */
export const stringCodec: RedisValueCodec = {
  kind: "string",
  async get(c, key) {
    const raw = await c.get(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  },
  async set(c, key, value) {
    await c.set(key, canonicalJson(value));
  },
};

/** Native RedisJSON documents (written with sorted keys); needs the JSON module on the server. */
export const jsonCodec: RedisValueCodec = {
  kind: "json",
  async get(c, key) {
    return (await requireJson(c).get(key)) ?? null;
  },
  async set(c, key, value) {
    await requireJson(c).set(key, "$", canonical(value));
  },
};

function requireJson(c: RedisLike): NonNullable<RedisLike["json"]> {
  if (!c.json) {
    throw new Error(
      "createRedisJSONStorage: the client exposes no `json` commands; use node-redis (the `redis` " +
        "package) v4+, and a server with the RedisJSON module (Redis 8 / Redis Stack).",
    );
  }
  return c.json;
}

/** Read the raw stored text of `KEYS[1]` (`ARGV[1]` = codec). */
const READ_SCRIPT = `
if ARGV[1] == 'json' then return redis.call('JSON.GET', KEYS[1]) end
return redis.call('GET', KEYS[1])`;

/**
 * Atomic swap. `ARGV[1]` = `"0"` to require absence, `"1"` to require that the stored text equals
 * `ARGV[2]` exactly; `ARGV[3]` = next JSON; `ARGV[4]` = codec (`string` | `json`).
 */
const SWAP_SCRIPT = `
local json = ARGV[4] == 'json'
local raw
if json then raw = redis.call('JSON.GET', KEYS[1]) else raw = redis.call('GET', KEYS[1]) end
if ARGV[1] == '0' then
  if raw then return 0 end
elseif raw ~= ARGV[2] then
  return 0
end
if json then redis.call('JSON.SET', KEYS[1], '$', ARGV[3]) else redis.call('SET', KEYS[1], ARGV[3]) end
return 1`;

/** A lazily connected node-redis client (semi-public, ADR 0004). */
export interface RedisConnection {
  /** Resolve a connected client, creating/connecting it on first use (retried after a failure). */
  get(): Promise<RedisLike>;
  /** Attach the internal `error` listener (and `onError`) to a client. */
  attachErrorHandler(c: RedisLike): void;
  /** Quit the client if this connection created it. */
  close(): Promise<void>;
}

/** Build a {@link RedisConnection} from a borrowed `client` or a `url`. */
export function redisConnection(
  options: Pick<RedisStorageOptions, "url" | "client" | "onError">,
  subpath = SUBPATH,
): RedisConnection {
  const ownsClient = !options.client;
  let client: RedisLike | undefined = options.client as RedisLike | undefined;
  let connecting: Promise<RedisLike> | undefined;

  // node-redis emits `error` on connection drops; without a listener Node crashes the process.
  const attachErrorHandler = (c: RedisLike): void => {
    c.on?.("error", (err: unknown) => options.onError?.(err));
  };
  if (client) attachErrorHandler(client);

  return {
    attachErrorHandler,
    async get(): Promise<RedisLike> {
      if (client?.isOpen) return client;
      connecting ??= (async () => {
        if (!client) {
          type CreateClient = (opts: Record<string, unknown>) => RedisLike;
          const mod = await importPeer(
            "redis",
            subpath,
            () =>
              import("redis") as unknown as Promise<{
                createClient?: CreateClient;
                default?: { createClient: CreateClient };
              }>,
          );
          const createClient = (mod.createClient ?? mod.default?.createClient) as CreateClient;
          // Fail fast while the socket is down (no offline queue); reconnect with a capped backoff.
          client = createClient({
            url: options.url,
            disableOfflineQueue: true,
            socket: { reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000) },
          });
          attachErrorHandler(client);
        }
        if (!client.isOpen) await client.connect();
        return client;
      })();
      try {
        return await connecting;
      } finally {
        connecting = undefined;
      }
    },
    async close(): Promise<void> {
      if (ownsClient && client?.isOpen) await client.quit();
    },
  };
}

/**
 * Every key a `SCAN … MATCH` yields, de-duplicated (SCAN may return a key more than once; node-redis
 * v4 yields keys, v5 batches). Semi-public.
 */
export async function scanKeys(c: RedisLike, match: string): Promise<string[]> {
  const out = new Set<string>();
  for await (const entry of c.scanIterator({ MATCH: match, COUNT: 100 })) {
    if (Array.isArray(entry)) for (const key of entry) out.add(key);
    else out.add(entry);
  }
  return [...out];
}

/** Options for {@link createRedisKvStorage}: the driver options plus the codec and connection. */
export interface RedisKvStorageOptions extends RedisStorageOptions {
  /** The value codec ({@link stringCodec} or {@link jsonCodec}). */
  codec: RedisValueCodec;
  /**
   * A connection to reuse (so a product capability layer shares the driver's client). Default: one
   * built from `url`/`client`/`onError`.
   */
  connection?: RedisConnection;
}

/**
 * The Redis driver with an explicit codec and optional shared connection (semi-public, ADR 0004).
 * {@link createRedisStorage} and {@link createRedisJSONStorage} are this with a fixed codec.
 */
export function createRedisKvStorage(options: RedisKvStorageOptions): RedisKvStorage {
  const { codec, onWrite } = options;
  const fullPrefix = options.prefix ? `${options.prefix}:` : "";
  const connection = options.connection ?? redisConnection(options);
  const getClient = connection.get;

  const toRedisKey = (key: string): string => `${fullPrefix}${key}`;
  const fromRedisKey = (key: string): string =>
    fullPrefix && key.startsWith(fullPrefix) ? key.slice(fullPrefix.length) : key;
  const written = async (c: RedisLike, key: string, value: unknown): Promise<void> => {
    await onWrite?.(key, value, { client: c, redisKey: toRedisKey(key), toRedisKey });
  };

  return {
    async getItem<T>(key: string): Promise<T | null> {
      return ((await codec.get(await getClient(), toRedisKey(key))) as T | null) ?? null;
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      const c = await getClient();
      await codec.set(c, toRedisKey(key), value);
      await written(c, key, canonical(value));
    },

    async removeItem(key: string): Promise<void> {
      const c = await getClient();
      await c.del(toRedisKey(key));
      await written(c, key, null);
    },

    async getKeys(prefix: string): Promise<string[]> {
      const keys = await scanKeys(await getClient(), `${escapeRedisGlob(toRedisKey(prefix))}*`);
      return keys.map(fromRedisKey).filter((key) => key.startsWith(prefix));
    },

    async compareAndSwap<T>(input: CompareAndSwapInput<T>): Promise<boolean> {
      const c = await getClient();
      const redisKey = toRedisKey(input.key);
      const next = canonicalJson(input.next);
      const swap = async (mode: "0" | "1", current: string): Promise<boolean> =>
        Number(
          await c.eval(SWAP_SCRIPT, {
            keys: [redisKey],
            arguments: [mode, current, next, codec.kind],
          }),
        ) === 1;
      const ok =
        input.expected === null
          ? await swap("0", "")
          : await swapWithFallback<string>(input.expected, {
              fast: () => swap("1", canonicalJson(input.expected)),
              async read() {
                const raw = await c.eval(READ_SCRIPT, {
                  keys: [redisKey],
                  arguments: [codec.kind],
                });
                return typeof raw === "string" ? { raw, value: JSON.parse(raw) as unknown } : null;
              },
              swapRaw: (raw) => swap("1", raw),
            });
      if (ok) await written(c, input.key, canonical(input.next));
      return ok;
    },

    async watch(
      prefix: string,
      callback: (event: StorageChangeEvent) => void,
    ): Promise<() => void> {
      // Keyspace notifications publish to `__keyspace@<db>__:<key>`.
      const subscriber = (await getClient()).duplicate();
      connection.attachErrorHandler(subscriber);
      await subscriber.connect();
      const pattern = `__keyspace@*__:${escapeRedisGlob(toRedisKey(prefix))}*`;
      await subscriber.pSubscribe(pattern, (event: string, channel: string) => {
        const idx = channel.indexOf("__:");
        if (idx === -1) return;
        const key = fromRedisKey(channel.slice(idx + 3));
        if (!key.startsWith(prefix)) return;
        callback({ type: event === "del" || event === "expired" ? "remove" : "update", key });
      });
      return () => {
        void subscriber.disconnect();
      };
    },

    close: connection.close,
  };
}

/**
 * Create a Redis-backed {@link RedisKvStorage} storing JSON strings.
 *
 * @example
 * ```ts
 * import { createRedisStorage } from "@xtandard/kit/storage/redis";
 *
 * const storage = createRedisStorage({ url: process.env.REDIS_URL, prefix: "app" });
 * ```
 */
export function createRedisStorage(options: RedisStorageOptions): RedisKvStorage {
  return createRedisKvStorage({ ...options, codec: stringCodec });
}

/**
 * Create a Redis-backed {@link RedisKvStorage} storing native RedisJSON documents, queryable with
 * JSONPath (`JSON.GET app:key $.field`) and indexable with RediSearch. Same options and semantics
 * as {@link createRedisStorage}; never point it at keys written by `createRedisStorage`.
 */
export function createRedisJSONStorage(options: RedisStorageOptions): RedisKvStorage {
  return createRedisKvStorage({ ...options, codec: jsonCodec });
}
