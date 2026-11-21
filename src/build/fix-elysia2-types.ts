/**
 * Post-build step for a product's `/elysia2` declarations.
 *
 * `tsc -p tsconfig.elysia2.build.json` type-checks against the `elysia-v2` devDep alias (the repos
 * develop on Elysia 1), and where tsc has to name an inferred type it may spell the alias:
 * `import("elysia-v2/types")`. Consumers install Elysia 2 as plain `elysia`, so the specifier is
 * rewritten.
 *
 * @module
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Options for {@link fixElysia2Types}. */
export interface FixElysia2TypesOptions {
  /** The declarations directory; `"dist/types-elysia2"` by default. */
  dir?: string;
  /** The alias to rewrite; `"elysia-v2"` by default. */
  from?: string;
  /** What it becomes; `"elysia"` by default. */
  to?: string;
}

/** Rewrite `"<from>"` / `"<from>/…"` module specifiers to `<to>` in a string. */
export function rewriteSpecifiers(source: string, from = "elysia-v2", to = "elysia"): string {
  const name = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.replace(new RegExp(`(["'])${name}(\\/[^"']*)?\\1`, "g"), `$1${to}$2$1`);
}

/**
 * Rewrite the alias in every `.d.ts`/`.d.mts`/`.d.cts` under `dir` (recursively). Resolves to the
 * number of files changed.
 */
export async function fixElysia2Types(options: FixElysia2TypesOptions = {}): Promise<number> {
  const dir = options.dir ?? "dist/types-elysia2";
  let rewritten = 0;
  for (const rel of await readdir(dir, { recursive: true })) {
    if (!/\.d\.[mc]?ts$/.test(rel)) continue;
    const path = join(dir, rel);
    const src = await readFile(path, "utf8");
    const out = rewriteSpecifiers(src, options.from, options.to);
    if (out !== src) {
      await writeFile(path, out);
      rewritten++;
    }
  }
  return rewritten;
}
