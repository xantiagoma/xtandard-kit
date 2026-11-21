/**
 * unstorage driver: wraps an [unstorage](https://unstorage.unjs.io) `Storage` (any driver) as a
 * {@link KvStorage}. The caller builds and configures the unstorage instance; this module only
 * imports its type, so `unstorage` stays an optional peer.
 *
 * unstorage normalizes keys: `/` and `\` become `:`, anything after `?` is dropped, repeated and
 * leading/trailing separators collapse, and keys ending in `$` are meta keys hidden from
 * `getKeys`. So this driver encodes:
 *
 * - `%`, `:`, `\` and `?` as `%25`, `%3A`, `%5C`, `%3F` (every copy did this);
 * - a **trailing** `$` as `%24` (only that one; a `$` elsewhere is stored as-is, ADR 0005);
 * - an empty segment (`a//b`, `a/`) as a lone `%` (which a literal `%` never produces).
 *
 * Reads fall back to the legacy spellings of a key containing `$` (the raw trailing `$` of the
 * older copies, and the every-`$`-encoded form), and `getKeys` lists both, so data written by
 * earlier product releases stays readable. Because unstorage matches whole segments only,
 * `getKeys(prefix)` lists the prefix's parent segment and filters by the full prefix.
 *
 * No `compareAndSwap`: unstorage drivers share no atomic primitive.
 *
 * @module
 */

import type { Storage } from "unstorage";
import type { KvStorage } from "./contract.ts";

/** Options for {@link createUnstorageStorage}. */
export interface UnstorageStorageOptions {
  /** A pre-constructed unstorage `Storage` instance (any driver). */
  storage: Storage;
}

/** The unstorage storage (no optional capabilities). */
export type UnstorageKvStorage = KvStorage;

const hex = (c: string): string =>
  `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;

/** How a spelling writes `$`: only a trailing one (current), never (wh/fl/au/li) or always (en). */
type DollarMode = "trailing" | "none" | "all";

/** Encode `key` (empty segments as `%`) with the given `$` spelling. */
function encodeKey(key: string, dollars: DollarMode): string {
  const encoded = key
    .split("/")
    .map((s) => (s === "" ? "%" : s.replace(dollars === "all" ? /[%:\\?$]/g : /[%:\\?]/g, hex)))
    .join("/");
  return dollars === "trailing" ? encoded.replace(/\$$/, "%24") : encoded;
}

/** The key as written today: trailing `$` encoded, empty segments as `%`. */
export const toUnstorageKey = (key: string): string => encodeKey(key, "trailing");

/**
 * Legacy spellings of `key` that differ from {@link toUnstorageKey}: the raw trailing `$` (wh, fl,
 * au, li) and the every-`$`-encoded form (en). Keys with empty segments have none: those were
 * collapsed onto another key.
 */
function legacyKeys(key: string): string[] {
  if (!key.includes("$") || key.split("/").includes("")) return [];
  const current = toUnstorageKey(key);
  return [...new Set([encodeKey(key, "none"), encodeKey(key, "all")])].filter((k) => k !== current);
}

/** Convert an unstorage `:`-separated key back to the caller's `/`-separated form. */
export const fromUnstorageKey = (key: string): string =>
  key
    .split(":")
    .map((s) =>
      s === "%"
        ? ""
        : s.replace(/%(25|3A|5C|3F|24)/g, (_, h: string) =>
            String.fromCharCode(Number.parseInt(h, 16)),
          ),
    )
    .join("/");

/**
 * Create a {@link KvStorage} backed by an unstorage `Storage` instance. unstorage serializes JSON
 * values, so values round-trip structurally; missing keys read back as `null`.
 *
 * @example
 * ```ts
 * import { createUnstorageStorage } from "@xtandard/kit/storage/unstorage";
 * import { createStorage } from "unstorage";
 * import fsDriver from "unstorage/drivers/fs";
 *
 * const storage = createUnstorageStorage({
 *   storage: createStorage({ driver: fsDriver({ base: "./data" }) }),
 * });
 * ```
 */
export function createUnstorageStorage(options: UnstorageStorageOptions): UnstorageKvStorage {
  const { storage } = options;

  const read = async <T>(key: string): Promise<T | null> => {
    const value = await storage.getItem<T>(key);
    return value === undefined ? null : value;
  };
  const removeLegacy = async (key: string): Promise<void> => {
    for (const legacy of legacyKeys(key)) await storage.removeItem(legacy);
  };

  return {
    async getItem<T>(key: string): Promise<T | null> {
      const value = await read<T>(toUnstorageKey(key));
      if (value !== null) return value;
      for (const legacy of legacyKeys(key)) {
        const old = await read<T>(legacy);
        if (old !== null) return old;
      }
      return null;
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      // unstorage's setItem rejects `undefined`; the contract never stores it.
      await storage.setItem(toUnstorageKey(key), value as NonNullable<T>);
      await removeLegacy(key);
    },

    async removeItem(key: string): Promise<void> {
      await storage.removeItem(toUnstorageKey(key));
      await removeLegacy(key);
    },

    async getKeys(prefix: string): Promise<string[]> {
      // unstorage's getKeys takes a whole-segment base and returns `:`-separated keys; list the
      // parent segment, convert back and filter by the plain prefix. A Set: a legacy spelling and
      // the current one decode to the same key.
      // A `$` in a parent segment is stored raw today and was `%24` in en's layout: list both.
      const parent = prefix.slice(0, prefix.lastIndexOf("/") + 1);
      const bases =
        parent === ""
          ? [""]
          : [...new Set([encodeKey(parent, "none"), encodeKey(parent, "all")])].map(
              (b) => `${b.slice(0, -2)}/`,
            );
      const out = new Set<string>();
      for (const base of bases)
        for (const key of await storage.getKeys(base)) out.add(fromUnstorageKey(key));
      return [...out].filter((key) => key.startsWith(prefix));
    },
  };
}
