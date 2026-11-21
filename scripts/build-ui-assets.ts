/**
 * Post-`vp pack` step: writes `dist/ui/styles.css` (exported as `@xtandard/kit/ui/styles.css`)
 * from `src/ui/styles.css`, replacing the source `@source` block with one `@source` line per
 * compiled UI file — the UI entries plus every chunk they import — so Tailwind in a product
 * generates exactly the classes the kit's components use (ADR 0008), without scanning the rest of
 * `dist/`.
 *
 * @module
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
const UI_ENTRIES = ["entry-ui.mjs", "entry-ui-embed.mjs"];
const BLOCK = /\/\* @kit-sources:start \*\/[\s\S]*?\/\* @kit-sources:end \*\//;

/** The UI entries and the local chunks they import, transitively (paths relative to `dist/`). */
export async function uiFiles(distDir: URL, entries: string[] = UI_ENTRIES): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const code = await readFile(new URL(file, distDir), "utf8").catch(() => {
      throw new Error(`build-ui-assets: dist/${file} is missing`);
    });
    seen.add(file);
    const imports =
      /\b(?:from|import)\s*["'](\.\.?\/[^"']+)["']|import\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g;
    for (const m of code.matchAll(imports)) {
      const target = new URL(m[1] ?? m[2]!, new URL(file, distDir)).href;
      if (target.startsWith(distDir.href)) queue.push(target.slice(distDir.href.length));
    }
  }
  return [...seen].sort();
}

/** Replace the `@kit-sources` block of `css` with `@source` lines for `files` (relative to `dist/ui/`). */
export function withSources(css: string, files: string[]): string {
  if (!BLOCK.test(css)) throw new Error("build-ui-assets: no @kit-sources block in styles.css");
  const lines = files.map((f) => `@source "../${f}";`).join("\n");
  return css.replace(BLOCK, `/* @kit-sources:start */\n${lines}\n/* @kit-sources:end */`);
}

if (import.meta.main) {
  const css = await readFile(new URL("src/ui/styles.css", root), "utf8");
  const files = await uiFiles(dist);
  await mkdir(new URL("ui/", dist), { recursive: true });
  await writeFile(new URL("ui/styles.css", dist), withSources(css, files));
  console.log(`dist/ui/styles.css: @source for ${files.length} compiled UI file(s)`);
}
