/**
 * File-system storage driver. Persists each key as a JSON file under a base directory, mirroring the
 * `/`-delimited key layout as nested directories with a `.json` leaf. Zero dependencies
 * (`node:fs/promises`, which works in Bun and Node).
 *
 * - Segments are encoded ({@link encodeSegment}) so every key maps to a distinct, safe file name on
 *   any filesystem: `Acme` / `acme` / `acmé` never collide on case- or normalization-insensitive
 *   volumes, a key can never escape the base directory, and an empty segment (`a//b`) is `%`.
 * - Writes go to a temporary sibling and are renamed into place, so a crash never leaves a
 *   half-written file.
 * - `compareAndSwap` is serialized per key **within this process** (an in-process lock around read →
 *   compare → write). It is not safe across processes sharing one directory; use a database driver
 *   for that.
 * - Stores written before segment encoding (the "legacy" layout of raw segment names) are handled by
 *   the `legacy` option: ignore them, warn once, or read through to them; {@link migrateFileStorage}
 *   moves them to the encoded layout once.
 *
 * @module
 */

import { existsSync, watch as fsWatch } from "node:fs";
import type { Dirent } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { deepEqual } from "../internal/json.ts";
import type {
  CompareAndSwapInput,
  CompareAndSwapKvStorage,
  StorageChangeEvent,
  WatchableKvStorage,
} from "./contract.ts";

/**
 * How {@link createFileStorage} treats leaves in the legacy (pre-encoding, raw segment) layout:
 *
 * - `"ignore"` (default): they are invisible;
 * - `"warn"`: invisible, and `onLegacy` is called once (by default a `console.warn` that points at
 *   {@link migrateFileStorage});
 * - `"read-through"`: `getItem` falls back to the legacy file when the encoded one is missing,
 *   `getKeys` lists legacy leaves too, and the next write or remove of that key deletes the legacy
 *   file.
 */
export type FileLegacyMode = "ignore" | "warn" | "read-through";

/** Options for {@link createFileStorage}. */
export interface FileStorageOptions {
  /** Base directory under which key files are written. Created on demand. */
  dir: string;
  /** How to treat leaves in the legacy raw-segment layout. Default `"ignore"`. */
  legacy?: FileLegacyMode;
  /**
   * Called once per storage instance when `legacy: "warn"` meets a legacy leaf. Products pass their
   * own message (it names the product and the release that wrote the legacy layout).
   */
  onLegacy?: (dir: string) => void;
}

/** The file storage: watchable and (in-process) compare-and-swap capable. */
export type FileKvStorage = WatchableKvStorage & CompareAndSwapKvStorage;

/** Suffix appended to the leaf file of every stored key. */
const JSON_SUFFIX = ".json";

/**
 * Encode one key segment as a file name that survives case-insensitive and
 * normalization-insensitive filesystems and never escapes its directory: uppercase letters become
 * `^` + the lowercase letter, `^` becomes `^^`, bytes outside `[a-z0-9._~!@,=+-]` become `%XX` (of
 * the UTF-8 encoding, so `é` never folds with `e`), a leading `.` is `%2E` (no `.`, `..` or
 * dotfiles) and the empty segment is a lone `%`.
 */
