/**
 * Importing a storage subpath must never load its optional peer: every peer is imported lazily on
 * first use (ADR 0001). Each entry is bundled (esbuild) with every package left external and imported by
 * plain `node` from a directory with no `node_modules`, so a top-level peer import fails to
 * resolve. When `dist/` exists (after `bun run build`), the published files are checked the same
 * way.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const ENTRIES = [
  "storage",
  "storage-memory",
  "storage-file",
  "storage-unstorage",
  "storage-cloudflare-kv",
  "storage-testing",
  "storage-sqlite",
  "storage-sqlite-internals",
  "storage-libsql",
  "storage-libsql-internals",
  "storage-postgres",
  "storage-postgres-internals",
  "storage-drizzle",
  "storage-drizzle-internals",
  "storage-mongodb",
  "storage-mongodb-internals",
  "storage-redis",
  "storage-redis-internals",
];

const root = resolve(import.meta.dirname, "..");
const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function importUnderNode(file: string): string[] {
  const out = execFileSync(
    "node",
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(`file://${file}`)}); console.log(JSON.stringify(Object.keys(m)));`,
    ],
    { cwd: tmpdir(), encoding: "utf8", env: { ...process.env, NODE_PATH: "" } },
  );
  return JSON.parse(out) as string[];
}

describe("storage subpaths import under plain node with no peers installed", () => {
  test.each(ENTRIES)(
    "src/entry-%s.ts (bundled, packages external)",
    async (entry) => {
      const dir = await mkdtemp(join(tmpdir(), "kit-node-import-"));
      dirs.push(dir);
      const out = join(dir, `${entry}.mjs`);
      // esbuild (vite's own bundler): Bun's bundler mis-handles these re-exports in some releases
      // (1.3.x: "Export … is not defined in module").
      execFileSync(
        join(root, "node_modules/.bin/esbuild"),
        [
          join(root, `src/entry-${entry}.ts`),
          "--bundle",
          "--platform=node",
          "--format=esm",
          "--packages=external",
          "--log-level=error",
          `--outfile=${out}`,
        ],
        { cwd: root, stdio: "pipe" },
      );
      expect(importUnderNode(out).length > 0).toBe(true);
    },
    30_000,
  );

  test.skipIf(!existsSync(join(root, "dist/entry-storage-drizzle.mjs")))(
    "dist/entry-storage-{drizzle,sqlite,…}.mjs",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "kit-node-dist-"));
      dirs.push(dir);
      await cp(join(root, "dist"), dir, { recursive: true });
      // Throws (non-zero exit) when a module fails to load.
      for (const entry of ENTRIES) importUnderNode(join(dir, `entry-${entry}.mjs`));
    },
    60_000,
  );
});
