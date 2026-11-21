/**
 * The `xtandard-kit` command: build-time helpers for the xtandard products.
 *
 * - `scope-embed-css --scope .xtandard-x [--css dist/react.css]`
 * - `fix-elysia2-types [--dir dist/types-elysia2]`
 * - `api-surface <dist-or-pkg-dir> [--out file]` and `api-surface --diff before.json after.json`
 *
 * @module
 */

import { readFile, writeFile } from "node:fs/promises";
import { apiSurface, diffApiSurface, type ApiSurface } from "./build/api-surface.ts";
import { fixElysia2Types } from "./build/fix-elysia2-types.ts";
import { scopeCssFile } from "./build/scope-css.ts";

const HELP = `xtandard-kit <command> [options]

Commands:
  scope-embed-css --scope <.class> [--css <file>]
      Scope the React-embed stylesheet (default dist/react.css) under the wrapper class,
      then fail if any rule still leaks onto the host page.
  fix-elysia2-types [--dir <dir>]
      Rewrite "elysia-v2" specifiers to "elysia" in the Elysia 2 declarations
      (default dist/types-elysia2).
  api-surface <dist-or-pkg-dir> [--out <file>]
      Print (or write) every exports subpath's runtime and declaration names as JSON.
  api-surface --diff <before.json> <after.json>
      Compare two snapshots; exits 1 when anything was removed.
  help
      Show this help.
`;

/** Where the CLI writes; injectable for tests. */
export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

const processIo: CliIo = {
  out: (t) => void process.stdout.write(t),
  err: (t) => void process.stderr.write(t),
};

/** `--name value` → value; flags without a value or missing → undefined. */
function option(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function positionals(argv: string[], valued: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (valued.includes(a)) i++;
    else if (!a.startsWith("--")) out.push(a);
  }
  return out;
}

async function scopeEmbedCss(argv: string[], io: CliIo): Promise<number> {
  const scope = option(argv, "--scope");
  if (!scope) {
    io.err("scope-embed-css: --scope <.class> is required (e.g. --scope .xtandard-flags)\n");
    return 1;
  }
  const css = option(argv, "--css") ?? "dist/react.css";
  const { leaks } = await scopeCssFile(css, scope);
  if (leaks.length > 0) {
    io.err(
      `[scope-embed-css] ${leaks.length} unscoped rule(s) leaked:\n${leaks.slice(0, 3).join("\n")}\n`,
    );
    return 1;
  }
  io.out(`[scope-embed-css] scoped ${css} under ${scope}\n`);
  return 0;
}

async function fixTypes(argv: string[], io: CliIo): Promise<number> {
  const dir = option(argv, "--dir") ?? "dist/types-elysia2";
  const n = await fixElysia2Types({ dir });
  io.out(`fix-elysia2-types: rewrote elysia-v2 → elysia in ${n} file(s)\n`);
  return 0;
}

async function surface(argv: string[], io: CliIo): Promise<number> {
  if (argv.includes("--diff")) {
    const [before, after] = positionals(argv, ["--out"]);
    if (!before || !after) {
      io.err("api-surface --diff <before.json> <after.json>\n");
      return 1;
    }
    const read = async (f: string) => JSON.parse(await readFile(f, "utf8")) as ApiSurface;
    const diff = diffApiSurface(await read(before), await read(after));
    for (const line of diff.added) io.out(`+ ${line}\n`);
    for (const line of diff.removed) io.err(`- ${line}\n`);
    io.out(`api-surface: ${diff.added.length} added, ${diff.removed.length} removed\n`);
    return diff.removed.length > 0 ? 1 : 0;
  }
  const [dir] = positionals(argv, ["--out"]);
  if (!dir) {
    io.err("api-surface <dist-or-pkg-dir> [--out <file>]\n");
    return 1;
  }
  const snapshot = await apiSurface(dir);
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  const out = option(argv, "--out");
  if (out) {
    await writeFile(out, json);
    io.out(`api-surface: wrote ${Object.keys(snapshot.subpaths).length} subpath(s) to ${out}\n`);
  } else io.out(json);
  const failed = Object.entries(snapshot.subpaths).filter(([, s]) => s.error);
  for (const [subpath, s] of failed) io.err(`! ${subpath}: ${s.error}\n`);
  return 0;
}

/** Run the CLI with `argv` (without the node/bin prefix); resolves to the exit code. */
export async function run(argv: string[], io: CliIo = processIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "scope-embed-css":
        return await scopeEmbedCss(rest, io);
      case "fix-elysia2-types":
        return await fixTypes(rest, io);
      case "api-surface":
        return await surface(rest, io);
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.out(HELP);
        return 0;
      default:
        io.err(`Unknown command "${command}".\n\n${HELP}`);
        return 1;
    }
  } catch (error) {
    io.err(`${command}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
