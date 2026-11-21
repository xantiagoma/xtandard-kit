/**
 * In-memory storage driver. Zero deps; for tests, dev and single-process apps. Values are
 * deep-cloned on write and read so callers cannot mutate stored state by reference.
 *
 * @module
 */

import { deepEqual } from "../internal/json.ts";
import type {
  CompareAndSwapInput,
  CompareAndSwapKvStorage,
  StorageChangeEvent,
  WatchableKvStorage,
} from "./contract.ts";

/**
 * A write hook (ADR 0004): called after every successful write with the key and the new value, or
 * `null` after a remove (whether or not the key existed). Products mirror keys into their own
 * indexes with it (wh mirrors due keys for `claimDue`). An error thrown by the hook rejects the
 * write call; the write itself has already happened.
 */
export type MemoryWriteHook = (key: string, value: unknown) => void | Promise<void>;

/** Options for {@link createMemoryStorage}. */
export interface MemoryStorageOptions {
  /** Optional seed data (key → value). Seeding does not call `onWrite`. */
  initial?: Record<string, unknown>;
  /** Called after every write and remove; see {@link MemoryWriteHook}. */
  onWrite?: MemoryWriteHook;
}

/** The memory storage: watchable and compare-and-swap capable. */
export type MemoryKvStorage = WatchableKvStorage & CompareAndSwapKvStorage;

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

/**
 * Create an in-memory {@link MemoryKvStorage}. `watch` callbacks fire on the next microtask after a
 * write or remove; `compareAndSwap` compares structurally (own properties, key order ignored) and
 * is race-free in-process.
 *
 * @example
 * ```ts
 * import { createMemoryStorage } from "@xtandard/kit/storage/memory";
 *
 * const storage = createMemoryStorage({ initial: { "app/config": { theme: "dark" } } });
 * ```
 */
export function createMemoryStorage(options: MemoryStorageOptions = {}): MemoryKvStorage {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(options.initial ?? {})) map.set(key, clone(value));
  const { onWrite } = options;

  const watchers = new Set<{ prefix: string; cb: (event: StorageChangeEvent) => void }>();
  const notify = (event: StorageChangeEvent): void => {
    for (const w of watchers) if (event.key.startsWith(w.prefix)) queueMicrotask(() => w.cb(event));
  };

  async function write(key: string, value: unknown): Promise<void> {
    map.set(key, clone(value));
    notify({ type: "update", key });
    await onWrite?.(key, clone(value));
  }

  return {
    async getItem<T>(key: string): Promise<T | null> {
      return map.has(key) ? clone(map.get(key) as T) : null;
    },
    async setItem<T>(key: string, value: T): Promise<void> {
      await write(key, value);
    },
    async removeItem(key: string): Promise<void> {
      if (map.delete(key)) notify({ type: "remove", key });
      await onWrite?.(key, null);
    },
    async getKeys(prefix: string): Promise<string[]> {
      const out: string[] = [];
      for (const key of map.keys()) if (key.startsWith(prefix)) out.push(key);
      return out;
    },
    async watch(prefix, cb): Promise<() => void> {
      const entry = { prefix, cb };
      watchers.add(entry);
      return () => {
        watchers.delete(entry);
      };
    },
    async compareAndSwap<T>(input: CompareAndSwapInput<T>): Promise<boolean> {
      const current = map.has(input.key) ? map.get(input.key) : null;
      if (!deepEqual(current, input.expected)) return false;
      await write(input.key, input.next);
      return true;
    },
  };
}
