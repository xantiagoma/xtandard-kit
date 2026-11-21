/**
 * `@xtandard/kit/storage/mongodb/internals` — **semi-public** building blocks of the MongoDB driver
 * (ADR 0004): the lazy connection, the duplicate-key check and the KV operations over a collection.
 * Covered by the versioning policy like any export; changes are a MINOR bump.
 *
 * @module
 */

export {
  isDuplicateKey,
  mongoConnection,
  mongoKvStorage,
  type KvDocument,
  type MongoConnection,
} from "./storage/mongodb.ts";
