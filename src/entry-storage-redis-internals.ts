/**
 * `@xtandard/kit/storage/redis/internals` — **semi-public** building blocks of the Redis drivers
 * (ADR 0004): the lazy connection, de-duplicating `scanKeys`, the value codecs and
 * `createRedisKvStorage` (the driver with an explicit codec and a shared connection), so a product
 * capability layer such as wh's `claimDue` runs on the same client. Covered by the versioning policy
 * like any export; changes are a MINOR bump.
 *
 * @module
 */

export {
  createRedisKvStorage,
  jsonCodec,
  redisConnection,
  scanKeys,
  stringCodec,
  type RedisConnection,
  type RedisKvStorageOptions,
  type RedisLike,
  type RedisValueCodec,
} from "./storage/redis.ts";
