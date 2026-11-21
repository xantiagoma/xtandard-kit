/**
 * Cloudflare Workers KV driver over a `KVNamespace` **binding** (`env.MY_KV`). It works in
 * production Workers, under `wrangler dev` / Miniflare, and in tests against any object with the
 * small {@link KVNamespaceLike} surface. No npm peer: the binding comes from the runtime.
 *
 * KV is eventually consistent (writes take up to ~60 s to reach every location) and has no atomic
 * primitive, so there is no `compareAndSwap`. An optional `prefix` namespaces every key (joined
 * with `:`) and is stripped from `getKeys` results. KV prefixes are byte-exact, so no post-filter
 * is needed.
 *
 * @module
 */

import type { KvStorage } from "./contract.ts";

/** The subset of the Workers `KVNamespace` binding this driver uses. */
export interface KVNamespaceLike {
  /** Read a value as text. */
  get(key: string, type?: "text"): Promise<string | null>;
  /** Write a value. */
  put(key: string, value: string): Promise<void>;
  /** Delete a key. */
  delete(key: string): Promise<void>;
  /** List one page of keys. */
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }>;
}

/** Options for {@link createCloudflareKvStorage}. */
export interface CloudflareKvStorageOptions {
  /** The KV namespace binding (e.g. `env.MY_KV`). */
  namespace: KVNamespaceLike;
  /** Optional key namespace prepended to every key, joined with `:`. */
  prefix?: string;
}

/** A {@link KvStorage} backed by a Cloudflare KV namespace binding. */
export type CloudflareKvStorage = KvStorage;

/**
 * Create a Cloudflare KV-backed {@link KvStorage} from a `KVNamespace` binding.
 *
 * @example
 * ```ts
 * import { createCloudflareKvStorage } from "@xtandard/kit/storage/cloudflare-kv";
 *
 * export default {
 *   async fetch(req: Request, env: { DATA: KVNamespace }) {
 *     const storage = createCloudflareKvStorage({ namespace: env.DATA, prefix: "prod" });
 *     // …
 *   },
 * };
 * ```
 */
export function createCloudflareKvStorage(
  options: CloudflareKvStorageOptions,
): CloudflareKvStorage {
  const { namespace } = options;
  const fullPrefix = options.prefix ? `${options.prefix}:` : "";
  const toKey = (key: string): string => `${fullPrefix}${key}`;

  return {
    async getItem<T>(key: string): Promise<T | null> {
      const raw = await namespace.get(toKey(key), "text");
      return raw === null ? null : (JSON.parse(raw) as T);
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      await namespace.put(toKey(key), JSON.stringify(value));
    },

    async removeItem(key: string): Promise<void> {
      await namespace.delete(toKey(key));
    },

    async getKeys(prefix: string): Promise<string[]> {
      const out: string[] = [];
      let cursor: string | undefined;
      // KV list is paginated: page through until complete.
      do {
        const page = await namespace.list({ prefix: toKey(prefix), ...(cursor ? { cursor } : {}) });
        for (const k of page.keys) out.push(k.name.slice(fullPrefix.length));
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return out;
    },
  };
}
