/**
 * The key/value storage contract shared by every xtandard product. The base {@link KvStorage} is
 * intentionally tiny (four async methods) so users can bring their own backend. Optional
 * capabilities (`watch`, `compareAndSwap`) are separate interfaces that drivers may implement and
 * callers feature-detect with {@link isWatchable} / {@link isCompareAndSwap}.
 *
 * Products alias these under their own names (`type WebhooksStorage = KvStorage`, …).
 *
 * @module
 */

/** The minimal key/value contract every storage backend must satisfy. */
export interface KvStorage {
  /** Read a value, or `null` if absent. */
  getItem<T>(key: string): Promise<T | null>;
  /** Write a value (overwriting any existing). */
  setItem<T>(key: string, value: T): Promise<void>;
  /** Delete a key (no-op if absent). */
  removeItem(key: string): Promise<void>;
  /** List all keys beginning with `prefix` (a plain, case-sensitive string prefix). */
  getKeys(prefix: string): Promise<string[]>;
}

/** A storage change event delivered to {@link WatchableKvStorage.watch} callbacks. */
export interface StorageChangeEvent {
  /** `update` for a write, `remove` for a delete. */
  type: "update" | "remove";
  /** The changed key. */
  key: string;
}

/** Storage that can push change notifications (e.g. Redis keyspace events, `fs.watch`). */
export interface WatchableKvStorage extends KvStorage {
  /** Subscribe to changes under `prefix`. Resolves to an unsubscribe function. */
  watch(prefix: string, callback: (event: StorageChangeEvent) => void): Promise<() => void>;
}

/**
 * Storage that supports atomic multi-key transactions.
 *
 * @deprecated Declared for API compatibility only: no driver implements it and nothing calls it.
 * Use {@link CompareAndSwapKvStorage} for optimistic concurrency.
 */
export interface TransactionalKvStorage extends KvStorage {
  /** Run `callback` atomically against a transactional view of the storage. */
  transaction<T>(callback: (tx: KvStorage) => Promise<T>): Promise<T>;
}

/** Input of {@link CompareAndSwapKvStorage.compareAndSwap}. */
export interface CompareAndSwapInput<T> {
  /** The key to swap. */
  key: string;
  /** The value the key must hold (structurally), or `null` to require that it is absent. */
  expected: T | null;
  /** The value to write when the expectation holds. */
  next: T;
}

/** Storage that supports optimistic concurrency via compare-and-swap. */
export interface CompareAndSwapKvStorage extends KvStorage {
  /**
   * Atomically write `next` when the key currently holds a value structurally equal to `expected`
   * (object key order ignored), or is absent when `expected` is `null`. Resolves `true` when the
   * write happened. Of several concurrent swaps from the same `expected`, exactly one wins.
   */
  compareAndSwap<T>(input: CompareAndSwapInput<T>): Promise<boolean>;
}

/** Runtime feature-detection: does this storage implement `watch`? */
export function isWatchable(storage: KvStorage): storage is WatchableKvStorage {
  return typeof (storage as Partial<WatchableKvStorage>).watch === "function";
}

/**
 * Runtime feature-detection: does this storage implement `transaction`?
 *
 * @deprecated No driver implements {@link TransactionalKvStorage}; kept for API compatibility.
 */
export function isTransactional(storage: KvStorage): storage is TransactionalKvStorage {
  return typeof (storage as Partial<TransactionalKvStorage>).transaction === "function";
}

/** Runtime feature-detection: does this storage implement `compareAndSwap`? */
export function isCompareAndSwap(storage: KvStorage): storage is CompareAndSwapKvStorage {
  return typeof (storage as Partial<CompareAndSwapKvStorage>).compareAndSwap === "function";
}
