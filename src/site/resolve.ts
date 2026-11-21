/**
 * Load a docs-site peer from the **site's** install. The site has its own `package.json` and
 * `node_modules`, and the integrations must be the instances Astro and starlight-typedoc use there
 * (one `typedoc`, one `typescript`). Resolving from the kit's own location would find other
 * copies, or none, whenever the kit is not installed inside `site/node_modules`: a hoisted install,
 * or the kit's own site, whose `file:..` dependency is a tree of symlinks into the repo.
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { importPeer } from "../internal/peer.ts";

const SUBPATH = "@xtandard/kit/site";

type Conditions = string | null | { [key: string]: Conditions } | Conditions[];

function pickEntry(value: Conditions | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = pickEntry(v);
      if (hit) return hit;
    }
    return undefined;
  }
  for (const key of ["import", "node", "default"]) {
    const hit = pickEntry(value[key]);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The ESM entry file of package `name` as installed for `fromDir` (looking in `node_modules` from
 * `fromDir` upwards), or `undefined` when it isn't installed there.
 */
export function resolvePackageEntry(name: string, fromDir: string): string | undefined {
  let dir = fromDir;
  for (;;) {
    const pkgDir = join(dir, "node_modules", name);
    const pkgFile = join(pkgDir, "package.json");
    if (existsSync(pkgFile)) {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as {
        exports?: Conditions | Record<string, Conditions>;
        module?: string;
        main?: string;
      };
      const exp = pkg.exports;
      const root =
        exp && typeof exp === "object" && !Array.isArray(exp) && "." in exp
          ? (exp as Record<string, Conditions>)["."]
          : (exp as Conditions | undefined);
      const entry = pickEntry(root) ?? pkg.module ?? pkg.main ?? "index.js";
      return join(pkgDir, entry);
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Import package `name` as installed for the site at `siteDir`; when the site doesn't have it,
 * fall back to a plain `import()` from the kit (and a clear "install it" error when that fails).
 */
export async function importFromSite<T>(name: string, siteDir: string): Promise<T> {
  const entry = resolvePackageEntry(name, siteDir);
  if (entry) return (await import(pathToFileURL(entry).href)) as T;
  return importPeer(name, SUBPATH, () => import(/* @vite-ignore */ name) as Promise<T>);
}
