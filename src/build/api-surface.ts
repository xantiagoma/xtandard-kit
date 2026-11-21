/**
 * API-surface snapshots (ADR 0003). For every `exports` subpath of a built package,
 * {@link apiSurface} records the runtime export names (by importing the ESM entry) and the exported
 * declaration names (from its `.d.mts`, through the TypeScript compiler API). {@link diffApiSurface}
 * compares two snapshots; a migration PR, or a kit patch, must show no removals.
 *
 * Needs the optional peer `typescript` for the declaration names.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { importPeer } from "../internal/peer.ts";

/** The surface of one subpath. */
export interface SubpathSurface {
  /** Runtime export names (sorted), from importing the ESM entry. */
  runtime: string[];
  /** Every exported name in the `.d.mts` (types and values, sorted). */
  types: string[];
  /** Why the entry could not be imported or read, when it couldn't. */
  error?: string;
}

/** A package's API surface, as written by `xtandard-kit api-surface`. */
export interface ApiSurface {
  package: string;
  version: string;
  /** Keyed by subpath (`"."`, `"./storage/redis"`…), in `exports` order. */
  subpaths: Record<string, SubpathSurface>;
}

/** The ESM runtime file and declaration file an `exports` entry points at. */
export interface ExportTarget {
  runtime?: string;
  types?: string;
}

type Conditions = string | null | { [condition: string]: Conditions } | Conditions[];

function pick(value: Conditions | undefined, keys: readonly string[]): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = pick(v, keys);
      if (hit) return hit;
    }
    return undefined;
  }
  for (const key of keys) {
    const hit = pick(value[key], keys);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Resolve an `exports` value to its ESM runtime file and declaration file (paths as written in
 * `package.json`). `.d.mts` is derived from an `.mjs` target when no `types` condition is given.
 */
export function exportTarget(value: Conditions): ExportTarget {
  const importSide =
    value && typeof value === "object" && !Array.isArray(value) && "import" in value
      ? value.import
      : value;
  const runtime = pick(importSide ?? null, ["node", "default"]);
  // `types` only ever comes from a condition; a bare string target is the runtime file.
  const conditionTypes = (v: Conditions | undefined) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? pick(v.types ?? null, ["default"])
      : undefined;
  let types = conditionTypes(importSide) ?? conditionTypes(value);
  if (!types && runtime)
    types = runtime.replace(/\.m?js$/, (ext) => (ext === ".mjs" ? ".d.mts" : ".d.ts"));
  const isCode = (p?: string) => (p && /\.[cm]?[jt]s$/.test(p) ? p : undefined);
  return {
    runtime: isCode(runtime),
    types: types && /\.d\.[cm]?ts$/.test(types) ? types : undefined,
  };
}

/** Locate the package root: `dir` itself, or its parent when `dir` is the `dist/` folder. */
export function packageRoot(dir: string): string {
  const abs = resolve(dir);
  if (existsSync(join(abs, "package.json"))) return abs;
  if (existsSync(join(dirname(abs), "package.json"))) return dirname(abs);
  throw new Error(`api-surface: no package.json in ${abs} or its parent`);
}

async function declarationNames(files: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (files.length === 0) return out;
  // `typescript` is CommonJS: its API is the default export under Node ESM.
  const ts = await importPeer("typescript", "@xtandard/kit/build", async () => {
    const mod = await import("typescript");
    return mod.default ?? mod;
  });
  const program = ts.createProgram(files, {
    noEmit: true,
    skipLibCheck: true,
    allowJs: false,
    types: [],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
  });
  const checker = program.getTypeChecker();
  for (const file of files) {
    const source = program.getSourceFile(file);
    const symbol = source && checker.getSymbolAtLocation(source);
    out.set(
      file,
      symbol
        ? checker
            .getExportsOfModule(symbol)
            .map((s) => s.getName())
            .sort()
        : [],
    );
  }
  return out;
}

/**
 * Snapshot the API surface of the built package at `dir` (the package root, or its `dist/`).
 * Wildcard, CSS, JSON and `./package.json` exports are skipped.
 */
export async function apiSurface(dir: string): Promise<ApiSurface> {
  const root = packageRoot(dir);
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    exports?: Record<string, Conditions> | Conditions;
  };
  const exportsField: Record<string, Conditions> =
    pkg.exports && typeof pkg.exports === "object" && !Array.isArray(pkg.exports)
      ? Object.keys(pkg.exports).every((k) => k.startsWith("."))
        ? (pkg.exports as Record<string, Conditions>)
        : { ".": pkg.exports as Conditions }
      : pkg.exports
        ? { ".": pkg.exports as Conditions }
        : {};

  const targets: [string, ExportTarget][] = [];
  for (const [subpath, value] of Object.entries(exportsField)) {
    if (subpath.includes("*") || subpath === "./package.json") continue;
    const target = exportTarget(value);
    if (target.runtime || target.types) targets.push([subpath, target]);
  }

  const typeFiles = targets
    .map(([, t]) => t.types && join(root, t.types))
    .filter((f): f is string => Boolean(f && existsSync(f)));
  const names = await declarationNames(typeFiles);

  const subpaths: Record<string, SubpathSurface> = {};
  for (const [subpath, target] of targets) {
    const surface: SubpathSurface = { runtime: [], types: [] };
    const errors: string[] = [];
    if (target.runtime) {
      try {
        // A fresh module instance per snapshot: Node caches ESM by URL, so a second snapshot
        // in the same process (before/after a rebuild) would otherwise see the old exports.
        const url = `${pathToFileURL(join(root, target.runtime)).href}?surface=${Date.now()}`;
        const mod = (await import(url)) as object;
        surface.runtime = Object.keys(mod).sort();
      } catch (error) {
        errors.push(`import ${target.runtime}: ${(error as Error).message}`);
      }
    }
    if (target.types) {
      const file = join(root, target.types);
      if (names.has(file)) surface.types = names.get(file)!;
      else errors.push(`missing ${target.types}`);
    }
    if (errors.length) surface.error = errors.join("; ");
    subpaths[subpath] = surface;
  }
  return { package: pkg.name ?? basename(root), version: pkg.version ?? "0.0.0", subpaths };
}

/** The result of {@link diffApiSurface}: one line per change, e.g. `"./storage: runtime foo"`. */
export interface ApiSurfaceDiff {
  removed: string[];
  added: string[];
}

/** Compare two snapshots. Anything in `before` but not in `after` is a removal. */
export function diffApiSurface(before: ApiSurface, after: ApiSurface): ApiSurfaceDiff {
  const removed: string[] = [];
  const added: string[] = [];
  const keys = new Set([...Object.keys(before.subpaths), ...Object.keys(after.subpaths)]);
  for (const subpath of keys) {
    const a = before.subpaths[subpath];
    const b = after.subpaths[subpath];
    if (!b) {
      removed.push(`${subpath}: subpath`);
      continue;
    }
    if (!a) {
      added.push(`${subpath}: subpath`);
      continue;
    }
    for (const kind of ["runtime", "types"] as const) {
      const was = new Set(a[kind]);
      const now = new Set(b[kind]);
      for (const name of was) if (!now.has(name)) removed.push(`${subpath}: ${kind} ${name}`);
      for (const name of now) if (!was.has(name)) added.push(`${subpath}: ${kind} ${name}`);
    }
    if (b.error && !a.error) removed.push(`${subpath}: now fails (${b.error})`);
  }
  return { removed, added };
}
