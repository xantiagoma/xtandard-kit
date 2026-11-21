/**
 * `fixElysia2Types`: the `elysia-v2` alias tsc may spell in the Elysia 2 declarations becomes
 * plain `elysia`.
 *
 * @module
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fixElysia2Types, rewriteSpecifiers } from "../src/build/fix-elysia2-types.ts";

const dir = await mkdtemp(join(tmpdir(), "kit-elysia2-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("fix-elysia2-types", () => {
  it("rewrites bare and deep specifiers in both quote styles, nothing else", () => {
    expect(
      rewriteSpecifiers(
        `import("elysia-v2/types"); from 'elysia-v2'; "elysia-v2x"; "my-elysia-v2"; elysia-v2`,
      ),
    ).toBe(`import("elysia/types"); from 'elysia'; "elysia-v2x"; "my-elysia-v2"; elysia-v2`);
    expect(rewriteSpecifiers(`"a.b"`, "a.b", "c")).toBe(`"c"`);
  });

  it("walks the directory recursively and counts changed declaration files", async () => {
    await mkdir(join(dir, "adapters"), { recursive: true });
    await writeFile(join(dir, "entry.d.ts"), `export type X = import("elysia-v2").Elysia;`);
    await writeFile(join(dir, "adapters", "e.d.mts"), `import type { T } from "elysia-v2/types";`);
    await writeFile(join(dir, "same.d.ts"), `export {};`);
    await writeFile(join(dir, "code.js"), `import("elysia-v2")`);
    expect(await fixElysia2Types({ dir })).toBe(2);
    expect(await readFile(join(dir, "entry.d.ts"), "utf8")).toContain(`import("elysia")`);
    expect(await readFile(join(dir, "adapters", "e.d.mts"), "utf8")).toContain(`"elysia/types"`);
    expect(await readFile(join(dir, "code.js"), "utf8")).toContain("elysia-v2");
    expect(await fixElysia2Types({ dir })).toBe(0);
  });
});
