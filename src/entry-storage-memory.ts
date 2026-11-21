/**
 * `@xtandard/kit/storage/memory` — in-memory storage (zero deps; tests, dev, single-process apps),
 * watchable and compare-and-swap capable, with an `onWrite` hook for product indexes.
 *
 * @module
 */

export {
  createMemoryStorage,
  type MemoryKvStorage,
  type MemoryStorageOptions,
  type MemoryWriteHook,
} from "./storage/memory.ts";
