/**
 * Config factories for the products' toolchain, so the shared skeleton lives once and only the
 * product's entries, thresholds and ports are passed in:
 *
 * - {@link defineXtandardConfig}: the vite-plus config (test projects, coverage, lint, fmt, staged,
 *   pack);
 * - {@link defineUiConfig}: the bundled admin SPA build (`dist/ui`);
 * - {@link defineEmbedConfig}: the React embed library build (`dist/react.js` + `react.css`);
 * - {@link definePlaywrightConfig}: the browser e2e config.
 *
 * The vite plugins (`@vitejs/plugin-react`, `@tailwindcss/vite`) are optional peers, loaded when the
 * factory runs; the UI and embed factories therefore return a promise, which `vite` accepts as a
 * config export.
 *
 * @module
 */

import type { PlaywrightTestConfig } from "@playwright/test";
import type { UserConfig as ViteUserConfig, PluginOption } from "vite";
import type { UserConfig as VitePlusUserConfig } from "vite-plus";
import { importPeer } from "../internal/peer.ts";

const SUBPATH = "@xtandard/kit/build";

/** Coverage thresholds (percent). */
export interface CoverageThresholds {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

/** Options for {@link defineXtandardConfig}. */
export interface XtandardConfigOptions {
  /** `vp pack` entries (`src/index.ts`, `src/entry-*.ts`, `src/cli.ts`…). */
  entries: string[];
  /** Coverage settings; `include` defaults to `src/**\/*.ts`. */
  coverage?: {
    thresholds?: CoverageThresholds;
    /** Added to the default excludes (`src/ui/**`, `src/entry-*.ts`, `src/index.ts`, `src/cli.ts`). */
    exclude?: string[];
    include?: string[];
  };
  /**
   * The Elysia 2 test project (`elysia` aliased to the `elysia-v2` devDep). `true` (default) runs
   * `test/**\/*.elysia2.test.ts` and `test/elysia2.test.ts`; `false` drops it.
   */
  elysia2?: boolean | { include: string[] };
  /** Type tests (`test/**\/*.test-d.ts`) through vitest typecheck; default `false`. */
  typecheck?: boolean | { include: string[] };
  /** Added to the lint ignores (`dist/**`, `src/ui/**`, `apps/**`, `examples/**`, `site/**`). */
  lintIgnore?: string[];
  /** Added to the fmt ignores (`CHANGELOG.md`, `site/**\/*.mdx`, `MISSION.md`). */
  fmtIgnore?: string[];
  /** Added to `pack.deps.neverBundle` (`/^bun:/`). */
  neverBundle?: (string | RegExp)[];
  /** Test retries (live-backend timing); default `2`. */
  retry?: number;
}

/** The family's coverage thresholds (en, and the kit). */
export const DEFAULT_THRESHOLDS: CoverageThresholds = {
  statements: 90,
  branches: 82,
  functions: 90,
  lines: 90,
};

/**
 * The vite-plus config every product shares. Pass the result to `defineConfig` from `vite-plus`:
 *
 * ```ts
 * export default defineConfig(defineXtandardConfig({ entries: [...], coverage: { thresholds } }));
 * ```
 */
export function defineXtandardConfig(options: XtandardConfigOptions): VitePlusUserConfig {
  const elysia2 =
    options.elysia2 === false
      ? undefined
      : options.elysia2 === true || options.elysia2 === undefined
        ? ["test/**/*.elysia2.test.ts", "test/elysia2.test.ts"]
        : options.elysia2.include;
  const typecheck =
    options.typecheck === true
      ? { enabled: true, include: ["test/**/*.test-d.ts"] }
      : options.typecheck
        ? { enabled: true, include: options.typecheck.include }
        : undefined;

  const projects: unknown[] = [
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
          ...(elysia2 ?? []),
        ],
        ...(typecheck ? { typecheck } : {}),
      },
    },
  ];
  if (elysia2) {
    projects.push({
      extends: true,
      resolve: { alias: { elysia: "elysia-v2" } },
      test: { name: "elysia2", include: elysia2, passWithNoTests: true },
    });
  }

  const config = {
    test: {
      projects,
      // Live-backend tests depend on pub/sub & timer timing; retry absorbs rare scheduling flakes.
      retry: options.retry ?? 2,
      coverage: {
        provider: "v8",
        include: options.coverage?.include ?? ["src/**/*.ts"],
        exclude: [
          "src/ui/**",
          "src/entry-*.ts",
          "src/index.ts",
          "src/cli.ts",
          ...(options.coverage?.exclude ?? []),
        ],
        reporter: ["text", "html", "lcov"],
        thresholds: { ...(options.coverage?.thresholds ?? DEFAULT_THRESHOLDS) },
      },
    },
    lint: {
      ignorePatterns: [
        "dist/**",
        "src/ui/**",
        "apps/**",
        "examples/**",
        "site/**",
        ...(options.lintIgnore ?? []),
      ],
    },
    // changelogen owns CHANGELOG.md; oxfmt mangles MDX comments; MISSION.md is a provided brief.
    fmt: {
      ignorePatterns: ["CHANGELOG.md", "site/**/*.mdx", "MISSION.md", ...(options.fmtIgnore ?? [])],
    },
    // Pre-commit only formats. `--no-error-on-unmatched-pattern` keeps a commit that touches only
    // fmt-ignored files (CHANGELOG.md, .mdx) from failing with "no target files".
    staged: {
      "*.{ts,tsx,md,json,jsonc,yml,yaml,css,html}": ["vp fmt --no-error-on-unmatched-pattern"],
    },
    pack: [
      {
        entry: options.entries,
        dts: true,
        format: ["esm", "cjs"],
        sourcemap: true,
        // `bun:sqlite` only exists in the Bun runtime — never bundle/resolve it.
        deps: { neverBundle: [/^bun:/, ...(options.neverBundle ?? [])] },
      },
    ],
  };
  return config as VitePlusUserConfig;
}

