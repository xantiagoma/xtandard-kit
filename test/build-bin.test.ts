/**
 * The `xtandard-kit` command: scope-embed-css, fix-elysia2-types, api-surface (+ --diff), help.
 *
 * @module
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/bin.ts";
import { EMBED_CSS_SAMPLE } from "../src/build/testing.ts";

const dir = await mkdtemp(join(tmpdir(), "kit-bin-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

async function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = await run(argv, { out: (t) => void (out += t), err: (t) => void (err += t) });
  return { code, out, err };
}

describe("xtandard-kit", () => {
  it("prints help, and rejects unknown commands", async () => {
    expect((await cli()).out).toContain("scope-embed-css");
    expect((await cli("--help")).code).toBe(0);
    const bad = await cli("nope");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('Unknown command "nope"');
  });

  it("scope-embed-css scopes the file and fails on leaks", async () => {
    const css = join(dir, "react.css");
    await writeFile(css, EMBED_CSS_SAMPLE);
    const ok = await cli("scope-embed-css", "--scope", ".xtandard-flags", "--css", css);
    expect(ok).toMatchObject({ code: 0 });
    expect(ok.out).toContain(`scoped ${css} under .xtandard-flags`);
    expect(await readFile(css, "utf8")).toContain(".xtandard-flags .flex{");
    expect((await cli("scope-embed-css", "--css", css)).err).toContain(
      "--scope <.class> is required",
    );
    const missing = await cli("scope-embed-css", "--scope", ".x", "--css", join(dir, "none.css"));
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("scope-embed-css:");
    // `@import` keeps its URL; an unscopable `:root` inside a nested at-rule is still re-homed,
    // so a leak can only come from a selector the transform doesn't know: simulate one.
    await writeFile(css, "@media print{a{color:red}}");
    const scoped = await cli("scope-embed-css", "--scope", ".x", "--css", css);
    expect(scoped.code).toBe(0);
  });

  it("fix-elysia2-types rewrites the declarations directory", async () => {
    const types = join(dir, "types-elysia2");
    await mkdir(types, { recursive: true });
    await writeFile(join(types, "a.d.ts"), `import("elysia-v2")`);
    const res = await cli("fix-elysia2-types", "--dir", types);
    expect(res.out).toContain("in 1 file(s)");
  });

  it("api-surface writes a snapshot and --diff fails on removals", async () => {
    const pkg = join(dir, "pkg");
    await mkdir(join(pkg, "dist"), { recursive: true });
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ name: "p", version: "1.0.0", exports: { ".": "./dist/index.mjs" } }),
    );
    await writeFile(join(pkg, "dist/index.mjs"), "export const a = 1, b = 2;");
    await writeFile(join(pkg, "dist/index.d.mts"), "export declare const a: 1, b: 2;");
    const before = join(dir, "before.json");
    expect((await cli("api-surface", pkg, "--out", before)).out).toContain("1 subpath(s)");
    const printed = await cli("api-surface", join(pkg, "dist"));
    expect(JSON.parse(printed.out).subpaths["."].runtime).toEqual(["a", "b"]);

    await writeFile(join(pkg, "dist/index.mjs"), "export const a = 1, c = 3;");
    await writeFile(join(pkg, "dist/index.d.mts"), "export declare const a: 1, c: 3;");
    const after = join(dir, "after.json");
    await cli("api-surface", pkg, "--out", after);
    const diff = await cli("api-surface", "--diff", before, after);
    expect(diff.code).toBe(1);
    expect(diff.err).toContain("- .: runtime b");
    expect(diff.out).toContain("+ .: runtime c");
    expect(diff.out).toContain("2 added, 2 removed");
    expect((await cli("api-surface", "--diff", before, before)).code).toBe(0);
    expect((await cli("api-surface", "--diff", before)).code).toBe(1);
    expect((await cli("api-surface")).code).toBe(1);

    await writeFile(join(pkg, "dist/index.mjs"), "throw new Error('peer missing')");
    const failing = await cli("api-surface", pkg);
    expect(failing.code).toBe(0);
    expect(failing.err).toContain("! .: import ./dist/index.mjs: peer missing");
  }, 60_000); // spawns the CLI eight times, each loading the TypeScript compiler
});
