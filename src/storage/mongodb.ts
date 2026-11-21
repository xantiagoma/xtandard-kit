/**
 * MongoDB storage driver over the [`mongodb`](https://github.com/mongodb/node-mongodb-native)
 * driver (an optional peer). Pass a (optionally pre-connected) `MongoClient`, or a `url` to create
 * and connect one lazily on first use; a failed connect is retried on the next call.
 *
 * - One collection of `{ _id: <key>, value: <BSON> }` documents. Values are written with sorted
 *   object keys, because BSON document equality is field-order sensitive.
 * - `getKeys` matches `_id` with an anchored, escaped regex (projecting only `_id`) plus an exact
 *   `startsWith` filter, which guards against a case-insensitive collection collation.
 * - `compareAndSwap` is one `updateOne({ _id, $expr: { $eq: ["$value", { $literal: expected }] } })`
 *   (`$literal`: a value with `$`-prefixed keys is never read as an expression), or an `insertOne`
 *   guarded by the unique `_id` for an absent key. A document written before canonicalisation
 *   (fields in insertion order) misses that fast path; the swap then reads it, compares it
 *   structurally and swaps on the exact stored document (ADR 0005).
 * - No `watch`: change streams need a replica set. Compose `withWatch` if you have one.
 *
 * @module
 */

import type { Collection, Document, MongoClient } from "mongodb";
import { canonical } from "../internal/json.ts";
import { importPeer } from "../internal/peer.ts";
import { swapWithFallback } from "./cas.ts";
import type { CompareAndSwapInput, CompareAndSwapKvStorage } from "./contract.ts";
import { escapeRegex } from "./util.ts";

const SUBPATH = "@xtandard/kit/storage/mongodb";

/** Options for {@link createMongoStorage}. */
export interface MongoStorageOptions {
  /**
   * The import path to name in error messages (a missing peer, a missing `client`/`url`…), e.g.
   * `"@xtandard/webhooks/storage/mongodb"` when a product re-exports this driver. Default: the kit
   * subpath.
   */
  subpath?: string;
  /** A pre-constructed (optionally pre-connected) `MongoClient`. Never closed by the driver. */
  client?: MongoClient;
  /** Connection string; a `MongoClient` is created lazily when no `client` is given. */
  url?: string;
  /** Database name (default `"xtandard"`; products pass theirs). */
  dbName?: string;
  /** Collection name (default `"kv"`; products pass theirs). */
  collectionName?: string;
}

/** A compare-and-swap capable storage backed by MongoDB, plus `close()`. */
export interface MongoKvStorage extends CompareAndSwapKvStorage {
  /** Disconnect the client if this driver created it; no-op for a borrowed one. */
  close(): Promise<void>;
}

/** One key/value document. */
export interface KvDocument extends Document {
  /** The storage key, verbatim. */
  _id: string;
  /** The stored value (any BSON). */
  value: unknown;
}

/** A lazily connected Mongo database handle (semi-public, ADR 0004). */
export interface MongoConnection {
  /** Resolve a collection, creating and connecting the client on first use (retried after a failure). */
  collection<T extends Document>(name: string): Promise<Collection<T>>;
  /** Close the client if this connection created it. */
  close(): Promise<void>;
}

/** Build a {@link MongoConnection} from a borrowed `client` or a `url`. */
export function mongoConnection(
  options: { client?: MongoClient; url?: string; dbName: string },
  subpath = SUBPATH,
): MongoConnection {
  const ownsClient = !options.client;
  let client: MongoClient | undefined = options.client;
  let connecting: Promise<MongoClient> | undefined;

  async function connect(): Promise<MongoClient> {
    connecting ??= (async () => {
      if (!client) {
        if (options.url === undefined) {
          throw new Error(`${subpath} requires either a \`client\` or a \`url\``);
        }
        type Ctor = new (url: string) => MongoClient;
        const mod = await importPeer(
          "mongodb",
          subpath,
          () =>
            import("mongodb") as unknown as Promise<{
              MongoClient?: Ctor;
              default?: { MongoClient: Ctor };
            }>,
        );
        const MongoClientCtor = (mod.MongoClient ?? mod.default?.MongoClient) as Ctor;
        client = new MongoClientCtor(options.url);
      }
      // connect() on an already connected client is a no-op in current drivers; older ones threw.
      try {
        await client.connect();
      } catch (error) {
        if (!isAlreadyConnected(error)) throw error;
      }
      return client;
    })();
    try {
      return await connecting;
    } catch (error) {
      connecting = undefined; // let a later operation retry
      throw error;
    }
  }

  return {
    async collection<T extends Document>(name: string): Promise<Collection<T>> {
      return (await connect()).db(options.dbName).collection<T>(name);
    },
    async close(): Promise<void> {
      if (ownsClient && client) await client.close();
    },
  };
}

