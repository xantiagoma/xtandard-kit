/**
 * `@xtandard/kit/storage/redis` — Redis storage: `createRedisStorage()` (JSON strings) and
 * `createRedisJSONStorage()` (RedisJSON documents) over node-redis, with an atomic Lua
 * compare-and-swap, keyspace-notification watch and an `onWrite` hook.
 *
 * Optional peer: `redis` (loaded on first use).
 *
 * @module
 */

export {
  createRedisJSONStorage,
  createRedisStorage,
  type RedisKvStorage,
  type RedisLike,
  type RedisStorageOptions,
  type RedisWriteContext,
  type RedisWriteHook,
} from "./storage/redis.ts";
