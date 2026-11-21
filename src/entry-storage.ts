/**
 * `@xtandard/kit/storage` — the neutral key/value storage contract (`KvStorage` and its optional
 * `watch` / `compareAndSwap` capabilities) with its feature-detection guards, `withWatch` +
 * `pgListenNotify` for composable change notifications, the escaping and canonical-JSON helpers the
 * drivers share, and generic key-segment helpers. Drivers live on their own subpaths
 * (`@xtandard/kit/storage/redis`, …) so importing this never loads a peer.
 *
 * @module
 */

export {
  isCompareAndSwap,
  isTransactional,
  isWatchable,
  type CompareAndSwapInput,
  type CompareAndSwapKvStorage,
  type KvStorage,
  type StorageChangeEvent,
  type TransactionalKvStorage,
  type WatchableKvStorage,
} from "./storage/contract.ts";
export {
  pgListenNotify,
  withWatch,
  type PgNotificationClient,
  type WatchSubscribe,
} from "./storage/watch.ts";
export {
  SAFE_IDENTIFIER,
  assertIdentifier,
  escapeGlob,
  escapeLike,
  escapeRedisGlob,
  escapeRegex,
} from "./storage/util.ts";
export {
  decodeSegment,
  encodeSegment,
  lastSegment,
  padMillis,
  parseSortableLeaf,
  sortableLeaf,
} from "./storage/keys.ts";
export {
  canonical,
  canonicalJson,
  deepEqual,
  parseJsonValue,
  type JsonObject,
  type JsonValue,
} from "./internal/json.ts";
export { importPeer, requirePeer } from "./internal/peer.ts";
