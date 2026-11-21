/**
 * Embed-CSS scoping (fl's transform, the scope as a parameter), through the reusable suite the
 * products run, plus the kit-only cases.
 *
 * @module
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  findUnscopedLeaks,
  normalizeScope,
  scopeCss,
  scopeCssFile,
} from "../src/build/scope-css.ts";
import { EMBED_CSS_SAMPLE, runEmbedCssSuite } from "../src/build/testing.ts";

const dir = await mkdtemp(join(tmpdir(), "kit-scope-css-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

runEmbedCssSuite({ describe, it, expect }, { scope: ".xtandard-flags" });
runEmbedCssSuite(
  { describe, it, expect },
  {
    scope: "xtandard-webhooks",
    readBuiltCss: () => scopeCss(EMBED_CSS_SAMPLE, ".xtandard-webhooks"),
  },
);
runEmbedCssSuite({ describe, it, expect }, { scope: ".x", readBuiltCss: () => undefined });

describe("scope-css (kit cases)", () => {
  it("normalizes the scope and rejects selectors", () => {
    expect(normalizeScope("xtandard-audit")).toBe(".xtandard-audit");
    expect(normalizeScope(" .xtandard-audit ")).toBe(".xtandard-audit");
    expect(() => normalizeScope(".a .b")).toThrow(/single class name/);
    expect(() => normalizeScope("")).toThrow(/single class name/);
  });

  // wh's transform only re-homed `[`-qualified roots; `:root.dark` / `:root:not(…)` leaked.
  it("re-homes any compound root selector (fl)", async () => {
    const out = await scopeCss(
      ':root:not([data-theme="light"]){--a:1}html.dark{--b:2}',
      ".xtandard-links",
    );
    expect(out).toBe('.xtandard-links:not([data-theme="light"]){--a:1}.xtandard-links.dark{--b:2}');
  });

  it("flags token blocks left on :root/html/body, and a look-alike class is not a scope", () => {
    expect(findUnscopedLeaks(":root{--a:1}", ".x")).toHaveLength(1);
    expect(findUnscopedLeaks("body{color:red}", ".x")).toHaveLength(1);
    expect(findUnscopedLeaks('html[data-theme="dark"]{--a:1}', ".x")).toHaveLength(1);
    expect(findUnscopedLeaks(".x-other *{margin:0}", ".x")).toEqual([]);
    expect(findUnscopedLeaks("*,.x-other{margin:0}", ".x")).toHaveLength(1);
    expect(findUnscopedLeaks(".x *{margin:0}", ".x")).toEqual([]);
  });

  it("scopeCssFile rewrites in place and reports leaks", async () => {
    const file = join(dir, "react.css");
    await writeFile(file, EMBED_CSS_SAMPLE);
    const result = await scopeCssFile(file, ".xtandard-audit");
    expect(result).toEqual({ path: file, leaks: [] });
    expect(await readFile(file, "utf8")).toContain(".xtandard-audit .flex{");
  });
});