/** True for a MongoDB duplicate-key error (E11000). Semi-public. */
export function isDuplicateKey(error: unknown): boolean {
  const e = error as { code?: unknown; writeErrors?: unknown } | null;
  if (e?.code === 11000) return true;
  // Bulk writes (`insertMany`, `bulkWrite`) may report E11000 only per write.
  const writeErrors = e?.writeErrors;
  return (
    Array.isArray(writeErrors) &&
    writeErrors.some((w) => (w as { code?: unknown } | null)?.code === 11000)
  );
}

const isAlreadyConnected = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("already") && message.includes("connect");
};

/**
 * The KV operations over a collection (semi-public, ADR 0004): `collection` resolves it before
 * every operation. {@link createMongoStorage} is this plus {@link mongoConnection}.
 */
export function mongoKvStorage(
  collection: () => Promise<Collection<KvDocument>>,
): CompareAndSwapKvStorage {
  return {
    async getItem<T>(key: string): Promise<T | null> {
      const doc = await (await collection()).findOne({ _id: key });
      return doc ? (doc.value as T) : null;
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      await (
        await collection()
      ).updateOne({ _id: key }, { $set: { value: canonical(value) } }, { upsert: true });
    },

    async removeItem(key: string): Promise<void> {
      await (await collection()).deleteOne({ _id: key });
    },

    async getKeys(prefix: string): Promise<string[]> {
      const cursor = (await collection())
        .find({ _id: { $regex: `^${escapeRegex(prefix)}` } })
        .project<{ _id: string }>({ _id: 1 });
      const out: string[] = [];
      for await (const doc of cursor) if (doc._id.startsWith(prefix)) out.push(doc._id);
      return out;
    },

    async compareAndSwap<T>(input: CompareAndSwapInput<T>): Promise<boolean> {
      const c = await collection();
      const next = canonical(input.next);
      if (input.expected === null) {
        try {
          await c.insertOne({ _id: input.key, value: next });
          return true;
        } catch (error) {
          if (isDuplicateKey(error)) return false;
          throw error;
        }
      }
      // `$expr` + `$literal`: exact equality (no array traversal), and `$`-prefixed keys stay data.
      const swap = async (current: unknown): Promise<boolean> =>
        (
          await c.updateOne(
            { _id: input.key, $expr: { $eq: ["$value", { $literal: current }] } },
            { $set: { value: next } },
          )
        ).matchedCount === 1;
      return swapWithFallback<unknown>(input.expected, {
        fast: () => swap(canonical(input.expected)),
        async read() {
          const doc = await c.findOne({ _id: input.key });
          return doc ? { raw: doc.value, value: doc.value } : null;
        },
        swapRaw: swap,
      });
    },
  };
}

/**
 * Create a MongoDB-backed {@link MongoKvStorage}. Connection is lazy and shared.
 *
 * @example
 * ```ts
 * import { createMongoStorage } from "@xtandard/kit/storage/mongodb";
 *
 * const storage = createMongoStorage({ url: process.env.MONGO_URL, dbName: "app", collectionName: "kv" });
 * ```
 */
export function createMongoStorage(options: MongoStorageOptions): MongoKvStorage {
  const { dbName = "xtandard", collectionName = "kv" } = options;
  const connection = mongoConnection({ ...options, dbName }, options.subpath ?? SUBPATH);
  return {
    ...mongoKvStorage(() => connection.collection<KvDocument>(collectionName)),
    close: connection.close,
  };
}
