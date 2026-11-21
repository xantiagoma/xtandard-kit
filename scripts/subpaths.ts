/**
 * The single source of truth for the kit's subpath exports. `bun scripts/subpaths.ts --write`
 * regenerates `package.json#exports` and the `src/entry-*.ts` stubs that don't exist yet;
 * `vite.config.ts` imports {@link packEntries} for `vp pack`. Run with `--check` in CI.
 *
 * @module
 */

/** One public subpath: `"storage/redis"` → `src/entry-storage-redis.ts` → `dist/entry-storage-redis.*`. */
export interface Subpath {
  path: string;
  /** Peer(s) this subpath needs at runtime (documentation + stub header). */
  peers?: string[];
  /** ESM only (browser/React code and build tooling). */
  esmOnly?: boolean;
}

export const SUBPATHS: Subpath[] = [
  { path: "storage" },
  { path: "storage/memory" },
  { path: "storage/file" },
  { path: "storage/sqlite", peers: ["bun:sqlite"] },
  { path: "storage/sqlite/internals", peers: ["bun:sqlite"] },
  { path: "storage/libsql", peers: ["@libsql/client"] },
  { path: "storage/libsql/internals", peers: ["@libsql/client"] },
  { path: "storage/postgres", peers: ["pg"] },
  { path: "storage/postgres/internals", peers: ["pg"] },
  { path: "storage/mongodb", peers: ["mongodb"] },
  { path: "storage/mongodb/internals", peers: ["mongodb"] },
  { path: "storage/redis", peers: ["redis"] },
  { path: "storage/redis/internals", peers: ["redis"] },
  { path: "storage/cloudflare-kv" },
  { path: "storage/unstorage", peers: ["unstorage"] },
  { path: "storage/drizzle", peers: ["drizzle-orm"] },
  { path: "storage/drizzle/internals", peers: ["drizzle-orm"] },
  { path: "storage/testing" },
  { path: "drizzle/pg", peers: ["drizzle-orm"] },
  { path: "drizzle/mysql", peers: ["drizzle-orm"] },
  { path: "drizzle/sqlite", peers: ["drizzle-orm"] },
  { path: "auth" },
  { path: "auth/none" },
  { path: "auth/basic" },
  { path: "auth/delegated" },
  { path: "authorization" },
  { path: "authorization/none" },
  { path: "authorization/roles" },
  { path: "authorization/delegated" },
  { path: "hooks" },
  { path: "hooks/log" },
  { path: "server" },
  { path: "server/router" },
  { path: "tokens" },
  { path: "adapters/bun" },
  { path: "adapters/node" },
  { path: "adapters/express", peers: ["express"] },
  { path: "adapters/hono", peers: ["hono"] },
  { path: "adapters/elysia", peers: ["elysia"] },
  { path: "adapters/next" },
  { path: "cli" },
  { path: "util" },
  { path: "testing" },
  {
    path: "ui",
    esmOnly: true,
    peers: [
      "react",
      "react-dom",
      "@base-ui-components/react",
      "lucide-react",
      "wouter",
      "@tanstack/react-query",
    ],
  },
  {
    path: "ui/embed",
    esmOnly: true,
    peers: ["react", "react-dom", "wouter", "@tanstack/react-query"],
  },
  {
    path: "build",
    esmOnly: true,
    peers: [
      "postcss",
      "postcss-prefix-selector",
      "typescript",
      "vite",
      "vite-plus",
      "@vitejs/plugin-react",
      "@tailwindcss/vite",
      "@playwright/test",
    ],
  },
  {
    path: "site",
    esmOnly: true,
    peers: ["astro", "@astrojs/starlight", "starlight-typedoc", "typedoc"],
  },
];

/** `"storage/redis"` → `"entry-storage-redis"`; the root `"."` is `index`. */
export const entryName = (path: string): string => `entry-${path.replaceAll("/", "-")}`;

/** Entry files for `vp pack` (root + every subpath + the CLI bin). */
export const packEntries = (): string[] => [
  "src/index.ts",
  "src/bin.ts",
  ...SUBPATHS.map((s) => `src/${entryName(s.path)}.ts`),
];

function exportsMap(): Record<string, unknown> {
  const dual = (name: string) => ({
    import: { types: `./dist/${name}.d.mts`, default: `./dist/${name}.mjs` },
    require: { types: `./dist/${name}.d.cts`, default: `./dist/${name}.cjs` },
  });
  const esm = (name: string) => ({ types: `./dist/${name}.d.mts`, default: `./dist/${name}.mjs` });
  const map: Record<string, unknown> = { ".": dual("index") };
  for (const s of SUBPATHS)
    map[`./${s.path}`] = s.esmOnly ? esm(entryName(s.path)) : dual(entryName(s.path));
  map["./ui/styles.css"] = "./dist/ui/styles.css";
  map["./tsconfig/*"] = "./tsconfig/*";
  map["./package.json"] = "./package.json";
  return map;
}

if (import.meta.main) {
  const write = process.argv.includes("--write");
  const pkgFile = Bun.file(new URL("../package.json", import.meta.url));
  const pkg = await pkgFile.json();
  const want = exportsMap();
  if (write) {
    pkg.exports = want;
    await Bun.write(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
    for (const s of SUBPATHS) {
      const f = Bun.file(new URL(`../src/${entryName(s.path)}.ts`, import.meta.url));
      if (await f.exists()) continue;
      const peers = s.peers?.length
        ? `\n *\n * Optional peer(s): ${s.peers.map((p) => `\`${p}\``).join(", ")}.`
        : "";
      await Bun.write(
        f,
        `/**\n * \`@xtandard/kit/${s.path}\` — not implemented yet.${peers}\n *\n * @module\n */\n\nexport {};\n`,
      );
    }
    console.log(`wrote ${Object.keys(want).length} exports`);
  } else if (JSON.stringify(pkg.exports) !== JSON.stringify(want)) {
    console.error("package.json#exports is out of date: run `bun scripts/subpaths.ts --write`");
    process.exit(1);
  }
}
