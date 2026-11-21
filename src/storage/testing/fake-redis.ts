/**
 * An in-memory node-redis look-alike for tests (semi-public): string and RedisJSON values, the kit
 * redis driver's Lua scripts emulated, sorted sets (`zAdd`/`zRem`/`zRangeByScore`), a SCAN that
 * yields keys more than once (as Redis may) and PSUBSCRIBE with real glob matching. Products run the
 * conformance suite on their wrapped redis driver with it, without a live server; a product's own
 * Lua scripts can be emulated through {@link FakeRedisOptions.eval}.
 *
 * @module
 */

import type { RedisLike, RedisStorageOptions } from "../redis.ts";

/** The fake's state, exposed for assertions. */
export type FakeRedis = RedisLike & {
  /** String and RedisJSON values by full key. */
  strings: Map<string, string>;
  /** Every PSUBSCRIBE pattern received. */
  patterns: string[];
  /** Sorted sets: member → score, by key. */
  zsets: Map<string, Map<string, number>>;
};

/** Options for {@link fakeRedis}. */
export interface FakeRedisOptions {
  /**
   * Emulate a product's own Lua scripts: return a value to answer `EVAL`, or `undefined` to fall back
   * to the kit driver's scripts.
   */
  eval?: (script: string, keys: string[], args: string[], fake: FakeRedis) => unknown;
}

/** Redis glob → RegExp (backslash escapes, `*`, `?`, `[…]`). */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "\\") re += `\\${glob[++i] ?? ""}`.replace(/\\([^\w])/, (_, x: string) => `\\${x}`);
    else if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 1);
      re += `[${glob.slice(i + 1, end).replace(/\\/g, "\\\\")}]`;
      i = end;
    } else re += c.replace(/[.+^${}()|\\/]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "s");
}

/**
 * An in-memory node-redis look-alike: string and RedisJSON values, the driver's two Lua scripts
 * emulated, a SCAN that yields every key twice (Redis may repeat keys), and PSUBSCRIBE with real
 * glob matching (so an unescaped prefix would miss events).
 */
export function fakeRedis(options: FakeRedisOptions = {}): FakeRedis {
  return makeFakeRedis(options);
}

function makeFakeRedis(options: FakeRedisOptions): RedisLike & {
  strings: Map<string, string>;
  patterns: string[];
  zsets: Map<string, Map<string, number>>;
} {
  const strings = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const subs = new Set<{ re: RegExp; listener: (m: string, ch: string) => void }>();
  const patterns: string[] = [];
  const emit = (key: string, event: string) => {
    for (const s of subs) {
      const ch = `__keyspace@0__:${key}`;
      if (s.re.test(ch)) queueMicrotask(() => s.listener(event, ch));
    }
  };
  const self: RedisLike & {
    strings: Map<string, string>;
    patterns: string[];
    zsets: Map<string, Map<string, number>>;
  } = {
    strings,
    patterns,
    zsets,
    async zAdd(key, members) {
      const set = zsets.get(key) ?? new Map<string, number>();
      for (const m of [members].flat()) set.set(m.value, m.score);
      zsets.set(key, set);
    },
    async zRem(key, members) {
      for (const m of [members].flat()) zsets.get(key)?.delete(m);
    },
    async zRangeByScore(key, min, max) {
      const bound = (v: number | string) =>
        v === "-inf" ? -Infinity : v === "+inf" ? Infinity : Number(v);
      const lo = bound(min);
      const hi = bound(max);
      return [...(zsets.get(key) ?? new Map<string, number>())]
        .filter(([, score]) => score >= lo && score <= hi)
        .sort((a, b) => a[1] - b[1])
        .map(([member]) => member);
    },
    isOpen: false,
    on: () => self,
    async connect() {
      self.isOpen = true;
    },
    async quit() {
      self.isOpen = false;
    },
    async disconnect() {
      self.isOpen = false;
    },
    async get(key) {
      return strings.get(key) ?? null;
    },
    async set(key, value) {
      strings.set(key, value);
      emit(key, "set");
    },
    async del(key) {
      for (const k of [key].flat()) if (strings.delete(k)) emit(k, "del");
    },
    json: {
      async get(key) {
        const raw = strings.get(key);
        return raw === undefined ? null : JSON.parse(raw);
      },
      async set(key, _path, value) {
        strings.set(key, JSON.stringify(value));
        emit(key, "json.set");
      },
    },
    async eval(script, opts = {}) {
      const [key] = opts.keys ?? [];
      const args = opts.arguments ?? [];
      const custom = options.eval?.(script, opts.keys ?? [], args, self);
      if (custom !== undefined) return custom;
      const raw = strings.get(key!) ?? null;
      if (!script.includes("ARGV[4]")) return raw;
      const [mode, expected, next] = args;
      if (mode === "0" ? raw !== null : raw !== expected) return 0;
      strings.set(key!, next!);
      emit(key!, "set");
      return 1;
    },
    async *scanIterator(opts = {}) {
      const re = globToRegExp(opts.MATCH ?? "*");
      const keys = [...strings.keys()].filter((k) => re.test(k));
      yield keys;
      yield keys.slice(0, 3); // SCAN may return a key more than once
    },
    duplicate() {
      const sub = fakeRedisSubscriber();
      return sub;
    },
    async pSubscribe() {},
  };
  function fakeRedisSubscriber(): RedisLike {
    return {
      ...self,
      isOpen: false,
      async connect() {},
      async pSubscribe(pattern, listener) {
        patterns.push(pattern);
        const entry = { re: globToRegExp(pattern), listener };
        subs.add(entry);
        this.disconnect = async () => {
          subs.delete(entry);
        };
      },
    };
  }
  return self;
}

/** Cast a fake to the `client` option type of the redis driver factories. */
export const asRedisClient = (c: RedisLike) =>
  c as unknown as NonNullable<RedisStorageOptions["client"]>;