async function vitePlugins(extra: PluginOption[] = []): Promise<PluginOption[]> {
  const [{ default: react }, { default: tailwindcss }] = await Promise.all([
    importPeer("@vitejs/plugin-react", SUBPATH, () => import("@vitejs/plugin-react")),
    importPeer("@tailwindcss/vite", SUBPATH, () => import("@tailwindcss/vite")),
  ]);
  return [react(), tailwindcss(), ...extra];
}

/** Options for {@link defineUiConfig}. */
export interface UiConfigOptions {
  /** The SPA source root (holds `index.html`); `"src/ui"` by default. */
  root?: string;
  /** Output directory, relative to the repo; `"dist/ui"` by default. */
  outDir?: string;
  /** Extra vite plugins. */
  plugins?: PluginOption[];
}

function relativeFrom(root: string, target: string): string {
  const up = root
    .split("/")
    .filter((s) => s && s !== ".")
    .map(() => "..");
  return [...up, target].join("/");
}

/**
 * The bundled admin SPA build. `base: "./"` keeps asset URLs relative so the SPA works under any
 * mount path (the panel injects a `<base>` tag); the output directory is emptied first, since it
 * only ever holds the SPA.
 */
export async function defineUiConfig(options: UiConfigOptions = {}): Promise<ViteUserConfig> {
  const root = options.root ?? "src/ui";
  return {
    root,
    base: "./",
    plugins: await vitePlugins(options.plugins),
    build: {
      outDir: relativeFrom(root, options.outDir ?? "dist/ui"),
      emptyOutDir: true,
    },
  };
}

/** Options for {@link defineEmbedConfig}. */
export interface EmbedConfigOptions {
  /** The embed entry (`"src/react.tsx"`, en: `"src/entry-react-embed.ts"`). */
  entry: string;
  /** Emitted JS file name; `"react.js"` by default. */
  fileName?: string;
  /** Emitted CSS file name; `"react.css"` by default. */
  cssFileName?: string;
  /** Output directory; `"dist"` by default (not emptied: the library and SPA live there too). */
  outDir?: string;
  /** Extra externals besides React. */
  external?: string[];
  /** Extra vite plugins. */
  plugins?: PluginOption[];
}

/**
 * The React embed library build: ESM, React external, everything else (the kit UI, TanStack
 * Query, Base UI, styles) bundled so the components are self-contained. The emitted CSS is a full
 * Tailwind build; run `xtandard-kit scope-embed-css` on it afterwards.
 */
export async function defineEmbedConfig(options: EmbedConfigOptions): Promise<ViteUserConfig> {
  const fileName = options.fileName ?? "react.js";
  return {
    plugins: await vitePlugins(options.plugins),
    build: {
      outDir: options.outDir ?? "dist",
      // The library build and the SPA live in dist/ too.
      emptyOutDir: false,
      cssCodeSplit: false,
      lib: { entry: options.entry, formats: ["es"], fileName: () => fileName },
      rollupOptions: {
        external: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "react-dom/client",
          ...(options.external ?? []),
        ],
        output: { assetFileNames: options.cssFileName ?? "react.css" },
      },
    },
  };
}

/** Options for {@link definePlaywrightConfig}. */
export interface PlaywrightConfigOptions {
  /** The e2e server port (wh/au/li 3311, fl 3310, en 3411). */
  port: number;
  /** Command that builds what it needs and starts the e2e server on `PORT`. */
  serverCmd: string;
  /** Health URL path the runner waits for; `"/healthcheck"` by default. */
  healthPath?: string;
  /** Server start timeout in ms; 120 s by default. */
  timeout?: number;
  /** Test directory; `"e2e"` by default. */
  testDir?: string;
  /** Worker count (en uses 1). */
  workers?: number;
  /** Extra environment for the server command. */
  env?: Record<string, string>;
  /** Whether `CI` is set; read from `process.env.CI` by default. */
  ci?: boolean;
}

/**
 * The browser e2e config: chromium, `PORT` passed to the server, retries and the GitHub reporter
 * on CI, an existing local server reused.
 */
export function definePlaywrightConfig(options: PlaywrightConfigOptions): PlaywrightTestConfig {
  const ci = options.ci ?? Boolean(process.env.CI);
  return {
    testDir: options.testDir ?? "e2e",
    testMatch: "**/*.spec.ts",
    fullyParallel: false,
    ...(options.workers ? { workers: options.workers } : {}),
    retries: ci ? 1 : 0,
    reporter: ci ? "github" : "list",
    use: { baseURL: `http://localhost:${options.port}`, trace: "on-first-retry" },
    projects: [
      {
        name: "chromium",
        use: { browserName: "chromium", viewport: { width: 1280, height: 720 } },
      },
    ],
    webServer: {
      command: options.serverCmd,
      url: `http://localhost:${options.port}${options.healthPath ?? "/healthcheck"}`,
      timeout: options.timeout ?? 120_000,
      reuseExistingServer: !ci,
      env: { ...options.env, PORT: String(options.port) },
    },
  };
}
