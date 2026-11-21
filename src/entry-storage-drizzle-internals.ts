/**
 * `@xtandard/kit/storage/drizzle/internals` — **semi-public** helpers of the Drizzle driver
 * (ADR 0004): dialect detection, MySQL affected-row counting and prefix ranges, the lazily imported `sql` tag and the
 * structural database type. Covered by the versioning policy like any export; changes are a MINOR
 * bump.
 *
 * @module
 */

export {
  affectedRows,
  detectDrizzleDialect,
  drizzleSql,
  prefixSuccessor,
  type DrizzleDialect,
  type DrizzleLikeDatabase,
} from "./storage/drizzle.ts";
