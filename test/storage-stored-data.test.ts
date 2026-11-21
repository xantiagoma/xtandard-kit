/**
 * Permanent stored-data fixtures for the SQL drivers (ADR 0005): each product's default table,
 * created with the DDL its last pre-kit release ran, holding rows written the way the copies wrote
 * them (`JSON.stringify` in insertion order). The kit must read, list and compare-and-swap them.
 */
import { createClient, type Client } from "@libsql/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createLibsqlStorage, type LibsqlClientLike } from "../src/storage/libsql.ts";
import { createPostgresStorage } from "../src/storage/postgres.ts";
import type { CompareAndSwapKvStorage } from "../src/storage/contract.ts";
import { pglite } from "./drizzle-helpers.ts";
import fixture from "./fixtures/stored-data/products.json" with { type: "json" };

vi.setConfig({ testTimeout: 60_000 });

const products = Object.entries(fixture.products);
const rowsFor = (root: string) =>
  fixture.rows.map((r) => ({ key: r.key.replace("{root}", root), json: r.json }));

async function expectReadsListsAndSwaps(storage: CompareAndSwapKvStorage, root: string) {
  const rows = rowsFor(root);
  for (const r of rows) expect(await storage.getItem(r.key)).toEqual(JSON.parse(r.json));
  expect((await storage.getKeys(`${root}/`)).sort()).toEqual(rows.map((r) => r.key).sort());
  expect(await storage.getKeys(`${root}/Acme/`)).toEqual([`${root}/Acme/config`]);
  for (const r of rows) {
    expect(
      await storage.compareAndSwap<unknown>({
        key: r.key,
        expected: JSON.parse(r.json),
        next: { swapped: r.key },
      }),
    ).toBe(true);
    expect(await storage.getItem(r.key)).toEqual({ swapped: r.key });
  }
}

describe("postgres: legacy tables and rows of every product (PGlite)", () => {
  test.each(products)("%s", async (_name, p) => {
    const table = `${p.table}_${process.pid}`;
    await pglite().exec(fixture.legacyDdl.postgres.replace("{table}", table));
    for (const r of rowsFor(p.keyRoot)) {
      await pglite().query(`INSERT INTO ${table} (key, value) VALUES ($1, $2::jsonb)`, [
        r.key,
        r.json,
      ]);
    }
    await expectReadsListsAndSwaps(createPostgresStorage({ client: pglite(), table }), p.keyRoot);
  });
});

const clients: Client[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

describe("libsql/sqlite: legacy tables and non-canonical rows of every product", () => {
  test.each(products)("%s", async (_name, p) => {
    const client = createClient({ url: ":memory:" });
    clients.push(client);
    await client.execute(fixture.legacyDdl.sqlite.replace("{table}", p.table));
    for (const r of rowsFor(p.keyRoot)) {
      await client.execute({
        sql: `INSERT INTO ${p.table} (key, value) VALUES (?, ?)`,
        args: [r.key, r.json],
      });
    }
    const storage = createLibsqlStorage({
      client: client as unknown as LibsqlClientLike,
      table: p.table,
    });
    await expectReadsListsAndSwaps(storage, p.keyRoot);
  });
});
