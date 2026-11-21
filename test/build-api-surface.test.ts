/**
 * `apiSurface` / `diffApiSurface` (ADR 0003): every `exports` subpath's runtime names (by importing
 * the ESM entry) and declaration names (from the `.d.mts`), and the no-removals diff.
 *
 * @module
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiSurface,
  diffApiSurface,
  exportTarget,
  packageRoot,
  type ApiSurface,
} from "../src/build/api-surface.ts";

const root = await mkdtemp(join(tmpdir(), "kit-api-surface-"));
afterAll(() => rm(root, { recursive: true, force: true }));

const files: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "@xtandard/demo",
    version: "0.3.1",
    exports: {
      ".": {
        import: { types: "./dist/index.d.mts", default: "./dist/index.mjs" },
        require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
      },
      "./storage": { types: "./dist/storage.d.mts", default: "./dist/storage.mjs" },
      "./react": "./dist/react.mjs",
      "./broken": "./dist/broken.mjs",
      "./nodts": { import: "./dist/nodts.mjs" },
      "./react/styles.css": "./dist/react.css",
      "./ui/*": "./dist/ui/*",
      "./package.json": "./package.json",
    },
  }),
  "dist/chunk.mjs": "export const shared = 1; export function helper() {}",
  "dist/chunk.d.mts":
    "export declare const shared: number; export declare function helper(): void; export interface Options { a: string }",
  "dist/index.mjs": `export { shared, helper } from "./chunk.mjs"; export default 42;`,
  "dist/index.d.mts": `export * from "./chunk.mjs"; export type Alias = string; declare const d: number; export default d;`,
  "dist/storage.mjs": "export const createStorage = () => ({});",
  "dist/storage.d.mts": `import type { Missing } from "not-installed"; export declare const createStorage: () => Missing; export type { Missing };`,
  "dist/react.mjs": "export const Dashboard = 1;",
  "dist/react.d.mts": "export declare const Dashboard: number; export type DashboardProps = {};",
  "dist/broken.mjs": `throw new Error("needs a peer");`,
  "dist/nodts.mjs": "export const x = 1;",
  "dist/react.css": ".a{}",
};

beforeAll(async () => {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), content);
  }
});

describe("exportTarget", () => {
  it("resolves the ESM runtime and declaration files", () => {
    expect(exportTarget({ import: { types: "./a.d.mts", default: "./a.mjs" } })).toEqual({
      runtime: "./a.mjs",
      types: "./a.d.mts",
    });
    expect(exportTarget("./b.mjs")).toEqual({ runtime: "./b.mjs", types: "./b.d.mts" });
    expect(exportTarget("./b.js")).toEqual({ runtime: "./b.js", types: "./b.d.ts" });
    expect(exportTarget({ types: "./c.d.ts", default: "./c.js" })).toEqual({
      runtime: "./c.js",
      types: "./c.d.ts",
    });
    expect(exportTarget({ import: { node: "./n.mjs" } })).toEqual({
      runtime: "./n.mjs",
      types: "./n.d.mts",
    });
    expect(exportTarget(["./x.mjs"])).toEqual({ runtime: "./x.mjs", types: "./x.d.mts" });
    expect(exportTarget("./s.css")).toEqual({ runtime: undefined, types: undefined });
    expect(exportTarget(null)).toEqual({ runtime: undefined, types: undefined });
  });

  it("finds the package root from the package or its dist/", () => {
    expect(packageRoot(root)).toBe(root);
    expect(packageRoot(join(root, "dist"))).toBe(root);
    expect(() => packageRoot(join(root, "dist", "nope", "deeper"))).toThrow(/no package.json/);
  });
});

describe("apiSurface", () => {
  it("records runtime and declaration names per subpath, in exports order", async () => {
    const s = await apiSurface(join(root, "dist"));
    expect(s.package).toBe("@xtandard/demo");
    expect(s.version).toBe("0.3.1");
    expect(Object.keys(s.subpaths)).toEqual([".", "./storage", "./react", "./broken", "./nodts"]);
    expect(s.subpaths["."]).toEqual({
      runtime: ["default", "helper", "shared"],
      types: ["Alias", "Options", "default", "helper", "shared"],
    });
    // Unresolvable peer types still list the exported names.
    expect(s.subpaths["./storage"]).toEqual({
      runtime: ["createStorage"],
      types: ["Missing", "createStorage"],
    });
    expect(s.subpaths["./react"]!.types).toEqual(["Dashboard", "DashboardProps"]);
    expect(s.subpaths["./broken"]!.error).toMatch(/import \.\/dist\/broken\.mjs: needs a peer/);
    expect(s.subpaths["./nodts"]).toEqual({
      runtime: ["x"],
      types: [],
      error: "missing ./dist/nodts.d.mts",
    });
  });
});

describe("diffApiSurface", () => {
  const snap = (subpaths: ApiSurface["subpaths"]): ApiSurface => ({
    package: "p",
    version: "1",
    subpaths,
  });

  it("reports removals and additions of subpaths, runtime and type names", () => {
    const before = snap({
      ".": { runtime: ["a", "b"], types: ["A", "b"] },
      "./gone": { runtime: ["x"], types: [] },
    });
    const after = snap({
      ".": { runtime: ["a", "c"], types: ["A", "b", "C"] },
      "./new": { runtime: [], types: [] },
    });
    expect(diffApiSurface(before, after)).toEqual({
      removed: [".: runtime b", "./gone: subpath"],
      added: [".: runtime c", ".: types C", "./new: subpath"],
    });
  });

  it("a subpath that starts failing to import is a removal", () => {
    const ok = snap({ ".": { runtime: ["a"], types: [] } });
    const broken = snap({ ".": { runtime: [], types: [], error: "boom" } });
    expect(diffApiSurface(ok, broken).removed).toEqual([".: runtime a", ".: now fails (boom)"]);
    expect(diffApiSurface(ok, ok)).toEqual({ removed: [], added: [] });
  });
});
