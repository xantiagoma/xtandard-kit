/**
 * `importFromSite` / `resolvePackageEntry`: docs-site peers come from the site's own install
 * (walking `node_modules` up from the site), not from wherever the kit happens to be.
 *
 * @module
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importFromSite, resolvePackageEntry } from "../src/site/resolve.ts";

const root = await mkdtemp(join(tmpdir(), "kit-site-resolve-"));
afterAll(() => rm(root, { recursive: true, force: true }));
const site = join(root, "repo/site");

async function pkg(dir: string, json: object, files: Record<string, string>) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify(json));
  for (const [f, c] of Object.entries(files)) {
    await mkdir(join(dir, f, ".."), { recursive: true });
    await writeFile(join(dir, f), c);
  }
}

beforeAll(async () => {
  await mkdir(site, { recursive: true });
  // In the site's own node_modules.
  await pkg(
    join(site, "node_modules/site-only"),
    { exports: { ".": { types: "./x.d.ts", import: "./esm.mjs", require: "./cjs.cjs" } } },
    {
      "esm.mjs": "export const where = 'site';",
    },
  );
  // Hoisted to the repo root.
  await pkg(
    join(root, "repo/node_modules/@scope/hoisted"),
    { exports: "./main.mjs" },
    {
      "main.mjs": "export default 'hoisted';",
    },
  );
  await pkg(
    join(site, "node_modules/legacy"),
    { main: "lib/index.mjs" },
    {
      "lib/index.mjs": "export const legacy = true;",
    },
  );
  await pkg(join(site, "node_modules/bare"), {}, { "index.js": "export const bare = 1;" });
  await pkg(
    join(site, "node_modules/arr"),
    { exports: { ".": [{ default: "./a.mjs" }] } },
    {
      "a.mjs": "export const arr = 1;",
    },
  );
});

describe("resolvePackageEntry", () => {
  it("finds the ESM entry in the site's node_modules, then upwards", () => {
    expect(resolvePackageEntry("site-only", site)).toBe(
      join(site, "node_modules/site-only/esm.mjs"),
    );
    expect(resolvePackageEntry("@scope/hoisted", site)).toBe(
      join(root, "repo/node_modules/@scope/hoisted/main.mjs"),
    );
    expect(resolvePackageEntry("legacy", site)).toBe(
      join(site, "node_modules/legacy/lib/index.mjs"),
    );
    expect(resolvePackageEntry("bare", site)).toBe(join(site, "node_modules/bare/index.js"));
    expect(resolvePackageEntry("arr", site)).toBe(join(site, "node_modules/arr/a.mjs"));
    expect(resolvePackageEntry("nowhere-to-be-found", site)).toBeUndefined();
  });
});

describe("importFromSite", () => {
  it("imports from the site, and falls back to a plain import or a clear error", async () => {
    expect(await importFromSite<{ where: string }>("site-only", site)).toMatchObject({
      where: "site",
    });
    expect((await importFromSite<{ default: string }>("@scope/hoisted", site)).default).toBe(
      "hoisted",
    );
    // Not in the site tree: the kit's own resolution (here, the repo's devDependency).
    expect(await importFromSite<object>("postcss", site)).toHaveProperty("default");
    await expect(importFromSite("nowhere-to-be-found", site)).rejects.toThrow(
      /@xtandard\/kit\/site requires the optional peer "nowhere-to-be-found"/,
    );
  });
});