export function encodeSegment(segment: string): string {
  if (segment === "") return "%";
  let out = "";
  for (const byte of new TextEncoder().encode(segment)) {
    const ch = String.fromCharCode(byte);
    if (byte >= 0x41 && byte <= 0x5a) out += `^${ch.toLowerCase()}`;
    else if (ch === "^") out += "^^";
    else if (/[a-z0-9._~!@,=+-]/.test(ch) && !(ch === "." && out === "")) out += ch;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** Reverse {@link encodeSegment}. */
export function decodeSegment(name: string): string {
  if (name === "%") return "";
  const bytes: number[] = [];
  for (let i = 0; i < name.length; i++) {
    const ch = name[i] as string;
    if (ch === "^") {
      const next = name[++i] ?? "";
      bytes.push((next === "^" ? "^" : next.toUpperCase()).charCodeAt(0));
    } else if (ch === "%") {
      bytes.push(Number.parseInt(name.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(ch.charCodeAt(0));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Whether `name` is a file name {@link encodeSegment} produces (not a legacy raw segment). */
const isEncoded = (name: string): boolean => encodeSegment(decodeSegment(name)) === name;

/** The encoded path of `key` under `dir`. */
const keyToPath = (dir: string, key: string): string =>
  join(dir, ...key.split("/").map(encodeSegment)) + JSON_SUFFIX;

/**
 * The legacy (raw segment) path of `key`, when there is an unambiguous one. Keys have none when:
 * - a segment is empty: the legacy layout collapsed `a//b` onto `a/b`, so reading through would alias
 *   another key;
 * - every raw segment is itself a valid encoded name (`a%25`, `^a`): the raw path is then the
 *   encoded path of a *different* key (`a%25` is how `a%` is encoded), so reading or removing it
 *   would touch that key's file. {@link leafKey} reads such a leaf as encoded, by the same rule.
 */
function legacyPath(dir: string, key: string): string | undefined {
  const segments = key.split("/");
  if (segments.includes("")) return undefined;
  if (segments.every(isEncoded)) return undefined;
  const path = join(dir, ...segments) + JSON_SUFFIX;
  return path === keyToPath(dir, key) ? undefined : path;
}

/** The `dir`-relative segments of a `.json` leaf under `dir`, or `null`. */
function leafSegments(dir: string, filePath: string): string[] | null {
  const rel = relative(dir, filePath);
  if (rel === "" || rel.startsWith("..") || !rel.endsWith(JSON_SUFFIX)) return null;
  return rel.slice(0, -JSON_SUFFIX.length).split(sep);
}

/**
 * The key of a leaf: `{ key, legacy: false }` in the encoded layout, `{ key, legacy: true }` when
 * some segment is a raw legacy name (raw segments are taken verbatim; encoded ones, such as the
 * all-lowercase `app`, decode to themselves), or `null` for a non-leaf.
 */
function leafKey(dir: string, filePath: string): { key: string; legacy: boolean } | null {
  const segments = leafSegments(dir, filePath);
  if (!segments) return null;
  const legacy = !segments.every(isEncoded);
  return {
    key: segments.map((s) => (legacy && !isEncoded(s) ? s : decodeSegment(s))).join("/"),
    legacy,
  };
}

/**
 * Whether `path` (under `dir`) exists with exactly this spelling. On a case-insensitive filesystem
 * `app/acme.json` would otherwise open the legacy `app/Acme.json` (and vice versa); `realpath`
 * returns the on-disk spelling.
 */
async function existsExactly(dir: string, path: string): Promise<boolean> {
  try {
    return relative(await realpath(dir), await realpath(path)) === relative(dir, path);
  } catch {
    return false;
  }
}

/** Recursively collect every `.json` leaf file path under `root`. */
async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = (await readdir(root, { withFileTypes: true })) as Dirent[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw err;
  }
  for (const entry of entries) {
    const name = entry.name.toString();
    const full = join(root, name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && name.endsWith(JSON_SUFFIX)) out.push(full);
  }
  return out;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

const defaultOnLegacy = (dir: string): void => {
  console.warn(
    `[@xtandard/kit] storage/file: ${dir} has files in the legacy (unencoded) layout, which are ` +
      "ignored; run migrateFileStorage({ dir }) once to move them.",
  );
};

let tmpCounter = 0;

/**
 * Create a file-backed {@link FileKvStorage}. Values are pretty-printed JSON. `watch` uses a
 * recursive `fs.watch` on the base directory; it is best-effort and may coalesce or miss events on
 * platforms without recursive-watch support. A `rename` event is reported as `remove` only when the
 * file is actually gone.
 *
 * @example
 * ```ts
 * import { createFileStorage } from "@xtandard/kit/storage/file";
 *
 * const storage = createFileStorage({ dir: "./data" });
 * ```
 */
export function createFileStorage(options: FileStorageOptions): FileKvStorage {
  const { dir, legacy = "ignore", onLegacy = defaultOnLegacy } = options;
  const readThrough = legacy === "read-through";
  let warnedLegacy = false;
  /** Per-key promise chains: every write to a key runs after the previous one. */
  const locks = new Map<string, Promise<unknown>>();

  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
  }

  async function legacyIfExists(key: string): Promise<string | undefined> {
    if (!readThrough) return undefined;
    const path = legacyPath(dir, key);
    return path && (await existsExactly(dir, path)) ? path : undefined;
  }

  async function read<T>(key: string): Promise<T | null> {
    const path = keyToPath(dir, key);
    let raw = await readIfExists(path);
    // With legacy files around, the encoded path may resolve to a legacy file of another case.
    if (raw !== null && readThrough && !(await existsExactly(dir, path))) raw = null;
    if (raw === null) {
      const path = await legacyIfExists(key);
      if (path) raw = await readIfExists(path);
    }
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async function removeLegacy(key: string): Promise<void> {
    const path = await legacyIfExists(key);
    if (path) await unlinkIfExists(path);
  }

  async function write(key: string, value: unknown): Promise<void> {
    const path = keyToPath(dir, key);
    await mkdir(dirname(path), { recursive: true });
    // Write-then-rename: readers never observe a partially written file.
    const tmp = `${path}.${process.pid}.${tmpCounter++}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await rename(tmp, path);
    await removeLegacy(key);
  }

  return {
    getItem: read,

    async setItem<T>(key: string, value: T): Promise<void> {
      await withLock(key, () => write(key, value));
    },

    async removeItem(key: string): Promise<void> {
      await withLock(key, async () => {
        await unlinkIfExists(keyToPath(dir, key));
        await removeLegacy(key);
      });
    },

    async getKeys(prefix: string): Promise<string[]> {
      // A Set: in read-through mode a legacy leaf and its encoded twin are the same key.
      const out = new Set<string>();
      for (const file of await walk(dir)) {
        const leaf = leafKey(dir, file);
        if (!leaf) continue;
        if (leaf.legacy && !readThrough) {
          if (legacy === "warn" && !warnedLegacy) {
            warnedLegacy = true;
            onLegacy(dir);
          }
          continue;
        }
        if (leaf.key.startsWith(prefix)) out.add(leaf.key);
      }
      return [...out];
    },

    async compareAndSwap<T>(input: CompareAndSwapInput<T>): Promise<boolean> {
      return withLock(input.key, async () => {
        if (!deepEqual(await read<T>(input.key), input.expected)) return false;
        await write(input.key, input.next);
        return true;
      });
    },

    async watch(
      prefix: string,
      callback: (event: StorageChangeEvent) => void,
    ): Promise<() => void> {
      // Ensure the watched root exists so fs.watch does not throw on a fresh dir.
      await mkdir(dir, { recursive: true });
      const watcher = fsWatch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const full = join(dir, filename.toString());
        const leaf = leafKey(dir, full);
        if (!leaf || (leaf.legacy && !readThrough) || !leaf.key.startsWith(prefix)) return;
        // `rename` covers creation, deletion and our write-then-rename: report "remove" only when
        // the file is actually gone.
        const type: StorageChangeEvent["type"] =
          eventType === "rename" && !existsSync(full) ? "remove" : "update";
        callback({ type, key: leaf.key });
      });
      return () => watcher.close();
    },
  };
}

/**
 * One-time upgrade of a store in the legacy layout (raw key segments as file names, so keys
 * differing only by case shared a file on case-insensitive filesystems). Moves every leaf that is
 * not in the encoded layout to its {@link encodeSegment} path and removes the emptied directories.
 * Idempotent; run it with no writer on the store. Resolves how many keys moved.
 *
 * @example
 * ```ts
 * import { migrateFileStorage } from "@xtandard/kit/storage/file";
 *
 * await migrateFileStorage({ dir: "./data" });
 * ```
 */
export async function migrateFileStorage(
  options: Pick<FileStorageOptions, "dir">,
): Promise<{ moved: number }> {
  const { dir } = options;
  let moved = 0;
  const emptied = new Set<string>();
  for (const file of await walk(dir)) {
    const leaf = leafKey(dir, file);
    if (!leaf?.legacy) continue;
    const target = keyToPath(dir, leaf.key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(file, "utf8"), "utf8");
    await unlink(file);
    emptied.add(dirname(file));
    moved++;
  }
  // Remove legacy directories left empty, deepest first, up to (not including) dir.
  for (let d of [...emptied].sort((a, b) => b.length - a.length)) {
    while (d !== dir && !relative(dir, d).startsWith("..")) {
      try {
        await rmdir(d);
      } catch {
        break; // not empty (or already gone)
      }
      d = dirname(d);
    }
  }
  return { moved };
}

/**
 * Delete every file written by a {@link createFileStorage} instance by removing its base directory.
 * Exposed for tests and cleanup tooling.
 */
export async function clearFileStorage(options: Pick<FileStorageOptions, "dir">): Promise<void> {
  await rm(options.dir, { recursive: true, force: true });
}
