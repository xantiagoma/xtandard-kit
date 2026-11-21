import { defineConfig } from "vite-plus";
import { packEntries } from "./scripts/subpaths.ts";

export default defineConfig({
  test: {
    // Two projects: everything on Elysia 1.x, plus the Elysia adapter tests again with
    // `elysia` aliased to the `elysia-v2` devDep.
    projects: [
      {
        extends: true,
        test: {
          name: "core",
          include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
          exclude: [
            "node_modules/**",
            "dist/**",
            "e2e/**",
            "test/**/*.bun.test.ts",
            "test/**/*.elysia2.test.ts",
          ],
        },
      },
      {
        extends: true,
        resolve: { alias: { elysia: "elysia-v2" } },
        test: { name: "elysia2", include: ["test/**/*.elysia2.test.ts"] },
      },
    ],
    // Live-backend tests depend on pub/sub & timer timing; retry absorbs rare scheduling flakes.
    retry: 2,
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/entry-*.ts", "src/bin.ts", "src/storage/sqlite*.ts"],
      reporter: ["text", "html", "lcov"],
      thresholds: { statements: 90, branches: 82, functions: 90, lines: 90 },
    },
  },
  lint: {
    ignorePatterns: ["dist/**", "site/**", "e2e/.host/**"],
  },
  fmt: {
    // changelogen owns CHANGELOG.md; oxfmt mangles MDX comments; MISSION.md is a provided brief.
    ignorePatterns: [
      "CHANGELOG.md",
      "site/**/*.mdx",
      "MISSION.md",
      "docs/research/inventory/data/**",
    ],
  },
  staged: {
    "*.{ts,tsx,md,json,jsonc,yml,yaml,css,html}": ["vp fmt --no-error-on-unmatched-pattern"],
  },
  pack: [
    {
      entry: packEntries(),
      dts: true,
      format: ["esm", "cjs"],
      sourcemap: true,
      // `bun:sqlite` only exists in the Bun runtime — never bundle/resolve it.
      deps: { neverBundle: [/^bun:/] },
    },
  ],
});
