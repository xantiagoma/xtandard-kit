/**
 * `@xtandard/kit/storage/mongodb` — MongoDB storage: one `{ _id: key, value }` collection over the
 * `mongodb` driver, with single-update compare-and-swap that also swaps documents written before
 * canonicalisation.
 *
 * Optional peer: `mongodb` (loaded on first use).
 *
 * @module
 */

export {
  createMongoStorage,
  type MongoKvStorage,
  type MongoStorageOptions,
} from "./storage/mongodb.ts";
