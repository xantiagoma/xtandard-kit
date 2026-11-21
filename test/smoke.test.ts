import { expect, test } from "vitest";
import { VERSION } from "../src/index.ts";
import pkg from "../package.json" with { type: "json" };

test("VERSION matches package.json", () => {
  expect(VERSION).toBe(pkg.version);
});
