# ADR 0005 — Stored data stays compatible; encoding fixes read through legacy forms

**Status:** Accepted

---

## Context

The best driver copies (mostly en's) change some on-disk or on-wire representations compared with the
older copies:

- canonical JSON on write;
- `$` escaping for unstorage;
- empty-segment encoding for file keys.

The copies also have different persisted defaults:

- table names `xtandard_X` and `xtandard_X_kv`;
- Mongo database and collection names;
- the pg notify channel;
- id formats: wh random base62, au/li ULID, en lowercase 22 characters.

Users upgrade a product in place, over existing data.

## Decision

1. **Persisted defaults are product parameters** (ADR 0002): table, database, collection, channel,
   key roots and id format. The kit has no defaults for these that a product relies on implicitly.
2. **Encoding changes must read legacy data.**
   - unstorage: encode **only a trailing `$`**, which is the case unstorage hides as a meta key.
     Reads fall back to the raw legacy key when the encoded key is missing.
   - file: empty segments are encoded as `%`. Keys without empty segments map to the same paths as
     before.
   - wh's `migrateFileStorage` and fl's legacy read-through remain available.
3. **CAS stays correct on legacy values.** Writes are canonical. CAS first tries a single-statement
   swap against the canonical form. On a miss, it reads the stored value, compares it structurally
   (`deepEqual`, own properties), and, if they are equal, swaps conditionally on the **raw** stored
   value, with bounded retries. This covers rows written before canonicalisation: SQLite text, and
   Mongo BSON, where field order matters.
4. DDL improvements are applied **only to new tables**: `COLLATE "C"` on pg keys, `utf8mb4_bin` on
   MySQL. Existing tables keep working, because prefix queries add an exact `startsWith` post-filter.
   Optional migration SQL is documented.

5. **MySQL key collation.** `utf8mb4_bin` is PAD SPACE: keys that differ only by trailing spaces
   collide, and indexed `LIKE` can skip supplementary characters. The kit's `mysqlKvTable` keeps
   `utf8mb4_bin` as its **default**, with an opt-in `keyCollation` (`utf8mb4_0900_bin` on MySQL
   8.0+, `utf8mb4_nopad_bin` on MariaDB). The reasons for keeping the default:
   - the table factory is a schema declaration and cannot know the server, and MariaDB and MySQL 5.7
     lack `utf8mb4_0900_bin`;
   - changing the default would make drizzle-kit generate an `ALTER` for every existing user.

   For safety on every table, the MySQL driver guards reads, deletes and swaps with
   `BINARY key = BINARY ?`, and turns an upsert that would collide into a clear error. New
   deployments are told, in docs, to use the NO PAD collation, with migration SQL for existing ones.
   A product may switch its own default in a MINOR release, with a CHANGELOG Migration note.

## Consequences

- Upgrading a product never makes existing keys unreadable or CAS operations fail permanently.
- **Stored-data fixtures are permanent kit tests** (`test/fixtures/stored-data/`). Each product's
  legacy representations are captured as fixture data:
  - pre-encoding file trees (wh v0.1.4 and earlier, fl);
  - unstorage keys containing `$`, `:`, `%`, `?` and `\`;
  - non-canonical JSON rows for sqlite/libsql/postgres/mysql/mongo;
  - RedisJSON and string-codec values;
  - each product's default table, collection and channel names.

  The fixtures are written directly through each backend. The kit must then read, list and CAS them.
  A future kit change that orphans old keys fails CI.
