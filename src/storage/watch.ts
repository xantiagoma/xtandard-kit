/**
 * Composable change notifications. `watch` is orthogonal to which storage you use, so instead of
 * baking it into each driver, {@link withWatch} wraps *any* {@link KvStorage} with a
 * {@link WatchSubscribe} source you provide: Postgres `LISTEN`/`NOTIFY` ({@link pgListenNotify}),
 * Redis pub/sub, an ORM after-write hook, a websocket, an `EventEmitter`…
 *
 * @example
 * ```ts
 * import { pgListenNotify, withWatch } from "@xtandard/kit/storage";
 * import { createDrizzleStorage } from "@xtandard/kit/storage/drizzle";
 *
 * const storage = withWatch(createDrizzleStorage({ db, table }), pgListenNotify(listener, "my_channel"));
 * ```
 *
 * @module
 */

import type { KvStorage, StorageChangeEvent, WatchableKvStorage } from "./contract.ts";

/**
 * A change source. Called with a `notify` callback: wire your source to invoke it (optionally with
 * the changed key) on every change, and return an unsubscribe function (sync or async).
 */
export type WatchSubscribe = (
  notify: (key?: string) => void,
) => (() => void | Promise<void>) | Promise<() => void | Promise<void>>;

/**
 * Wrap a storage so it implements {@link WatchableKvStorage} using `subscribe` as the change
 * source. The wrapper delegates every other member to `storage` and only adds `watch`; keys outside
 * the watched `prefix` are filtered out. A notification without a key is delivered as an `update`
 * of the prefix itself (enough to trigger a refresh).
 *
 * The wrapper inherits from `storage` **and** carries every member of `storage` (own, inherited and
 * class methods, bound to `storage`) as an own enumerable property, so `{ ...withWatch(s, sub) }`
 * keeps the methods (the copies' `Object.create`-only wrapper lost them on spread).
 */
export function withWatch<S extends KvStorage>(
  storage: S,
  subscribe: WatchSubscribe,
): S & WatchableKvStorage {
  const watchable = Object.create(storage) as S & WatchableKvStorage;
  for (const name of memberNames(storage)) {
    if (name === "watch") continue;
    const value = (storage as Record<string, unknown>)[name];
    Object.defineProperty(watchable, name, {
      enumerable: true,
      configurable: true,
      ...(typeof value === "function"
        ? { value: (value as (...args: unknown[]) => unknown).bind(storage), writable: true }
        : {
            get: () => (storage as Record<string, unknown>)[name],
            set: (next: unknown) => {
              (storage as Record<string, unknown>)[name] = next;
            },
          }),
    });
  }
  Object.defineProperty(watchable, "watch", {
    enumerable: true,
    configurable: true,
    writable: true,
    value: (prefix: string, callback: (event: StorageChangeEvent) => void) => {
      const notify = (key?: string): void => {
        if (key !== undefined && key !== "" && !key.startsWith(prefix)) return;
        callback({ type: "update", key: key || prefix });
      };
      return Promise.resolve(subscribe(notify));
    },
  });
  return watchable;
}

/** Every string-keyed member reachable from `obj`, up to (not including) `Object.prototype`. */
function memberNames(obj: object): Set<string> {
  const names = new Set<string>();
  for (let o: object | null = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const name of Object.getOwnPropertyNames(o)) if (name !== "constructor") names.add(name);
  }
  return names;
}

/**
 * A dedicated notification client for {@link pgListenNotify}, satisfied by a `pg` `Client`. A
 * `Pool` won't do (it rotates connections); use a `Client` you `connect()`.
 */
export interface PgNotificationClient {
  /** Run a statement (`LISTEN`/`UNLISTEN`). */
  query(sql: string): Promise<unknown>;
  /** Register the notification listener. */
  on(event: "notification", listener: (msg: { channel: string; payload?: string }) => void): void;
  /** Remove the notification listener. */
  removeListener(
    event: "notification",
    listener: (msg: { channel: string; payload?: string }) => void,
  ): void;
}

/**
 * A {@link WatchSubscribe} backed by Postgres `LISTEN`/`NOTIFY`. Pair it with {@link withWatch} for
 * the postgres or drizzle-over-pg drivers. Your migration owns the trigger that `pg_notify`s
 * `channel` with the changed key as payload; this only `LISTEN`s.
 *
 * The channel is a parameter: products pass the channel they document (`"xtandard_webhooks"`, …).
 * The neutral default is `"xtandard_kv"`.
 *
 * @example
 * ```ts
 * import { Client } from "pg";
 * const listener = new Client({ connectionString: process.env.DATABASE_URL });
 * await listener.connect();
 * const storage = withWatch(base, pgListenNotify(listener, "xtandard_webhooks"));
 * ```
 */
export function pgListenNotify(
  client: PgNotificationClient,
  channel = "xtandard_kv",
): WatchSubscribe {
  const quoted = `"${channel.replace(/"/g, '""')}"`;
  return async (notify) => {
    const listener = (msg: { channel: string; payload?: string }): void => {
      if (msg.channel === channel) notify(msg.payload);
    };
    client.on("notification", listener);
    await client.query(`LISTEN ${quoted}`);
    return async () => {
      client.removeListener("notification", listener);
      await client.query(`UNLISTEN ${quoted}`);
    };
  };
}
