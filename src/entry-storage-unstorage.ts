/**
 * `@xtandard/kit/storage/unstorage` — wrap any [unstorage](https://unstorage.unjs.io) `Storage`
 * (any driver) as a `KvStorage`, with lossless key encoding and read-through to legacy keys.
 *
 * Optional peer: `unstorage` (you construct the instance; this subpath only imports its type).
 *
 * @module
 */

export {
  createUnstorageStorage,
  type UnstorageKvStorage,
  type UnstorageStorageOptions,
} from "./storage/unstorage.ts";
