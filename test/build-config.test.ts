/**
 * The toolchain config factories: the shared vite-plus skeleton, the SPA and embed builds, and the
 * Playwright config.
 *
 * @module
 */

import { defineConfig } from "vite-plus";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  defineEmbedConfig,
  definePlaywrightConfig,
  defineUiConfig,
  defineXtandardConfig,
} from "../src/build/config.ts";

type AnyConfig = Record<string, any>; // oxlint-disable-line typescript/no-explicit-any

describe("defineXtandardConfig", () => {
  it("builds the shared skeleton (and is accepted by vite-plus defineConfig)", () => {
    const config = defineConfig(
      defineXtandardConfig({ entries: ["src/index.ts", "src/cli.ts"] }),
    ) as AnyConfig;
    const [core, elysia2] = config.test.projects;
    expect(core.test.name).toBe("core");
    expect(core.test.exclude).toContain("test/**/*.bun.test.ts");
    expect(core.test.exclude).toContain("test/**/*.elysia2.test.ts");
    expect(core.test.typecheck).toBeUndefined();
    expect(elysia2).toMatchObject({
      resolve: { alias: { elysia: "elysia-v2" } },
      test: { name: "elysia2", passWithNoTests: true },
    });
    expect(config.test.retry).toBe(2);
    expect(config.test.coverage.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(config.test.coverage.exclude).toEqual([
      "src/ui/**",
      "src/entry-*.ts",
      "src/index.ts",
      "src/cli.ts",
    ]);
    expect(config.fmt.ignorePatterns).toContain("CHANGELOG.md");
    expect(config.fmt.ignorePatterns).toContain("site/**/*.mdx");
    expect(config.staged["*.{ts,tsx,md,json,jsonc,yml,yaml,css,html}"]).toEqual([
      "vp fmt --no-error-on-unmatched-pattern",
    ]);
    expect(config.pack[0]).toMatchObject({
      entry: ["src/index.ts", "src/cli.ts"],
      dts: true,
      format: ["esm", "cjs"],
    });
    expect(config.pack[0].deps.neverBundle).toEqual([/^bun:/]);
  });

  it("takes the product's thresholds, excludes, ignores and projects", () => {
    const config = defineXtandardConfig({
      entries: [],
      coverage: {
        thresholds: { statements: 92, branches: 85, functions: 90, lines: 92 },
        exclude: ["src/storage/sqlite.ts"],
        include: ["src/**/*.ts", "src/**/*.tsx"],
      },
      elysia2: false,
      typecheck: true,
      lintIgnore: ["NOTES-*.md"],
      fmtIgnore: ["docs/research/**"],
      neverBundle: ["cloudflare:workers"],
      retry: 0,
    }) as AnyConfig;
    expect(config.test.projects).toHaveLength(1);
    expect(config.test.projects[0].test.typecheck).toEqual({
      enabled: true,
      include: ["test/**/*.test-d.ts"],
    });
    expect(config.test.retry).toBe(0);
    expect(config.test.coverage.thresholds.statements).toBe(92);
    expect(config.test.coverage.exclude).toContain("src/storage/sqlite.ts");
    expect(config.test.coverage.include).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
    expect(config.lint.ignorePatterns).toContain("NOTES-*.md");
    expect(config.fmt.ignorePatterns).toContain("docs/research/**");
    expect(config.pack[0].deps.neverBundle).toEqual([/^bun:/, "cloudflare:workers"]);

    const custom = defineXtandardConfig({
      entries: [],
      elysia2: { include: ["test/e2.test.ts"] },
      typecheck: { include: ["test/types.ts"] },
    }) as AnyConfig;
    expect(custom.test.projects[1].test.include).toEqual(["test/e2.test.ts"]);
    expect(custom.test.projects[0].test.exclude).toContain("test/e2.test.ts");
    expect(custom.test.projects[0].test.typecheck.include).toEqual(["test/types.ts"]);
  });
});

describe("defineUiConfig / defineEmbedConfig", () => {
  it("builds the SPA into dist/ui with relative asset URLs, emptying it first", async () => {
    const config = (await defineUiConfig()) as AnyConfig;
    expect(config).toMatchObject({
      root: "src/ui",
      base: "./",
      build: { outDir: "../../dist/ui", emptyOutDir: true },
    });
    expect(config.plugins.flat().length).toBeGreaterThan(1);
    const custom = (await defineUiConfig({ root: "./app/ui/", outDir: "out/spa" })) as AnyConfig;
    expect(custom.build.outDir).toBe("../../out/spa");
  });

  it("builds the embed as an ESM library with React external", async () => {
    const config = (await defineEmbedConfig({
      entry: "src/entry-react-embed.ts",
      fileName: "react-embed.js",
      external: ["react-dom/server"],
    })) as AnyConfig;
    expect(config.build).toMatchObject({
      outDir: "dist",
      emptyOutDir: false,
      cssCodeSplit: false,
      lib: { entry: "src/entry-react-embed.ts", formats: ["es"] },
      rollupOptions: { output: { assetFileNames: "react.css" } },
    });
    expect(config.build.lib.fileName()).toBe("react-embed.js");
    expect(config.build.rollupOptions.external).toEqual([
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react-dom/client",
      "react-dom/server",
    ]);
    const plain = (await defineEmbedConfig({ entry: "src/react.tsx" })) as AnyConfig;
    expect(plain.build.lib.fileName()).toBe("react.js");
  });
});

describe("definePlaywrightConfig", () => {
  it("wires the port, server command and health check", () => {
    const config = definePlaywrightConfig({
      port: 3311,
      serverCmd: "bun run build:ui && bun e2e/server.ts",
      ci: false,
      env: { AUTH_MODE: "none" },
    }) as AnyConfig;
    expect(config).toMatchObject({
      testDir: "e2e",
      retries: 0,
      reporter: "list",
      use: { baseURL: "http://localhost:3311" },
      webServer: {
        command: "bun run build:ui && bun e2e/server.ts",
        url: "http://localhost:3311/healthcheck",
        timeout: 120_000,
        reuseExistingServer: true,
        env: { AUTH_MODE: "none", PORT: "3311" },
      },
    });
    expect(config.workers).toBeUndefined();
    expect(config.projects[0].use.browserName).toBe("chromium");
  });

  it("uses CI settings, workers and a custom health path", () => {
    const config = definePlaywrightConfig({
      port: 3411,
      serverCmd: "x",
      ci: true,
      workers: 1,
      healthPath: "/ent/healthcheck",
      timeout: 300_000,
      testDir: "tests/e2e",
    }) as AnyConfig;
    expect(config).toMatchObject({
      testDir: "tests/e2e",
      workers: 1,
      retries: 1,
      reporter: "github",
      webServer: {
        url: "http://localhost:3411/ent/healthcheck",
        timeout: 300_000,
        reuseExistingServer: false,
      },
    });
  });
});
