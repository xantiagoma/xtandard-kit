/**
 * `@xtandard/kit/storage/cloudflare-kv` — Cloudflare Workers KV storage over a `KVNamespace`
 * binding (no npm dependency; eventually consistent, no compare-and-swap).
 *
 * @module
 */

export {
  createCloudflareKvStorage,
  type CloudflareKvStorage,
  type CloudflareKvStorageOptions,
  type KVNamespaceLike,
} from "./storage/cloudflare-kv.ts";
