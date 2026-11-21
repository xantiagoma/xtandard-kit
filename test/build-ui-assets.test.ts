/**
 * `scripts/build-ui-assets.ts`: the published stylesheet's `@source` lines cover exactly the
 * compiled UI entries and the chunks they import (ADR 0008).
 *
 * @module
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { uiFiles, withSources } from "../scripts/build-ui-assets.ts";

const dir = await mkdtemp(join(tmpdir(), "kit-ui-assets-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("build-ui-assets", () => {
  it("follows static, side-effect and dynamic imports from the UI entries only", async () => {
    await mkdir(join(dir, "dist", "sub"), { recursive: true });
    const files: Record<string, string> = {
      "entry-ui.mjs": `import { a } from "./chunk-a.mjs";\nimport "./side.mjs";\nexport * from './sub/c.mjs';`,
      "entry-ui-embed.mjs": `const m = () => import("./lazy.mjs"); import React from "react";`,
      "chunk-a.mjs": `import { b } from "./chunk-a.mjs";`,
      "side.mjs": "",
      "sub/c.mjs": `import { x } from "../chunk-a.mjs";`,
      "lazy.mjs": "",
      "entry-storage.mjs": "",
    };
    for (const [name, code] of Object.entries(files))
      await writeFile(join(dir, "dist", name), code);
    const dist = pathToFileURL(join(dir, "dist") + "/");
    expect(await uiFiles(dist)).toEqual([
      "chunk-a.mjs",
      "entry-ui-embed.mjs",
      "entry-ui.mjs",
      "lazy.mjs",
      "side.mjs",
      "sub/c.mjs",
    ]);
    await expect(uiFiles(dist, ["missing.mjs"])).rejects.toThrow(/dist\/missing.mjs is missing/);
  });

  it("replaces the @kit-sources block", () => {
    const css = `@import "tailwindcss";\n/* @kit-sources:start */\n@source "./";\n/* @kit-sources:end */\n.a{}`;
    expect(withSources(css, ["entry-ui.mjs", "x.mjs"])).toBe(
      `@import "tailwindcss";\n/* @kit-sources:start */\n@source "../entry-ui.mjs";\n@source "../x.mjs";\n/* @kit-sources:end */\n.a{}`,
    );
    expect(() => withSources(".a{}", [])).toThrow(/no @kit-sources block/);
  });
});
