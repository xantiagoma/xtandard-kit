import { describe, expect, test } from "vitest";
import { createDrizzleStorage } from "../src/storage/drizzle.ts";
import { createLibsqlStorage } from "../src/storage/libsql.ts";
import { createMongoStorage } from "../src/storage/mongodb.ts";
import { createSqliteStorage } from "../src/storage/sqlite.ts";

// A product re-exports the kit's drivers; its users should see the import path they used.
const at = (driver: string) => `@xtandard/webhooks/storage/${driver}`;

describe("driver errors name the product's subpath (subpath option)", () => {
  test("mongodb: missing client/url", async () => {
    const storage = createMongoStorage({ dbName: "x", subpath: at("mongodb") });
    await expect(storage.getItem("k")).rejects.toThrow(`${at("mongodb")} requires either`);
    await expect(createMongoStorage({ dbName: "x" }).getItem("k")).rejects.toThrow(
      "@xtandard/kit/storage/mongodb requires either",
    );
  });

  test("libsql: missing client/url", async () => {
    await expect(createLibsqlStorage({ subpath: at("libsql") }).getItem("k")).rejects.toThrow(
      `${at("libsql")} requires either`,
    );
  });

  test.skipIf(typeof (globalThis as { Bun?: unknown }).Bun !== "undefined")(
    "sqlite: Bun runtime required (under Node)",
    async () => {
      await expect(createSqliteStorage({ subpath: at("sqlite") }).getItem("k")).rejects.toThrow(
        `${at("sqlite")} requires the Bun runtime`,
      );
    },
  );

  test("drizzle: undetectable dialect", () => {
    expect(() =>
      createDrizzleStorage({ db: {}, table: {} as never, subpath: at("drizzle") }),
    ).toThrow(`${at("drizzle")}: cannot detect the Drizzle dialect`);
  });
});
