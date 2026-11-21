/**
 * `@xtandard/kit/storage/file` — file-system storage: one JSON file per key under a base
 * directory, case-safe segment encoding, write-then-rename, `fs.watch` change events, in-process
 * compare-and-swap, and read paths and a migration for stores in the legacy unencoded layout.
 *
 * @module
 */

export {
  clearFileStorage,
  createFileStorage,
  decodeSegment,
  encodeSegment,
  migrateFileStorage,
  type FileKvStorage,
  type FileLegacyMode,
  type FileStorageOptions,
} from "./storage/file.ts";
